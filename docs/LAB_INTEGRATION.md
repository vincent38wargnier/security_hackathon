# Attack lab: integration status (frontend branch `frontend/attack-patch-lab`)

Base: main `8bde0d2` (merged). `server.py` is unchanged by this branch. No second backend was created.

## What is live, simulated and unfinished

| Area | Status |
| --- | --- |
| Five levels (`direct`, `toolpoison`, `mcp`, `exfil`, `confused`) | Ported from `server.py` PAGE LEVELS into typed data (`frontend/src/protect/lab/levels.ts`). Scam link moved to reserved `calm-gift.example`. |
| Verdict heuristic | Ported verbatim (`INJ`, `DANGER`, `poisoned`, `verdict`) in `lab/verdict.ts`. Frontend rule on top: trace violations always count; empty, truncated, cancelled, failed or unsupported answers never count as a defense. |
| Loop | Visible steps Inspect, Attack, Observe, Patch, Replay, Explain. Attack -> read-only inspection -> patch under the hood -> exact replay (same input, fresh one-message history, must differ from the attacked config) -> benign control (legitimate tool must still be used). |
| Scripted fixture | **Simulated.** Deterministic local script, labelled "Scripted fixture · not AI" on every run. Default mode. Models only each level's reference attack and control; free text is marked inconclusive. |
| Live AI adapter | **Built and tested against mocks and the real key-less server.** Browser calls same-origin `/lab-api/{health,chat}` only. Vite dev/preview proxies to `http://127.0.0.1:${VULN_LAB_PORT:-8850}/api/*`. No key, model or URL is configurable from the browser. |
| Live model inference | **Not exercised.** No paid Scaleway call was made. Needs Vincent's server with a key plus explicit budget approval. |
| Tool effects | **Simulated always.** `server.py` returns the level's `returns` string; nothing executes. |
| `/api/scan` | **Wired in Live mode only** (typed `parseScan`, drawer "Real code scan report from the lab server"). 8bde0d2 fixed the label to `engine: "Semgrep"`. The UI says it reads an existing report file and that an empty list is unknown, not clean. The server `score` is hidden when there are no findings. |
| Offline drills (3 incidents, JSON proposal protocol) | Preserved unchanged at `?mode=drills` (tab "Offline drills"). `window.compassTraining` works as before. |
| Guild | Separate private workspace link only. Not an integration. |
| Public deployment | **Live at https://mycompass.world/protect in scripted mode** (Railway deployment 2c507e0a, assets `protect-DMgtrduZ.js`). Live AI button is shown disabled with the reason; builds enable it only with `VITE_LAB_LIVE=1`. See DEPLOYMENT.md. |

## Connection states shown in the UI

- `Scripted fixture · not AI`: fixture transport selected.
- `Checking lab server…`: `GET /lab-api/health` in flight.
- `Live: not connected`: no server, proxy error or a foreign health shape.
- `Live: server has no provider key`: `{ok:false}`.
- `Key configured · <model> · not yet verified`: `{ok:true}`. This only means a key exists.
- `Live run completed · <model>`: shown only after a real completed live run.

Live runs also require the player to tick "I have approval to spend on this session". A failed live call shows the error and never falls back to the fixture.

## Run it locally with Vincent's server

```sh
# terminal 1 (Vincent's server; add SCALEWAY_API_KEY only with budget approval)
python3 server.py
# terminal 2
cd frontend && npm ci && npm run dev    # http://127.0.0.1:8793/protect
```

Choose "Live AI" in the header. Without a key you will see "server has no provider key", and attempted runs send nothing.

## Requests to Vincent before any PUBLIC live release

1. **Access:** a server-side gate (session token or allowlisted judge access). Today anyone who can reach the port can spend the key.
2. **Input validation:** reject bodies over ~32 KB; require exactly one user message, `system` <= 4000 chars, <= 6 tools, tool name `^[A-Za-z0-9_-]{1,64}$`, text fields <= 2000 chars. The frontend already enforces these; the server must too.
3. **Rate, concurrency and budget:** per-client rate limit, one in-flight run per client, a daily call budget. One `/api/chat` can make up to 5 provider calls (`MAX_TOOL_HOPS` + 1). Consider `max_tokens` lower than 1200 for the game.
4. **Errors:** return `{error, code}` with sanitized text. Today HTTPError bodies (first 400 chars) and exception text are forwarded to the browser. The frontend redacts bearer/token patterns, but the server should not send them.
5. **Origin/CSRF:** accept `POST /api/chat` only with `Content-Type: application/json` and a same-origin `Origin` header.
6. **Routing:** mount the API under a path the COMPASS host does not already use, e.g. `/lab-api/*` behind the same origin as `/protect`. mycompass.world already serves other `/api/*` routes; the frontend deliberately never calls bare `/api/*`. Allowed paths: `/lab-api/health`, `/lab-api/chat`, `/lab-api/scan`.
7. **Receipt:** add `{model, request_id, provider_status, duration_ms}` to the chat response so the UI can show a redacted live receipt.
8. **Scan provenance:** the Snyk label is fixed in 8bde0d2. Remaining: with no `semgrep.json` the server returns `findings: []` and `score: 10.0`, which reads as a perfect result. Return `{"error": "no report"}` or `score: null` when the file is missing, and add the scanned commit and report time.

Until these exist, keep Live AI to local development. The public build stays scripted.

## Security checks run on this branch

- `npm audit`: 0 vulnerabilities.
- Snyk Open Source (`snyk test --dev --include-ignores`, org `axmatea`): 123 dependencies tested, 0 issues, no ignores.
- Snyk Code: **blocked**, `SNYK-CODE-0005` "Snyk Code is not enabled" for org `axmatea` (403). Account policy was not changed.
- None of these prove prompt-injection safety. Verdicts are single-run string heuristics.
