"""SQLite. upsert_event is the only writer of events. One connection, used from the event loop."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCHEMA = Path(__file__).with_name("schema.sql")
DEFAULT_DB = Path(__file__).resolve().parent.parent / "sentinel.db"
KEY_NAME_MAX = 100
KEY_COLUMNS = "id, name, prefix, created_at, last_used_at"


@dataclass(frozen=True)
class ApiKey:
    """A gateway key as the dashboard sees it. The plain key exists only in create_key's return value."""

    id: str
    name: str
    prefix: str
    created_at: float
    last_used_at: float | None


def _digest(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class Store:
    def __init__(self, path: str | Path) -> None:
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.executescript(SCHEMA.read_text())

    @property
    def db(self) -> sqlite3.Connection:
        """Shared with ApprovalDesk, the only writer of approvals."""
        return self._db

    def upsert_event(self, event: dict[str, Any]) -> None:
        """seq is assigned on first insert only, so feed order is creation order."""
        upstream = event["upstream"]["id"] if event["upstream"] else None
        with self._db:
            self._db.execute(
                """INSERT INTO events (id, session_id, created_at, updated_at, stage, headline, upstream, body)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, stage = excluded.stage,
                     headline = excluded.headline, upstream = excluded.upstream, body = excluded.body""",
                (event["id"], event["session_id"], event["created_at"], event["updated_at"], event["stage"],
                 event["headline"], upstream, json.dumps(event)),
            )

    def events(self, limit: int = 200, session: str | None = None) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT body FROM events WHERE ? IS NULL OR session_id = ? ORDER BY seq DESC LIMIT ?",
                                (session, session, limit))
        return [json.loads(body) for (body,) in rows]

    def stats(self) -> dict[str, dict[str, int]]:
        """Aggregated on read, so there are no counters to drift."""
        q = self._db.execute
        return {
            "by_action": dict(q("SELECT headline, COUNT(*) FROM events GROUP BY headline")),
            "by_entity": dict(q("""SELECT e.key, SUM(e.value) FROM events,
                                     json_each(events.body, '$.request.entity_counts') AS e GROUP BY e.key""")),
            "by_destination": dict(q("SELECT upstream, COUNT(*) FROM events WHERE upstream IS NOT NULL "
                                     "GROUP BY upstream")),
        }

    def create_key(self, name: str) -> tuple[ApiKey, str]:
        """(record, plain key). The key is fk_ plus 40 URL-safe characters; 30 random bytes encode to exactly 40."""
        key = "fk_" + secrets.token_urlsafe(30)
        record = ApiKey(uuid.uuid4().hex, name, key[:8], time.time(), None)
        with self._db:
            self._db.execute(f"INSERT INTO api_keys ({KEY_COLUMNS}, hash) VALUES (?, ?, ?, ?, ?, ?)",
                             (record.id, record.name, record.prefix, record.created_at, None, _digest(key)))
        return record, key

    def keys(self) -> list[ApiKey]:
        return [ApiKey(*row) for row in self._db.execute(f"SELECT {KEY_COLUMNS} FROM api_keys ORDER BY created_at")]

    def revoke_key(self, key_id: str) -> bool:
        with self._db:
            return self._db.execute("DELETE FROM api_keys WHERE id = ?", (key_id,)).rowcount == 1

    def use_key(self, key: str) -> str | None:
        """The key's name, stamping last_used_at, or None for an unknown or revoked key."""
        with self._db:
            row = self._db.execute("UPDATE api_keys SET last_used_at = ? WHERE hash = ? RETURNING name",
                                   (time.time(), _digest(key))).fetchone()
        return row[0] if row else None
