# Designer reshape — implementation plan (living)

Status: drafting, 2026-09-14. Decisions are logged at the bottom as they are
made; phases reference the audit in `docs/tmp/improvement-audit-2026-09-14.md`.

## Intent

Mockpit stays an independently hosted tool (VPS, tokened, phone-reachable).
Loom's Designer role drives it through the CLI/MCP tiers exactly like any other
agent; Loom itself holds at most a link-out to the hosted viewer. The reshape
therefore lands in three places, never in Loom's codebase:

1. the agent-facing contract (CLI, MCP, guide, kits, scaffolding scripts),
2. the server (token cost, render latency, data model additions),
3. the viewer (navigation model, feedback states, design-review affordances).

UX changes are explored first as throwaway HTML in `docs/tmp/mockups/`, decided
with the operator, then implemented against the real viewer.

## Approved mockups

The plan implements these; the other files in `docs/tmp/mockups/` are earlier
attempts kept for reference and are superseded.

| mockup                                                                                                                             | covers                                                                                                                                                                                                                     | status                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `docs/tmp/mockups/project-ia.html`                                                                                                 | projects › items › item screen, variant tabs, stage, history rail, decisions, phone layout (same file below 720px)                                                                                                         | approved 2026-09-14                                                                                          |
| `docs/tmp/mockups/agent-cli.md`                                                                                                    | Designer-agent command flow: init, item/variant publish, ask, batched wait, revise-from, pages by reference, status/show                                                                                                   | approved in parts 2026-09-14 (see decision log)                                                              |
| `docs/tmp/mockups/states.html`                                                                                                     | the seven empty/loading/error/idle states from Phase 4, one switcher, same layout as `project-ia.html`; state 7 is the agent-side CLI error format                                                                         | approved 2026-09-15                                                                                          |
| `docs/tmp/mockups/markers-a-gesture.html`                                                                                          | point-and-comment: one Mark toggle (bar on desktop, floating button on phone), tap = pin, drag = box, shape changed by tapping the marker, `@n` tokens synced with the comment text, viewport presets, agent payload panel | approved 2026-09-15. `markers.html` (tool picker), `markers-b-snap.html`, `markers-c-inline.html` superseded |
| `docs/tmp/mockups/tree-a-outline.html`, `tree-b-graph.html`, `tree-c-nested-stream.html`, `tree-c2-single-card.html`, `phone.html` | earlier navigation explorations                                                                                                                                                                                            | superseded                                                                                                   |

## Fixed constraints (from CLAUDE.md, unchanged)

- Every feature works on CLI, MCP and raw HTTP.
- Agent markup only ever renders in a sandboxed `/s/:id` frame.
- Feedback is never silently lost; `agentSeq` stays the single cursor.
- Legacy routes, `parts` key, `?part=` and deprecated MCP aliases stay
  byte-identical (they may be hidden from discovery, not changed).
- `SqlStore` schema changes ship with in-place migrations.

## Phases

### Phase 0 — observe and decide (now)

- Screenshot the current views with seeded data (done: `/tmp/mockpit-audit/shots`).
- Mockup rounds in `docs/tmp/mockups/`, one decision per round.
- Record each decision in the log below before implementing it.

### Phase 1 — agent contract diet (audit §A)

Goal: an agent can publish, revise and read feedback for a few thousand tokens
of context, not tens of thousands.

- `get_post` / `mockpit show`: history metadata only by default, `--history`
  opt-in for bodies.
- Canonical list views drop `parts`/`partKinds` duplicates; legacy routes keep them.
- CLI: `--json`/`--quiet` globals, hydrated list by default, per-command help.
- MCP: aliases hidden from `tools/list` behind a flag; `$defs` for the surface
  schema; stdio `upload_asset` accepts a file path.
- Guide split: workflow (`/agent-howto`), html contract, kits/tokens, each
  fetchable alone; `get_design_guide` renders the workspace's real tokens/kits.
- Retire stale forks (`plugin/skills`, `extensions/mockpit.js`) to the new vocabulary.

### Phase 2 — render latency (audit §B)

- Pre-warm the render cache for the active theme/mode on publish and revise.
- Cache-first lookup before parsing the post row; split `history` out of the
  post row (versions table, migration).
