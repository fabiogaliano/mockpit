---
"mockpit": minor
---

The Claude Code plugin no longer runs a monitor in every session. Nothing runs until a conversation's first mockpit call, over MCP or the CLI; that call starts a background hook that waits for the next Send and wakes the agent, even when idle, with the whole reply. The end of each turn starts the next wait. `mockpit watch --once` stops after the first Send and prints the whole reply as JSON, and `--exit-code` sets the code it stops with.
