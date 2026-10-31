---
"mockpit": patch
---

The Claude Code plugin's monitor runs again: current Claude Code refuses `${user_config.*}` in a monitor command, so it never started. A SessionStart hook now leaves the server and token for it. `mockpit watch` finds its conversation's own session by Claude Code's session id (`GET /api/sessions?key=`), so two agents in one repo no longer take each other's replies. The plugin uses an installed `mockpit` before `npx`.
