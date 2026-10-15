"""Database access for the worker. The job queue is Postgres itself."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


@contextmanager
def connect(database_url: str) -> Iterator[psycopg.Connection]:
    with psycopg.connect(database_url, row_factory=dict_row, autocommit=False) as conn:
        yield conn


def claim_job(conn: psycopg.Connection, *, max_attempts: int) -> dict[str, Any] | None:
    """Claim one queued job.

    SKIP LOCKED lets several workers share the queue without a broker; a job
    whose claim expired is reclaimed so a worker dying mid-check is not fatal.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE jobs AS j
               SET status      = 'running',
                   attempts    = j.attempts + 1,
                   claimed_at  = now(),
                   claim_expires_at = now() + make_interval(secs => j.timeout_seconds),
                   updated_at  = now()
             WHERE j.id = (
                   SELECT id FROM jobs
                    WHERE (status = 'queued'
                           OR (status = 'running' AND claim_expires_at < now()))
                      AND attempts < %(max_attempts)s
                    ORDER BY created_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1)
         RETURNING j.id, j.request_id, j.kind, j.attempts, j.timeout_seconds
            """,
            {"max_attempts": max_attempts},
        )
        job = cur.fetchone()
        if job is None:
            conn.rollback()
            return None
        cur.execute(
            "SELECT id, business_name, target_domain, contact_name, contact_email, status,"
            "       verification_secret, authorized_at, email_verified_at"
            "  FROM requests WHERE id = %s",
            (job["request_id"],),
        )
        job["request"] = cur.fetchone()
    conn.commit()
    return job


def record_findings(conn: psycopg.Connection, request_id: str, job_id: int, findings: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM findings WHERE request_id = %s", (request_id,))
        for row in findings:
            cur.execute(
                """
                INSERT INTO findings (request_id, job_id, check_id, category, title, outcome,
                                      severity_hint, summary, recommendation, evidence, observed_at)
                VALUES (%(request_id)s, %(job_id)s, %(check_id)s, %(category)s, %(title)s, %(outcome)s,
                        %(severity_hint)s, %(summary)s, %(recommendation)s, %(evidence)s, %(observed_at)s)
                """,
                {**row, "job_id": job_id, "evidence": Jsonb(row["evidence"])},
            )


def finish_job(conn: psycopg.Connection, job_id: int, *, status: str, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = %s, error = %s, finished_at = now(), updated_at = now() WHERE id = %s",
            (status, error, job_id),
        )


def mark_authorized(conn: psycopg.Connection, request_id: str, *, method: str,
                    evidence: dict[str, Any]) -> None:
    """Record proven control of the website and let the snapshot proceed."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE requests
               SET authorized_at = coalesce(authorized_at, now()),
                   authorized_method = %(method)s,
                   authorized_by = 'self-service',
                   authorization_evidence = %(evidence)s,
                   status = CASE WHEN status = 'awaiting_authorization'
                                 THEN 'queued'::request_status ELSE status END,
                   updated_at = now()
             WHERE id = %(request_id)s AND email_verified_at IS NOT NULL
            """,
            {"request_id": request_id, "method": method, "evidence": Jsonb(evidence)},
        )


def queue_snapshot(conn: psycopg.Connection, request_id: str, *, timeout_seconds: int) -> int | None:
    """Queue the one snapshot an authorized request is entitled to."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO jobs (request_id, kind, status, timeout_seconds)
                 SELECT %(request_id)s, 'snapshot', 'queued', %(timeout_seconds)s
                  WHERE EXISTS (SELECT 1 FROM requests
                                 WHERE id = %(request_id)s AND authorized_at IS NOT NULL)
                    AND NOT EXISTS (SELECT 1 FROM jobs
                                     WHERE request_id = %(request_id)s AND kind = 'snapshot')
              RETURNING id
            """,
            {"request_id": request_id, "timeout_seconds": timeout_seconds},
        )
        row = cur.fetchone()
    return row["id"] if row else None


def set_request_status(conn: psycopg.Connection, request_id: str, status: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE requests SET status = %s, updated_at = now() WHERE id = %s",
            (status, request_id),
        )


def save_report(conn: psycopg.Connection, request_id: str, *, html: str, pdf: bytes | None) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO reports (request_id, status, html, pdf)
            VALUES (%s, 'pending_review', %s, %s)
            ON CONFLICT (request_id) DO UPDATE
               SET html = EXCLUDED.html, pdf = EXCLUDED.pdf,
                   status = 'pending_review', updated_at = now()
         RETURNING id
            """,
            (request_id, html, pdf),
        )
        return cur.fetchone()["id"]


def audit(conn: psycopg.Connection, *, request_id: str | None, action: str, actor: str, detail: dict[str, Any] | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO audit_log (request_id, action, actor, detail) VALUES (%s, %s, %s, %s)",
            (request_id, action, actor, Jsonb(detail or {})),
        )


def queue_mail(
    conn: psycopg.Connection,
    *,
    request_id: str | None,
    to_address: str,
    subject: str,
    body_text: str,
    body_html: str | None,
    template: str,
    transport: str,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO email_outbox (request_id, to_address, subject, body_text, body_html, template, transport)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (request_id, to_address, subject, body_text, body_html, template, transport),
        )
        return cur.fetchone()["id"]


def purge_expired(conn: psycopg.Connection) -> int:
    """Delete requests past their retention date, and their dependent rows."""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM requests WHERE delete_after < now() RETURNING id",
        )
        deleted = cur.fetchall()
        cur.execute("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'")
    return len(deleted)


def json_dumps(value: Any) -> str:
    return json.dumps(value, default=str, separators=(",", ":"))
