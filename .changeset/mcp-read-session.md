---
"mockpit": patch
---

Over `/mcp`, `read`, `export` and `guide` take the `session` a write returned, as the other tools do: a bare read lists that session's project with its open follow-ups instead of every project, `tree` and `decisions` read it instead of failing, and a call that names neither project nor session says so.
