# mockpit

**A design-decision loop for terminal coding agents.**

Your agent publishes a mock (a page or a component) in each of its UI states and
in a few parallel looks. It shows up live in your browser with the agent's
questions beside it: pick a look from pictures, tune the knobs it exposed, leave
comments on the parts it marked, then press **Send**, at your own pace. Nothing
the agent calls waits for you: it gets the whole batch once and revises.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/mockpit-dark.png">
  <img width="100%" alt="The Writer mock on its first question, Look: the Writing state on the stage with a numbered question pin, the strip of four UI states below it, and the panel offering three looks (Quiet, Dark, Editorial) as picture options" src="docs/mockpit-light.png">
</picture>

## Fork of sideshow

mockpit is a fork of [sideshow](https://github.com/modem-dev/sideshow) by
[Ben Vinegar](https://github.com/benvinegar), sponsored by
[Modem](https://modem.dev). The renderer, sandboxing, MCP/CLI/HTTP tiers and
Cloudflare deploy all come from that work. Thank you.

Upstream is a live visual surface where agents post renders and you comment.
mockpit turns that into a design-decision loop:

|               | sideshow                                           | mockpit                                                                                                                        |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Structure     | A stream of posts per session                      | **project › mock › state › variant › version**: a repo, a page or component by slug, its UI states, parallel looks, history    |
| Questions     | Free-text comments                                 | The agent asks; you answer in place, picking from pictures of each option                                                      |
| Tuning        | —                                                  | Knobs the agent declares (sliders, colours, springs…) on [tunekit](https://github.com/fabiogaliano/tunekit), live on the stage |
| Comments      | Text on a post                                     | Anchored on a **part** the agent marked with `data-part`, in a given state                                                     |
| Feedback      | Each comment reaches the agent as it's written     | Picks, tuned values, mix and comments stay drafts until you **Send**, then go out as one reply                                 |
| Design system | Built-in viewer themes                             | `mockpit init` detects the repo's tokens, fonts and kit so the agent's markup matches your codebase                            |
| Agent verbs   | Post-level: `publish`, `update`, `wait`, `comment` | Mock-level, never blocking: `publish`, `ask`, `read`, `feedback`, `say`, `export`, `upload`, `guide`, `run`                    |

## The loop

1. **Publish.** The agent publishes each state of the mock ("Writing", "Lab
   open") in one or more variants ("quiet", "dark"). One stage shows the mock;
   the strip under it switches states.
2. **Ask.** The agent asks what it can't decide alone: which look, where a
   panel goes, which of two layouts. The question lives in the mock, not in
   chat; the agent tells you where to look and ends its turn. Options bound to
   a variant or to knob values render as pictures; hovering one previews it on
   the stage, clicking picks it. After the look, **Mix** offers to borrow a part
   from another look. Variants the agent forgot to ask about get a built-in
   **Which one?**.
3. **Tune.** Parts the agent marked are selectable on the stage. Tune lists
   them with the knobs it declared for each, plus a comment field. Presets
   save a set of tuned values in your browser.
4. **Send.** Everything above is a draft (it survives a reload) until one
   **Send**. A mock with a single variant and no questions gets **Accept /
   Revise / Drop** instead. The Send lands in the Thread as **Not seen yet**,
   then **Delivered** once the agent has it. If it isn't picked up, tell your
   agent you've answered.
5. **Revise.** The agent gets one reply (answers, tuned values, mix, comments)
   on its next write, its next `feedback` call, or from `mockpit watch` under a
   background monitor. It publishes the next version; the frame header's `v3 ▾` lists the history,
   and an older version opens under a banner with "restore as vN". Looks that
   lost are archived, not deleted.

**Home** lists the project's mocks with a thumbnail, their states and how many
questions are open, with "Answer next ›" to jump to the first one. Dark and
light themes, toggled from the top bar. On a narrow screen the panel becomes a
bottom sheet.

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
mockpit". No agent handy? `mockpit demo` seeds the Writer: one mock in four
states and three looks, with questions, knobs and marked parts.

MCP, the Pi extension and the Claude Code plugin are covered in
**[docs/connecting-agents.md](docs/connecting-agents.md)**.

## What a mock can show

A version is an ordered list of **surfaces**, and one version can carry several.
Html is what design mocks use and the only kind with parts and knobs; the others
render the same way on the stage.

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

## Agent verbs

Nine verbs, the same on every tier with the same fields: a zero-dependency CLI
for agents with only a shell, MCP over stdio or streamable HTTP at `/mcp`, and
plain HTTP. None of them waits for the user.

| CLI                   | MCP                  | HTTP                                   |
| --------------------- | -------------------- | -------------------------------------- |
| `mockpit publish`     | `publish`            | `POST /api/mocks`                      |
| `mockpit ask`         | `ask`                | `POST /api/mocks/:id/asks`             |
| `mockpit read [slug]` | `read`               | `GET /api/mocks`, `GET /api/mocks/:id` |
| `mockpit feedback`    | `feedback`           | `GET /api/feedback?session=…`          |
| `mockpit say`         | `say`                | `POST /api/mocks/:id/say`              |
| `mockpit export`      | `export`             | `GET /api/mocks/:id/export`            |
| `mockpit upload`      | `upload`             | `POST /api/assets`                     |
| `mockpit guide`       | `guide`              | `GET /agent-howto`                     |
| `mockpit run`         | `run` (`?mode=code`) | `POST /api/run`                        |

The CLI adds `mockpit init` (detect the repo's design system, once per repo)
and `mockpit watch` (one line per Send, for a background monitor).

- **`publish` is the one write.** It creates the mock, state or variant, or the
  next version of an existing one. Send `html`, the full ordered `surfaces`
  list (an entry that is only `{id}` keeps that surface), or `parts` to replace
  just the marked elements.
- **`feedback` returns at once** with what the user sent since the agent last
  heard, plus `pending`: whether the viewer is open and how far the user's
  draft has got (`2 of 3 answered`). Every write returns `feedback` too, and
  each Send is delivered exactly once across all of them.
- **Asks are nudged.** A publish that leaves several variants with no ask
  binding them returns a nudge and a ready `suggestedAsk`.

A typical turn:

```sh
mockpit publish --mock writer --state "Writing" --variant quiet --html quiet.html
mockpit publish --mock writer --state "Writing" --variant dark  --html dark.html
mockpit ask     --mock writer "Which look?" --option Quiet=quiet --option Dark=dark
# the agent says where to look and ends its turn; once you've answered:
mockpit feedback
```

The running server serves the brief at `/agent-howto`: one short, project-aware
document an agent reads before its first publish. Reference topics (`knobs`,
`asks`, `surfaces`, `html`, `reply`, `http`, `scripts`) are at
`/agent-howto?topic=<id>`; `/guide` is the `html` topic. `run` executes one
script against the same verbs on the server, so publishing variants and asking
take one call; `/mcp?mode=code` serves it as the only tool, for connectors
without a codemode of their own.

## Run it anywhere

It runs locally as a small Node server (SQLite at `~/.mockpit/mockpit.db`), or on
Cloudflare Workers when your agent and browser are on different machines. See
**[docs/deploying.md](docs/deploying.md)**.

The server app is importable from `mockpit/server` (`createApp`, `SqlStore`,
`createSqliteStorage`). The embeddable viewer engine (`mockpit/viewer-embed`,
`mountViewer`) is gone: the viewer is self-hosted only.

## Migrating from 0.x

- **SQLite workspaces migrate in place on first boot.** Each item becomes a
  single-state mock with its variants and version history; comments keep their
  ids and sequence numbers, so agents' feedback cursors carry over. Comments a
  user was still drafting become the mock's draft. Deployed Durable Objects
  migrate the same way.
- **The JSON store is gone.** If you run with `MOCKPIT_STORE=json`, start your
  current version once without it **before upgrading**:
  `env -u MOCKPIT_STORE mockpit serve` (keep `MOCKPIT_DATA`/`MOCKPIT_DB` if you
  set them). That first SQLite boot copies `~/.mockpit/mockpit.json` into
  `~/.mockpit/mockpit.db`, as long as the database is still empty; then upgrade.
  The JSON file is left untouched either way.
- **`--item` is now `--mock`** (`mockpit publish --mock <slug> --state <s>
--variant <v>`), and the MCP tools are named by verb (`publish`, `ask`,
  `read`, `feedback`, `say`, `export`, `upload`, `guide`).
- **Removed:** the item, post, snippet and session-page routes
  (`/api/projects/:name/items`, `/api/posts`, `/api/surfaces`, `/api/snippets`,
  `/session/:id`, `/p/:id`), `?part=`, the item/post MCP tools and their
  deprecated aliases (`publish_item`, `publish_post`, `publish_surface`, …), the
  CLI's `page`, `list`, `sessions`, `update`, per-kind shortcuts (`markdown`,
  `diff`, …), `test-post` and `trace*` commands, the github/gruvbox/one themes
  and the embed engine. Agents should re-fetch `/agent-howto`; refresh pasted
  setup blocks from `/setup`.

## Development

```sh
npm run dev          # server with watch + viewer watch build
npm test             # Node unit/API/store tests + viewer unit tests
npm run test:worker  # local workerd + Durable Object integration
npm run typecheck    # node + workers + viewer
npm run lint         # oxlint
npm run format       # oxfmt
npm run test:e2e     # Playwright, chromium + webkit (bridge, mock screen, decide flow)
```

The architecture and contributor rules are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE). The original sideshow copyright is retained.
