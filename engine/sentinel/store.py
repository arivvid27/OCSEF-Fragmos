"""SQLite. upsert_event is the only writer of events. One connection, used from the event loop."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

SCHEMA = Path(__file__).with_name("schema.sql")


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

    def events(self, limit: int = 200) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT body FROM events ORDER BY seq DESC LIMIT ?", (limit,))
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
