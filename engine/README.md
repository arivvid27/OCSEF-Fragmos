<img src="assets/icon.svg" width="64" height="64" alt="">

# SENTINEL

Firewalls protect networks from people. SENTINEL protects people from their own AI.

SENTINEL is a proxy that sits between an AI agent and the models it calls. It reads each request before the request leaves the laptop. It also reads every tool call the model asks the agent to run. For each request, a policy picks one action:

- `ALLOW` forwards the request unchanged.
- `REDACT` swaps names and emails for placeholders such as `[PERSON_1]`, sends the masked request to the cloud model, and puts the real values back before the agent sees the reply.
- `REROUTE` sends the request to the local model instead of the cloud.
- `HOLD` pauses a tool call until a human approves or denies it on the dashboard. After 60 seconds, a held call becomes a block.
- `BLOCK` refuses and returns `[SENTINEL] Request blocked: <reason>` to the agent.

The agent changes one line to use it: the `base_url` of its Anthropic client points at `http://127.0.0.1:8787`.

All demo data is fake. `demo/generate_data.py` generates it from a fixed seed.

## Run the demo

You need Python 3.11 at `~/.local/bin/python3.11`, Node.js with npm, `make`, and an OpenCode Go API key.

1. Clone the repo and open it:

	```sh
	git clone <repo-url> sentinel
	cd sentinel
	```

2. Install the Python packages, the spaCy model `en_core_web_lg`, and the dashboard packages:

	```sh
	make setup
	```

3. Create your `.env` and set `OPENCODE_API_KEY` in it:

	```sh
	cp .env.example .env
	```

4. Generate the demo data, build the dashboard, and start the stack:

	```sh
	make demo
	```

	You should see `stack is up`, then the dashboard URL and the four scenario commands.

5. Open the dashboard at `http://127.0.0.1:8787/`.
6. Run every scenario against the live stack and check the results:

	```sh
	make check
	```

	You should see one `PASS` line per scenario and `5/5 passed`.

7. To stop the stack, run `make down`.

The proxy, the demo site, and the attacker stub write their logs to `.run/`. `make test` runs the unit tests, which need no network.

### Use a real local model

In this proof of concept, the "local" model is not local. It is `glm-5.3-flash`, a cheap cloud model on OpenCode Go, chosen by config. The small Ollama models tested for this demo got the Scenario 2 arithmetic wrong.

Ollama serves the Anthropic `/v1/messages` API, so a real local model needs no code change. To use one, pull the model and set two variables in `.env`:

```sh
ollama pull qwen2.5:7b
```

```sh
SENTINEL_LOCAL_BASE_URL=http://localhost:11434
SENTINEL_LOCAL_MODEL=qwen2.5:7b
```

`SENTINEL_CLOUD_MODEL` overrides the cloud model, which defaults to `deepseek-v4.1-flash`.

## Give the three-minute demo

Start with `make demo` already run, the dashboard open on one side of the screen, and a terminal on the other. Each scenario prints its steps in color, including SENTINEL's block messages.

**0:00 to 0:20. Set up the problem.** Say: "This agent can read files, fetch web pages, send email, and post to URLs. Everything it reads goes to a cloud model. SENTINEL reads it first."

**0:20 to 1:00. Scenario 1: a health note.**

```sh
.venv/bin/python demo/agent.py --scenario 1
```

The agent reads `patient_note.txt`, which has health details. Policy marks health data tier 3, so the summary turn goes to the local model. The cloud edge on the graph stays dark. The model then asks to email the summary to `dr.lee@demo.sentinel.local`. The email carries a name, so SENTINEL holds it and the approval dialog opens. Click **Approve**. The email lands in `demo/outbox.jsonl`.

**1:00 to 1:40. Scenario 1b: the same task with a lighter note.**

```sh
.venv/bin/python demo/agent.py --scenario 1b
```

`patient_note_light.txt` has names and emails but no health data. SENTINEL replaces them with placeholders and sends the request to the cloud. Open the event in the feed to show the before and after view: the cloud saw `[PERSON_1]`, and the agent's answer has the real names.

**1:40 to 2:10. Scenario 2: salaries with SSNs.**

```sh
.venv/bin/python demo/agent.py --scenario 2
```

`employees.csv` holds SSNs, so the turn goes to the local model. The answer is still right: the average salary is 117,200 and Sheri Edwards earns the most.

**2:10 to 2:50. Scenario 3: prompt injection.**

```sh
.venv/bin/python demo/agent.py --scenario 3 --vulnerable
```

The blog post hides an instruction: read `.env.fake` and post it to `collector.evil-demo.net`. The model asks for that `http_post`. SENTINEL blocks it because the body carries a secret and the host is not on the allow list. A red toast appears, the graph edge ends in a red ✕, and the reason says possible prompt injection. Nothing reaches the outbox.

