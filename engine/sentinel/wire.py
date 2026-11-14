"""The only module that knows Anthropic JSON. Parse once at the edge, serialize once on the way out."""

from __future__ import annotations

import dataclasses
from enum import Enum
from typing import Any, Mapping

from sentinel.core.model import (Block, Conversation, Event, Inbound, Message, Opaque, Params, Reply, Text,
                                 ToolResult, ToolUse)


class WireError(ValueError):
    """Becomes HTTP 400 with an Anthropic-shaped invalid_request_error body."""


def error_body(kind: str, message: str) -> dict[str, Any]:
    return {"type": "error", "error": {"type": kind, "message": message}}


def _rest(raw: Mapping[str, Any], *known: str) -> dict[str, Any]:
    return {k: v for k, v in raw.items() if k not in known}


def _block(raw: Any) -> Block:
    if not isinstance(raw, dict) or not isinstance(raw.get("type"), str):
        raise WireError("each content block must be an object with a type")
    match raw["type"]:
        case "text":
            return Text(raw["text"], _rest(raw, "type", "text"))
        case "tool_use":
            return ToolUse(raw["id"], raw["name"], raw["input"], _rest(raw, "type", "id", "name", "input"))
        case "tool_result":
            return ToolResult(raw["tool_use_id"], _content(raw.get("content", [])),
                              _rest(raw, "type", "tool_use_id", "content"))
        case _:
            return Opaque(raw)


def _content(raw: Any) -> tuple[Block, ...]:
    """String content becomes one Text block, the same way every turn, so upstream bytes stay stable."""
    if isinstance(raw, str):
        return (Text(raw),)
    if isinstance(raw, list):
        return tuple(_block(b) for b in raw)
    raise WireError("content must be a string or a list of blocks")


def _system(raw: Any) -> tuple[Text, ...]:
    blocks = _content(raw) if raw is not None else ()
    if not all(isinstance(b, Text) for b in blocks):
        raise WireError("system blocks must be text")
    return blocks  # type: ignore[return-value]


def parse_request(body: Any, headers: Mapping[str, str], known_upstreams: frozenset[str]) -> Inbound:
    """headers must be case-insensitive or lower-cased. The agent's model, key, and sampling knobs are ignored."""
    if not isinstance(body, dict):
        raise WireError("request body must be a JSON object")
    if body.get("stream"):
        raise WireError("streaming is not supported by SENTINEL; send stream=false")
    upstream_id = headers.get("x-sentinel-upstream") or "cloud"
    if upstream_id not in known_upstreams:
        raise WireError(f"unknown x-sentinel-upstream {upstream_id!r}")
    max_tokens = body.get("max_tokens")
    if not isinstance(max_tokens, int) or isinstance(max_tokens, bool):
        raise WireError("max_tokens must be an integer")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise WireError("messages must be a non-empty list")
    try:
        parsed = tuple(Message(_role(m), _content(m.get("content"))) for m in messages)
        system = _system(body.get("system"))
    except (KeyError, TypeError) as e:
        raise WireError(f"malformed block: missing {e}") from e
    return Inbound(
        session_id=headers.get("x-sentinel-session") or "default",
        upstream_id=upstream_id,
        conversation=Conversation(system, parsed),
        params=Params(
            max_tokens=max_tokens,
            tools=tuple(body.get("tools") or ()),
            stop_sequences=tuple(body.get("stop_sequences") or ()),
            anthropic_version=headers.get("anthropic-version"),
            anthropic_beta=headers.get("anthropic-beta"),
        ),
    )


def _role(m: Any) -> str:
    if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
        raise WireError("each message needs role user or assistant")
    return m["role"]


def block_to_json(block: Block) -> dict[str, Any]:
    match block:
        case Text(text=t, extra=x):
            return {"type": "text", "text": t, **x}
        case ToolUse(id=i, name=n, input=inp, extra=x):
            return {"type": "tool_use", "id": i, "name": n, "input": inp, **x}
        case ToolResult(tool_use_id=i, content=c, extra=x):
            return {"type": "tool_result", "tool_use_id": i, "content": [block_to_json(b) for b in c], **x}
        case Opaque(raw=raw):
            return raw  # type: ignore[return-value]


def to_upstream(conversation: Conversation, params: Params) -> dict[str, Any]:
    """kwargs for AsyncAnthropic.messages.create, minus model and headers."""
    kwargs: dict[str, Any] = {
        "max_tokens": params.max_tokens,
        "messages": [{"role": m.role, "content": [block_to_json(b) for b in m.content]}
                     for m in conversation.messages],
    }
    if conversation.system:
        kwargs["system"] = [block_to_json(t) for t in conversation.system]
    if params.tools:
        kwargs["tools"] = list(params.tools)
        kwargs["tool_choice"] = {"type": "auto"}
    if params.stop_sequences:
        kwargs["stop_sequences"] = list(params.stop_sequences)
    return kwargs


def parse_reply(message: Mapping[str, Any]) -> Reply:
    """From the upstream's raw response JSON. Thinking blocks with an empty signature become Opaque unchanged."""
    return Reply(
        id=message["id"],
        model=message["model"],
        blocks=tuple(_block(b) for b in message["content"]),
        stop_reason=message.get("stop_reason"),
        stop_sequence=message.get("stop_sequence"),
        usage=message.get("usage") or {},
        extra=_rest(message, "id", "type", "role", "model", "content", "stop_reason", "stop_sequence", "usage"),
    )


def reply_to_json(reply: Reply) -> dict[str, Any]:
    return {
        "id": reply.id,
        "type": "message",
        "role": "assistant",
        "model": reply.model,
        "content": [block_to_json(b) for b in reply.blocks],
        "stop_reason": reply.stop_reason,
        "stop_sequence": reply.stop_sequence,
        "usage": dict(reply.usage),
        **reply.extra,
    }


def event_to_json(event: Event) -> dict[str, Any]:
    """The dashboard's Event type mirrors this function's output."""
    return dataclasses.asdict(
        event, dict_factory=lambda items: {k: v.value if isinstance(v, Enum) else v for k, v in items})
