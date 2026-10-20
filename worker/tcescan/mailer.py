"""Outbound mail.

Every message is recorded in `email_outbox` first. With MAIL_TRANSPORT=log the
record is all that happens — nothing leaves the network — which is the posture
until a TCecure sending identity exists. A DigitalRCC relay is never used for
TCecure mail.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

import psycopg

from .config import Config
from .db import queue_mail

log = logging.getLogger(__name__)


def send(conn: psycopg.Connection, cfg: Config, *, request_id: str | None, to_address: str,
         subject: str, body_text: str, body_html: str | None, template: str) -> int:
    mail_id = queue_mail(
        conn,
        request_id=request_id,
        to_address=to_address,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        template=template,
        transport=cfg.mail_transport,
    )
    if cfg.mail_transport != "smtp":
        _mark(conn, mail_id, "logged", None)
        log.info("mail %s recorded for %s (transport=log, not sent): %s", mail_id, to_address, subject)
        return mail_id
    try:
        _smtp_send(cfg, to_address=to_address, subject=subject, body_text=body_text, body_html=body_html)
        _mark(conn, mail_id, "sent", None)
    except Exception as exc:
        # The message text is kept; the failure reason never includes credentials.
        _mark(conn, mail_id, "failed", f"{type(exc).__name__}")
        log.error("mail %s to %s failed: %s", mail_id, to_address, type(exc).__name__)
        raise
    return mail_id


def _smtp_send(cfg: Config, *, to_address: str, subject: str, body_text: str, body_html: str | None) -> None:
    message = EmailMessage()
    message["From"] = f"{cfg.mail_from_name} <{cfg.mail_from}>"
    message["To"] = to_address
    message["Subject"] = subject
    if cfg.reply_to:
        message["Reply-To"] = cfg.reply_to
    message.set_content(body_text)
    if body_html:
        message.add_alternative(body_html, subtype="html")
    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        if cfg.smtp_user:
            smtp.login(cfg.smtp_user, cfg.smtp_password)
        smtp.send_message(message)


def flush_pending(conn: psycopg.Connection, cfg: Config, *, limit: int = 20) -> int:
    """Deliver messages the web tier queued.

    The web application has no outbound path of its own, so it only writes rows;
    this is where they leave (or, with MAIL_TRANSPORT=log, are marked recorded).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, to_address, subject, body_text, body_html
              FROM email_outbox
             WHERE status = 'pending'
          ORDER BY id
             LIMIT %s
            FOR UPDATE SKIP LOCKED
            """,
            (limit,),
        )
        rows = cur.fetchall()

    handled = 0
    for row in rows:
        mail_id = row["id"]
        to_address = row["to_address"]
        subject = row["subject"]
        if cfg.mail_transport != "smtp":
            _mark(conn, mail_id, "logged", None)
            log.info("mail %s recorded for %s (transport=log, not sent): %s", mail_id, to_address, subject)
        else:
            try:
                _smtp_send(cfg, to_address=to_address, subject=subject,
                           body_text=row["body_text"], body_html=row["body_html"])
                _mark(conn, mail_id, "sent", None)
            except Exception as exc:
                _mark(conn, mail_id, "failed", f"{type(exc).__name__}")
                log.error("mail %s to %s failed: %s", mail_id, to_address, type(exc).__name__)
        handled += 1
    return handled


def _mark(conn: psycopg.Connection, mail_id: int, status: str, error: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE email_outbox SET status = %s, error = %s, sent_at = now() WHERE id = %s",
            (status, error, mail_id),
        )
