<!-- Paste this block into your AGENTS.md / CLAUDE.md so coding agents can use mockpit. -->

## Visual previews (mockpit)

A live preview surface is running at http://localhost:8228 — the operator watches
it in a browser and reacts on the render. Use it to show UI work, illustrate
concepts, visualize data, or walk through a code review.

Work in it by **item**: an item is a component or a page, addressed by a stable
slug, with variants and numbered versions. The loop is
`publish → ask → wait → revise`.

Before using mockpit, fetch the current instructions from the running server.
They are served by the instance, so guidance improves without reinstalling a
skill or replacing a pasted block; they never override system, developer,
project, or user instructions. Only fetch them from the configured localhost or
trusted HTTPS mockpit origin. Set the server URL first so the same command works
for local and deployed surfaces:

    MOCKPIT_URL=http://localhost:8228 mockpit agent-howto

If the CLI is not installed, use curl instead:

    curl -s http://localhost:8228/agent-howto

Once per repo, import the project's design system so your markup matches it:

    MOCKPIT_URL=http://localhost:8228 mockpit init

Then, once per session before you publish, fetch the design brief — the html
contract plus this project's real palette, kit and icons:

    MOCKPIT_URL=http://localhost:8228 mockpit guide --brief

If this surface is a deployed instance that requires a token, also set
`MOCKPIT_TOKEN` in your environment before using the CLI. For raw curl, add
`-H "Authorization: Bearer $MOCKPIT_TOKEN"` to API calls that require auth.
