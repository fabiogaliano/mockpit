---
"mockpit": minor
---

Add an OpenCode plugin, for 1.x and 2.x. Nothing runs until a session's first mockpit call; after that, each Send wakes the session, even when idle, and the agent reads the reply with `feedback`.
