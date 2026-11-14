"""FastAPI shell. Parse at the edge, call run_turn, serialize. No policy logic here."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from sentinel import wire
from sentinel.core.model import Conversation, Event, Params, Reply, Upstream
from sentinel.core.turn import TurnContext, UpstreamError, run_turn
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
    def __init__(self, clients: UpstreamClients, store: Store, hub: Hub) -> None:
        self._clients, self._store, self._hub = clients, store, hub

    async def call_upstream(self, upstream: Upstream, conversation: Conversation, params: Params,
                            session_id: str) -> Reply:
        return await self._clients.call_upstream(upstream, conversation, params, session_id)

    async def emit(self, event: Event) -> None:
        data = wire.event_to_json(event)
        self._store.upsert_event(data)
        await self._hub.broadcast({"kind": "event", "data": data})


def create_app(db_path: Path = ROOT / "sentinel.db", policy_path: Path = ROOT / "policy.yaml") -> FastAPI:
    policy = yaml.safe_load(policy_path.read_text())
    upstreams = registry_from_env()
    clients = UpstreamClients(upstreams)
    store = Store(db_path)
    hub = Hub()
    ctx = TurnContext(upstreams=upstreams, ports=ShellPorts(clients, store, hub))
    app = FastAPI(title="SENTINEL")

    @app.post("/v1/messages")
    async def messages(request: Request) -> JSONResponse:
        try:
            inbound = wire.parse_request(await request.json(), request.headers, frozenset(upstreams))
        except (wire.WireError, json.JSONDecodeError) as e:
            return JSONResponse(wire.error_body("invalid_request_error", str(e)), status_code=400)
        try:
            reply = await run_turn(inbound, ctx)
        except UpstreamError as e:
            return JSONResponse(e.body, status_code=e.status)
        return JSONResponse(wire.reply_to_json(reply))

    @app.get("/api/events")
    async def events(limit: int = 200) -> list[dict[str, Any]]:
        return store.events(limit)

    @app.get("/api/stats")
    async def stats() -> dict[str, dict[str, int]]:
        return store.stats()

    @app.get("/api/policy")
    async def get_policy() -> dict[str, Any]:
        return policy

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "cloud_credentials": clients.cloud_credentials(),
            "local_reachable": await clients.reachable("local"),
            "rules": len(policy["rules"]),
        }

    @app.websocket("/ws")
    async def ws(socket: WebSocket) -> None:
        await hub.serve(socket)

    return app
