# Fragmos

Fragmos keeps personal data and secrets out of the AI models you use. It has two front doors.

- **The workspace is for people.** You paste a student note, a patient intake, or a config file. The browser swaps every name, contact, record id, and key for a placeholder such as `[SUBJECT_1]` before the prompt leaves the tab. Gemini, Claude, or GPT answers in placeholders, and the browser puts the real values back.
- **The engine is for AI agents.** SENTINEL is a proxy between an agent and its models. The agent points its Anthropic client at `http://127.0.0.1:8787`, or its OpenAI client at `http://127.0.0.1:8787/v1`, and sends a gateway key from the dashboard. Open WebUI connects the same way. The engine reads every request and every tool call the model asks for. A policy then lets it through, masks it, sends it to a local model, holds it for a human, or blocks it.

Both doors work the same way. Real values go out as placeholders, and the real values come back only on your side. The Monitor page shows the engine's decisions live and is where a person approves or denies a held tool call.

All demo data is fake.

## Run it

You need the following:

- Python 3.11 at `~/.local/bin/python3.11`. `make setup` uses it to create `engine/.venv`.
- Node.js with npm.
- `make`, `curl`, and `lsof`. The Makefiles use them to start and stop processes.
- An OpenCode Go API key. The engine calls its cloud and "local" models through OpenCode Go.
- Optionally, a Gemini API key. The workspace uses it when a person has not added their own key in **Settings**.

Run every command from the repository root.

1. Install the Python packages, the spaCy model `en_core_web_lg`, and the web app's packages:

	```sh
	make setup
	```

	It finishes with npm's report of the packages it added.

2. Create the engine's env file and set `OPENCODE_API_KEY` in it:

	```sh
	cp engine/.env.example engine/.env
	```

3. Optional. To let the workspace call Gemini with a server key, create the web app's env file and set `GEMINI_API_KEY` in it:

	```sh
	cp fragmos/.env.example fragmos/.env.local
	```

	Without it, open **Settings** (the gear icon) in the workspace and add your own Gemini, Claude, or GPT key. Claude and GPT always need your own key.

4. Generate the demo data, then start the engine, the demo site, the attacker stub, and the web app:

	```sh
	make demo
	```

	You should see `started proxy on :8787`, `started site on :8788`, `started stub on :8789`, and `stack is up`, then the four scenario commands. The web app builds next, and `make demo` waits up to two minutes for it to answer. The output ends with these lines:

	```
	workspace  http://127.0.0.1:3000/
	monitor    http://127.0.0.1:3000/monitor
	run the scenarios above from engine/
	```

5. With the stack up, run every engine scenario and check the results:

	```sh
	make check
	```

	You should see one `PASS` line each for `1`, `1-deny`, `1b`, `2`, and `3`, then `5/5 passed`. The check approves or denies each held call itself, through the engine's API. A scenario that calls a real model gets one retry if it fails, reported as `PASS (retry)`, because a model can drift.

6. Run the unit tests, which need no network and no running stack:

	```sh
	make test
	```

	The engine's suite prints `303 passed, 6 xfailed`. The six expected failures are the known gaps that `engine/tests/test_gaps.py` and `engine/tests/test_fragmos_presets.py` keep as strict xfails. The web app's suite prints `Test Files  10 passed (10)` and `Tests  313 passed (313)`.

7. To stop everything, run:

	```sh
	make down
	```

	You should see `stopped web`, `stopped proxy`, `stopped site`, and `stopped stub`.

Each process writes its log to `engine/.run/`, for example `engine/.run/web.log` and `engine/.run/proxy.log`. If a port is busy, `make demo` stops with `port <n> is held by another process`.

To develop the web app with hot reload, see [`fragmos/README.md`](fragmos/README.md). To run the engine alone or switch it to a real local model, see [`engine/README.md`](engine/README.md).

## Give the three-minute demo

Start with `make demo` already run. Open the workspace in one browser tab and the Monitor in another. Keep a terminal open in `engine/` for the agent scenarios. The workspace presets need a Gemini key on the server or a key in **Settings** to generate a reply. Without one, the masking still shows live as you click each preset.

**0:00 to 0:15. Set up the problem.** Say: "People paste student records and patient notes into chatbots. Agents read files and post to URLs. Fragmos reads everything first, from either door."

