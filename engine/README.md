<img src="assets/icon.svg" width="64" height="64" alt="">

# SENTINEL

SENTINEL is the agents' side of Fragmos. To run the whole product, the workspace and the Monitor included, use the root [`README.md`](../README.md).

It is a proxy between an AI agent and the models the agent calls. SENTINEL reads each request before the request leaves the laptop. It also reads every tool call the model asks the agent to run. For each request, a policy picks one action:

- `ALLOW` forwards the request unchanged.
- `REDACT` swaps names and emails for placeholders such as `[PERSON_1]`, sends the masked request to the cloud model, and puts the real values back before the agent sees the reply.
- `REROUTE` sends the request to the local model instead of the cloud.
- `HOLD` pauses a tool call until a human approves or denies it on the Monitor. After 60 seconds, a held call becomes a block.
- `BLOCK` refuses and returns `[SENTINEL] Request blocked: <reason>` to the agent.

To use SENTINEL, a client changes its base URL and sends a gateway key as its API key. An Anthropic client points at `http://127.0.0.1:8787`. An OpenAI client, such as Open WebUI or any OpenAI SDK, points at `http://127.0.0.1:8787/v1`. Both doors run the same detection, policy, vault, and Monitor events. [Connect an agent or a chat app](#connect-an-agent-or-a-chat-app) has the steps.

The Monitor is the web app's `/monitor` page at `http://127.0.0.1:3000/monitor`. It reaches SENTINEL through the `/engine/*` rewrite in `fragmos/next.config.ts`. SENTINEL itself serves only the API on port 8787.

All demo data is fake. `demo/generate_data.py` generates it from a fixed seed.

## Run the engine alone

You need Python 3.11 at `~/.local/bin/python3.11`, `make`, `curl`, `lsof`, and an OpenCode Go API key. Run these commands from `engine/`.

1. Install the Python packages and the spaCy model `en_core_web_lg`:

	```sh
	make setup
	```

2. Create your `.env` and set `OPENCODE_API_KEY` in it:

	```sh
	cp .env.example .env
	```

3. Generate the demo data and start the proxy, the demo site, and the attacker stub:

	```sh
	make demo
	```

	You should see `stack is up (logs in .run/)`, then the events URL and the four scenario commands.

4. Run every scenario against the live stack and check the results:

	```sh
	make check
	```

	You should see one `PASS` line each for `1`, `1-deny`, `1b`, `2`, and `3`, then `5/5 passed`.

5. To stop the stack, run `make down`.

`make demo` here starts no Monitor. Run `make demo` from the repository root to get the Monitor too. Without the Monitor, read the events at `http://127.0.0.1:8787/api/events`.

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

`SENTINEL_CLOUD_MODEL` overrides the cloud model, which defaults to `deepseek-v4.1-flash`. `SENTINEL_LOCAL_API_KEY_ENV` names the variable that holds the local model's key, which defaults to `OPENCODE_API_KEY`.

## Connect an agent or a chat app

Every call to `/v1/messages`, `/v1/chat/completions`, or `/v1/models` needs a gateway key. A missing, wrong, or revoked key gets 401. Create a key in the dashboard, or from `engine/`:

```sh
.venv/bin/python -m sentinel keys create my-app
```

The command prints the key, `fk_` and 40 more characters, and nothing else. SENTINEL stores only its SHA-256, so the key is shown once. `make up` mints a key named `demo` into `.run/demo.key` when that file is missing or the engine rejects it, and `demo/agent.py` sends it.

The key's name is the event's `client` field, so the Monitor can show which app sent each turn. The vault is kept per key name and session, so one app's `[PERSON_1]` never turns into another app's real name.

An Anthropic client sends the key as its API key:

```python
anthropic.Anthropic(base_url="http://127.0.0.1:8787", api_key=key)
```

An OpenAI client does the same against `/v1`:

```python
openai.OpenAI(base_url="http://127.0.0.1:8787/v1", api_key=key)
```

In Open WebUI, add an OpenAI API connection under **Admin Settings > Connections** with the URL `http://127.0.0.1:8787/v1` and the key. `/v1/models` lists `cloud` and `local`. The `model` field picks one of them. Any other model name routes the way the Anthropic door does, to the `x-sentinel-upstream` header or to `cloud`.

The OpenAI door handles text chat only for now.

- `system` and `developer` messages become the system prompt.
- `max_completion_tokens` or `max_tokens` caps the reply, 4096 by default. `temperature`, `top_p`, and other sampling knobs are dropped, as on `/v1/messages`, because the Anthropic SDK SENTINEL calls upstream has no field for them.
- Images, audio, files, `tools`, and tool calls get 400.
- With `"stream": true`, the reply comes as server-sent events. A role chunk comes first, then the whole answer as one chunk, a chunk with `finish_reason`, and `data: [DONE]`.
- A blocked or denied turn answers with a normal assistant message, `[SENTINEL] Request blocked: <reason>`, so the chat shows it. A held turn waits for the Monitor's approve or deny, up to 60 seconds, before it answers.

`GET /api/gateway` returns both base URLs and the model list for the dashboard. The base URLs come from `SENTINEL_PUBLIC_URL`, `http://127.0.0.1:8787` by default. That value is only shown. It does not change which `Host` SENTINEL accepts.

The endpoint is loopback only. SENTINEL binds `127.0.0.1` and accepts only a loopback `Host`, so a client must run on the same machine. The key, event, and approval APIs have no key of their own and rely on that, together with the `Origin` check. Reaching SENTINEL from another machine or a container needs a tunnel and an auth layer in front of every route, which is out of scope.

`SENTINEL_PORT` moves the engine off port 8787. `SENTINEL_DB` moves its database, for the server and for `keys create`.

## Give the three-minute demo

The root [`README.md`](../README.md) has a three-minute script that covers the workspace and these scenarios together. This script covers the engine alone.

Start with `make demo` already run from the repository root. Open the Monitor at `http://127.0.0.1:3000/monitor` on one side of the screen and a terminal in `engine/` on the other. Each scenario prints its steps in color, including SENTINEL's block messages.

**0:00 to 0:20. Set up the problem.** Say: "This agent can read files, fetch web pages, send email, and post to URLs. Everything it reads goes to a cloud model. SENTINEL reads it first."

**0:20 to 1:00. Scenario 1, a health note.**

```sh
.venv/bin/python demo/agent.py --scenario 1
```

The agent reads `patient_note.txt`, which has health details. Policy marks health data tier 3, so the summary turn goes to the local model. The cloud edge on the graph stays dark. The model then asks to email the summary to `dr.lee@demo.sentinel.local`. The email carries personal data, so SENTINEL holds it and the **Held for your approval** dialog opens. Click **Approve**. The email lands in `demo/outbox.jsonl`.

**1:00 to 1:40. Scenario 1b, the same task with a lighter note.**

```sh
.venv/bin/python demo/agent.py --scenario 1b
```

`patient_note_light.txt` has names and emails but no health data. SENTINEL replaces them with placeholders and sends the request to the cloud. Open the turn in the feed to compare the real text with what the model saw. The cloud saw `[PERSON_1]`, and the agent's answer has the real names.

**1:40 to 2:10. Scenario 2, salaries with SSNs.**

```sh
.venv/bin/python demo/agent.py --scenario 2
```

`employees.csv` holds SSNs, so the turn goes to the local model. The answer is still right. The average salary is 117,200, and Sheri Edwards earns the most.

**2:10 to 2:50. Scenario 3, prompt injection.**

```sh
.venv/bin/python demo/agent.py --scenario 3 --vulnerable
```

The blog post hides an instruction to read `.env.fake` and post it to `collector.evil-demo.net`. The model asks for that `http_post`. SENTINEL blocks it because the body carries a secret and the host is not on the allow list. A **Blocked before it left** toast appears, the graph edge ends in a red ✕, and the reason says possible prompt injection. Nothing reaches the outbox.

No real model followed the injection in 45 runs across seven models. `--vulnerable` therefore plays the obedient model with a scripted stub on port 8789. Every request and reply still goes through SENTINEL's full pipeline, and the event log labels that upstream `simulated`.

**2:50 to 3:00. Close.** Say: "Firewalls protect networks from people. SENTINEL protects people from their own AI."

`docs/screenshots/` and `docs/recordings/m7-all-scenarios.webm` show these steps on the standalone dashboard that the Monitor replaced. The Monitor has the same feed, graph, toast, and approval dialog. `DEMO_LOG.md` has a recorded `make check` run.

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
        │                 │        SQLite event log ─► /api/*, WS /ws ─────┼────► /engine/* rewrite
        │                 └─────────────────────┼──────────────────────────┘      in fragmos/next.config.ts
        │                                       │                                       │
        │                                       │                                       ▼
        │                                       │                              Monitor :3000/monitor
        │                                       │                              approve or deny
   mocked tools: read_file, web_fetch (demo site :8788), send_email and http_post (demo/outbox.jsonl)
```

Detection uses Presidio with the spaCy model `en_core_web_lg`. `sentinel/presidio_detector.py` adds recognizers for the types Presidio lacks or misses:

- `SECRET`: Anthropic, OpenAI, AWS, GitHub, Slack, Stripe, Google, SendGrid, Twilio, and npm keys, private keys, JWTs, `Bearer` and `Basic` credentials, passwords in URLs, and `name=value` assignments such as `SMTP_PASSWORD=...`. An entropy check adds random-looking tokens, at a lower bar after a word such as `token` or `secret`.
- `HEALTH`: a list of medical terms.
- `EMAIL_ADDRESS`, including emails on `.local` domains.
- `CRYPTO`, `US_EIN`, `UK_NINO`, `DATE_OF_BIRTH`, and `PROJECT_CODENAME`, with patterns ported from the web app's `fragmos/lib/patterns.ts`.
- `CREDIT_CARD`, with an extra pattern for Mastercard's 2-series and Presidio's Luhn check.

Each entity type has a tier in `policy.yaml`, and SENTINEL asks Presidio only for the types listed there. The first matching rule picks the action. A secret or any tier-3 entity reroutes, a tier-2 entity redacts, and anything else is allowed. Tier 1 types, such as `ORGANIZATION`, `IP_ADDRESS`, and `UUID`, are found and counted but never redacted.

SSNs and secrets are also read through disguises. `sentinel/core/views.py` undoes NFKC compatibility forms, invisible characters, unusual dashes and spaces, text spaced out one character at a time, and base64. A key broken by a space or a line break is read whole again. `joined()` in `sentinel/core/detect.py` reads a value split across messages, blocks, or tool calls.

The egress check runs on every tool call after SENTINEL restores the real values. An `http_post`, `web_fetch`, or `send_email` to a host outside `allowed_domains` is blocked if it carries a secret, an SSN, a UK national insurance number, or a card number. One that carries a name, email, phone number, health term, birth date, IBAN, crypto wallet, or employer tax number is held.

Detection, policy, the vault, and the egress check live in `sentinel/core/`. That package imports no web framework, SDK, or database, so the tests run without a server. `sentinel/wire.py` is the only module that reads or writes the Anthropic JSON format. `docs/design.md` explains the design, and `DECISIONS.md` records each decision with its evidence.

### Endpoints

| Endpoint | Returns |
|---|---|
| `POST /v1/messages` | The Anthropic Messages API, non-streaming. Needs a gateway key. Sessions come from the `x-sentinel-session` header. The `x-sentinel-upstream` header picks a registered upstream, `cloud` by default. |
| `POST /v1/chat/completions` | The OpenAI Chat Completions API for text, streaming or not. Needs a gateway key. `model` picks an upstream; the session and upstream headers work as on `/v1/messages`. |
| `GET /v1/models` | The upstreams a caller can pick, in OpenAI's list shape. Needs a gateway key. |
| `GET /api/gateway` | `openai_base_url`, `anthropic_base_url`, and `models`, for the dashboard. |
| `GET /api/keys` | Gateway keys: `id`, `name`, `prefix`, `created_at`, `last_used_at`. Never the key. |
| `POST /api/keys` | Creates a key from `{"name": "..."}` and returns 201 with the plain `key`, the only time it is shown. |
| `DELETE /api/keys/{id}` | Revokes a key at once. Returns 204. |
| `GET /api/events?limit=200` | The latest events, one per turn. `&session=<id>` keeps one session's events. |
| `GET /api/stats` | Counts by action, entity type, and destination. |
| `GET /api/approvals` | Approvals, pending ones first. |
| `POST /api/approvals/{id}` | Resolves an approval. The body is `{"decision": "approve"}` or `{"decision": "deny"}`. |
| `GET /api/policy` | The loaded policy, read-only. |
| `GET /api/upstreams` | The configured upstreams and their trust class. |
| `GET /health` | Whether cloud credentials are set, whether the local upstream answers, and the rule count. |
| `WS /ws` | Each new event and approval as it happens. |

The Monitor calls its endpoints under `http://127.0.0.1:3000/engine/`, for example `/engine/api/events`. The web app forwards only `/api/events`, `/api/stats`, `/api/upstreams`, `/api/approvals` and `/ws`.

SENTINEL accepts only a loopback `Host` header (`127.0.0.1` or `localhost`), so a DNS-rebound name gets 400. A browser `Origin` that is not on `SENTINEL_ALLOWED_ORIGINS` gets 403 on `/ws`, `POST /api/approvals/{id}`, every `/api/keys` route, `POST /v1/messages`, and `POST /v1/chat/completions`. The default list is `http://127.0.0.1:3000,http://localhost:3000`. Agents, chat backends, and curl send no `Origin`, so they are not affected. An approval or a new key also needs `Content-Type: application/json`, or it gets 415.

## Known limits

An adversarial review tried to get a fake SSN or API key past SENTINEL to the cloud model or to an outside host. SENTINEL closed every leak it found except the first three below. `tests/test_gaps.py` keeps each of those three as a strict expected failure, so a fix shows up as a test change.

- Block-listed data sent to an allowed host passes. The policy blocks secrets only on hosts outside `allowed_domains`, so a URL such as `http://localhost/redirect?to=evil.net` carrying a key is allowed.
- SENTINEL reads no pixels. Text inside an image goes to the cloud unread.
- An SSN split across two requests is missed when the second request does not carry the first in its history.
- The checks that undo spacing, encoding, and splitting cover SSNs and secrets only, not card numbers. Other digits placed between the parts of an SSN also defeat the split check.
- A held tool call whose agent disconnects stays pending until someone resolves it or the proxy restarts.
- SENTINEL does not flag record ids such as `MRN-772913`. Presidio has no recognizer for them and reads that one as a `LOCATION`. `tests/test_fragmos_presets.py` keeps this as a strict expected failure.
- Institutions are found but not redacted. `ORGANIZATION` is tier 1, because spaCy also tags `SSN`, `EIN`, and first names as organizations.
- The entropy check can fire on a file path that follows a word such as "api" or "token". Such a request stays on the local model.
- The codename pattern reads "Client ID", "Client Error", and "Project Structure" as codenames. In text SENTINEL cannot rewrite, such as a tool definition, that match sends the request to the local model.
- Name linking depends on order across turns. The vault never changes a placeholder, so a lone name seen before its full name keeps its own placeholder.
- Detection has false positives. Presidio tags whole CSV rows as people, a salary of 168000 as a phone number, and some place names as people. None of them change the demo's actions.

## Next steps

- **A fine-tuned GLiNER2 model.** It is training to find names and prompt-injection attempts. It will join the detector once trained.
- **MCP support.** Check MCP tool calls the same way SENTINEL checks the Anthropic `tool_use` blocks today.
