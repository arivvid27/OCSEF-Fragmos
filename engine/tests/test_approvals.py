import asyncio
import time

from sentinel.approvals import ApprovalDesk
from sentinel.core.model import HoldSubject
from sentinel.store import Store

SUBJECT = HoldSubject("event-1", "tool_calls", "personal-data-needs-approval", "send_email carries PERSON",
                      frozenset({"PERSON"}))


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class Desk:
    def __init__(self, ttl_s=60.0, clock=time.time, db=None):
        self.broadcasts, self.opened = [], []
        self.db = db or Store(":memory:").db
        self.desk = ApprovalDesk(self.db, self._broadcast, ttl_s=ttl_s, clock=clock)

    async def _broadcast(self, message):
        assert message["kind"] == "approval"
        self.broadcasts.append(message["data"])

    async def _open(self, ref):
        self.opened.append(ref)

    async def start(self):
        opened = len(self.opened)
        task = asyncio.create_task(self.desk.hold(SUBJECT, self._open))
        while len(self.opened) == opened:
            await asyncio.sleep(0)
        return task, self.opened[-1].id

    def statuses(self):
        return [b["status"] for b in self.broadcasts]


def test_approve_before_the_deadline_wins_and_repeats_are_idempotent():
    async def scenario():
        d = Desk(clock=Clock())
        task, approval_id = await d.start()
        first = await d.desk.decide(approval_id, "approved")
        again = await d.desk.decide(approval_id, "approved")
        contra = await d.desk.decide(approval_id, "denied")
        return d, await task, first, again, contra

    d, held, first, again, contra = asyncio.run(scenario())
    assert held == "approved"
    assert (first[0], first[1]["status"]) == (True, "approved")
    assert again == first
    assert (contra[0], contra[1]) == (False, first[1])
    assert d.statuses() == ["pending", "approved"]


def test_post_after_the_deadline_expires_the_row_and_gets_409():
    async def scenario():
        clock = Clock()
        d = Desk(ttl_s=60.0, clock=clock)
        task, approval_id = await d.start()
        clock.now += 60.0
        posted = await d.desk.decide(approval_id, "approved")
        return d, await task, posted

    d, held, (accepted, row) = asyncio.run(scenario())
    assert (held, accepted, row["status"]) == ("expired", False, "expired")
    assert d.statuses() == ["pending", "expired"]


def test_timer_expiry_then_post_gets_409_expired():
    async def scenario():
        d = Desk(ttl_s=0.02)
        task, approval_id = await d.start()
        held = await task
        return d, held, await d.desk.decide(approval_id, "approved")

    d, held, (accepted, row) = asyncio.run(scenario())
    assert (held, accepted, row["status"]) == ("expired", False, "expired")
    assert d.statuses() == ["pending", "expired"]


def test_approve_racing_expiry_has_exactly_one_winner():
    async def trial(delay):
        d = Desk(ttl_s=0.01)
        task, approval_id = await d.start()
        await asyncio.sleep(delay)
        accepted, row = await d.desk.decide(approval_id, "approved")
        return d, await task, accepted, row

    async def scenario():
        return [await trial(delay) for delay in [0.0, 0.009, 0.01, 0.011] * 5 + [0.03]]

    outcomes = asyncio.run(scenario())
    for d, held, accepted, row in outcomes:
        assert held == row["status"] in ("approved", "expired")
        assert accepted == (held == "approved")
        assert d.statuses() == ["pending", held]
    assert {held for _, held, _, _ in outcomes} == {"approved", "expired"}


def test_listing_puts_pending_first_and_carries_the_subject():
    async def scenario():
        d = Desk(clock=Clock())
        done, done_id = await d.start()
        await d.desk.decide(done_id, "denied")
        await done
        waiting, waiting_id = await d.start()
        listed = d.desk.list()
        await d.desk.decide(waiting_id, "approved")
        await waiting
        return listed, waiting_id, done_id

    listed, waiting_id, done_id = asyncio.run(scenario())
    assert [(a["id"], a["status"]) for a in listed] == [(waiting_id, "pending"), (done_id, "denied")]
    subject = listed[0]["subject"]
    assert (subject["rule"], subject["reason"], subject["entities"], subject["expires_at"]) == (
        "personal-data-needs-approval", "send_email carries PERSON", ["PERSON"], listed[0]["expires_at"])


def test_boot_expires_orphaned_pending_rows():
    db = Store(":memory:").db

    async def orphan():
        d = Desk(db=db)
        task, approval_id = await d.start()
        task.cancel()
        return approval_id

    approval_id = asyncio.run(orphan())
    desk = ApprovalDesk(db, None)
    assert desk.expire_orphans() == 1
    assert desk.get(approval_id)["status"] == "expired"
    assert desk.expire_orphans() == 0
