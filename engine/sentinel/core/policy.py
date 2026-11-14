"""Policy: the tiers map today. Milestone 3 adds the first-match rule table behind the same decide()."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .model import Allow, Decision, Detection, Redact, Tier, Upstream


@dataclass(frozen=True)
class Policy:
    tiers: Mapping[str, Tier]


def load_policy(raw: Mapping[str, Any]) -> Policy:
    """Fails at boot on a tier value outside 0..3."""
    return Policy(tiers={entity: Tier(level) for entity, level in raw["tiers"].items()})


def decide(detection: Detection, policy: Policy, requested_upstream: Upstream, local_upstream: Upstream) -> Decision:
    redacted = frozenset(f.entity_type for f in detection.findings if f.tier >= Tier.CONFIDENTIAL)
    if redacted:
        return Redact("confidential-redacted", f"{', '.join(sorted(redacted))} at tier {detection.tier.name}",
                      requested_upstream.id, redacted)
    return Allow("default", "no confidential data", requested_upstream.id)