**0:15 to 0:45. The IEP student note in the workspace.** Click **IEP Student Note** under **Try a sample**. Names, the student id, both schools, both emails, and both phones turn into placeholders such as `[SUBJECT_1]` and `[RECORD_ID_1]`. Point at the **Wire** panel, which is the exact payload sent to `/api/chat`, and at the **Vault**, which holds the real values in memory only. "Marcus" alone reuses `[SUBJECT_1]`, the placeholder for "Marcus Vance". Click **Generate Safely**. The reply streams back with the real names restored in the browser.

**0:45 to 1:00. The clinical intake.** Click **Clinical Intake**. The SSN, the `MRN-772913` record id, the clinic, and the hospital are masked along with the names and contacts. Hover a highlighted value in the editor to see why that kind of value is sensitive.

**1:00 to 1:15. The leaked API config.** Click **Leaked API Config**. Every credential becomes a placeholder: the Gemini key, both AWS keys, the Stripe key, the database URL with its password, and the SMTP password. Generate, and the model lists what to rotate without ever seeing a key.

**1:15 to 1:20. Switch doors.** Say: "That was a person. Now an agent." Switch to the Monitor tab.

**1:20 to 1:50. Scenario 1, a health note.**

```sh
.venv/bin/python demo/agent.py --scenario 1
```

The agent reads `patient_note.txt`, which has health details. Health data is tier 3, so the summary turn goes to the local model and the cloud edge on the graph stays dark. The model then asks to email the summary to `dr.lee@demo.sentinel.local`. The email carries personal data, so the engine holds it and the **Held for your approval** dialog opens. Click **Approve**. The email lands in `engine/demo/outbox.jsonl`.

**1:50 to 2:15. Scenario 1b, the same task with a lighter note.**

```sh
.venv/bin/python demo/agent.py --scenario 1b
```

`patient_note_light.txt` has names and emails but no health data. The engine replaces them with placeholders and sends the request to the cloud. Open the turn in the feed to compare what the agent sent with what the cloud saw. The cloud saw `[PERSON_1]`, and the agent's answer has the real names.

**2:15 to 2:30. Scenario 2, salaries with SSNs.**

```sh
.venv/bin/python demo/agent.py --scenario 2
```

`employees.csv` holds SSNs, so the turn goes to the local model. The answer is still right. The average salary is 117,200, and Sheri Edwards earns the most.

**2:30 to 2:55. Scenario 3, prompt injection.**

```sh
.venv/bin/python demo/agent.py --scenario 3 --vulnerable
```

The blog post hides an instruction to read `.env.fake` and post it to `collector.evil-demo.net`. The model asks for that `http_post`. The engine blocks it because the body carries a secret and the host is not on the allow list. A **Blocked before it left** toast appears, the graph edge ends in a red ✕, and the reason says possible prompt injection. Nothing reaches the outbox.

No real model followed the injection in 45 runs across seven models. `--vulnerable` therefore plays the obedient model with a scripted stub on port 8789. Every request and reply still goes through the engine's full pipeline, and the Monitor labels that upstream simulated.

**2:55 to 3:00. Close.** Say: "Placeholders out, real values back, for people and for agents."

## How the pieces connect

```
  a person                                          an AI agent or a chat app
     │                                                  │ Anthropic at :8787 or OpenAI at :8787/v1, gateway key
     ▼                                                  ▼
  Workspace  http://127.0.0.1:3000/                  SENTINEL engine  http://127.0.0.1:8787
  fragmos/components/Fragmos.tsx                     engine/sentinel/
     │ scrubText() runs in the browser                  │ detect ─► policy ─► vault ─► forward ──┬──► cloud model
     │ the vault keeps real values in the tab           │ Presidio  policy.yaml  placeholders    │    deepseek-v4.1-flash
     ▼                                                  │ + patterns                             │
  POST /api/chat                                        │                                        └──► "local" model
  fragmos/app/api/chat/route.ts                         │                                             glm-5.3-flash
     │ rechecks the payload, rate-limits the server key │                                             (both on OpenCode Go)
     ▼                                                  │
  Gemini, Claude, or GPT                                │ reply ─► rehydrate ─► egress check on each tool call
     │ reply in placeholders                            │                       ALLOW, HOLD, or BLOCK
     ▼                                                  │
  rehydrateSegments() restores real values              │ SQLite event log, /api/*, WS /ws
  in the browser                                        │
                                                        ▼
  Monitor  http://127.0.0.1:3000/monitor  ◄──── /engine/* rewrite in fragmos/next.config.ts
  fragmos/components/monitor/                    approve or deny held tool calls
```

