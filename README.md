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
