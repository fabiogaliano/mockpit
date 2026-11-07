---
"mockpit": patch
---

Withdrawing an alternative's only version, and taking an undrawn state out of a flow with `step: 0`, now return `sessionId` like every other write. Over stdio MCP the withdraw failed output validation after it had delivered the feedback it carried, so a user's Send on another design was lost.
