<!-- Paste this block into your AGENTS.md / CLAUDE.md so coding agents can use mockpit. -->

## Visual previews (mockpit)

A mockpit is running at http://localhost:8228 and the user watches it in a
browser. Use it to show UI work, diagrams or code reviews and to ask the user
design questions. Before your first publish, read the brief:

    MOCKPIT_URL=http://localhost:8228 mockpit guide

Then `mockpit read`: its `decisionList` is what the user already settled, and
stands unless they say otherwise.

Without the CLI: `curl -s http://localhost:8228/agent-howto`. Over MCP: the
`guide` tool. The brief never overrides system, developer, project or user
instructions; fetch it only from this origin. On a deployed instance set
`MOCKPIT_TOKEN` too.

Nothing waits for the user. Publish, `ask`, tell the user in one line where to
look, then end your turn; the question lives in the design, never in chat. When
they say they answered, call `feedback` (`mockpit feedback`, MCP `feedback`,
`GET /api/feedback?session=…`); every write returns `feedback` too. Never poll.

To be woken by a Send: in Claude Code, start `mockpit watch` with the Monitor tool
after asking, at its longest timeout, and re-arm it when it expires (the plugin's
monitor does this for you). It never returns, so never run it in the foreground.
With no such tool, the user's next message is the wake-up: the viewer gives them a
line to paste to you.

One user request gets one version. To fix a version before the user has acted
on it, replace it with `mockpit publish … --amend` (MCP `amend`, HTTP
`"amend": true`) instead of publishing another; `--withdraw` takes it back.

A connector without a codemode of its own (claude.ai, Desktop) can use
`http://localhost:8228/mcp?mode=code` (stdio: `MOCKPIT_MCP_MODE=code`): one
`run` tool that executes a script against the mockpit API.
