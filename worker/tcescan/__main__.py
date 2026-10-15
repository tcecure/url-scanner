"""Worker entry point: claim snapshot jobs, run the checks, build the briefing.

Nothing is delivered from here. A completed job leaves the request in
`awaiting_review`; a TCecure reviewer decides whether the briefing is sent.
"""

from __future__ import annotations

import base64
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from . import authorization, db, mailer, report
from .checks import run_all
from .config import Config

log = logging.getLogger("tcescan.worker")

# Installed, the package sits in site-packages and the repository layout is gone,
# so the image sets this to where it stages the brand asset.
LOGO = Path(
    os.environ.get(
        "BRAND_LOGO_PATH",
        Path(__file__).resolve().parents[2] / "web" / "public" / "brand" / "tcecure-logo-white.png",
    )
)

_stopping = False


def _handle_signal(signum, _frame):
    global _stopping
    log.info("signal %s received; finishing the current job then stopping", signum)
    _stopping = True


def logo_data_uri() -> str | None:
    if not LOGO.exists():
        return None
    return "data:image/png;base64," + base64.b64encode(LOGO.read_bytes()).decode()


def process_one(cfg: Config) -> bool:
    """Claim and run a single job. Returns False when the queue is empty."""
    with db.connect(cfg.database_url) as conn:
        job = db.claim_job(conn, max_attempts=cfg.max_attempts)
        if job is None:
            return False
        if job["kind"] == "authorization_probe":
            _run_authorization_probe(conn, cfg, job)
            return True
        _run_snapshot(conn, cfg, job)
    return True


def _run_authorization_probe(conn, cfg: Config, job: dict) -> None:
    """Look for the verification value the customer was asked to publish.

    Not finding it is an ordinary outcome, not a failure: the customer may still
    be waiting on DNS to propagate, and can ask again.
    """
    request = job["request"]
    request_id = str(request["id"])
    domain = request["target_domain"]
    try:
        check = authorization.verify(domain, request["verification_secret"], nameservers=cfg.resolvers)
    except Exception as exc:
        db.finish_job(conn, job["id"], status="failed", error=f"{type(exc).__name__}: {exc}")
        db.audit(conn, request_id=request_id, action="authorization.probe_error", actor="worker",
                 detail={"job_id": job["id"], "error": type(exc).__name__})
        conn.commit()
        log.exception("job %s: authorization probe of %s errored", job["id"], domain)
        return

    if check.verified:
        db.mark_authorized(conn, request_id, method=check.method, evidence=check.evidence)
        snapshot_job = db.queue_snapshot(conn, request_id, timeout_seconds=cfg.job_timeout_seconds)
        db.audit(conn, request_id=request_id, action="authorization.verified", actor="worker",
                 detail={"method": check.method, "snapshot_job": snapshot_job})
        log.info("job %s: %s verified by %s; snapshot queued", job["id"], domain, check.method)
    else:
        db.audit(conn, request_id=request_id, action="authorization.not_found", actor="worker",
                 detail={"job_id": job["id"], "evidence": check.evidence})
        log.info("job %s: no verification value published for %s yet", job["id"], domain)
    db.finish_job(conn, job["id"], status="succeeded")
    conn.commit()


def _run_snapshot(conn, cfg: Config, job: dict) -> None:
    request = job["request"]
    request_id = str(request["id"])
    domain = request["target_domain"]
    log.info("job %s: snapshot of %s (attempt %s)", job["id"], domain, job["attempts"])
    db.set_request_status(conn, request_id, "running")
    db.audit(conn, request_id=request_id, action="snapshot.started", actor="worker",
             detail={"job_id": job["id"], "attempt": job["attempts"]})
    conn.commit()

    started = time.monotonic()
    try:
        result = run_all(domain, nameservers=cfg.resolvers)
        rows = [f.as_row(request_id, job["id"]) for f in result.findings]
        db.record_findings(conn, request_id, job["id"], rows)

        html = report.render_html(
            request=dict(request),
            findings=rows,
            generated_at=datetime.now(timezone.utc),
            logo_data_uri=logo_data_uri(),
        )
        pdf = report.render_pdf(html)
        db.save_report(conn, request_id, html=html, pdf=pdf)
        db.finish_job(conn, job["id"], status="succeeded",
                      error="; ".join(result.errors) if result.errors else None)
        db.set_request_status(conn, request_id, "awaiting_review")
        db.audit(conn, request_id=request_id, action="snapshot.completed", actor="worker",
                 detail={"job_id": job["id"], "findings": len(rows),
                         "seconds": round(time.monotonic() - started, 1),
                         "pdf": pdf is not None, "errors": result.errors})
        conn.commit()
        log.info("job %s: %s findings, awaiting review", job["id"], len(rows))
    except Exception as exc:
        conn.rollback()
        final = job["attempts"] >= cfg.max_attempts
        db.finish_job(conn, job["id"], status="failed" if final else "queued",
                      error=f"{type(exc).__name__}: {exc}")
        if final:
            db.set_request_status(conn, request_id, "failed")
        db.audit(conn, request_id=request_id, action="snapshot.failed", actor="worker",
                 detail={"job_id": job["id"], "error": type(exc).__name__, "final": final})
        conn.commit()
        log.exception("job %s failed (final=%s)", job["id"], final)


def deliver_queued_mail(cfg: Config) -> int:
    with db.connect(cfg.database_url) as conn:
        handled = mailer.flush_pending(conn, cfg)
        conn.commit()
    return handled


def housekeeping(cfg: Config) -> None:
    with db.connect(cfg.database_url) as conn:
        removed = db.purge_expired(conn)
        if removed:
            db.audit(conn, request_id=None, action="retention.purged", actor="worker",
                     detail={"requests_deleted": removed})
            log.info("retention: deleted %s request(s) past their retention date", removed)
        conn.commit()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )
    cfg = Config()
    log.info("worker starting: %s", {k: v for k, v in cfg.redacted().items() if k != "database_url"})
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    last_housekeeping = 0.0
    while not _stopping:
        try:
            worked = process_one(cfg)
        except Exception:
            log.exception("worker loop error; backing off")
            worked = False
        try:
            worked = bool(deliver_queued_mail(cfg)) or worked
        except Exception:
            log.exception("mail delivery failed; messages remain queued")
        now = time.monotonic()
        if now - last_housekeeping > 3600:
            try:
                housekeeping(cfg)
            except Exception:
                log.exception("housekeeping failed")
            last_housekeeping = now
        if not worked:
            time.sleep(cfg.poll_seconds)
    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
