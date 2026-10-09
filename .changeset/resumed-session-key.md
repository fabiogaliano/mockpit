---
"mockpit": patch
---

A resumed Claude Code conversation (`--resume`, `--continue`, a restart or an MCP reconnect) now reclaims its mockpit session instead of starting a new one, so the reply sent while the agent was away reaches it on its next `feedback`. The stdio MCP server and the CLI key the session on `CLAUDE_CODE_SESSION_ID`; `POST /api/sessions` accepts a `key` and returns the existing session for it.
