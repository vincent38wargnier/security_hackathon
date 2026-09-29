Original prompt: Move the existing COMPASS security-training frontend into
Vincent's security_hackathon repository, prepare a complete Claude Code handoff,
and build around Vincent's forthcoming backend rather than creating another one.

## Baseline

Copied only committed training files from compass-horizon 492a890.
React app, 19 model/proposal tests, browser walkthrough and local Manrope retained.
Standalone Vite configuration and minimal package manifest added.
Production baseline is already at https://mycompass.world/protect.

## Next

Read ../docs/CLAUDE_CODE_PROMPT.md. Vincent pushed server.py in 06b24b2 during
the handoff. Upgrade the evidence/action visual hierarchy and build a React
attack -> patch -> replay flow using his inspected /api/chat contract.
Do not create or pretend to have a live provider before that handoff.

## Verification

Standalone build and 19 model/protocol tests passed. Browser walkthrough passed
at 390/768/1440 with no errors or unexpected requests. Standard game client also
passed; screenshots inspected. See ../docs/VERIFICATION.md. server.py untouched.

## Attack lab (branch frontend/attack-patch-lab)

Built the React attack -> patch -> exact replay -> benign control lab around
Vincent's /api/chat contract. Scripted fixture is the default and labelled.
Live adapter verified against mocks and the key-less local server only.
Drills moved behind the "Offline drills" tab (?mode=drills), unchanged.
Status, blockers and requests for Vincent: ../docs/LAB_INTEGRATION.md.
