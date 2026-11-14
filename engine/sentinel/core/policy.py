"""Policy: the tiers map and the first-match request rule table.

load_policy takes an already-parsed dict (YAML is the shell's job) and refuses anything malformed, so a bad policy
fails at boot. decide trusts what load_policy built.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .model import (Action, Allow, Block, Decision, Detection, Finding, ForwardHold, Redact, Reroute, Tier, Trust,
                    Upstream)

THINKING_REASON = "sensitive data inside a thinking block, which SENTINEL never modifies"


class PolicyError(ValueError):
    pass


@dataclass(frozen=True)
class When:
    """All present keys must hold. An empty When matches every request."""

    entity_in: frozenset[str] | None = None
    tier_gte: Tier | None = None

    @property
    def unconditional(self) -> bool:
        return self.entity_in is None and self.tier_gte is None

    def matches(self, findings: tuple[Finding, ...]) -> bool:
        return ((self.entity_in is None or any(f.entity_type in self.entity_in for f in findings))
                and (self.tier_gte is None or any(f.tier >= self.tier_gte for f in findings)))

    def triggered(self, findings: tuple[Finding, ...]) -> frozenset[str]:
        """The types any present key matched: what the reason names and what REDACT masks."""
        return frozenset(f.entity_type for f in findings
                         if (self.entity_in is not None and f.entity_type in self.entity_in)
                         or (self.tier_gte is not None and f.tier >= self.tier_gte))


@dataclass(frozen=True)
class Rule:
    name: str
    when: When
    action: Action


@dataclass(frozen=True)
class Policy:
    tiers: Mapping[str, Tier]  # entity type -> tier; also the only types the detector is asked for
    rules: tuple[Rule, ...]


def load_policy(raw: Mapping[str, Any]) -> Policy:
    tiers = {}
    for entity, level in raw["tiers"].items():
        try:
            tiers[entity] = Tier(level)
        except ValueError:
            raise PolicyError(f"tier {entity}: {level!r} is not 0..3") from None
    rules = tuple(_rule(r, tiers) for r in raw.get("rules") or ())
    for rule in rules[:-1]:
        if rule.when.unconditional:
            raise PolicyError(f"rule {rule.name} has no `when`, so the rules after it can never match")
    if not rules or not rules[-1].when.unconditional:
        raise PolicyError("the last rule must have no `when`, so every request matches a rule")
    names = [r.name for r in rules]
    if len(set(names)) != len(names):
        raise PolicyError(f"rule names must be unique: {names}")
    return Policy(tiers, rules)


def _rule(raw: Mapping[str, Any], tiers: Mapping[str, Tier]) -> Rule:
    name = raw.get("name")
    if not isinstance(name, str) or not name:
        raise PolicyError(f"every rule needs a name: {dict(raw)}")
    try:
        action = Action(raw.get("action"))
    except ValueError:
        raise PolicyError(f"rule {name}: unknown action {raw.get('action')!r}, expected one of "
                          f"{', '.join(a.value for a in Action)}") from None
    when = raw.get("when") or {}
    unknown = set(when) - {"entity_in", "tier_gte"}
    if unknown:
        raise PolicyError(f"rule {name}: unknown `when` keys {sorted(unknown)}")
    entity_in = None
    if "entity_in" in when:
        entity_in = frozenset(when["entity_in"])
        if missing := sorted(entity_in - set(tiers)):
            raise PolicyError(f"rule {name}: unknown entity {', '.join(missing)}; entities must be keys of tiers")
    tier_gte = None
    if "tier_gte" in when:
        try:
            tier_gte = Tier(when["tier_gte"])
        except ValueError:
            raise PolicyError(f"rule {name}: tier_gte {when['tier_gte']!r} is not 0..3") from None
    return Rule(name, When(entity_in, tier_gte), action)


def decide(detection: Detection, policy: Policy, requested_upstream: Upstream, local_upstream: Upstream) -> Decision:
    findings = detection.findings
    rule = next(r for r in policy.rules if r.when.matches(findings))
    types = rule.when.triggered(findings)

    def reroute(reason: str) -> Reroute:
        # REROUTE keeps data inside the trust boundary; it does not mean "the upstream named local".
        if requested_upstream.trust is Trust.LOCAL:
            return Reroute(rule.name, reason, requested_upstream.id, already_local=True)
        return Reroute(rule.name, reason, local_upstream.id, already_local=False)

    match rule.action:
        case Action.ALLOW:
            return Allow(rule.name, _allow_reason(findings, policy.tiers), requested_upstream.id)
        case Action.REDACT:
            if any(f.opaque and (f.entity_type in types or f.source == "vault") for f in findings):
                return reroute(THINKING_REASON)
            return Redact(rule.name, _reason(rule, types, policy.tiers, "it is replaced with placeholders",
                                             "they are replaced with placeholders"), requested_upstream.id, types)
        case Action.REROUTE:
            return reroute(_reason(rule, types, policy.tiers, "it stays local", "they stay local"))
        case Action.HOLD:
            waits = "the request waits for approval"
            return ForwardHold(rule.name, _reason(rule, types, policy.tiers, waits, waits), requested_upstream.id)
        case Action.BLOCK:
            return Block(rule.name, _reason(rule, types, policy.tiers, "it may not be sent", "they may not be sent"))


def _reason(rule: Rule, types: frozenset[str], tiers: Mapping[str, Tier], one: str, many: str) -> str:
    """'US_SSN is RESTRICTED (tier 3), so it stays local'."""
    if not types:
        return f"rule {rule.name} applies to every request"
    return f"{_classify(types, tiers)}, so {one if len(types) == 1 else many}"


def _allow_reason(findings: tuple[Finding, ...], tiers: Mapping[str, Tier]) -> str:
    if not findings:
        return "nothing sensitive found"
    return f"{_classify(frozenset(f.entity_type for f in findings), tiers)}, which no rule restricts"


def _classify(types: frozenset[str], tiers: Mapping[str, Tier]) -> str:
    """'HEALTH and US_SSN are RESTRICTED (tier 3), PERSON is CONFIDENTIAL (tier 2)', most sensitive first."""
    by_tier: dict[Tier, list[str]] = {}
    for t in sorted(types):
        by_tier.setdefault(tiers[t], []).append(t)
    return ", ".join(f"{' and '.join(names)} {'is' if len(names) == 1 else 'are'} {tier.name} (tier {tier.value})"
                     for tier, names in sorted(by_tier.items(), reverse=True))