The code lives in two directories.

- `fragmos/` is the Next.js web app. It serves the workspace at `/` and the Monitor at `/monitor`. `fragmos/lib/` holds the browser scrubber, and `fragmos/app/api/` holds the two server routes, `/api/chat` and `/api/models`.
- `engine/` is the SENTINEL engine, a FastAPI proxy. `engine/sentinel/core/` holds detection, policy, the vault, and the egress check, with no web framework or database imports. `engine/sentinel/presidio_detector.py` is the only module that imports Presidio. `engine/policy.yaml` holds the tiers, rules, and egress lists.

The Monitor never calls port 8787 directly. `fragmos/next.config.ts` forwards the Monitor's routes under `/engine/*` to `SENTINEL_URL`, which defaults to `http://127.0.0.1:8787`, and the WebSocket goes through the same rewrite. Agent traffic (`/v1/messages`, `/v1/chat/completions`) is not forwarded. [`engine/README.md`](engine/README.md#connect-an-agent-or-a-chat-app) explains gateway keys and how to connect a client.

Both halves stay on this machine. The web app binds `127.0.0.1`. The engine accepts only a loopback `Host`, which stops DNS rebinding. It refuses a browser `Origin` that is not on `SENTINEL_ALLOWED_ORIGINS` (default: the web app on port 3000) for `/ws`, approvals, gateway keys, `/v1/messages`, and `/v1/chat/completions`. Every model call needs a live gateway key. Approvals and new keys also need a JSON body, so another web page cannot send one without a preflight that fails. Next.js reads `SENTINEL_URL` when `next build` or `next dev` runs. If the engine is down, the Monitor shows **The engine is not running** and retries in the background.

The root `Makefile` drives both halves. Each root target runs the matching target in `engine/Makefile` and adds the web app's part:

- `make setup` adds `npm ci`.
- `make demo` adds a production build and `next start` on port 3000.
- `make down` adds stopping the web app.
- `make test` adds `npm test`.
- `make check` adds nothing. It runs the engine's scenario check alone.

Both Makefiles start and stop processes with the pidfile macros in `engine/run.mk`.

## Two detectors, by design

The workspace and the engine each have their own detector. The browser scrubber is TypeScript in `fragmos/lib/`, so the raw text never leaves the browser to be checked. The engine is Python in `engine/sentinel/`, using Presidio with spaCy's `en_core_web_lg` plus regex recognizers. Agent traffic already passes through the engine, so the engine can load spaCy's large English model. The browser uses the much smaller `compromise` library for names.

Both detectors catch the same pattern types, except record ids, which only the browser catches. The engine's patterns for tax ids, UK national insurance numbers, birth dates, crypto wallets, project codenames, and secrets are ported from `fragmos/lib/patterns.ts`. Both also run the same entropy check for unknown keys. `engine/tests/test_fragmos_presets.py` runs the workspace's three presets through the engine, so a change to a preset shows up in the engine's tests.

The two detectors read through the same disguises. Each checks the text as written and a normalized reading that undoes the following:

- Full-width and other compatibility characters, through NFKC.
- Zero-width and other invisible characters.
- Unusual dashes and spaces.
- Text spaced out one character at a time.
- SSN digit groups split by spaces or dots.
- Base64-encoded values.
- Keys broken by a space or a line break.

The code for these readings is `fragmos/lib/views.ts` and `engine/sentinel/core/views.py`.

They differ in these places:

