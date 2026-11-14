"""Detection, P4 strategy B: known vault values first, then the detector on what remains."""

from __future__ import annotations

from typing import Mapping, Protocol, Sequence

from .model import Conversation, Detection, Finding, Leaf, Span, Tier
from .vault import PLACEHOLDER, Vault


class Detector(Protocol):
    def scan(self, text: str, entity_types: frozenset[str]) -> Sequence[Span]:
        """Spans of the requested types only, deterministic for the same text."""
        ...


def scan_leaf(leaf: Leaf, detector: Detector, vault: Vault, tiers: Mapping[str, Tier]) -> list[Finding]:
    """Known values count as findings too, so a turn carrying them is never classified lower than the turn
    that minted them. Detector spans touching a [TYPE_N] token are placeholders, not data, and are dropped."""
    residue, known = vault.substitute(leaf.text)
    findings = [Finding(m.entity_type, tiers[m.entity_type], leaf.path, m.start, m.end, 1.0,
                        leaf.text[m.start:m.end], "vault", not leaf.rewritable) for m in known]

    # Residue offset -> original offset: each substituted token shifts everything after it.
    shifts, delta = [], 0
    for m in known:
        token_end = m.start - delta + len(m.placeholder)
        delta += (m.end - m.start) - len(m.placeholder)
        shifts.append((token_end, delta))
    tokens = [t.span() for t in PLACEHOLDER.finditer(residue)]

    for s in detector.scan(residue, frozenset(tiers)):
        if any(s.start < end and start < s.end for start, end in tokens):
            continue
        offset = next((d for end, d in reversed(shifts) if end <= s.start), 0)
        start, end = s.start + offset, s.end + offset
        findings.append(Finding(s.entity_type, tiers[s.entity_type], leaf.path, start, end, s.score,
                                leaf.text[start:end], "detector", not leaf.rewritable))
    return findings


def detect(conversation: Conversation, detector: Detector, vault: Vault, tiers: Mapping[str, Tier]) -> Detection:
    """Every leaf, thinking included: thinking is never rewritten, but what it holds still counts toward the tier."""
    return Detection(tuple(f for leaf in conversation.leaves() for f in scan_leaf(leaf, detector, vault, tiers)))
