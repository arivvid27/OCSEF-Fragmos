"""Policy: the tiers map, the first-match request rule table, and the first-match egress table.

load_policy takes an already-parsed dict (YAML is the shell's job) and refuses anything malformed, so a bad policy
fails at boot. decide trusts what load_policy built.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import urlsplit

from .detect import Detector, scan_leaf
from .model import (Action, Allow, Block, Decision, Detection, EgressVerdict, Finding, ForwardHold, Redact, Reply,
                    Reroute, Tier, ToolUse, Trust, Upstream, json_leaves)
from .vault import Vault

THINKING_REASON = "sensitive data inside a thinking block, which SENTINEL never modifies"


class PolicyError(ValueError):
    pass


@dataclass(frozen=True)
class When:
    """All present keys must hold. An empty When matches everything. domain_allowed exists only in egress rules."""

    entity_in: frozenset[str] | None = None
    tier_gte: Tier | None = None
    domain_allowed: bool | None = None

    @property
    def unconditional(self) -> bool:
        return self.entity_in is None and self.tier_gte is None and self.domain_allowed is None

    def matches(self, findings: tuple[Finding, ...], domain_allowed: bool = False) -> bool:
        return ((self.entity_in is None or any(f.entity_type in self.entity_in for f in findings))
                and (self.tier_gte is None or any(f.tier >= self.tier_gte for f in findings))
                and (self.domain_allowed is None or self.domain_allowed == domain_allowed))

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
class Egress:
    allowed_domains: frozenset[str]  # normalized hosts, matched exactly
    tools: Mapping[str, str]  # external tool -> the input argument that names its destination
    rules: tuple[Rule, ...]


NO_EGRESS = Egress(frozenset(), {}, (Rule("default", When(), Action.ALLOW),))


@dataclass(frozen=True)
class Policy:
    tiers: Mapping[str, Tier]  # entity type -> tier; also the only types the detector is asked for
    rules: tuple[Rule, ...]
    egress: Egress = NO_EGRESS


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
    return Policy(tiers, rules, _egress(raw["egress"], tiers) if "egress" in raw else NO_EGRESS)


def _egress(raw: Mapping[str, Any], tiers: Mapping[str, Tier]) -> Egress:
    tools = {}
    for tool in raw.get("external_tools") or ():
        if tool not in DESTINATION_ARG:
            raise PolicyError(f"egress: external tool {tool} has no destination argument; known tools are "
                              f"{', '.join(sorted(DESTINATION_ARG))}")
        tools[tool] = DESTINATION_ARG[tool]
    allowed = set()
    for domain in raw.get("allowed_domains") or ():
        host = normalize_host(str(domain))
        if host is None:
            raise PolicyError(f"egress: allowed domain {domain!r} is not a valid host")
        allowed.add(host)

    def entities(key: str) -> frozenset[str]:
        found = frozenset(raw.get(key) or ())
        if missing := sorted(found - set(tiers)):
            raise PolicyError(f"egress {key}: unknown entity {', '.join(missing)}; entities must be keys of tiers")
        return found

    rules = (Rule("possible-prompt-injection", When(entity_in=entities("block_if_payload_has"), domain_allowed=False),
                  Action.BLOCK),
             Rule("personal-data-needs-approval", When(entity_in=entities("hold_if_payload_has")), Action.HOLD),
             Rule("default", When(), Action.ALLOW))
    return Egress(frozenset(allowed), tools, rules)


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


DESTINATION_ARG = {"send_email": "to", "http_post": "url", "web_fetch": "url"}

_ADDRESS = re.compile(r"[^@\s,;<>]+@([^@\s,;<>]+)")
_URL_REJECT = re.compile(r"[\s\\\x00-\x1f\x7f]")  # parsers disagree on these, so the host would be a guess


def normalize_host(host: str) -> str | None:
    """Lowercase, one trailing dot dropped, IDNA-encoded. None when that fails."""
    host = host.lower()
    host = host[:-1] if host.endswith(".") else host
    if not host:
        return None
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError:
        return None


def destination_host(tool: str, value: object) -> str | None:
    """'dr.lee@demo.sentinel.local' -> 'demo.sentinel.local'; 'https://u@Host.:8443/x' -> 'host'.
    Missing or unparseable is None, which is never allow-listed."""
    if not isinstance(value, str):
        return None
    if DESTINATION_ARG.get(tool) == "to":
        m = _ADDRESS.fullmatch(value.strip())
        return normalize_host(m.group(1)) if m else None
    if _URL_REJECT.search(value):
        return None
    try:
        parts = urlsplit(value)
        host = parts.hostname
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not host:
        return None
    return normalize_host(host)


def check_egress(reply: Reply, policy: Policy, detector: Detector, vault: Vault) -> tuple[EgressVerdict, ...]:
    """One verdict per tool_use in the rehydrated reply, scanned leaf by leaf like a request. An email address
    is only the destination; a URL is also payload, since its path, query and subdomains can carry data."""
    verdicts = []
    for j, block in enumerate(reply.blocks):
        if not isinstance(block, ToolUse):
            continue
        arg = policy.egress.tools.get(block.name)
        if arg is None:
            verdicts.append(EgressVerdict(block.id, block.name, None, frozenset(), Action.ALLOW, "internal-tool",
                                          f"{block.name} is not an external tool", "forwarded"))
            continue
        dest = block.input.get(arg) if isinstance(block.input, dict) else None
        host = destination_host(block.name, dest)
        allowed = host is not None and host in policy.egress.allowed_domains
        findings = tuple(f for leaf in json_leaves(block.input, ("content", j, "input"))
                         if not (arg == "to" and leaf.path[3:] == (arg,))
                         for f in scan_leaf(leaf, detector, vault, policy.tiers))
        rule = next(r for r in policy.egress.rules if r.when.matches(findings, allowed))
        types = ", ".join(sorted(rule.when.triggered(findings)))
        where = host or "an unparseable destination"
        match rule.action:
            case Action.BLOCK:
                reason, outcome = (f"possible prompt injection: {block.name} tried to send {types} to {where}, "
                                   f"which is not on the allow list"), "blocked"
            case Action.HOLD:
                reason, outcome = f"{block.name} to {where} carries {types}, so it waits for approval", "pending"
            case _:
                reason, outcome = f"{block.name} to {where} carries nothing on the block or hold lists", "forwarded"
        verdicts.append(EgressVerdict(block.id, block.name, host, frozenset(f.entity_type for f in findings),
                                      rule.action, rule.name, reason, outcome))
    return tuple(verdicts)
