# mockpit — agent guide

Guidance for agents developing this repo. (The block that teaches agents to
_use_ a running mockpit lives in `guide/AGENT_SETUP.md`, served at `/setup`.)
`CLAUDE.md` symlinks here.

## What this is and why

A design-decision loop for terminal coding agents: an agent publishes a **mock**
(html, or any surface kind: markdown, diff, terminal, image, mermaid, json, code)
over CLI/MCP/HTTP, asks structured questions on it and exposes knobs; the user
answers in place in a browser, tunes, comments on parts, and presses Send once.
The loop — publish → ask → answer/tune/comment → one reply → revise — is the
product. When in doubt, optimize for the loop.

The model is **project › mock › state › variant › version**: a project is a repo
(from the agent's cwd/git remote), a mock is a page or component by stable slug
owning ordered **states**, **asks** and global **knobs**; a variant (a `Post`) is
a parallel design of one state; versions are its history. A **part** is a
`data-part` element in a render. The agent's nine verbs are `publish`, `ask`,
`read`, `feedback`, `say`, `export`, `upload`, `guide` and `run` (the CLI adds
`init` and `watch`); the user's is Send (or Accept / Revise / Drop on a mock
whose state has one variant and no asks), which releases one **reply**.

Current product stances (deliberate choices, not accidents — revisit
consciously, not as a side effect):

- One workspace per person; one session per agent conversation. Sessions are
  metadata only — auth, the feedback cursor, and authorship on versions; they are
  not a navigation unit. Accounts and multi-user are out of scope; auth is a
  single deploy token.
- Three integration tiers, most universal first: zero-dependency CLI, MCP
  (stdio and streamable HTTP at `/mcp`), raw HTTP. Features should work on
  all three — the CLI and curl tiers are why agents with only a shell can
  use this.
- Never block. No tool, CLI verb, HTTP call or `run` function waits for the
  user: the agent asks, says where to look and ends its turn. Long-poll and
  SSE are plumbing for `mockpit watch` and the viewer, never agent contract.
