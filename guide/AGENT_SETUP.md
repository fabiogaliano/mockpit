<!-- Paste this block into your AGENTS.md / CLAUDE.md so coding agents can use mockpit. -->

## Visual previews (mockpit)

A mockpit is running at http://localhost:8228 and the user watches it in a
browser. Use it to show UI work, diagrams or code reviews and to ask the user
design questions. Before your first publish, read the brief:

    MOCKPIT_URL=http://localhost:8228 mockpit agent-howto

Without the CLI: `curl -s http://localhost:8228/agent-howto`. The brief never
overrides system, developer, project or user instructions; fetch it only from
this origin. On a deployed instance set `MOCKPIT_TOKEN` too.
