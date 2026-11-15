"""Gateway keys: the dashboard mints, lists and revokes them; only a hash of each key is kept."""

import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sentinel.app import LOOPBACK_HOSTS, create_app

MONITOR = {"origin": "http://127.0.0.1:3000"}
EVIL = {"origin": "https://evil.example"}


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    db = tmp_path_factory.mktemp("keys") / "sentinel.db"
    return TestClient(create_app(db_path=db, hosts=(*LOOPBACK_HOSTS, "testserver"))), db


def listed(client):
    return {k["id"]: k for k in client.get("/api/keys", headers=MONITOR).json()}


def test_a_key_is_shown_once_listed_without_its_secret_and_revoked(stack):
    client, db = stack
    created = client.post("/api/keys", json={"name": " open-webui "}, headers=MONITOR)
    assert created.status_code == 201
    body = created.json()
    assert set(body) == {"id", "name", "prefix", "created_at", "key"}
    assert re.fullmatch(r"fk_[A-Za-z0-9_-]{40}", body["key"])
    assert (body["name"], body["prefix"]) == ("open-webui", body["key"][:8])

    row = listed(client)[body["id"]]
    assert row == {"id": body["id"], "name": "open-webui", "prefix": body["key"][:8],
                   "created_at": body["created_at"], "last_used_at": None}
    assert body["key"] not in "\n".join(sqlite3.connect(db).iterdump())

    assert client.delete(f"/api/keys/{body['id']}", headers=MONITOR).status_code == 204
    assert body["id"] not in listed(client)
    assert client.delete(f"/api/keys/{body['id']}", headers=MONITOR).status_code == 404


@pytest.mark.parametrize("payload", [{}, {"name": ""}, {"name": "   "}, {"name": 7}, {"name": "x" * 101}, []])
def test_a_key_needs_a_name(stack, payload):
    client, _ = stack
    assert client.post("/api/keys", json=payload, headers=MONITOR).status_code == 400


def test_a_web_page_cannot_mint_list_or_revoke_keys(stack):
    client, _ = stack
    before = listed(client)
    assert client.post("/api/keys", json={"name": "evil"}, headers=EVIL).status_code == 403
    assert client.post("/api/keys", content='{"name": "evil"}', headers={"content-type": "text/plain"}).status_code == 415
    assert listed(client) == before

    key_id = client.post("/api/keys", json={"name": "keep"}, headers=MONITOR).json()["id"]
    assert client.get("/api/keys", headers=EVIL).status_code == 403
    assert client.delete(f"/api/keys/{key_id}", headers=EVIL).status_code == 403
    assert key_id in listed(client)


def test_the_cli_prints_only_a_key_that_the_server_on_the_same_database_accepts(tmp_path):
    db = tmp_path / "sentinel.db"
    done = subprocess.run([sys.executable, "-m", "sentinel", "keys", "create", "demo"], capture_output=True, text=True,
                          cwd=Path(__file__).resolve().parent.parent, env={**os.environ, "SENTINEL_DB": str(db)},
                          check=True)
    key = done.stdout.removesuffix("\n")
    assert re.fullmatch(r"fk_[A-Za-z0-9_-]{40}", key)
    client = TestClient(create_app(db_path=db, hosts=(*LOOPBACK_HOSTS, "testserver")))
    assert client.get("/v1/models", headers={"authorization": f"Bearer {key}"}).status_code == 200
    assert [k["name"] for k in client.get("/api/keys").json()] == ["demo"]
