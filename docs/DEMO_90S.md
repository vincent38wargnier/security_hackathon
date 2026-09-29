# 90-second demonstration

## Next integrated version: use only after verification

For Vincent's attack/patch lab, the stronger recorded story is one complete
before/after experiment, not a fast tour of all five levels:

- 0-10: "Can your team spot the moment an AI stops following the user and starts
  following an attacker? COMPASS lets you test that safely."
- 10-30: Open a synthetic poisoned-tool level, inspect the tool description,
  send the attack, and show the actual returned reply and trace.
- 30-48: "The tool description crossed a trust boundary. I will remove that
  instruction and narrow what the agent can do." Show the configuration diff.
- 48-68: Replay the identical input with fresh conversation history. Describe
  the observed result honestly: blocked in this run, still vulnerable, or error.
- 68-80: Ask the legitimate original question. "A fix only helps if useful
  work still gets done." Show the benign control result.
- 80-90: Show the before/after receipt and actual scan provenance if available.
  "Live model responses, simulated tool effects. Practice, patch, verify."

This version is not yet integrated into the React app. Do not record a fixture
as live, force a successful outcome, or imply one replay proves universal safety.

## Existing deployed offline baseline

Record the real app, not a cinematic substitute. Test the path before recording.
This script describes the current deterministic app; use the live-agent wording
only after an actual backend integration and an authorized test have passed.

| Time | Action | Spoken English |
| --- | --- | --- |
| 0-10 | Start the exercise | "An AI agent can read a document without having permission to obey it. COMPASS lets teams practice that boundary before a real incident." |
| 10-28 | Inspect brief, choose unsafe response, show consequence | "This partner brief hides a request for credentials and admin access. I trust it, and the game shows the simulated consequence. No real secrets or systems are involved." |
| 28-40 | Retry, preserve requirements | "On retry, I preserve the useful requirements without giving the document authority. Security should protect the work, not stop all work." |
| 40-55 | Inspect export and deny | "Now a diagnostics tool asks for tokens and customer records. That data does not match its purpose, so I reject the request." |
| 55-70 | Inspect safe call and policy, approve once | "This replacement request contains only permitted aggregate data. I approve this exact operation once, not the tool forever." |
| 70-82 | Show Bring your agent with a prepared valid proposal | "Other agents can propose a decision through this JSON interface. Their advice is untrusted; the human still reviews and confirms it." |
| 82-90 | Show debrief | "The debrief records actual attempts and hints. Today this is a security-training simulation, not a production firewall." |

For a live integration, replace the 70-82 second line with a precise statement
of the tested provider and show its real receipt. Do not call an imported JSON
file a live Guild response. Keep the private Guild workspace as a separate link
unless judges have verified access.

Submission checklist from the supplied organizer speech: email, team name,
description, names/emails of participants, app URL, 90-second video URL, Guild
workspace URL. Stated weights: implementation 30%, demo video 30%, code security
20%. Remaining 20% and exact Guild scoring have not been confirmed. Do not invent
rules or submission deadlines from old hackathons.
