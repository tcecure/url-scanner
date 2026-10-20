"""Retention purge, against the dict rows the worker's connections return."""

from __future__ import annotations

from tcescan import db


class FakeCursor:
    def __init__(self, conn):
        self._conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, sql, params=None):
        self._conn.executed.append((" ".join(sql.split()), params))

    def fetchall(self):
        return self._conn.expired


class FakeConn:
    def __init__(self, expired):
        self.expired = expired
        self.executed: list[tuple[str, object]] = []

    def cursor(self):
        return FakeCursor(self)


def statements(conn):
    return [sql for sql, _params in conn.executed]


def test_expired_requests_take_their_mail_with_them():
    conn = FakeConn([{"id": "r1"}, {"id": "r2"}])

    assert db.purge_expired(conn) == 2

    mail = [params for sql, params in conn.executed if sql.startswith("DELETE FROM email_outbox")]
    assert mail == [(["r1", "r2"],)]
    # The mail rows reference the request, so they have to go first.
    assert statements(conn).index("DELETE FROM email_outbox WHERE request_id = ANY(%s)") < statements(
        conn
    ).index("DELETE FROM requests WHERE id = ANY(%s)")


def test_nothing_expired_deletes_nothing():
    conn = FakeConn([])

    assert db.purge_expired(conn) == 0

    assert not [sql for sql in statements(conn) if sql.startswith("DELETE FROM requests")]
    assert not [sql for sql in statements(conn) if sql.startswith("DELETE FROM email_outbox")]
