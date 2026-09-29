# security_hackathon: Prompt Injection Playground

A level-based game that teaches prompt injection and agentic-AI vulnerabilities to beginners (14+).
Each level is one attack type. You hack a live LLM agent (Gemma on Scaleway), then patch it so the same attack fails.

Levels:
1. Leak the rules (direct prompt injection)
2. Poison a tool (malicious tool description)
3. The scam note (injected content from an MCP tool result)
4. Steal the secret (data exfiltration through a tool call)
5. Trick it into acting (confused-deputy destructive action)

Hint buttons reveal the attack and the fix. All notes and events are pretend.

## Run

Pure Python standard library, no dependencies.

```bash
export SCALEWAY_API_KEY=<your Scaleway Generative APIs key>
python3 server.py
# open http://127.0.0.1:8850
```

Optional env: `VULN_LAB_PORT`, `VULN_LAB_MODEL` (default `gemma-4-26b-a4b-it`).
The API key is read from the environment only and is never sent to the browser.

---

## COMPASS frontend handoff

Interactive AI security training: inspect suspicious evidence, protect the
boundary, and keep legitimate work moving. Fictional data, no real attacks.

**Team repository:** https://github.com/vincent38wargnier/security_hackathon

**Existing deployed baseline:** https://mycompass.world/protect

## Ownership

- Vincent owns the backend, agent runtime, credentials and provider integrations.
- NAYL / frontend coding agents own `frontend/`, visual design and the demo.
- Do not build a parallel backend or overwrite Vincent's incoming commits.
- Vincent pushed `server.py` in commit `06b24b2` during this handoff. Its source
  API was inspected; live provider calls were not executed. Fetch before editing.

## Start the frontend

```sh
cd frontend
npm ci
npm run dev -- --port 8794 --strictPort
```

Open http://127.0.0.1:8794/protect (the root also opens the game).

```sh
npm test
npm run build
# Install the test browser if missing, then test a running local app:
npx playwright install chromium
PROTECT_URL=http://127.0.0.1:8794/protect npm run qa:protect
```

The production artifact is `frontend/dist/`, entry `protect.html`. A production
host must serve `/protect` as that file and serve `/assets/`, `/favicon.svg` and
`/acquisition/fonts/` from the artifact. Vite preview is not a production server.
Do not replace the existing site's root deployment with this standalone folder.

## What works

Three playable incidents, evidence inspection, hints, wrong-answer retry,
safe-action control, accurate attempt counts, JSON debrief and reset.
Another agent can read an exported challenge and submit a JSON proposal;
the player must inspect evidence and explicitly confirm it.

What does not exist in the React frontend yet: connection to Vincent's API,
live embedded Guild calls, a real security gateway, server persistence,
authentication, and real quarantine/network isolation.
The React game engine and coach are deterministic browser code. All incident data
and consequences are simulated; the client includes the scenario answer keys.

## Handoff

- [Claude Code implementation prompt](docs/CLAUDE_CODE_PROMPT.md)
- [Backend handoff and proposed contract](docs/BACKEND_HANDOFF.md)
- [Deployment and provenance](docs/DEPLOYMENT.md)
- [90-second demonstration](docs/DEMO_90S.md)

The frontend is an additive foundation for presenting Vincent's five-level
attack -> patch -> replay experience. It does not replace his server or original
prototype. Keep the existing three-case simulation as an explicit offline exercise.

The existing React baseline was published from `axmatea/compass-horizon` commit
`492a8905e0708f6677d85e542060edaa60535138`. This repository contains only its
training frontend and minimal standalone tooling, not the older SaaS backend.
The deployment is not automatically connected to this repository yet.