| | Browser scrubber | Engine |
|---|---|---|
| Names | `compromise` finds people and runs of proper nouns. A lone first name links to its full name's placeholder. | spaCy finds `PERSON`. A lone name links to its full name's placeholder the same way. |
| Schools, clinics, and hospitals | Masked as `INSTITUTION`. | Found as `ORGANIZATION`, which is tier 1, so it reaches the cloud unmasked. |
| Record ids such as `Student ID #884920` and `MRN-772913` | Masked as `RECORD_ID`. | Not detected. |
| Health terms | Not detected. | `HEALTH`, a list of medical terms, at tier 3. |
| Places | Not detected. | `LOCATION`, tier 1. |
| IP addresses and UUIDs | Masked while the **HIPAA** policy is on. | Tier 1, so found and counted but never redacted. |
| IBANs | Any IBAN-shaped string. | Only IBANs whose checksum holds. |
| ALL-CAPS terms and terms you pick | Masked as `ENTITY` and `CUSTOM`. | Not detected. |
| Disguised readings | Applied to every pattern. | Applied to SSNs and secrets only. |
| A value split across messages or tool calls | Not applicable. The workspace sends one text. | Read whole again across messages, blocks, and tool calls. |
| Entropy check | Runs on every candidate. | Skips a URL's host and path, and ignores guesses on ids, media bytes, and decoded readings. |
| Truncated keys | Need the full key length. | A key's prefix with part of its body still counts. |
| What happens next | Every match becomes a placeholder. The browser refuses to send if a real value survives. | `policy.yaml` picks ALLOW, REDACT, REROUTE, HOLD, or BLOCK for each request and tool call. |

The same three presets show the difference. The workspace masks all three and sends them to the model you picked. The engine sends the IEP note to the cloud with names and contacts masked and the schools unmasked. The clinical intake carries an SSN and a health term, and the leaked config carries keys, so the engine keeps both on the local model.

## Known limits

An adversarial review tried to get a fake SSN or API key past the engine. The engine closed every leak it found except the first three below. `engine/tests/test_gaps.py` keeps each of those three as a strict expected failure, so a fix shows up as a test change.

Engine limits:

- Block-listed data sent to an allowed host passes. The policy blocks secrets only on hosts outside `allowed_domains`, so a URL such as `http://localhost/redirect?to=evil.net` that carries a key is allowed.
- The engine reads no pixels. Text inside an image goes to the cloud unread.
- An SSN split across two requests is missed when the second request does not carry the first in its history.
- The checks that undo spacing, encoding, and splitting cover SSNs and secrets only, not card numbers. Other digits placed between the parts of an SSN also defeat the split check.
- A held tool call whose agent disconnects stays pending until someone resolves it or the engine restarts.
- The engine does not flag record ids such as `MRN-772913`. Presidio has no recognizer for them and reads that one as a `LOCATION`.
- Institutions are found but not redacted. `ORGANIZATION` is tier 1, because spaCy also tags `SSN`, `EIN`, and first names as organizations.
- The entropy check can fire on a file path that follows a word such as "api" or "token". Such a request stays on the local model.
- The codename pattern reads "Client ID", "Client Error", and "Project Structure" as codenames. In text the engine cannot rewrite, such as a tool definition, that match sends the request to the local model.
- Name linking depends on order across turns. The vault never changes a placeholder, so a lone name seen before its full name keeps its own placeholder.
- Detection has false positives. Presidio tags whole CSV rows as people, a salary of 168000 as a phone number, and some place names as people. None of them change the demo's actions.

Workspace limits:

- The server's rate limit on its Gemini key counts in memory, per server instance. Each instance has its own budget, and a restart resets it.
- An em dash glued to the end of a key pulls the next word into the placeholder. `Use sk-ant-<key>—then rotate it` becomes `Use [API_KEY_1] rotate it`, and the vault entry includes "then".
- The codename pattern also masks "Client ID" and similar phrases as `[PROJECT_1]`.
- The server recheck on `/api/chat` reruns the patterns and the entropy check, not name detection.
- A word that starts like a key prefix, such as `sk-learn` or `xoxb-`, is masked together with the words after it, up to the next punctuation. The scrubber cannot tell a key split by spaces from prose by shape, so it fails closed.
- A key split by a space after a part that is already a whole key is masked only up to the space.
- Names encoded in base64 are not found. Name detection reads the prompt as typed, and only the structured patterns read decoded base64.
- Without `TRUST_FORWARDED_FOR=true`, all clients share one per-client budget on the server's Gemini key.

## Next steps

- **A fine-tuned GLiNER2 model.** It is training to find names and prompt-injection attempts. It will join the engine's detector once trained.
- **MCP support.** Check MCP tool calls the same way the engine checks Anthropic `tool_use` blocks today.