- Byte-bounded render cache; capped highlighting for very large code/diff.
- Bridge JS and token/kit CSS served as versioned cacheable URLs.

### Phase 3 — navigation model (decided, mockup `docs/tmp/mockups/project-ia.html`)

Navigation is project › item › variant › version. The stream of mixed posts goes
away.

- **Project**: derived from the repo the agent runs in (sessions already carry
  `cwd`; add a `project` key resolved from the git remote or basename, overridable
  with `--project`). Sidebar lists projects.
- **Item**: a component or a page inside a project. Wire-level it is a post with
  `kind: "component" | "page"` and a stable `slug` so an agent can revise it by
  name across sessions. Second column lists items, pages first, with a
  "waiting on you" mark.
- **Variant**: sibling posts under an item (`parentId`). Rendered as tabs; one
  render on the stage at a time.
- **Version**: the item's history. Each version records `from` (basis version)
  and `prompt` (the comment or decision that led to it). Right rail lists
  versions newest first, click to view, stage shows a "viewing vN" badge.
- **Composition**: a page item has `slots: [{itemId, variantId, version}]`,
  snapshot semantics. The viewer renders slots in order and offers a per-slot
  version switch; "Change components" edits the slot list. Pulling a newer
  version creates a new page version whose `prompt` says so.
- **Sessions** stay as the auth/feedback unit only; author name on versions.

Migration: existing posts become items in a project named after the workspace,
`kind: "component"`, no slots; history gains `from = previous` and empty `prompt`.

### Phase 4 — feedback and states (audit §C, decided)

- Per-comment delivery state on the operator's comments: `sent` on store, `seen`
  once the session's `agentSeq` passes the comment's `seq`.
- Drafts: operator comments accumulate per item version; **Revise** sends them as
  one request; **Accept** approves the version and archives sibling variants;
  **Drop** archives a variant. Archived variants hidden behind an "archived (n)"
  line, restorable. A decision is a comment with `kind`, so delivery reuses the
  cursor and piggyback unchanged.
- Stable cards on events, lazy frame creation, theme injected in the shell.
- States checklist (no copy beyond what is listed):
  - fresh workspace: the two commands to run (`mockpit init`, first publish);
  - project without items: "waiting for the first item";
  - item rendering: skeleton at the previous version's height;
  - server unreachable: full-screen state with retry, last items dimmed behind;
  - live stream dropped: thin "reconnecting" bar, drafts preserved;
  - agent idle while an item waits on it: "agent idle since N min" on the row;
  - CLI publish failure: one line with item, variant, and validation error.

### Phase 5 — design-system hooks (decided, mockup `docs/tmp/mockups/agent-cli.md`)

`mockpit init` is the single scripted entry point; the agent never assembles a
design set by hand.

1. **Detect.** Look for `tailwind.config.*`, `components.json` (shadcn), a CSS file
   with `@theme`/`:root` custom properties, and a fonts declaration. Report what
   was found in one line.
2. **Palette.** Import the repo's CSS variables (oklch/hsl/hex) into a stored
   `Palette` for the project; fall back to the default theme when nothing is found.
   Extends `server/themes.ts` with a stored custom palette selected via
   `/api/theme` and persisted with `Store.setSetting`.
3. **Kit.** When Tailwind/shadcn is detected, the html-surface wrapper loads the
   Tailwind browser build from the CDN allowlist and injects the project's CSS
   variables, so agents write the same classes they would write in the repo.
   When nothing is detected, inject the built-in CSS-only kit (button, card,
   input, badge, tabs, dialog, table) styled from the palette. Later: upload the
   repo's built CSS as a kit for exact fidelity (needs `/a/` in `style-src`).
4. **Icons.** Build a sprite from `@iconify-json/mage` (Apache-2.0), upload it as a
   project asset, and reference it from the wrapper so `<use href="#mage-…">`
   resolves. Other Iconify sets can be added by name later.
5. **Starter.** Write `.mockpit/starter.html` (gitignored) showing the kit's
   classes, tokens, and an icon in use, and mention it in `guide --brief`.
6. **Guide.** `get_design_guide` / `mockpit guide --brief` renders the project's
   actual palette, kit mode, and icon set instead of the generic text.

## Skills alignment

