---
"mockpit": minor
---

`mockpit watch` now only says a reply landed, and `feedback` or the next write delivers it. Before, the watch took the reply off the session's cursor, so the `feedback` call it pointed the agent to came back empty and the agent saw only the one-line summary. A harness cutting or dropping a watch line can no longer lose a reply.

A Codex plugin: `codex plugin marketplace add fabiogaliano/mockpit`, then `codex plugin add mockpit@mockpit`. The conversation's first mockpit call starts a background hook, and each Send wakes the idle thread through `codex queue`. MCP and CLI sessions are keyed to the Codex thread, so two threads in one repo don't take each other's replies.
