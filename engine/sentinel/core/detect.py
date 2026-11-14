"""Detection, P4 strategy B: known vault values first, then the detector on what remains."""

from __future__ import annotations

import re
from bisect import bisect_right
from typing import Iterable, Mapping, Protocol, Sequence

from .model import Detection, Finding, Leaf, Span, Tier
from .vault import PLACEHOLDER, Vault
from .views import compact, decoded, normalized

VIEW_TYPES = frozenset({"US_SSN", "SECRET"})
SURE = 0.5  # a delimited SSN or a secret pattern; a bare run of nine digits scores 0.05
_FRAGMENT = re.compile(r"\S*\d\S*")


class Detector(Protocol):
    def scan(self, text: str, entity_types: frozenset[str]) -> Sequence[Span]:
        """Spans of the requested types only, deterministic for the same text."""
        ...

    def patterns(self, text: str, entity_types: frozenset[str]) -> Sequence[Span]:
        """Like scan, from the regex and deny-list recognizers alone: no NER, so cheap and blind to names."""
        ...


class HasLeaves(Protocol):
    def leaves(self) -> Iterable[Leaf]: ...


def scan_leaf(leaf: Leaf, detector: Detector, vault: Vault, tiers: Mapping[str, Tier]) -> list[Finding]:
    """Known values count as findings too, so a turn carrying them is never classified lower than the turn
    that minted them. Detector spans touching a [TYPE_N] token this vault issued are placeholders, not data, and are
    dropped; a token the sender typed is just text."""
    residue, known = vault.substitute(leaf.text)
    read_only = not leaf.rewritable
    findings = [Finding(m.entity_type, tiers[m.entity_type], leaf.path, m.start, m.end, 1.0,
                        leaf.text[m.start:m.end], "vault", read_only) for m in known]

    # Residue offset -> original offset: each substituted token shifts everything after it.
    shifts, delta = [], 0
    for m in known:
        token_end = m.start - delta + len(m.placeholder)
        delta += (m.end - m.start) - len(m.placeholder)
        shifts.append((token_end, delta))
    tokens = [t.span() for t in PLACEHOLDER.finditer(residue) if vault.issued(t.group())]

    scan = detector.patterns if leaf.identifier else detector.scan
    for s in scan(residue, frozenset(tiers)):
        if any(s.start < end and start < s.end for start, end in tokens):
            continue
        offset = next((d for end, d in reversed(shifts) if end <= s.start), 0)
        start, end = s.start + offset, s.end + offset
        findings.append(Finding(s.entity_type, tiers[s.entity_type], leaf.path, start, end, s.score,
                                leaf.text[start:end], "detector", read_only))
    return findings + _disguised(leaf, detector, tiers, findings)


def _disguised(leaf: Leaf, detector: Detector, tiers: Mapping[str, Tier], found: list[Finding]) -> list[Finding]:
    """Values a reader would decode from the leaf (base64, odd dashes and spaces, zero-width characters, one character
    at a time) that the recognizers read past. Read-only: a placeholder over the disguised span would not line up with
    what the reader decodes."""
    wanted = VIEW_TYPES & frozenset(tiers)
    if not wanted:
        return []
    plain = normalized(leaf.text)
    views = [(v, wanted) for v in decoded(leaf.text)]
    if plain.text != leaf.text:
        views.append((plain, wanted))
    if "SECRET" in wanted:
        views.append((compact(plain), frozenset({"SECRET"})))

    seen = [(f.entity_type, f.start, f.end) for f in found]
    extra = []
    for view, types in views:
        for s in detector.patterns(view.text, types):
            start, end = view.source(s.start, s.end)
            if any(t == s.entity_type and a <= start and end <= b for t, a, b in seen):
                continue
            seen.append((s.entity_type, start, end))
            extra.append(Finding(s.entity_type, tiers[s.entity_type], leaf.path, start, end, s.score,
                                 leaf.text[start:end], "detector", True))
    return extra


def joined(leaves: Sequence[Leaf], detector: Detector, tiers: Mapping[str, Tier]) -> list[Finding]:
    """A value split across leaves (two messages, two blocks, two tool calls) is whole again to whoever reads them all.
    Scans the leaves end to end, then only their digit-bearing tokens so the words between two halves drop out. Keeps
    sure matches that span leaves, one read-only finding per piece; a match inside one leaf is that leaf's own."""
    wanted = VIEW_TYPES & frozenset(tiers)
    prose = [leaf for leaf in leaves if not leaf.identifier]  # tool ids between two halves would break the join
    if not wanted or len(prose) < 2:
        return []
    whole = [(i, 0, len(leaf.text)) for i, leaf in enumerate(prose)]
    tokens = [(i, m.start(), m.end()) for i, leaf in enumerate(prose) for m in _FRAGMENT.finditer(leaf.text)]
    found, seen = [], set()
    for pieces in (whole, tokens):
        starts, n = [], 0
        for _, a, b in pieces:
            starts.append(n)
            n += b - a
        text = "".join(prose[i].text[a:b] for i, a, b in pieces)
        for s in detector.patterns(text, wanted):
            first, last = bisect_right(starts, s.start) - 1, bisect_right(starts, s.end - 1) - 1
            if s.score < SURE or pieces[first][0] == pieces[last][0]:
                continue
            for (i, a, b), at in zip(pieces[first:last + 1], starts[first:last + 1]):
                start, end = a + max(s.start - at, 0), a + min(s.end - at, b - a)
                leaf = prose[i]
                if start < end and (leaf.path, start, end, s.entity_type) not in seen:
                    seen.add((leaf.path, start, end, s.entity_type))
                    found.append(Finding(s.entity_type, tiers[s.entity_type], leaf.path, start, end, s.score,
                                         leaf.text[start:end], "detector", True))
    return found


def detect(request: HasLeaves, detector: Detector, vault: Vault, tiers: Mapping[str, Tier]) -> Detection:
    """Every leaf the request forwards, and every value split across them. Read-only leaves are never rewritten, but
    what they hold still counts."""
    leaves = list(request.leaves())
    each = [f for leaf in leaves for f in scan_leaf(leaf, detector, vault, tiers)]
    return Detection((*each, *joined(leaves, detector, tiers)))
