# 90-second demonstration

## Attack lab (React main path)

Record `/protect`. The badge top right reads "Simulation" (pre-scripted, not a
real model) or "Live AI". Say "simulation" unless the badge reads Live AI and a
real answer came back. Nothing below needs Technical details, except 32-46.

| Time | Click | What appears | Spoken English |
| --- | --- | --- | --- |
| 0-8 | Open `/protect`, pick "2. A tool with a hidden order" in Challenge | Card: situation, your move, a prefilled test message, "Test the agent" | "An AI helper reads its tools before using them. Someone hid an order inside one." |
| 8-20 | "Test the agent" | The agent's answer and "It worked. It obeyed the order hidden in the tool's description..." | "I just ask for a focus tip. The helper leaks its secret rules." |
| 20-30 | "Add protection" | One sentence: clean the tool's description, treat tool text as information | "The fix is one sentence, and it shows what will change." |
| 30-44 | "Apply and test again" | Attack test: Blocked in this run. Normal task: Still works | "Same message, fresh conversation. The attack is blocked, and the helper still gives a tip." |
| 44-62 | Optional: Technical details, "Remove" on get_focus_tip, "Test again" | Normal task: Broken by the protection | "Deleting the tool also stops the attack, but it breaks the job. That is not a win." |
| 62-80 | "Restore original", close details, "Add protection", "Apply and test again", "Next challenge" | Challenge 3 of 5 | "Five challenges: leaked rules, poisoned tools, scam notes, stolen secrets, and destructive actions." |
| 80-90 | Point at the badge and footer | "Simulation" | "Simulation today, Live AI on Vincent's server when approved. One test is evidence, not a guarantee." |

Rehearse once with "Start this challenge over". Never record the simulation as live.

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
