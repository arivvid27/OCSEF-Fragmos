"""ApprovalDesk: the HOLD wait and the only writer of the approvals table.

Every terminal write is one conditional UPDATE. Approve and deny need the row pending and unexpired; expiry needs it
pending and expired. SQLite picks exactly one winner, only the winner resolves the future, and a loser reads the
stored row. No await sits between a winning UPDATE and set_result, so a resolved row always has a resolved future.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
import uuid
from typing import Any, Awaitable, Callable, Literal

from sentinel import wire
from sentinel.core.model import ApprovalRef, ApprovalStatus, HoldSubject

HOLD_SECONDS = 60.0

Verdict = Literal["approved", "denied"]


class ApprovalDesk:
    def __init__(self, db: sqlite3.Connection, broadcast: Callable[[dict[str, Any]], Awaitable[None]],
                 ttl_s: float = HOLD_SECONDS, clock: Callable[[], float] = time.time) -> None:
        self._db, self._broadcast, self._ttl, self._clock = db, broadcast, ttl_s, clock
        self._futures: dict[str, asyncio.Future[ApprovalStatus]] = {}

    def expire_orphans(self) -> int:
        """At boot: no future survives a restart, so nothing pending can ever be approved."""
        with self._db:
            return self._db.execute("UPDATE approvals SET status = 'expired', resolved_at = ? WHERE status = 'pending'",
                                    (self._clock(),)).rowcount

    def list(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._db.execute(f"SELECT {COLUMNS} FROM approvals ORDER BY status = 'pending' DESC, created_at DESC "
                                "LIMIT ?", (limit,))
        return [_approval(r) for r in rows]

    def get(self, approval_id: str) -> dict[str, Any] | None:
        row = self._db.execute(f"SELECT {COLUMNS} FROM approvals WHERE id = ?", (approval_id,)).fetchone()
        return _approval(row) if row else None

    async def hold(self, subject: HoldSubject, on_open: Callable[[ApprovalRef], Awaitable[None]]) -> ApprovalStatus:
        now = self._clock()
        ref = ApprovalRef(uuid.uuid4().hex, "pending", now, now + self._ttl)
        body = {**wire.hold_subject_to_json(subject), "expires_at": ref.expires_at}
        with self._db:
            self._db.execute("INSERT INTO approvals (id, event_id, status, created_at, expires_at, subject) "
                             "VALUES (?, ?, 'pending', ?, ?, ?)",
                             (ref.id, subject.event_id, ref.created_at, ref.expires_at, json.dumps(body)))
        future = self._futures[ref.id] = asyncio.get_running_loop().create_future()
        try:
            await on_open(ref)
            await self._announce(ref.id)
            while True:
                try:
                    return await asyncio.wait_for(asyncio.shield(future), max(ref.expires_at - self._clock(), 0))
                except TimeoutError:
                    if self._finish(ref.id, "expired"):
                        await self._announce(ref.id)
                        return "expired"
                    stored = self.get(ref.id)["status"]
                    if stored != "pending":
                        return stored
                    # Still pending: the timer fired before the deadline by the clock's reckoning.
        finally:
            self._futures.pop(ref.id, None)

    async def decide(self, approval_id: str, verdict: Verdict) -> tuple[bool, dict[str, Any]]:
        """(accepted, stored row). Repeating the stored verdict is accepted; anything else after resolution is not.
        Raises KeyError for an unknown id."""
        if self.get(approval_id) is None:
            raise KeyError(approval_id)
        if self._finish(approval_id, verdict) or self._finish(approval_id, "expired"):
            await self._announce(approval_id)
        row = self.get(approval_id)
        return row["status"] == verdict, row

    def _finish(self, approval_id: str, status: ApprovalStatus) -> bool:
        now = self._clock()
        deadline = "expires_at <= ?" if status == "expired" else "expires_at > ?"
        with self._db:
            won = self._db.execute(f"UPDATE approvals SET status = ?, resolved_at = ? "
                                   f"WHERE id = ? AND status = 'pending' AND {deadline}",
                                   (status, now, approval_id, now)).rowcount == 1
        future = self._futures.get(approval_id)
        if won and future is not None and not future.done():
            future.set_result(status)
        return won

    async def _announce(self, approval_id: str) -> None:
        await self._broadcast({"kind": "approval", "data": self.get(approval_id)})


COLUMNS = "id, event_id, status, created_at, expires_at, resolved_at, subject"


def _approval(row: tuple) -> dict[str, Any]:
    keys = [c.strip() for c in COLUMNS.split(",")]
    approval = dict(zip(keys, row))
    approval["subject"] = json.loads(approval["subject"])
    return approval
