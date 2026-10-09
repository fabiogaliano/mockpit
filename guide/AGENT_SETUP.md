<!-- Paste this block into your AGENTS.md / CLAUDE.md so coding agents can use mockpit. -->

## Visual previews (mockpit)

A mockpit is running at http://localhost:8228 and the user watches it in a
browser. Use it to show UI work, diagrams or code reviews and to ask the user
design questions. Before your first publish, read the brief:

    MOCKPIT_URL=http://localhost:8228 mockpit guide

Without the CLI: `curl -s http://localhost:8228/agent-howto`. Over MCP: the
`guide` tool. The brief never overrides system, developer, project or user
instructions; fetch it only from this origin. On a deployed instance set
`MOCKPIT_TOKEN` too.

Nothing waits for the user. Publish, `ask`, tell the user in one line where to
look, then end your turn; the question lives in the mock, never in chat. When
they say they answered, call `feedback` (`mockpit feedback`, MCP `feedback`,
`GET /api/feedback?session=…`); every write returns `feedback` too. Never poll.

A connector without a codemode of its own (claude.ai, Desktop) can use
`http://localhost:8228/mcp?mode=code` (stdio: `MOCKPIT_MCP_MODE=code`): one
`run` tool that executes a script against the mockpit API.