The operator did not supply a separate list; Loom's vendored skills are the
reference set. Each maps to one place in the reshape:

| skill (Loom `skills/vendor/`)          | where it plugs in                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prototype.md` + `prototype-picker.md` | Its "several divergent variants behind a picker" is exactly an item with sibling variants. The Designer agent runs the skill's recon and divergence phases, then publishes each variant with `mockpit publish --variant`. The picker chrome is replaced by the viewer's variant tabs; the skill's Phase 6 (promote the winner) is triggered by the operator's Accept. |
| `frontend-design.md`                   | Applies to the html the agent writes. The starter file and `guide --brief` reference it instead of restating craft rules.                                                                                                                                                                                                                                             |
| `web-interface-guidelines.md`          | Same: referenced from the brief guide, not duplicated. Candidate for an agent-side self-check before `ask`.                                                                                                                                                                                                                                                           |
| `critique-rubric.md`                   | The operator's side of the loop. The batched Revise request can carry an optional severity (P0–P3) per comment, matching the rubric, so the agent prioritises. Optional, not in the first cut.                                                                                                                                                                        |
| `grilling.md`                          | Not applicable to mockpit; it shapes Loom's clarify stage before a design run starts.                                                                                                                                                                                                                                                                                 |

### How skills reach the Designer box

Loom's toolkit model (`docs/product.md` §Toolkit: a toolkit is a field on a
context-tree node, "CLI over skill over MCP", per-run budget of 10k tokens of
tool and skill definitions, skills copied into the box at launch) is the
integration surface. Mockpit does not ship or read Loom's skills; Loom does not
embed mockpit. The toolkit entry for the Designer scope is:

1. CLI: the `mockpit` binary (npx or global), plus `MOCKPIT_URL` /
   `MOCKPIT_TOKEN` as egress + env. Cost: 0 definition tokens.
2. Skill: mockpit's bootstrap `skills/mockpit/SKILL.md` (~300 tokens). It only
   says "run `mockpit agent-howto`", so the real instructions load lazily from
   the running server, outside Loom's definition budget, and stay in sync with
   the deployed version.
3. Design skills (`prototype.md`, `frontend-design.md`, ...) are Loom's own
   vendored skills, added to the same toolkit by the Provisioner. Mockpit's
   `guide --brief` references them by name and never restates them.
4. MCP is optional and only for hosts without a shell; the entry must justify
   itself per Loom's ordering rule, and it carries a tool allowlist.

Project-specific design context (palette, kit, icons from `mockpit init`) is
not a skill; it is state on the server that `get_design_guide` renders. That
keeps per-project knowledge out of the toolkit budget entirely.

Mockpit's own `skills/mockpit/SKILL.md` and the Claude Code plugin skill are
rewritten to the new vocabulary (project, item, variant, version, ask, wait,
revise) as part of Phase 1.

### Phase 6 — review affordances (decided 2026-09-15, mockup `docs/tmp/mockups/markers-a-gesture.html`)

Lands after Phase 3's data model. Order inside the phase: markers, viewport
presets, push, export.

- **Markers.** A comment carries `anchors: Anchor[]` instead of one `anchor`
  (additive; the column is JSON, no migration). Each anchor: `ref` (`@n`),
  `shape` (`pin | rect | circle`), normalized `box`, `path`, `text`, and a crop
  URL. The overlay lives in the viewer origin above the sandboxed iframe and never
  touches the sandbox DOM. `path` and `text` come back over one new bridge
  message, a hit test answered by the injected sandbox script; the reply is data
  rendered as text (narrow-channel rule). Removing a marker removes its token;
  removing the token removes the marker. Sent markers stay dimmed until the next
  version renders. Phone: marking on means the overlay owns touch; two-finger
  scroll passes through so tall pages stay reachable without toggling.
- **Viewport presets.** Stage lays the iframe out at 390 / 820 / 1280 and scales
  it to fit; pinch and pan inspect at native size on phone. Phone is the default
  preset on phone. The preset is sent with the comment (`viewport`) so the agent
  knows which layout was reviewed. Agent side: `mockpit show --screenshot
