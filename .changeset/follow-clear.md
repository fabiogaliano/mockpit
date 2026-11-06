---
"mockpit": patch
---

After `/clear` in Claude Code, the stdio MCP server, the CLI and `mockpit watch` follow the new conversation instead of staying on the old one's session: a reply that wakes the agent is now one its `feedback` call takes, so the viewer says Delivered. A watcher whose conversation was cleared exits instead of holding its session "listening". The "is listening" note beside a sent reply is a chip of the same row.
