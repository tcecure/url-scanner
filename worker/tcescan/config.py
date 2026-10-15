"""Worker configuration. Every secret comes from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Config:
    database_url: str = field(default_factory=lambda: os.environ["DATABASE_URL"])
    public_base_url: str = field(
        default_factory=lambda: os.environ.get("PUBLIC_BASE_URL", "https://scan.tcecure.com")
    )
    # Public resolvers; the worker network does not use the lab's internal DNS.
    resolvers: list[str] = field(
        default_factory=lambda: [
            s.strip() for s in os.environ.get("PUBLIC_RESOLVERS", "1.1.1.1,8.8.8.8").split(",") if s.strip()
        ]
    )
    poll_seconds: float = field(default_factory=lambda: float(os.environ.get("WORKER_POLL_SECONDS", "3")))
    max_concurrent_jobs: int = field(default_factory=lambda: _int("WORKER_CONCURRENCY", 2))
    job_timeout_seconds: int = field(default_factory=lambda: _int("JOB_TIMEOUT_SECONDS", 120))
    max_attempts: int = field(default_factory=lambda: _int("JOB_MAX_ATTEMPTS", 3))
    retention_days: int = field(default_factory=lambda: _int("RETENTION_DAYS", 90))

    # Mail. While no TCecure sending identity exists the transport is 'log':
    # messages are still written to email_outbox so the flow is complete and
    # auditable, but nothing leaves the network.
    mail_transport: str = field(default_factory=lambda: os.environ.get("MAIL_TRANSPORT", "log"))
    smtp_host: str = field(default_factory=lambda: os.environ.get("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: _int("SMTP_PORT", 587))
    smtp_user: str = field(default_factory=lambda: os.environ.get("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: os.environ.get("SMTP_PASSWORD", ""))
    mail_from: str = field(default_factory=lambda: os.environ.get("MAIL_FROM", "no-reply@tcecure.com"))
    mail_from_name: str = field(default_factory=lambda: os.environ.get("MAIL_FROM_NAME", "TCecure"))
    reply_to: str = field(default_factory=lambda: os.environ.get("MAIL_REPLY_TO", ""))

    def redacted(self) -> dict[str, object]:
        """A log-safe view; credentials are never rendered."""
        data = {k: v for k, v in self.__dict__.items()}
        data["database_url"] = _redact_url(self.database_url)
        data["smtp_password"] = "<set>" if self.smtp_password else "<unset>"
        data["smtp_user"] = "<set>" if self.smtp_user else "<unset>"
        return data


def _redact_url(url: str) -> str:
    if "@" not in url:
        return url
    scheme, rest = url.split("://", 1) if "://" in url else ("", url)
    _creds, host = rest.split("@", 1)
    return f"{scheme}://<redacted>@{host}" if scheme else f"<redacted>@{host}"
