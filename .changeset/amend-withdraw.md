---
"mockpit": minor
---

An agent can fix its own version before you see it twice: `publish --amend` (MCP `amend`, HTTP `"amend": true`) replaces a variant's latest version in place, keeping its number, and `publish --withdraw` takes it back. Both work only from the session that published the version and only while you haven't acted on it (no Send, comment or draft answer about that state, and not in use; a word on another state doesn't count); otherwise they refuse with a fix. Publishing the same variant twice within minutes, untouched, now nudges the agent to amend instead.
