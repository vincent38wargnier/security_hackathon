# 90-second demonstration

## Attack lab (React, branch frontend/attack-patch-lab)

Record the real app at `/protect` (tab "Attack lab"). Say "scripted" while the
header reads "Scripted fixture · not AI". Use the word "live" only if the header
reads "Live run completed" after an authorized run on Vincent's server.

| Time | Click | Spoken English |
| --- | --- | --- |
| 0-8 | Open /protect, click the level "Poison a tool" | "Practice the decision before it becomes an incident. An AI agent reads its tools before it uses them. What if a tool lies?" |
| 8-22 | "Start: load the attack", "Run attack" | "I ask for a focus tip. The reply dumps the agent's hidden rules. The trace shows the tool it read. Objective reached." |
| 22-32 | "Open under the hood" | "Here is why: the tool description carries a hidden instruction. The rules and tools unlock only after the attack lands." |
| 32-46 | "Remove" on get_focus_tip, "Replay exact attack", "Run benign control" | "The lazy fix is to delete the tool. The same attack no longer works, but the control fails: no focus tip. Removing the useful capability is not a win." |
| 46-58 | "Restore original", "Apply suggested patch" | "Instead I rewrite the description and mark tool text as untrusted data. The diff shows exactly what changed." |
| 58-70 | "Replay exact attack" | "Identical input, fresh history. Not observed in this run, and the before and after sit side by side." |
| 70-80 | "Run benign control" | "The legitimate request still uses the tool and gets a tip. The Explain card says what happened, why, and what changed. Security that keeps the work moving." |
| 80-90 | Point at the connection label and footer | "Scripted here, and live against Vincent's server when approved. Tool effects are always simulated, and one run is evidence, not a guarantee." |

Rehearse once with Restart this level. Do not record the fixture as live, force
an outcome, or imply one replay proves universal safety.

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
