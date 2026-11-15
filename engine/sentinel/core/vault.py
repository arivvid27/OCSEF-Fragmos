"""Per-session two-way map between real values and [TYPE_N] placeholders, plus REDACT and rehydration.

Append-only: a value never changes placeholder and a placeholder never changes value. That makes masking
idempotent, so re-masking rehydrated history reproduces the bytes the upstream saw last turn.

One person is one placeholder: "Dr. Elena Rostova" and a later lone "Rostova" share a token, as in Fragmos, and the
token rehydrates to the name first minted for it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .model import Conversation, Detection, Finding, Leaf, LeafDiff, Mark, Reply, Text, ToolUse

PLACEHOLDER = re.compile(r"\[[A-Z][A-Z_]*_\d+\]")
NAME = "PERSON"
_TITLE = re.compile(r"^(?:Dr|Mr|Mrs|Ms|Mx|Prof|Professor)\.?\s+", re.IGNORECASE)

REDACTION_NOTE = (
    "Privacy note from SENTINEL: tokens like [PERSON_1] or [EMAIL_ADDRESS_2] are placeholders for real values "
    "the user is allowed to see. Treat each as that real value and copy it verbatim wherever the value belongs, "
    "including tool call arguments. Never comment on the placeholders."
)

DIFF_CAP = 2048


@dataclass
class Vault:
    _token_of: dict[str, str] = field(default_factory=dict)
    _value_of: dict[str, str] = field(default_factory=dict)
    _type_of: dict[str, str] = field(default_factory=dict)
    _count: dict[str, int] = field(default_factory=dict)
    _full_names: dict[str, str] = field(default_factory=dict)  # "elena rostova" -> its token
    _known: re.Pattern[str] | None = None

    def __len__(self) -> int:
        return len(self._token_of)

    def issued(self, token: str) -> bool:
        return token in self._value_of

    def token_for(self, entity_type: str, value: str) -> str:
        """A value keeps the type it was first minted under. A name reuses the token of the one full name it
        spells or is a part of; a part of two full names is nobody in particular and gets its own."""
        if value not in self._token_of:
            name = _name_key(value) if entity_type == NAME else None
            token = self._person(name) if name else None
            if token is None:
                n = self._count[entity_type] = self._count.get(entity_type, 0) + 1
                token = f"[{entity_type}_{n}]"
                self._value_of[token], self._type_of[token] = value, entity_type
                if name and " " in name:
                    self._full_names[name] = token
            self._token_of[value] = token
            self._known = re.compile("|".join(re.escape(v) for v in sorted(self._token_of, key=len, reverse=True)))
        return self._token_of[value]

    def mint(self, values: list[tuple[str, str]]) -> None:
        """Tokens for (entity type, value) pairs in the order given, except that full names go first, so a lone
        part earlier in the same request still finds the name it belongs to."""
        for entity_type, value in sorted(values, key=lambda v: v[0] == NAME and " " not in _name_key(v[1])):
            self.token_for(entity_type, value)

    def _person(self, name: str) -> str | None:
        if " " in name:
            return self._full_names.get(name)
        holders = [token for full, token in self._full_names.items() if name in full.split()]
        return holders[0] if len(holders) == 1 else None

    def substitute(self, text: str) -> tuple[str, tuple[Mark, ...]]:
        """Every known value replaced by its token, longest first. Marks are offsets into the original text."""
        if self._known is None:
            return text, ()
        marks = tuple(Mark(m.start(), m.end(), self._type_of[t], t)
                      for m in self._known.finditer(text) for t in [self._token_of[m.group(0)]])
        return self._known.sub(lambda m: self._token_of[m.group(0)], text), marks

    def unmask(self, text: str) -> tuple[str, tuple[Mark, ...]]:
        """Known tokens become real values; unknown tokens stay. Marks are offsets into the returned text."""
        out, marks, pos, shift = [], [], 0, 0
        for m in PLACEHOLDER.finditer(text):
            value = self._value_of.get(m.group(0))
            if value is None:
                continue
            out.append(text[pos:m.start()])
            start = m.start() + shift
            marks.append(Mark(start, start + len(value), self._type_of[m.group(0)], m.group(0)))
            out.append(value)
            shift += len(value) - len(m.group(0))
            pos = m.end()
        out.append(text[pos:])
        return "".join(out), tuple(marks)


def _name_key(value: str) -> str:
    """'Dr.  Elena Rostova' -> 'elena rostova'."""
    return " ".join(_TITLE.sub("", value.strip()).lower().split())


def _clusters(findings: list[Finding]) -> list[list[Finding]]:
    """Overlapping spans in one leaf, grouped. Presidio's CSV PERSON spans swallow SSNs whole or in part."""
    groups: list[list[Finding]] = []
    for f in sorted(findings, key=lambda f: (f.start, -f.end)):
        if groups and f.start < max(g.end for g in groups[-1]):
            groups[-1].append(f)
        else:
            groups.append([f])
    return groups


