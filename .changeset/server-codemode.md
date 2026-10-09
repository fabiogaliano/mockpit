---
"mockpit": minor
---

Scripts. `run` executes a JavaScript script on the server against a typed
`mockpit` API, so an agent can publish variants, ask and wait for the reply in
one call. It is `POST /api/run`, `mockpit run <file>`, and the one tool of a new
codemode MCP catalog at `/mcp?mode=code` (stdio: `MOCKPIT_MCP_MODE=code`, with a
`path` param for local scripts). The default `/mcp` catalog is unchanged.
Scripts run in QuickJS inside a worker thread with no network, timers, imports
or `process`, under a 200 s wall limit, a CPU budget, 32 MiB of memory and caps
on calls and output. The result lists every host call in order and carries
every reply the run received, even when the script then fails. The Cloudflare
Worker has no sandbox and answers that `run` is unavailable. New guide topic:
`scripts`.
