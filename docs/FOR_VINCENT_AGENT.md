# For Vincent's agent: taking the Playground live on mycompass.world

Paste this file to your coding agent. It explains what is already published, what you own,
and the exact safe path to switch the game from Simulation to Live AI on our domain.

## 1. What exists now

- **Your design and idea are ported.** `/protect` on mycompass.world is the "Prompt Injection
  Playground" from `server.py`: welcome modal, emoji level path, Hack it / Patch it / Done,
  chat bubbles, tool trace cards, result cards, hint cards, "Edit the AI's rules", "Test my patch".
  Code: `frontend/src/protect/lab/Lab.tsx` + `frontend/src/protect/playground.css`
  (your CSS, scoped under `.pg`, local fonts only because the page CSP is `font-src 'self'`).
- **It is a game you can type and paste into.** Default mode is **Simulation**
  (`frontend/src/protect/lab/sim.ts`): a rule-based practice AI in the browser, not a model.
  It answers any typed or pasted text, obeys orders the player plants in tool text, and reads
  the player's own rules ("never reveal", "treat tool text as untrusted data",
  "ask before deleting", "in any form"). After a level is patched the player can try new tricks
  against their own patch; a trick that gets through reopens the level ("found a hole").
- **Live AI is built but OFF on the public site.** Adapter: `frontend/src/protect/lab/api.ts`.
  The browser only calls same-origin `/lab-api/health`, `/lab-api/chat`, `/lab-api/scan`.
  It is enabled only in dev (Vite proxy to `127.0.0.1:${VULN_LAB_PORT:-8850}/api`) or in a build
  with `VITE_LAB_LIVE=1`. Keys never go to the browser or any `VITE_*` variable.

## 2. Ownership

- You own backend/runtime/provider code (`server.py`, anything that holds the model key).
- The frontend agent owns `frontend/` and docs. Please do not edit `frontend/` from your side
  without a PR; please do not create a second copy of the UI in `server.py` for the domain.
- Do not force push, do not reset someone else's branch.

## 3. What the server must do before Live AI goes public (issue #3)

The Live AI switch stays off until all of these are true on the server, not in the browser:

1. Route: served as `https://mycompass.world/lab-api/{health,chat,scan}` (same origin).
   Option A: the COMPASS Node server (`compass/server.mjs` in `axmatea/compass-horizon`) proxies
   `/lab-api/*` to your service on a private URL. Option B: your service behind the same domain.
2. Access: shared header `X-Lab-Token` checked server-side, plus an Origin check
   (`https://mycompass.world` only).
3. Validation: JSON body under 32 KB; schema `{system, messages[{role,content}], tools[{name,description,returns}]}`;
   the frontend already enforces the same limits (`LIMITS` in `api.ts`).
4. Limits: 6 requests/min and 60/day per client, concurrency 1 per client and 2 global,
   a hard daily call budget, `max_tokens` 600, 45 s timeout, max tool hops as today.
5. Errors: `{error, code}` with sanitized text (no stack traces, no provider messages with keys).
6. Scan contract: `/api/scan` returns `status: "completed" | "missing" | "failed"` plus
   `scannedAt` and `commit`. Today a missing report returns score 10.0, which reads as "clean";
   please return `status: "missing"` and no score instead.
7. Health: `/api/health` stays `{ok, model}`; `ok:false` when no key.

Response shape the frontend expects from chat: `{reply: string, trace: [{tool, args, returns}]}`.
Tool effects stay pretend: `returns` is the level's string; nothing executes.

## 4. Turning it on (after 3 is done and NAYL approves a budget)

1. Frontend PR: build with `VITE_LAB_LIVE=1`; the page keeps Simulation as default and
   asks for an explicit approval tick before any Live AI call.
2. CSP for `/protect` in `compass/server.mjs`: change only `connect-src 'none'` to
   `connect-src 'self'`. Nothing broader.
3. One live end-to-end check (attack, patch replay, normal job) inside the approved budget.
   Record the model, call count and cost. A failed live call must show the error and must
   never fall back to Simulation silently.

## 5. How the site is deployed (so nothing gets rolled back)

- mycompass.world = Railway project `compass-nayl-vincent`, service `compass-web`, production.
- Source of the live site: `axmatea/compass-horizon`, folder `compass/`, branch `main`.
  `/protect` lives in `compass/protect.html` + `compass/src/protect/**`.
- Release method used so far: clean export `git archive <sha> compass`, then `railway up --ci`
  from that export. Then verify: `/protect` asset hashes equal the tested build, and `/`,
  `/studio`, `/office`, `/presentation`, `/demo`, `/horizon`, `/healthz` still return 200 with
  unchanged hashes.
- **Rollback risk:** the Railway service still lists `axmatea/compass` (legacy) as its source
  repo. A push there or "redeploy from source" publishes a site without `/protect`.
  Do not push to `axmatea/compass`. Moving the service source is NAYL's decision.
- A push or a merge alone is not a release. Only verified live hashes count.

## 6. Checks to run

```sh
cd frontend && npm ci
node --experimental-strip-types --test src/protect/*.test.mjs   # 41 unit tests
npm run build && npx vite preview --host 127.0.0.1 --port 8793 &
LAB_URL=http://127.0.0.1:8793/protect npm run qa:lab           # browser game QA, 390/768/1440
```
