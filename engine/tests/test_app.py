"""The HTTP shell refuses what another web page could send it: a socket that reads events, a form that approves."""

import json
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from sentinel.app import create_app
from sentinel.store import Store

MONITOR = "http://127.0.0.1:3000"
EVIL = "https://evil.example"


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    db = tmp_path_factory.mktemp("app") / "sentinel.db"
    client = TestClient(create_app(db_path=db))
    store = Store(db)

    def pending():
        approval_id = f"a{time.monotonic_ns()}"
        with store.db:
            store.db.execute("INSERT INTO approvals (id, event_id, status, created_at, expires_at, subject) "
                             "VALUES (?, 'e1', 'pending', ?, ?, '{}')", (approval_id, time.time(), time.time() + 60))
        return approval_id

    def status(approval_id):
        return next(a["status"] for a in client.get("/api/approvals").json() if a["id"] == approval_id)

    return client, pending, status


def decide(client, approval_id, origin=MONITOR, content_type="application/json"):
    headers = {"content-type": content_type, **({"origin": origin} if origin else {})}
    return client.post(f"/api/approvals/{approval_id}", content=json.dumps({"decision": "approve"}), headers=headers)


@pytest.mark.parametrize("origin", [MONITOR, "http://localhost:3000", None], ids=["127.0.0.1", "localhost", "none"])
def test_the_monitor_socket_hears_an_approval(stack, origin):
    client, pending, _ = stack
    approval_id = pending()
    with client.websocket_connect("/ws", headers={"origin": origin} if origin else {}) as socket:
        assert decide(client, approval_id).status_code == 200
        message = socket.receive_json()
    assert (message["kind"], message["data"]["id"], message["data"]["status"]) == ("approval", approval_id, "approved")


def test_a_socket_from_another_origin_is_refused(stack):
    client, _, _ = stack
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": EVIL}):
            pass


@pytest.mark.parametrize("origin, content_type", [
    (EVIL, "application/json"),
    (MONITOR, "text/plain"),
    (None, "text/plain;charset=UTF-8"),
    (None, "application/x-www-form-urlencoded"),
], ids=["other-origin", "text-plain", "text-plain-no-origin", "form"])
def test_an_approval_a_web_page_could_send_is_refused(stack, origin, content_type):
    client, pending, status = stack
    approval_id = pending()
    assert decide(client, approval_id, origin, content_type).status_code in (403, 415)
    assert status(approval_id) == "pending"


@pytest.mark.parametrize("origin", [MONITOR, None], ids=["monitor", "none"])
def test_a_json_approval_without_a_foreign_origin_is_accepted(stack, origin):
    client, pending, status = stack
    approval_id = pending()
    assert decide(client, approval_id, origin, "application/json; charset=utf-8").status_code == 200
    assert status(approval_id) == "approved"


def test_the_allowed_origins_come_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("SENTINEL_ALLOWED_ORIGINS", " http://monitor.test , https://ops.test ")
    client = TestClient(create_app(db_path=tmp_path / "sentinel.db"))
    with client.websocket_connect("/ws", headers={"origin": "https://ops.test"}):
        pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": MONITOR}):
            pass


def test_an_empty_allow_list_in_env_keeps_the_monitor(tmp_path, monkeypatch):
    monkeypatch.setenv("SENTINEL_ALLOWED_ORIGINS", "")
    client = TestClient(create_app(db_path=tmp_path / "sentinel.db"))
    with client.websocket_connect("/ws", headers={"origin": MONITOR}):
        pass
