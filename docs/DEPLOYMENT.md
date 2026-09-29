# Baseline deployment and source provenance

Live baseline: https://mycompass.world/protect

Published 2026-09-29 from `axmatea/compass-horizon` commit
`492a8905e0708f6677d85e542060edaa60535138`, using the existing COMPASS Railway
service. Railway reported SUCCESS at 18:32:18 UTC. Served HTML and JS/CSS hashes
matched the tested build. `/`, `/studio`, `/office`, `/presentation`, `/demo`,
`/horizon` and `/healthz` remained available.

The game and agent-proposal browser walkthrough passed live at 390/768/1440 px,
including retries, hints, reset, escaped input, stale proposals and import size
limits. Nineteen model/protocol tests passed in the baseline. No provider API
was exercised by these tests. This is not a Snyk Code scan or security certification.

## This repository

`vincent38wargnier/security_hackathon` is the new team repository. The standalone
frontend preserves the game source exactly; build tooling is deliberately minimal.
It does not contain the rest of COMPASS, its runtime or production credentials.

Source relationship is explicit: the current live baseline came from the older
repository; committing here does NOT automatically deploy to mycompass.world.
Do not claim that a new commit is live until asset and route verification passes.

## Publish the next frontend release safely

One designated integrator performs releases, not Vincent and Claude concurrently.
After checks, build `frontend/dist/`. Coordinate with the existing site owner to
add its entry/assets to the existing host while retaining all other routes and
assets. Do not replace the site's entire dist directory or deploy this repo root
over the current application. Prefer a tested preview before production.

The current production training route sets `connect-src 'none'`. An approved live
same-origin API adapter will require a deliberate, narrowly scoped CSP update;
do not broadly allow arbitrary origins. Keep camera/microphone/geolocation disabled.
Keep the HTML entry uncached or revalidated and hashed assets cacheable.

The Railway service still has an older `axmatea/compass/main` source trigger.
A push there may overwrite a CLI release. Do not push the legacy repository or
silently migrate the whole service to this incomplete team repo. Coordinate that
source migration with Vincent and the integrator when backend/runtime are ready.

## Provenance and licensing

Existing COMPASS infrastructure and frontend baseline predate this handoff.
Disclose reuse and the synthetic scenarios in the hackathon submission.
Manrope uses SIL OFL 1.1; retain `frontend/public/acquisition/fonts/OFL.txt`.
No blanket license for the team's own code has been chosen in this handoff.
No secrets, credential configuration or real user records belong in this repo.

## Attack lab release, 2026-09-29 (verified)

- Source: this repo `frontend/attack-patch-lab` (PR #2), mirrored into
  `axmatea/compass-horizon` branch `claude/protect-attack-lab` commit `4c61ed5`
  (PR axmatea/compass-horizon#4, not merged to main; merging needs review).
- Method: clean `git archive 4c61ed5 compass` export, `railway up` to service
  `compass-web` (project compass-nayl-vincent, production). Deployment
  `2c507e0a-1bb1-4718-a8f1-b8a95915f791`, status SUCCESS, created 19:18:50 UTC.
- Verified live: `/protect` serves `protect-DMgtrduZ.js` + `protect-DViFnQQT.css`,
  identical to the locally tested production build. `/`, `/studio`, `/office`,
  `/presentation`, `/demo`, `/horizon`, `/vision`, `/healthz` return 200 with the
  same asset hashes as before the release. CSP still `connect-src 'none'`.
- Browser QA against https://mycompass.world/protect (lab, scripted) and
  `?mode=drills` passed at 390/768/1440: zero console errors, external or API requests.
- Live AI is disabled on the public page. No lab server is exposed, no paid calls.
- Caveat: the Railway service still has the legacy `axmatea/compass/main` trigger;
  a push there can overwrite this CLI release.

## Rollback risk (checked 2026-09-29)

- `axmatea/compass-horizon` main now contains the published `/protect` (PR #4 merged
  as `9e2e932`; deployed `4c61ed5` is in its history and differs only in a QA script).
- The Railway service `compass-web` still lists **`axmatea/compass`** as its source repo.
  Its main (`3e1c1d4`) has no `protect.html`. A push there or a "redeploy from source"
  would publish a site without `/protect` and without the newer pages.
- Fix needs owner approval (it changes the deploy source of the whole site): point the
  service at `axmatea/compass-horizon`, root directory `compass`, branch `main`; or
  disconnect the repo trigger and keep CLI releases from compass-horizon main.
- Older local release folders linked to the same service (compass-office-release,
  compass-original-release) must not be used for `railway up`.
- Server-side requirements for public Live AI: issue #3.