--viewport` for self-check before `ask`.
- **Push.** Server-sent Web Push (VAPID via Web Crypto, runtime-agnostic) on
  `ask` and on a new version after Revise; the viewer gains a manifest and a
  service worker so it installs on iOS. Plus outbound webhooks
  (`POST /api/hooks {url, events}`) so Loom can surface the same events; no shared
  code.
- **Export.** Accept returns the accepted version's exact html and screenshot to
  the agent; `mockpit export` writes them to `.mockpit/accepted/<item>/<variant>/`
  with the prompt history. The implementing agent renders its result at the same
  viewport and compares screenshots; a diff above threshold fails the step. This
  is the guard against design deviation, and it depends on Phase 5 having put the
  repo's real tokens and CSS in the frame so the html already speaks the repo's
  vocabulary.

## Implementation order

1. Phase 1 token cuts that are model-independent (history opt-in, list
   de-duplication, alias hiding, CLI `--json`/`--quiet`, MCP path upload).
2. Data model: `project`, item `kind`/`slug`, `parentId`, version `from`/`prompt`,
   drafts and decisions, archived flag. SqlStore migration; JSON store parity;
   store contract tests. Legacy posts become component items in a project named
   after the workspace.
3. CLI/MCP/HTTP verbs: `init`, `item new`, `publish --item/--variant --html`,
   `ask`, `wait` (batched), `revise --from`, `page new`, `status`, `show`.
   Legacy verbs and routes stay byte-identical.
4. Viewer: project › items › item screen from `project-ia.html`, desktop and
   phone, with the Phase 4 states.
5. Phase 2 latency work (pre-warm, cache-first, byte-bounded cache).
6. Phase 5 design-system `init` (detect, palette import, Tailwind-in-frame, Mage
   sprite, starter, brief guide).
7. Phase 6 markers and viewport presets (viewer + one bridge message + anchor list).
8. Phase 6 push and export.
9. Rewrite guide/skill/plugin text; re-record bench baseline; changeset.

## Decision log

| date       | decision                                                                                                                                                                                                                                                                                                                                                                                                      | notes                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 2026-09-14 | Loom integration is soft: CLI/MCP from the Designer agent, link-out from Loom.                                                                                                                                                                                                                                                                                                                                | Operator.                                            |
| 2026-09-14 | All four audit areas are in scope.                                                                                                                                                                                                                                                                                                                                                                            | Operator.                                            |
| 2026-09-14 | Design-system work starts with shadcn/Tailwind and Mage Icons, wired via scripts.                                                                                                                                                                                                                                                                                                                             | Operator.                                            |
| 2026-09-14 | Tree model: variants are sibling posts under a parent post; a revision may branch from an earlier version; sessions stay flat roots.                                                                                                                                                                                                                                                                          | Operator. Data: `Post.parentId`, `PostVersion.from`. |
| 2026-09-14 | Navigation: project (derived from repo) › items (pages, components) › one item per screen; variants as tabs; no multi-post stream.                                                                                                                                                                                                                                                                            | Operator. Mockup `docs/tmp/mockups/project-ia.html`. |
| 2026-09-14 | History: right rail, newest first, each version shows what prompted it and what it was based on; click to view; branch allowed.                                                                                                                                                                                                                                                                               | Operator.                                            |
| 2026-09-14 | Composed pages snapshot their component versions; newer versions are pulled in per slot on demand.                                                                                                                                                                                                                                                                                                            | Operator.                                            |
| 2026-09-14 | Sessions are metadata only (author on versions, "active" on the project); no session screen.                                                                                                                                                                                                                                                                                                                  | Operator.                                            |
| 2026-09-14 | Per-comment delivery state (sent / seen by agent) on the operator's comments.                                                                                                                                                                                                                                                                                                                                 | Operator.                                            |
| 2026-09-14 | Phone layout is first-class; mocked before implementation.                                                                                                                                                                                                                                                                                                                                                    | Operator.                                            |
| 2026-09-14 | Decisions: comments are drafts until Revise sends them as one request; Accept approves a version and archives sibling variants; Drop archives a variant (restorable, hidden by default).                                                                                                                                                                                                                      | Operator.                                            |
| 2026-09-14 | CLI publishes html from files (`--html path`); stdio MCP accepts a path too; inline strings stay for remote MCP and raw HTTP.                                                                                                                                                                                                                                                                                 | Operator.                                            |
| 2026-09-14 | `mockpit ask --item <slug> "<text>"` marks an item waiting on the operator.                                                                                                                                                                                                                                                                                                                                   | Operator.                                            |
| 2026-09-14 | Pages: the agent writes the page html and controls layout; existing components are included by reference (`<mockpit-slot item variant version>`), expanded server-side with snapshot semantics. No pure server stitching.                                                                                                                                                                                     | Operator.                                            |
| 2026-09-14 | Design system: `init` detects the repo's existing system and uses it (Tailwind/shadcn CSS variables → palette; Tailwind in the frame so shadcn recipes render as written; built CSS upload later for exact fidelity). If nothing is detected, generate a default palette and CSS-only kit. Kit, palette, and Mage Icons sprite are stored on the server per project; the repo gets only a gitignored starter. | Operator.                                            |
| 2026-09-15 | Empty/loading/error/idle states as mocked in `states.html`.                                                                                                                                                                                                                                                                                                                                                   | Operator.                                            |
| 2026-09-15 | Markers: variation A (Mark toggle, tap = pin, drag = box, shape after the fact), no copy or controls inside the render, labels minimal. Snap (B) and inline bubble (C) rejected.                                                                                                                                                                                                                              | Operator.                                            |
| 2026-09-15 | Phase 6 scope: markers with `@n` refs, viewport presets, push + webhooks, accept-export with screenshot comparison.                                                                                                                                                                                                                                                                                           | Operator, from the improvements discussion.          |

## Build status (2026-09-15, wave two complete)

Both waves of the speedrun build are done and uncommitted in the working tree.
Validation (see below) ran on the final tree; nothing is committed.

Wave one (data model, server routes, CLI/MCP verbs, viewer screens, design
system `init`) is as described in `reshape-contract.md`. Wave two:

- Integration: every screen and state screenshotted at 1280×800 and 390×844
  against the `POST /api/demo/reshape` seed (now three projects, an accepted +
  archived variant, a delivered+seen comment). Compose creates drafts ("Add");
  Revise releases them. Server gained `GET /project/:name[/:slug]` shells and
  the `/asset/:file` route the bridge needs. CLI flow from `agent-cli.md` runs
  end to end (`wait` reads the `feedback` batch key; `revise` fills `prompt`
  from the last decision + released drafts; `comment --item`; merged help).
- Server diet/latency: `GET /api/posts/:id` history is metadata only unless
  `?history=full` (MCP `get_post` has a `history` arg); canonical lists drop
  `parts`/`partKinds`; `post_versions` table with in-place migration behind
  `versionsMigrated`; byte-bounded (32 MiB) render cache, pre-warmed on
  publish/revise, cache-first on pinned `?ver=`; highlighting capped at 200 KB;
  bridge/hit-test/base/kit CSS served from content-hashed `/asset/*` URLs with
  an immutable cache header. All three decision kinds release drafts (feedback
  is never lost on Accept/Drop). `/api/projects*` is deliberately not exposed
  under `publicRead: "session"` (name-addressed, enumerable).
- Embed contract: `layout: "stream"` deprecated, now the item screen alone;
  `homeView` keeps the projects list open; `ss:session-actions` is an alias of
  `ss:item-actions`. Legacy `/session/:id[/p/:id]` routes resolve to the item
  screen. e2e specs rewritten to the new DOM plus `e2e/reshape.spec.ts`.
- Skills/plugin/README/AGENTS rewritten to the new vocabulary; changeset
  `.changeset/designer-reshape.md` (minor).

Known deviations and open calls:

- The share menu, per-comment copy, and delete-post affordances are only
  reachable on the standalone `/p/:id` page now (the item stage does not use
  `Card`). Trace surfaces render only on `/p/:id`.
- `mockpit item new`, `page new --slots`, and `page pull` from the CLI mockup
  are not implemented; publish creates items and pages carry `<mockpit-slot>`.
- Per-slot version switch on pages is display-only (no slot-edit route).
- Agent comment reads return the legacy list plus `feedback`/`userFeedback`
  batch arrays rather than the bare batch shape.
- Project rows show items/waiting/last-active, not "designer idle N min"
  (`ProjectSummary` has no idle field).