def _mint(detection: Detection, leaf_texts: dict, vault: Vault, entity_types: frozenset[str]) -> None:
    """Give every new value of a redacted type a placeholder. Overlapping spans mint their union, typed by the
    most sensitive member, so no fragment of either goes upstream raw."""
    by_path: dict = {}
    for f in detection.findings:
        if f.source == "detector" and not f.read_only and f.entity_type in entity_types:
            by_path.setdefault(f.path, []).append(f)
    values = []
    for path, findings in by_path.items():
        for group in _clusters(findings):
            start, end = min(f.start for f in group), max(f.end for f in group)
            top = max(group, key=lambda f: (f.tier, f.end - f.start))
            values.append((top.entity_type, leaf_texts[path][start:end]))
    vault.mint(values)


def redact(conversation: Conversation, detection: Detection, vault: Vault, entity_types: frozenset[str],
           diff_paths: frozenset) -> tuple[Conversation, tuple[LeafDiff, ...]]:
    """Mask every rewritable leaf with the vault, then append REDACTION_NOTE as the last system block."""
    _mint(detection, {leaf.path: leaf.text for leaf in conversation.leaves()}, vault, entity_types)
    diffs = []

    def mask(leaf: Leaf) -> str:
        masked, marks = vault.substitute(leaf.text)
        if leaf.path in diff_paths and marks:
            diffs.append(_leaf_diff(_where(leaf.path), "request", leaf.text, masked, marks))
        return masked

    masked = conversation.rewrite(mask)
    if vault:
        masked = Conversation((*masked.system, Text(REDACTION_NOTE)), masked.messages)
    return masked, tuple(diffs)


def raw_diffs(conversation: Conversation, detection: Detection, diff_paths: frozenset) -> tuple[LeafDiff, ...]:
    """What went upstream unmasked, and where the findings were."""
    marks: dict = {}
    for f in detection.findings:
        marks.setdefault(f.path, []).append(Mark(f.start, f.end, f.entity_type, None))
    return tuple(_leaf_diff(_where(leaf.path), "request", leaf.text, leaf.text,
                           tuple(sorted(marks[leaf.path], key=lambda m: m.start)))
                 for leaf in conversation.leaves() if leaf.path in diff_paths and leaf.path in marks)


def rehydrate(reply: Reply, vault: Vault) -> tuple[Reply, tuple[LeafDiff, ...]]:
    """Known placeholders back to real values in text blocks and tool_use.input string leaves. Opaque untouched.
    One tool_call diff per tool_use string leaf: masked is what the model wrote, real is what the agent runs."""
    diffs = []

    def restore(leaf: Leaf) -> str:
        real, marks = vault.unmask(leaf.text)
        block = reply.blocks[leaf.path[1]]
        if isinstance(block, ToolUse):
            diffs.append(_leaf_diff(f"tool_use {block.name}{_keys(leaf.path[3:])}", "tool_call", real, leaf.text,
                                   marks))
        return real

    return reply.rewrite(restore), tuple(diffs)


def _leaf_diff(where: str, direction, real: str, masked: str, marks: tuple[Mark, ...]) -> LeafDiff:
    kept = tuple(Mark(m.start, min(m.end, DIFF_CAP), m.entity_type, m.placeholder) for m in marks if m.start < DIFF_CAP)
    return LeafDiff(where, direction, real[:DIFF_CAP], masked[:DIFF_CAP], kept)


def _where(path: tuple) -> str:
    """("messages", 3, 0, "content", 1) -> "messages[3].content[0].content[1]"."""
    head, *rest = path
    if head == "messages":
        out, rest = f"messages[{rest[0]}].content[{rest[1]}]", rest[2:]
    else:
        out, rest = f"{head}[{rest[0]}]", rest[1:]
    return out + _keys(rest)


def _keys(path) -> str:
    return "".join(f"[{k}]" if isinstance(k, int) else f".{k}" for k in path)