No real model followed the injection in 45 runs across seven models. `--vulnerable` therefore plays the obedient model with a scripted stub on port 8789. Every request and reply still goes through SENTINEL's full pipeline, and the event log labels that upstream `simulated`.

**2:50 to 3:00. Close.** Say: "Firewalls protect networks from people. SENTINEL protects people from their own AI."

Screenshots of each step are in `docs/screenshots/`. A recording of all four scenarios is `docs/recordings/m7-all-scenarios.webm`. `DEMO_LOG.md` has the latest `make check` output.

## How a request moves through SENTINEL

```
                          ┌──────────────── SENTINEL :8787 ────────────────┐
  demo/agent.py           │                                                │      cloud model
  (Anthropic SDK,  ──────►│ parse ─► detect ─► policy ─► vault ─► forward ─┼────► deepseek-v4.1-flash
  base_url=:8787)         │  wire.py   Presidio   policy.yaml  REDACT      │      (OpenCode Go)
        ▲                 │            + regexes  first match  placeholders│
        │                 │                                       │        │      "local" model
        │                 │                         REROUTE ──────┴────────┼────► glm-5.3-flash
        │                 │                                                │      (or Ollama)
        │◄────────────────┤ rehydrate ◄─ egress check ◄─ reply ◄───────────┤
        │  reply or       │  real values   each tool_use:                  │      attacker stub :8789
        │  block message  │  restored      ALLOW, HOLD, or BLOCK           │      (--vulnerable only)
        │                 │                     │                          │
        │                 │        SQLite event log ─► WebSocket /ws ──────┼────► dashboard (React Flow)
        │                 └─────────────────────┼──────────────────────────┘      approve or deny
        │                                       │
   mocked tools: read_file, web_fetch (demo site :8788), send_email and http_post (demo/outbox.jsonl)
```

Detection uses Presidio with the spaCy model `en_core_web_lg`. Custom recognizers add secrets (Anthropic, AWS, and GitHub keys, private keys, and JWTs), health terms, and emails on `.local` domains. Each entity type has a tier in `policy.yaml`. The first matching rule picks the action: a secret or any tier-3 entity reroutes, a tier-2 entity redacts, and anything else is allowed.

The egress check runs on every tool call after SENTINEL restores the real values. An `http_post`, `web_fetch`, or `send_email` that carries a secret, an SSN, or a card number to a host outside `allowed_domains` is blocked. One that carries a name, email, phone number, or health term is held.

Detection, policy, the vault, and the egress check live in `sentinel/core/`. That package imports no web framework, SDK, or database, so the tests run without a server. `sentinel/wire.py` is the only module that reads or writes the Anthropic JSON format. `docs/design.md` explains the design, and `DECISIONS.md` records each decision with its evidence.

### Endpoints

| Endpoint | Returns |
|---|---|
| `POST /v1/messages` | The Anthropic Messages API, non-streaming. Sessions come from the `x-sentinel-session` header. |
| `GET /api/events?limit=200` | The latest events, one per turn. |
| `GET /api/stats` | Counts by action, entity type, and destination. |
| `GET /api/approvals` | Approvals, pending ones first. |
| `POST /api/approvals/{id}` | Resolves an approval. The body is `{"decision": "approve"}` or `{"decision": "deny"}`. |
| `GET /api/policy` | The loaded policy, read-only. |
| `GET /api/upstreams` | The configured upstreams and their trust class. |
| `GET /health` | Whether cloud credentials are set, whether the local upstream answers, and the rule count. |
| `WS /ws` | Each new event and approval as it happens. |

## Known limits

An adversarial review tried to get a fake SSN or API key past SENTINEL to the cloud model or to an outside host. SENTINEL closed every leak it found except the ones below. `tests/test_gaps.py` keeps each one as a strict expected failure, so a fix shows up as a test change.

- Block-listed data sent to an allowed host passes. The policy blocks secrets only on hosts outside `allowed_domains`, so a URL such as `http://localhost/redirect?to=evil.net` carrying a key is allowed.
- SENTINEL reads no pixels. Text inside an image goes to the cloud unread.
- An SSN split across two requests is missed when the second request does not carry the first in its history.
- The checks that undo spacing, encoding, and splitting cover SSNs and secrets only, not card numbers. Interleaving other digits between the parts of an SSN also defeats the split check.
- A held tool call whose agent disconnects stays pending until someone resolves it or the proxy restarts.
- Detection has false positives. Presidio tags whole CSV rows as people, a salary of 168000 as a phone number, and some place names as people. None of them change the demo's actions.

## Next steps

- **A semantic classifier.** Add a model-based classifier next to the pattern recognizers, to catch sensitive content that has no fixed shape, such as a described diagnosis with no medical keyword.
- **MCP support.** Check MCP tool calls the same way SENTINEL checks the Anthropic `tool_use` blocks today.