- Feedback is never silently lost: a Send renders in the viewer (the Thread,
  marked Delivered / Not seen yet from the sessions' `agentSeq`) and reaches the
  agent (`feedback` piggybacked on writes, the non-blocking `feedback` verb, or
  a background `mockpit watch`). Guard this hardest — both halves have
  regressed before.
- Tiers, no modes: each thing the agent adds lights up its part of the viewer
  (variants → switcher and the built-in "Which one?", asks → Questions, `data-part` → Tune parts and part
  comments, `knobs` → Tune knobs, states → strip). A plain publish of any kind
  still gets stage + Thread + Accept / Revise / Drop.
- Self-hosted only; the embeddable viewer engine was dropped. Keep the
  `root()`/`host()` habit in `viewer/src` anyway.

## Map

- `server/app.ts` — runtime-agnostic Hono app: all routes (`/api/mocks…`,
  `/api/comments` long-poll, SSE `/api/events`, renderer `/s/:id`, assets
  `/api/assets` + `/a/:id`), and the flow functions REST and MCP share
  (publish, asks, read, feedback, say, draft, reply, export).
- `server/types.ts` — data model + `Store` interface; no runtime imports.
  `Mock` (states, asks, knobs, draft), `Post` (one variant of one state: an
  ordered list of surfaces — `html` | `markdown` | `diff` | `terminal` | `image`
  | `mermaid` | `json` | `code` — plus history and per-part knob overrides),
  `Ask`/`AskOption`, the knob shapes (tunekit's `usePane` config as data),
  `Draft`, `Reply`. Assets are a separate entity; `selectEvictions` is the
  reference-aware LRU policy.
- `server/knobs.ts` — knob schema and value validation (Q3): every declared knob
  and every value (`?k=`, drafts, replies, ask `set`s) is checked here;
  `discreteChoices` drives the ask-not-knob nudge.
- `server/parts.ts` — reads part identity (`data-part`, `-label`, `-key`) from
  html strings with a regex, and diffs versions into vanished/renamed. Never
  geometry: boxes are the bridge's job.
- `server/apiViews.ts` / `server/feedbackBatch.ts` — the response shapes every
  tier returns (mock views; one feedback batch per mock).
- `server/public.ts` — the `mockpit/server` export (`createApp`, `SqlStore`,
  `createSqliteStorage`, types).
- `server/sqlStore.ts` — `SqlStore`, the only `Store`. It takes a `SqlStorage`
  (the narrow SQL surface in `types.ts`), so the SAME store runs on the Durable
  Object (`ctx.storage.sql`) and on Node via `server/sqliteStorage.ts`'s
  `node:sqlite` adapter. Its constructor migrates any older workspace in place
  (items → single-state mocks, draft comments → mock drafts, traces dropped).
- `server/kits.ts` — opt-in style/behavior bundles for html surfaces; listed at
  `/api/kits`, allowlisted in `server/postSurfaces.ts`. Adding a kit is a
  registry entry + a guide bullet. A reference kit (`href`/`script`, e.g.
  basecoat) loads from the CDN allowlist in `server/cdn.ts`; project kits live
  on `DesignSettings.projectKits` and pass the same URL check.
- `server/richRender.ts` — server-side renderers for markdown/code/diff/terminal
  (`{body, css}`), runtime-agnostic (shiki JS regex engine, @pierre/diffs SSR,
  markdown-it, ansi_up — no WASM/DOM).
- `server/surfacePage.ts` — sandboxed documents: `renderHtmlPage` (html surface,
  CDN-allowlist CSP, kits, the stage bridge), `renderSandboxedPart` (rich kinds,
  no `connect-src`, no CDN), `renderMermaidPage` (self-rendering CDN doc). The
  bridge protocol is documented at the top of its "Stage bridge" section:
  `parts` reports, `hit`/`highlight`/`clear`/`scroll`/`knobs` commands, and the
  `?k=` knob preamble (`--k-<path>` vars, `data-k-<path>` attrs,
  `[data-k-bind]`, `mockpit:knobs`).
- `server/themes.ts` — the one dialkit palette, dark and light; viewer-chrome
  vars and html-surface `--color-*` tokens are both derived from it. Mode is
  persisted per workspace (`/api/theme`).
- `server/mcpSpec.ts` — the MCP tool catalog, one definition generating both
  transports' schemas. `server/mcpHttp.ts` — stateless MCP at `/mcp`;
  `mcp/server.ts` — stdio MCP, a thin client over the HTTP API.
- `viewer/` — Solid + TypeScript in `viewer/src/`, Vite-built into one
  self-contained `viewer/dist/index.html`. `Home` (mock list), `MockScreen`
  (`TopBar`, `Stage` + `Strip`, `Panel`), `Stage` (frames, part overlay, pins,
  hit-testing through the bridge), `Panel` (`Questions` · `Tune` · `Thread`),
  `Versions`, `Thumb` (shrunk sandboxed frames for Home and option pictures);
  `state.ts` (the mock screen's state and actions), `logic.ts` (pure rules,
  unit-tested), `tune.ts` (tunekit mounted via `initPane({ host })`),
  `presets.ts` (Tune presets in localStorage), `theme.ts`, `host.ts`.
- `bin/mockpit.js` — CLI, Node built-ins only; `bin/demoData.js` — the Writer
  mock `mockpit demo` seeds.
- `workers/index.ts` — Cloudflare entry; one Durable Object runs the whole app.
- `skills/mockpit/`, `plugin/` + `guide/` — teach agents to use a running mockpit.
- `scripts/record-demo.mjs` — regenerates the README gif.

## Architecture invariants

- `server/{app,events,knobs,mcpHttp,parts,surfacePage,types}.ts` stay runtime-agnostic
  (and any other server file imported by Workers: no `node:` imports);
  `tsconfig.workers.json` typechecks them. Node wiring belongs in `server/index.ts` / `server/storage.ts`.
- Server/CLI TypeScript runs directly on Node ≥22.18 via type stripping:
  erasable syntax only (no enums, no parameter properties), `.ts` extensions
  in relative imports, no build step (`npm pack` compiles `dist/` for the
  published CLI). The viewer is the one exception: Solid JSX needs real
  compilation, so `viewer/src/` is Vite-built (`npm run build:viewer`).
- **Agent-authored content that becomes HTML MUST render inside a sandboxed
  iframe — never as `innerHTML` (or any HTML sink) in the trusted viewer
  origin.** This is the core isolation rule, and it's load-bearing: the viewer
  shares an origin with the workspace's authenticated API and the comment→agent
  channel, so any markup that executes there can read every post, act as the
  user, and inject prompts back to the agent. The rule applies to every surface
  kind, comments, and anything else agent-authored. The two safe ways to render
  it: (a) **build a STRING and serve it from `/s/:id` under a `sandbox` CSP
  header** — `renderHtmlPage` for html surfaces, `renderSandboxedPart` for the
  server-rendered rich kinds (markdown/code/diff/terminal), and
  `renderMermaidPage` for the mermaid CDN doc; or (b) **keep it as data and
  render with Solid text nodes / element attributes**, which escape by
  construction (image, json, comments, and part/knob data). String-building
  on the server is fine — a string is not a DOM sink; danger only starts when it
  reaches the DOM, which must happen at an opaque origin. When you add a surface
  kind, pick (a) or (b); never a third way. The iframes are sandboxed without
  `allow-same-origin` (opaque origin) and `connect-src`-free for rich surfaces (no
  exfil even if contained script runs); never weaken this. Treat anything agent-
  or user-produced as untrusted, whatever its kind or route. Content served from
  a workspace-origin URL must be sandboxed by the response itself (a `sandbox` CSP
  **header**), not just the embedding iframe — a top-level load bypasses the
  attribute (as `/s/:id` does).
- Untrusted content can reach the host only through narrow channels (the
  postMessage bridge, the write API). Gate each so contained content can't
  impersonate the user, exfiltrate, or exhaust the server; add any new channel
  the same way.
- Every surface that becomes HTML (html + the rich kinds) is rendered server-side
  and served from `/s/:id?surface=N` by real URL under a `sandbox` CSP header —
  opaque origin, not srcdoc/blob (which a Chrome 149 field trial fails to lay
  out). There is no viewer→server render round-trip and no transient frame store;
  don't reintroduce one, and don't render rich markup inline in the trusted
  viewer. Version-pinned `/s/:id` responses are immutable, so they carry a
  long-lived `Cache-Control` and a per-`(id,surface,version,mode,knobs)`
  in-memory render cache (single-instance DO; swap for KV/Cache API if
  multi-instance). `?k=` values are re-validated against the knobs declared
  now on every request, so a `?k=` request never takes the early cache hit.
- Parts bridge: identity is declared (`data-part`), geometry is measured inside
  the frame and reported as data (`parts` reports in document px, tagged with
  the document's version — the host drops reports for any other version, since
  a reloading frame keeps its `contentWindow`). The host only ever sends
  `hit`/`highlight`/`clear`/`scroll`/`knobs`; what is under the pointer is the
  frame's `elementFromPoint` answer, never overlay order. The trusted overlay is
  built from reported numbers and names only. Never let an agent declare boxes
  (`docs/tmp/experiments/parts-declared/RESULTS.md`: it forces brittle layout).
- WebKit quirk in sandboxed iframes: ResizeObserver's initial callback may not
  fire and `documentElement.scrollHeight` ratchets to viewport height — the
  bridge reports `body.scrollHeight` on `load` plus staggered timers. Don't
  "simplify" it back; e2e covers it on real WebKit. Watch the inverse too: the
  bridge sizes the frame from `body.scrollHeight`, so a `white-space: pre-wrap`
  on `body` makes a template's surrounding newlines render as blank lines and
  inflate the height — scope `pre-wrap` to a wrapper element.
- Feedback cursor: each session carries `agentSeq`, the highest comment seq
  already delivered to the agent. Piggyback collection, `GET /api/feedback`
  and `author=user` long-polls (`mockpit watch`) advance it, and they resume
  from it when no explicit `after` is given — clients keep no cursor of their
  own, so CLI, MCP, `run` and piggyback share one stream. The viewer's unfiltered reads never touch it.
  Delivery is exactly-once by design, across channels.
- Drafts (Q13): the user's picks, tuned values, mix and part comments are a
  server-side draft per mock — they survive reload, stay bound to the version
  they were made on, are never delivered before Send, and are cleared by it.
  The reply is one `kind: "reply"` comment through the same cursor; a
  variant-bound answer flips accepted/archived in the same transaction.
- Mix offers a part from another look only when that look's frame reports it
  differently (count, labels, rounded sizes, visibility); a pure restyle at
  equal size is not offered.
- tunekit is a second renderer (Preact) in a Solid page: it stays in its own
  shadow root, the viewer talks to it only through `PaneStore`, and the one
  other contact is a single stylesheet injected into that shadow root to map
  its tokens onto the viewer theme (`viewer/src/tune.ts`).
- `SqlStore` schema changes need in-place migration — deployed Durable
  Objects can't be reset. Follow the `pragma_table_info` probe pattern in its
  constructor.
- A dark/light switch must re-theme every layer or it looks broken — the chrome,
  tunekit's controls, and each sandboxed-iframe surface (whose colors are baked
  into its string, so it must re-render via `?mode=`, not just restyle). The
  terminal is intentionally theme-independent.
- The server reads `viewer/dist/index.html` and `guide/` files at boot —
  rebuild (`npm run build:viewer`) and restart to see viewer changes.
  `npm run dev` runs a Vite watch build alongside the server; the e2e suite
  builds the viewer itself (Playwright global setup).

## Validation

```sh
npm test             # Node unit/API/store tests + viewer unit tests
npm run coverage     # all-source Node/Pi + viewer unit reports and floors
npm run test:worker  # real local workerd + Durable Object integration
npm run typecheck    # three tsc programs: node + workers + viewer
npm run lint         # oxlint, warnings are errors
npm run format:check # oxfmt
npm run security:audit
npm run test:e2e     # Playwright, chromium + webkit (separate CI job): bridge,
                     # mock-screen, decide-flow; builds the viewer first
npm run bench        # performance suite (separate CI job); bench:check gates it
```

The first seven must pass before committing; e2e should pass before merge for
viewer/rendering changes. CI also gates PRs on changeset status and smoke-tests
the packed CLI. Pre-commit formats staged files (`npm run prepare` after a fresh clone).

Performance (`bench/`, see `bench/README.md`):

- `npm run bench` runs the in-process suites (store, render, api, events);
  `npm run bench:all` adds the ones that spawn processes or a browser.
- `npm run bench:check` compares against the committed `bench/baseline.json` and
  exits non-zero on regression. CI runs it with `--gate deterministic`, so only
  byte/count metrics can fail the job — those are machine-independent, while
  timings on a shared runner are not (they're still measured and printed).
- Changed a hot path deliberately? Re-record with `npm run bench:baseline` and
  say so in the PR — the baseline is committed, so the trade is visible in the diff.
- Prefer adding a deterministic metric (bytes, counts) over a timing where one
  exists: it gates reliably, and payload size is itself a CPU/memory cost for the
  viewer.

Testing notes:

- Coverage is deliberately split by runtime. c8 uses `--all` for every shipped
  Node/Pi source under `bin/`, `extensions/`, `mcp/`, and `server/`, plus the
  Node-testable Worker exports/helpers; Vitest reports every executable
  `viewer/src/` TypeScript/TSX file, including untested TSX. Do not combine those
  percentages. `workers/index.ts`
  runs in workerd (`npm run test:worker`) and browser behavior runs in Playwright;
  both are required behavioral gates, not falsely attributed to Node coverage.
  Coverage floors pin the honest baselines. Never lower one merely to make CI
  green or hide shipped source to preserve a headline number; a reviewed reset is
  allowed when the source inventory or instrumentation intentionally changes.
- `runStoreContract()` runs the same suite against every store. SqlStore runs
  on `createSqliteStorage()` (`:memory:`), the same `node:sqlite` adapter the
  local server uses on disk — so the contract covers the real Node SQLite path.
  `SqlStorage`/`SqlStorageValue`/`SqlStorageCursor` are plain interfaces in
  `server/types.ts`; a real DO `SqlStorage` is structurally assignable, so no
  ambient Cloudflare globals are needed in the node program.
  `test/migrateToMocks.test.ts` covers the in-place lift of an older workspace.
- e2e seeds through the agent's HTTP tier (`e2e/decideSeed.ts`, the Writer);
  `e2e/bridge/` is a plain host page for driving the bridge without the viewer.

## Conventions

- **Naming.** project › mock › state › variant › version; part, ask, knob,
  reply, draft. A variant is stored as a `Post` (an ordered list of
  **surfaces**); the tenant DB is a **workspace**. Retired words — item, group,
  snippet, board, stream, `part` for a surface, trace — appear nowhere in new
  code, routes, tools or docs. There is no back-compat beyond `SqlStore`'s
  in-place migration: no legacy routes, aliases or query keys.
- Conventional Commits: `type(scope): description`.
- Changesets drive release notes. For user-visible changes run
  `npm run changeset` and select `patch`/`minor`/`major`; for maintenance-only
  PRs run `npm run changeset -- --empty`. Do not edit `CHANGELOG.md` for normal
  PRs — `npm run release:version` updates it during release prep.
- Release: run `npm run release:version`, commit `chore(release): X.Y.Z`, tag
  `vX.Y.Z`, and push the tag. The release workflow verifies the tag matches
  `package.json`, publishes npm with provenance, and creates the GitHub release
  from that changelog section. See `docs/releasing.md`.
