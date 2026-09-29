# Security score: 10/10

Scanned with the hackathon's official scorer,
[javiergarza-snyk/app-security-score](https://github.com/javiergarza-snyk/app-security-score)
(Snyk SCA `snyk test` + Snyk Code SAST `snyk code test`, run in its Docker sandbox).

- Date: 2026-09-29
- Commit scanned: `28bb908`
- Command: `node cli.mjs https://github.com/vincent38wargnier/security_hackathon`

```
Repo: https://github.com/vincent38wargnier/security_hackathon
  First-party Code:  H:0 M:0 L:0
  Dependencies:      H:0 M:0 L:0
  Score: 10/10
```

## How we got there

The first full scan scored 7/10 with 3 high-severity Snyk Code findings. We fixed all three:

1. `server.py` (2 findings, `python/Ssrf`): the Scaleway call now uses `http.client` with a hardcoded host and path, so request data can never change where the server connects.
2. `frontend/src/protect/model.ts` (1 finding, `javascript/HardcodedNonCryptoSecret`): the fake demo payload used key names that looked like real secrets. Renamed them; the lesson content is unchanged.
