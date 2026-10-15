"""Outbox flush, against the dict rows the worker's connections return."""

from __future__ import annotations

from tcescan import mailer
from tcescan.config import Config


class FakeCursor:
    def __init__(self, rows, executed):
        self._rows = rows
        self._executed = executed

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, sql, params=None):
        self._executed.append((" ".join(sql.split()), params))

    def fetchall(self):
        return self._rows


class FakeConn:
    def __init__(self, rows):
        self.rows = rows
        self.executed: list[tuple[str, object]] = []
        self._served = False

    def cursor(self):
        rows, self.rows = ([] if self._served else self.rows), []
        self._served = True
        return FakeCursor(rows, self.executed)


def config(**overrides) -> Config:
    return Config(database_url="postgres://localhost/none", mail_transport="log", **overrides)


def test_logged_transport_marks_each_row_by_id():
    conn = FakeConn([
        {
            "id": 7,
            "to_address": "owner@example.com",
            "subject": "Confirm your request",
            "body_text": "text",
            "body_html": None,
        }
    ])

    handled = mailer.flush_pending(conn, config())

    assert handled == 1
    updates = [params for sql, params in conn.executed if sql.startswith("UPDATE email_outbox")]
    assert updates == [("logged", None, 7)]
