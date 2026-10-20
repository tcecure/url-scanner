"""Renders the TCecure business posture briefing from recorded findings."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

TEMPLATE_DIR = Path(__file__).parent / "templates"

SECTION_ORDER = ("Website", "Encryption", "Email", "DNS", "Review")


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(TEMPLATE_DIR),
        autoescape=select_autoescape(["html"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["ts"] = lambda value: value.strftime("%d %b %Y %H:%M UTC") if value else ""
    return env


def group(findings: Iterable[dict[str, Any]]) -> list[tuple[str, list[dict[str, Any]]]]:
    buckets: dict[str, list[dict[str, Any]]] = {}
    for finding in findings:
        buckets.setdefault(finding["category"], []).append(finding)
    ordered = [(name, buckets.pop(name)) for name in SECTION_ORDER if name in buckets]
    ordered.extend(sorted(buckets.items()))
    return ordered


def summarize(findings: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "observed": sum(1 for f in findings if f["outcome"] == "observed"),
        "absent": sum(1 for f in findings if f["outcome"] == "absent"),
        "attention": sum(1 for f in findings if f["severity_hint"] == "attention"),
        "consider": sum(1 for f in findings if f["severity_hint"] == "consider"),
        "errors": sum(1 for f in findings if f["outcome"] == "error"),
        "total": len(findings),
    }


def render_html(
    *,
    request: dict[str, Any],
    findings: list[dict[str, Any]],
    reviewer_notes: str | None = None,
    generated_at: datetime | None = None,
    logo_data_uri: str | None = None,
) -> str:
    generated_at = generated_at or datetime.now(timezone.utc)
    observed_window = [f["observed_at"] for f in findings if f.get("observed_at")]
    return _env().get_template("briefing.html").render(
        request=request,
        sections=group(findings),
        counts=summarize(findings),
        reviewer_notes=reviewer_notes,
        generated_at=generated_at,
        observed_from=min(observed_window) if observed_window else generated_at,
        observed_to=max(observed_window) if observed_window else generated_at,
        logo_data_uri=logo_data_uri,
    )


def render_pdf(html: str, *, base_url: str | None = None) -> bytes | None:
    """Render the briefing to PDF. Returns None when WeasyPrint is unavailable.

    The HTML briefing is the authoritative artifact; the PDF is a convenience
    copy, so a missing rendering stack must not fail the job.
    """
    try:
        from weasyprint import HTML  # imported lazily: heavy native dependency
    except Exception:
        return None
    return HTML(string=html, base_url=base_url or str(TEMPLATE_DIR)).write_pdf()
