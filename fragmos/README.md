# Fragmos web app

This Next.js app is the people's side of Fragmos. It serves the workspace at `/`, where the browser masks personal data and secrets before a prompt goes to Gemini, Claude, or GPT. It also serves the Monitor at `/monitor`, which shows what the SENTINEL engine does with an agent's traffic.

To run the whole product, the engine included, use the root [`README.md`](../README.md).

## Develop

Run these from `fragmos/`:

| Command | What it does |
|---|---|
| `npm ci` | Installs the packages from `package-lock.json`. |
| `npm run dev` | Starts `next dev` with hot reload at `http://localhost:3000`. |
| `npm run build` | Builds for production. |
| `npm run start` | Serves the production build. |
| `npm run lint` | Runs ESLint. |
| `npm test` | Runs the Vitest suite once. |

The workspace works without the engine. The Monitor needs the engine on port 8787. To start the engine alone, run `make demo` in `engine/`. The root `make demo` starts the engine and a production build of this app together.

## Environment

Copy `.env.example` to `.env.local`. Every variable is optional.

| Variable | Default | Use |
|---|---|---|
| `GEMINI_API_KEY` | unset | The server's Gemini key. `/api/chat` uses it when the request carries no user key. |
| `GEMINI_MODEL` | unset | Pins one Gemini model. Unset, the route tries `gemini-3.6-flash`, then `gemini-3.1-flash-lite`. |
| `GOOGLE_GENAI_USE_VERTEXAI` | unset | Set to `true` to use Vertex AI in place of `GEMINI_API_KEY`. A user's own Gemini key still goes to the Gemini API. |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | unset | The Vertex AI project and region. |
| `SENTINEL_URL` | `http://127.0.0.1:8787` | Where the engine listens. `next.config.ts` reads it when `next dev` or `next build` runs. |
| `SERVER_KEY_RATE_LIMIT` | `20` | Requests per client per window on the server's Gemini key. |
| `SERVER_KEY_RATE_LIMIT_TOTAL` | `200` | Requests from all clients per window on the server's Gemini key. |
| `SERVER_KEY_RATE_WINDOW_SECONDS` | `60` | The length of the rate-limit window. |

Claude and GPT have no server key. A person adds their own key in **Settings** (the gear icon). The browser keeps keys in `sessionStorage` under `fragmos.settings` and sends the active one in the `x-user-key` header. The server passes it to the provider and stores nothing.

## How a prompt moves through the app

1. **The scrubber masks the text in the browser.** `scrubText()` in `lib/scrubber.ts` runs on every edit. It finds structured values with the patterns in `lib/patterns.ts` and the entropy check in `lib/entropy.ts`, through `detectSensitive()` in `lib/detect.ts`. It then finds names and institutions with `compromise` and a pattern for school and clinic names. It also masks unknown ALL-CAPS terms and any terms the person chose to mask. Each value gets a placeholder such as `[SUBJECT_1]` or `[EMAIL_2]`, and the vault maps it back to the real value in memory. A lone first name reuses the placeholder of the one full name it belongs to.
2. **The views read through disguises.** `lib/views.ts` gives each pattern more readings of the same text: NFKC-folded, with invisible characters dropped, unusual dashes and spaces made plain, spaced-out characters joined, and SSN digit groups hyphenated. `decoded()` adds a reading of each base64 run, and `compact()` removes whitespace so a key broken across lines still matches. Every view maps its matches back to the original characters, so the placeholder covers what the person typed.
3. **The browser checks before it sends.** `leaksOriginal()` refuses the send if any real value from the vault still appears in the sanitized text, in any reading. The page shows "Blocked" and sends nothing.
4. **The server rechecks.** `POST /api/chat` in `app/api/chat/route.ts` receives only `sanitizedPrompt` and the active policy ids. `parseChatRequest()` in `lib/server/request.ts` rejects a body over 256 KB or a prompt over 20,000 characters with status 413. `containsResidualPII()` then reruns the patterns and the entropy check for every category that is switched on, with the placeholders masked out, and returns status 422 if any value remains. The recheck does not rerun name detection.
5. **The rate limit guards the server's key.** `limitServerKey()` in `lib/server/rate-limit.ts` runs only on requests that spend the server's Gemini key, on `/api/chat` and `/api/models`. Over the limit, it returns status 429 with a `Retry-After` header. A client is the first address in `X-Forwarded-For`. The total limit holds even when that header is forged. The counts live in memory, so each server instance has its own budget and a restart resets it.
6. **The provider answers in placeholders.** `lib/server/llm.ts` streams the reply from Gemini, Claude, or GPT. On a retryable status, `/api/chat` tries each model twice before it moves to the next one. The route's system prompt tells the model to copy every placeholder exactly.
7. **The browser restores the real values.** `rehydrateSegments()` swaps each known placeholder in the reply for its real value. While the reply streams, `withholdPartialToken()` hides a placeholder that has only partly arrived.

The policy toggles under the editor come from `lib/policies.ts`. **HIPAA**, **PCI**, **Gov IDs**, and **Projects** each turn a group of categories on or off. Names, institutions, record ids, emails, phones, SSNs, and secrets are always on. The **Wire** panel shows the exact payload, and the **Vault** panel lists each placeholder with its real value.

## The Monitor

`app/monitor/page.tsx` renders `components/monitor/Monitor.tsx`. It opens the engine's WebSocket, then loads the latest events, approvals, and upstreams. After that, each message on the socket updates the page, and the page fetches fresh stats after each burst of messages. If the socket closes, the page reconnects with a growing delay. `lib/monitor/api.ts` makes every call under `/engine`, and `next.config.ts` rewrites `/engine/:path*` to `SENTINEL_URL`, the WebSocket included. The page shows a feed of turns, a graph of where each turn went, a detail pane comparing the real text with what the model saw, a toast for each block, and the approval dialog for held tool calls. When the engine is down, the page says **The engine is not running**.

## Tests

`npm test` runs 313 tests in 10 files. They need no network and no running engine.

- `lib/patterns.test.ts`, `lib/entropy.test.ts`, and `lib/detect.test.ts` cover the patterns, the Luhn check, the entropy check, and detection through disguises.
- `lib/views.test.ts` covers each reading and its mapping back to the original text.
- `lib/scrubber.test.ts` covers masking, name linking, rehydration, and the leak check.
- `app/api/chat/route.test.ts` and `app/api/models/route.test.ts` cover request parsing, the server recheck, the rate limit, and the key checks.
- `lib/server/llm.test.ts` covers the provider streams and how provider errors become statuses.
- `lib/monitor/api.test.ts` covers how the Monitor parses the engine's WebSocket messages, and `lib/monitor/entities.test.ts` covers the explanation it shows for each entity type.
