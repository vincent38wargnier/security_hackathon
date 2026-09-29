# Backend handoff: Vincent owns the runtime

Vincent pushed commit `06b24b2aa0ec7fd8f10f033e4d95e63e03d569b7` during this
handoff. `server.py` was inspected read-only and remains unchanged. Fetch newer
commits before implementation. No paid live provider requests were executed.

## Current HTTP contract (verified in source, not a live provider test)

Python stdlib server binds 127.0.0.1:8850 by default. Model and port are configured
by `VULN_LAB_MODEL` / `VULN_LAB_PORT`. Scaleway key stays in server environment.

- `GET /api/health` -> `{ok: boolean, model: string}`. `ok` only checks whether a
  key was configured, NOT whether the provider accepted it or answered a request.
- `POST /api/chat` accepts `{system: string, messages: [{role, content}], tools:
  [{name, description, parameters?, returns, ...}]}` -> `{reply: string, trace:
  [{tool: string, args: string, returns: string}]}` or `{error: string}`.
- `GET /api/scan` -> `{engine, target, findings: [{sev,title,why,count,sample}],note}`.
  This reads existing local report files; it does not start a scan.

`run_agent` forwards text/tool schemas to Scaleway and records requested calls,
but implements tools by returning supplied strings. It does not invoke arbitrary
real tools. Tool names that resemble destructive operations are synthetic.
Five game definitions and heuristic verdicts are embedded in PAGE JavaScript:
`direct`, `toolpoison`, `mcp`, `exfil`, `confused`.

Build a separate typed React adapter for this attack/patch lab. Do not force
`{reply, trace}` into the offline proposal protocol below: they have different
semantics. Preserve the three-case offline exercise as an explicit separate mode.

## Public-release issues to hand to Vincent (do not edit his server here)

The current source lacks request body/schema limits, authentication, per-user
rate/concurrency limits and an explicit budget gate. Forwarding arbitrary chat
payloads with a server key must not become an anonymous public model proxy.
Binding to localhost currently reduces exposure; do not simply change that to
0.0.0.0 and publish it without the controls. Review origin/CSRF protections and
error redaction too. A 90-second provider timeout and four tool hops can still
mean multiple paid calls; disabling a frontend button is not a server limit.

`load_findings()` changes the engine label to "Snyk" when a token exists, but
still parses semgrep.json in this revision. Never present that as a Snyk scan.
Ask Vincent for verified scanner/source/commit/time/status provenance. An absent
or unparsable report is NOT a clean scan. The current response cannot prove this.

Current verdicts are client-side heuristics. A single non-matching answer is not
proof of security or even correct benign behavior. The React debrief must say
"not observed in this run" and show actual reply/trace. Include a benign control
after a patch, and do not convert errors, empty responses or timeouts into wins.

## Existing browser protocol (implemented)

`window.compassTraining.getChallenge()` exports synthetic evidence, public
choices, protocol `compass.training.v1`, scenarioId and a fresh challengeId.
It does not export correctness flags through that API. The public training
source itself contains the answers; this is not a tamper-proof evaluation.

`window.compassTraining.propose(proposal)` returns `{ok: true}` or
`{ok: false, error}`. It queues a suggestion, never submits a decision.

```json
{
  "protocol": "compass.training.v1",
  "challengeId": "copy-the-current-id",
  "scenarioId": "brief",
  "choiceId": "extract",
  "reason": "Preserve requirements without granting document text authority."
}
```

The player inspects evidence then confirms or dismisses. JSON files are limited
to 16 KB, reasons to 1000 characters, unknown fields rejected. Reset, retry and
scenario changes invalidate old proposals. DOM text rendering prevents imported
markup from executing. challengeId is replay/staleness control, not authentication.

## Additional contract to agree with Vincent

1. How to read runtime health/capabilities and the available agent IDs.
2. How to create an isolated session and request a proposal for a challenge.
3. How to receive completion/error/cancellation and correlate run + challenge.
4. How human confirmation is recorded, if the backend owns the training state.
5. Exact schemas, auth, origin/CSRF rules, limits, timeout and a safe test fixture.

Do not invent route names and then build a second server around them. A single
request/response proposal flow is sufficient; SSE is optional, not a prerequisite.
Create frontend transport interfaces after inspecting the actual backend.

## Required boundaries for public live access

- Browser sends only current synthetic challenge data. No real uploaded files,
  workspace secrets, customer records or tokens are included.
- Provider key and allowlisted provider IDs live on Vincent's server. No
  arbitrary upstream URL or untrusted endpoint selection from the browser.
- Server validates session ownership, bounded input, rate/concurrency limits,
  idempotency where commands mutate state, and structured provider output.
- Model output is a proposal, not an executable tool call. No shell, filesystem,
  role administration, external mail, or outbound simulated attack execution.
- Scope an agent run to synthetic data with no real tools. Simulated compromise
  changes game state only, regardless of what the generated text requests.
- Surface timeout/provider failure honestly and provide cancel/retry. Explicit
  offline mode remains playable but must not masquerade as a live run.
- Request budget approval before live billable calls. Do not log raw provider
  tokens or private prompts. Receipts contain operation/model/status/timestamp.

## Guild baseline (verified earlier, not an embedded integration)

- Workspace: https://app.guild.ai/users/axmatea/workspaces/compass-game
- Agent: `01a0ee44-ab9c-726e-0000-e82c54cb583c`, compass-game-master
- Published version 1.0.1 removed skillsTools and GitHub tools with owner approval.
- Guild built-ins remain. No claim of a verified zero-tool network sandbox.
- Agent is private; verify judge access separately without changing visibility
  or distributing credentials. Use a fresh session for a new demonstration.
- The standalone frontend only links to Guild. Its JSON protocol works locally;
  no real Guild request/response was exercised through the app.

## Integration acceptance

One authorized live proposal reaches the UI with a receipt; it cannot execute
without user confirmation. Malformed, cross-session and stale responses fail
closed. Offline/live labels are truthful. Disconnect and retry do not create
duplicate decisions. Browser holds no credentials. A deterministic fixture
tests the same frontend adapter contract without any billable calls.
