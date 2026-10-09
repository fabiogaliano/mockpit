---
"mockpit": minor
---

The server keeps an event log for diagnosing agent sessions after the fact: one JSON line per agent call, viewer write and live-feed connection. Each line records the client and its version, the status, the session, the mock, the reply seqs delivered and what was pending, but never content. On Node it is on by default at `~/.mockpit/events.jsonl` (next to the database, rolled over at 10 MB); `MOCKPIT_LOG` sets another path, or `off` disables it. On Workers it goes to Workers Logs. The CLI, the stdio MCP server and the Pi extension now send an `x-mockpit-client: <tier>/<version>` header, so a client left running across an upgrade shows up in the log. `createApp` accepts a `log` sink.
