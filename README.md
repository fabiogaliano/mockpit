# mockpit

**A design-review loop for terminal coding agents.**

Your agent publishes UI components and pages, diagrams, diffs and other renders;
they show up live in your browser. You comment on them, then **Revise**,
**Accept** or **Drop**, and the agent wakes once with the whole batch.

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/mockpit-dark.png">
        <img width="100%" alt="The viewer: agent sessions in a sidebar, a published diagram with a comment thread, and an interactive explainer below" src="docs/mockpit-light.png">
      </picture>
    </td>
    <td width="50%" valign="top">
      <img width="100%" alt="Animated demo: an agent publishes a diagram that appears live in the viewer, the user comments under it, and the agent revises it and replies" src="docs/mockpit-demo.gif">
    </td>
  </tr>
</table>

## Fork of sideshow

mockpit is a fork of [sideshow](https://github.com/modem-dev/sideshow) by
[Ben Vinegar](https://github.com/benvinegar), sponsored by
[Modem](https://modem.dev). The renderer, sandboxing, MCP/CLI/HTTP tiers and
Cloudflare deploy all come from that work. Thank you.

Upstream is a live visual surface where agents post renders and you comment.
mockpit turns that into a design loop:

|               | sideshow                                           | mockpit                                                                                                                               |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Structure     | A stream of posts per session                      | **project › mock › state › variant › version**: a repo, a page or component by slug, its UI states, parallel designs, version history |
| Feedback      | Each comment reaches the agent as it's written     | Answers, tuned knob values, mix picks and part comments stay drafts until you **Send**, then go out as one reply                      |
| Comments      | Text on a post                                     | Markers drawn on the render (`@1`, `@2`) with the element's CSS path and viewport preset (390 / 820 / 1280)                           |
| Design system | Built-in viewer themes                             | `mockpit init` detects the repo's tokens, fonts and kit so the agent's markup matches your codebase                                   |
| Agent verbs   | Post-level: `publish`, `update`, `wait`, `comment` | Mock-level: `init`, `publish`, `revise`, `ask`, `wait`, `status`, `show`, `export` (with matching MCP tools)                          |
| Outcome       | —                                                  | Accept hands the agent the accepted html, its prompt history and a screenshot; `export` writes them to `.mockpit/accepted/`           |
| Notifications | Viewer only                                        | Also Web Push on `ask` and new versions, plus outbound webhooks                                                                       |

## Quick start

Requires Node 22.18 or newer.

```sh
git clone https://github.com/fabiogaliano/mockpit && cd mockpit
npm install
npm start                      # viewer on http://localhost:8228
npm link                       # puts the `mockpit` CLI on your PATH
```

Point your agent at it by pasting the setup block into its instructions:

```sh
curl -s http://localhost:8228/setup >> AGENTS.md
```

Then run `mockpit init` once per repo and ask the agent to "mock this up on
mockpit". No agent handy? `mockpit demo` seeds an example mock.

MCP, the Pi extension and the Claude Code plugin are covered in
**[docs/connecting-agents.md](docs/connecting-agents.md)**.

## What a mock can show

A version is an ordered list of **surfaces**, and one version can carry several.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/surfaces/01-html.png" width="100%" alt="html surface">
      <p><b><code>html</code></b>: markup the agent authors, rendered in a sandbox and themed by your design system.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/surfaces/02-markdown.png" width="100%" alt="markdown surface">
      <p><b><code>markdown</code></b>: prose, tables and fenced code.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/surfaces/03-diff.png" width="100%" alt="diff surface">
      <p><b><code>diff</code></b>: a patch as a syntax-highlighted code review (unified or split).</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/surfaces/07-mermaid.png" width="100%" alt="mermaid surface">
      <p><b><code>mermaid</code></b>: diagram source rendered to SVG in the viewer palette.</p>
    </td>
  </tr>
</table>

There are also `terminal` (ANSI output), `image` (uploaded assets), `json`
(collapsible tree) and `code` (shiki-highlighted source with line numbers).

## Run it anywhere

It runs locally as a small Node server, or on Cloudflare Workers when your agent
and browser are on different machines. See **[docs/deploying.md](docs/deploying.md)**.

## Development

```sh
npm run dev          # server with watch + viewer watch build
npm test             # Node unit/API/store tests + viewer unit tests
npm run test:worker  # local workerd + Durable Object integration
npm run typecheck    # node + workers + viewer
npm run lint         # oxlint
npm run format       # oxfmt
npm run test:e2e     # Playwright, chromium + webkit
```

The architecture and contributor rules are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE). The original sideshow copyright is retained.
