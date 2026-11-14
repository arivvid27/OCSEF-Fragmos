"""FastAPI shell. Parse at the edge, call run_turn, serialize. No policy logic here."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Awaitable, Callable

import yaml
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from sentinel import wire
from sentinel.approvals import HOLD_SECONDS, ApprovalDesk
from sentinel.core.model import ApprovalRef, ApprovalStatus, Conversation, Event, HoldSubject, Params, Reply, Upstream
from sentinel.core.policy import load_policy
from sentinel.core.turn import TurnContext, UpstreamError, run_turn
from sentinel.core.vault import Vault
from sentinel.presidio_detector import PresidioDetector
from sentinel.store import Store
from sentinel.upstreams import UpstreamClients, registry_from_env

ROOT = Path(__file__).resolve().parent.parent


class Hub:
    def __init__(self) -> None:
        self._sockets: set[WebSocket] = set()

    async def serve(self, ws: WebSocket) -> None:
        await ws.accept()
        self._sockets.add(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            self._sockets.discard(ws)

    async def broadcast(self, message: dict[str, Any]) -> None:
        text = json.dumps(message)
        sockets = list(self._sockets)
        results = await asyncio.gather(*(ws.send_text(text) for ws in sockets), return_exceptions=True)
        for ws, result in zip(sockets, results):
            if isinstance(result, Exception):
                self._sockets.discard(ws)


class ShellPorts:
    def __init__(self, clients: UpstreamClients, store: Store, hub: Hub, desk: ApprovalDesk) -> None:
        self._clients, self._store, self._hub, self._desk = clients, store, hub, desk

    async def call_upstream(self, upstream: Upstream, conversation: Conversation, params: Params,
                            session_id: str) -> Reply:
        return await self._clients.call_upstream(upstream, conversation, params, session_id)

    async def hold(self, subject: HoldSubject, on_open: Callable[[ApprovalRef], Awaitable[None]]) -> ApprovalStatus:
        return await self._desk.hold(subject, on_open)

    async def emit(self, event: Event) -> None:
        data = wire.event_to_json(event)
        self._store.upsert_event(data)
        await self._hub.broadcast({"kind": "event", "data": data})


def create_app(db_path: Path = ROOT / "sentinel.db", policy_path: Path = ROOT / "policy.yaml",
               hold_seconds: float = HOLD_SECONDS) -> FastAPI:
    policy = load_policy(yaml.safe_load(policy_path.read_text()))
    detector = PresidioDetector()
    upstreams = registry_from_env()
    clients = UpstreamClients(upstreams)
    store = Store(db_path)
    hub = Hub()
    desk = ApprovalDesk(store.db, hub.broadcast, hold_seconds)
    desk.expire_orphans()
    ports = ShellPorts(clients, store, hub, desk)
    vaults: dict[str, Vault] = {}  # by x-sentinel-session
    app = FastAPI(title="SENTINEL")

    @app.post("/v1/messages")
    async def messages(request: Request) -> JSONResponse:
        try:
            inbound = wire.parse_request(await request.json(), request.headers, frozenset(upstreams))
        except (wire.WireError, json.JSONDecodeError) as e:
            return JSONResponse(wire.error_body("invalid_request_error", str(e)), status_code=400)
        try:
            vault = vaults.setdefault(inbound.session_id, Vault())
            reply = await run_turn(inbound, TurnContext(upstreams, ports, policy, detector, vault))
        except UpstreamError as e:
            return JSONResponse(e.body, status_code=e.status)
        return JSONResponse(wire.reply_to_json(reply))

    @app.get("/api/events")
    async def events(limit: int = 200) -> list[dict[str, Any]]:
        return store.events(limit)

    @app.get("/api/stats")
    async def stats() -> dict[str, dict[str, int]]:
        return store.stats()

    @app.get("/api/approvals")
    async def approvals() -> list[dict[str, Any]]:
        return desk.list()

    @app.post("/api/approvals/{approval_id}")
    async def decide(approval_id: str, request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except json.JSONDecodeError:
            body = None
        decision = body.get("decision") if isinstance(body, dict) else None
        verdict = {"approve": "approved", "deny": "denied"}.get(decision) if isinstance(decision, str) else None
        if verdict is None:
            return JSONResponse({"error": 'body must be {"decision": "approve" | "deny"}'}, status_code=400)
        try:
            accepted, row = await desk.decide(approval_id, verdict)
        except KeyError:
            return JSONResponse({"error": f"no approval {approval_id}"}, status_code=404)
        return JSONResponse(row, status_code=200 if accepted else 409)

    @app.get("/api/policy")
    async def get_policy() -> dict[str, Any]:
        return wire.policy_to_json(policy)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "cloud_credentials": clients.cloud_credentials(),
            "local_reachable": await clients.reachable("local"),
            "rules": len(policy.rules),
        }

    @app.websocket("/ws")
    async def ws(socket: WebSocket) -> None:
        await hub.serve(socket)

    return app
