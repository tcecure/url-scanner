"""Shared data types for the snapshot worker."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

Outcome = Literal["observed", "absent", "error", "not_applicable"]
SeverityHint = Literal["informational", "consider", "attention"]


@dataclass
class Finding:
    """One observation.

    `summary` states only what was seen, with `evidence` to back it; advice goes
    in `recommendation` so a briefing can keep the two apart. An absent control
    is an absence, never a proven vulnerability.
    """

    check_id: str
    category: str
    title: str
    outcome: Outcome
    severity_hint: SeverityHint
    summary: str
    recommendation: str | None
    evidence: dict[str, Any]
    observed_at: datetime

    def as_row(self, request_id: str, job_id: int | None) -> dict[str, Any]:
        return {
            "request_id": request_id,
            "job_id": job_id,
            "check_id": self.check_id,
            "category": self.category,
            "title": self.title,
            "outcome": self.outcome,
            "severity_hint": self.severity_hint,
            "summary": self.summary,
            "recommendation": self.recommendation,
            "evidence": self.evidence,
            "observed_at": self.observed_at,
        }


@dataclass
class SnapshotResult:
    domain: str
    findings: list[Finding] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
