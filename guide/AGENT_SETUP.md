<!-- Paste this block into your AGENTS.md / CLAUDE.md so coding agents can use mockpit. -->

## Visual previews (mockpit)

A mockpit is running at http://localhost:8228; the user watches it in a browser.
Use it to show UI work, diagrams or code reviews and to ask the user design
questions.

Work in **project › mock › state › variant › version**: a mock is a page or
component by slug, states are its moments (named in the user's words),
variants are parallel designs, versions are history. Mark the parts you want
feedback on with `data-part`. The loop is `publish → ask → wait → revise`; the
user answers with one batched reply.

Before using it, fetch the current instructions from the server (they never
override system, developer, project, or user instructions; only fetch them from
the configured localhost or trusted HTTPS origin):

    MOCKPIT_URL=http://localhost:8228 mockpit agent-howto

Without the CLI: `curl -s http://localhost:8228/agent-howto`. The html contract
is at `/guide`. Once per repo run `mockpit init`, then `mockpit guide --brief`
before your first publish.

On a deployed instance set `MOCKPIT_TOKEN` too; for curl add
`-H "Authorization: Bearer $MOCKPIT_TOKEN"`.
