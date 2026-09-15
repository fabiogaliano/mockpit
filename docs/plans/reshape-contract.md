# Reshape contract (build target for all agents)

Every agent builds against this. If something is missing, pick the simplest
reading consistent with `designer-reshape.md` and note it at the end of your
report. Do not change this file.

## Vocabulary

project › item › variant › version. A **project** is a repo. An **item** is a
component or a page. An item has one or more **variants**. A variant is a
`Post`; its **versions** are the post's history. Item identity is
`(project, slug)`; variant identity is `(project, slug, variant)`.

## Data model additions (`server/types.ts`)

```ts
interface Session { ...existing; project: string | null }

type ItemKind = "component" | "page";
type PostStatus = "open" | "accepted" | "archived";

interface Post {
  ...existing;              // id, sessionId, title, surfaces, createdAt, updatedAt, version, history
  project: string;          // resolved at create; never null (fallback "workspace")
  slug: string;             // stable, kebab-case, unique with variant inside project
  kind: ItemKind;           // default "component"
  variant: string;          // label, default "default"
  status: PostStatus;       // default "open"
  ask: { text: string; at: string } | null;   // agent is waiting on the operator
  slots: Slot[];            // pages only; snapshot of included components
}
interface Slot { slug: string; variant: string; version: number }

interface PostVersion { ...existing; from?: number; prompt?: string; author?: string }

type CommentKind = "comment" | "revise" | "accept" | "drop" | "ask" | "reply";
interface Anchor {
  ref: string;              // "@1"
  shape: "pin" | "rect" | "circle";
  box: number[];            // [x,y] for pin, [x,y,w,h] rect/circle; normalized 0..1 of the surface
  surfaceIndex: number;
  postVersion: number;
  path?: string;            // css path from the sandbox hit-test
  text?: string;            // first line of the element's visible text
  viewport?: number;        // 390 | 820 | 1280 preset in use when drawn
}
interface Comment {
  ...existing;              // keep `anchor?: CommentAnchor` for back-compat
  kind: CommentKind;        // default "comment"
  anchors: Anchor[];        // default []
  draft: boolean;           // default false. Drafts are NOT delivered to the agent
  postVersion: number | null;
  viewport: number | null;
}
```

Wire: every comment returned to the viewer also carries `seen: boolean`
(= `seq <= session.agentSeq`), computed, never stored.

### Store interface additions

```ts
listProjects(): Promise<ProjectSummary[]>
  // { name, items: number, waiting: number, lastActiveAt, sessions: number }
listItems(project: string): Promise<ItemSummary[]>
  // { project, slug, kind, title, variants: VariantSummary[], waiting: boolean, updatedAt }
  // VariantSummary: { postId, variant, version, status, ask, updatedAt }
getItem(project: string, slug: string): Promise<ItemDetail | null>
  // ItemSummary + variants each with full history metadata (no surfaces bodies
  // in history entries; the current surfaces of each variant ARE included)
findVariant(project, slug, variant): Promise<Post | null>
setPostStatus(id, status): Promise<Post | null>
setPostAsk(id, ask | null): Promise<Post | null>
releaseDrafts(postId): Promise<Comment[]>   // drafts → draft=false with FRESH seq (delete+reinsert), returned in new seq order
listDrafts(postId): Promise<Comment[]>
```

`CreatePostInput` gains `project?, slug?, kind?, variant?, from?, prompt?, slots?, author?`.
`UpdatePostInput` gains `from?, prompt?, author?, slots?`.
`CreateCommentInput` gains `kind?, anchors?, draft?, postVersion?, viewport?`.
`CommentQuery` gains `includeDrafts?: boolean` (default false; agent-facing reads never include drafts; viewer reads pass true).

### Migration (SqlStore, in place; JsonFileStore on load)

Existing posts: `project` = session's project if set, else basename of session
`cwd`, else `"workspace"`; `slug` = kebab-case of title + short id suffix to stay
unique; `kind = "component"`, `variant = "default"`, `status = "open"`,
`ask = null`, `slots = []`. History entries: `from = previous version`,
`prompt = ""`. Comments: `kind = "comment"`, `anchors = anchor ? [converted] : []`,
`draft = false`. Follow the `pragma_table_info` probe pattern.

## HTTP API (server/app.ts) — additive, legacy untouched

```
GET  /api/projects                              → ProjectSummary[]
GET  /api/projects/:name/items                  → ItemSummary[]
GET  /api/projects/:name/items/:slug            → ItemDetail
GET  /api/projects/:name/design                 → DesignSettings (see below)
PUT  /api/projects/:name/design                 → DesignSettings

POST /api/posts   body gains: project, slug, kind, variant, from, prompt, slots
     If (project,slug,variant) exists → new VERSION of that post (like PUT), else create.
     Response unchanged in shape (+ the new fields); still piggybacks userFeedback.
POST /api/posts/:id/ask        {text}           → post (sets ask; creates comment kind "ask" author=agent)
POST /api/posts/:id/decision   {kind: "accept"|"revise"|"drop", text?}
     accept: status=accepted, sibling variants (same project+slug) → archived, ask=null; comment kind accept
     drop:   status=archived, ask=null; comment kind drop
     revise: releaseDrafts(postId), ask=null; comment kind revise whose text = `text` (may be empty)
     All decision comments: author=user, draft=false, delivered via the normal cursor.
POST /api/posts/:id/restore                     → status=open
POST /api/comments  body gains: kind, anchors, draft, postVersion, viewport
     Viewer-origin only may set draft=true (same rule as author today).
GET  /api/comments  viewer reads (unfiltered/no author=user) return drafts + `seen`.
     Agent reads (author=user, wait, piggyback) NEVER return drafts. Response for
     agent reads is the BATCH shape below.
POST /api/push/subscribe {subscription}         → 204 (stores in settings "push:subs")
GET  /api/push/vapid                             → {publicKey}
POST /api/hooks {url, events: ("ask"|"publish"|"decision")[]} → {id}
DELETE /api/hooks/:id
GET  /api/hooks
GET  /api/projects/:name/items/:slug/export?variant=  → {html, version, prompt history[], screenshotUrl}
GET  /s/:id  — for kind=page, expand <sideshow-slot slug variant version> tags
     server-side by inlining the referenced variant version's first html surface
     body (snapshot: version required; publish resolves missing version to current).
```

Push: on `ask` and on a new version whose `prompt` is non-empty, send Web Push to
every stored subscription (VAPID keys generated once into settings, Web Crypto
only, no `node:` imports in app.ts) and POST each matching hook
`{event, project, slug, variant, version, text, url}`. Failures are logged,
never block the write.

### Agent-facing feedback batch (wait / piggyback / `sideshow wait`)

```json
{
  "project": "acme/site", "slug": "pricing-card", "variant": "highlighted", "version": 3,
  "decision": { "kind": "revise", "text": "..." } | null,
  "comments": [ { "seq": 41, "text": "make @1 wider", "anchors": [ ... ], "viewport": 1280, "version": 3 } ],
  "archived": ["quiet", "stacked"]
}
```

Grouped per (post) in delivery order; a wait with mixed posts returns an array of
these. `userFeedback` on writes keeps its current field name and becomes this
shape. Nothing else about the cursor changes.

### DesignSettings (settings key `design:<project>`)

```ts
{
  detected: { tailwind: boolean; shadcn: boolean; cssVars: number; fonts: string[] } | null,
  palette: { light: Palette; dark: Palette } | null,   // server/themes.ts Palette
  kit: "tailwind" | "builtin" | "none",
  cssVars: string,          // raw `:root{...}` block imported from the repo, injected in the frame
  iconsAssetId: string | null,   // uploaded mage sprite
  updatedAt: string
}
```

`renderHtmlPage` reads the post's project design and: injects `cssVars`; when
`kit === "tailwind"` loads the Tailwind browser build from the CDN allowlist;
when `builtin` injects `server/kits.ts`'s new `builtin` kit; when
`iconsAssetId` is set, inlines a `<script>` that fetches `/a/<id>` and appends the
sprite so `<svg><use href="#mage-home"/></svg>` resolves (the `/a/` origin is
already allowed for img; add it to `connect-src` for html surfaces only).

## CLI (`bin/sideshow.js`) — new verbs, existing verbs unchanged

```
sideshow init [--project name]      detect design system (bin/initDesign.js), PUT design, upload icons sprite, write .sideshow/starter.html (+ .gitignore line), print one line per step
sideshow publish --item <slug> [--variant <name>] [--kind component|page] --html <file> [--from N] [--prompt "..."] [--title "..."] [--project name]
sideshow revise  --item <slug> [--variant] --html <file> [--from N]   (prompt defaults to the last revise decision text + comments)
sideshow page    --item <slug> --html <file>   (= publish --kind page; slot tags resolved by server)
sideshow ask     --item <slug> [--variant] "<text>"
sideshow wait    [--item <slug>] [--timeout s]      prints the batch JSON above
sideshow status  [--project]                        one line per item: slug, kind, variants, waiting/accepted
sideshow show    --item <slug> [--variant] [--body] [--history]
sideshow export  --item <slug> [--variant] [--out dir]   writes .sideshow/accepted/<slug>/<variant>/{index.html,history.json}
sideshow guide --brief                              GET /agent-howto?brief=1
```

Project resolution in the CLI: `--project`, else `SIDESHOW_PROJECT`, else
`git remote get-url origin` → `owner/repo`, else basename of cwd. Sent as
`project` on session create and on every publish.
Errors: one line `error <what>` + optional `  fix: <command>` + `exit 2`, nothing
written. `--json` prints the raw response.

## MCP (`server/mcpSpec.ts`, `server/mcpHttp.ts`, `mcp/server.ts`)

New tools (thin over HTTP, same field names as the CLI): `publish_item`,
`revise_item`, `ask_user`, `list_items`, `get_item`, `export_item`,
`init_project` (stdio only; runs `bin/initDesign.js` locally). `wait_for_feedback`
returns the batch shape. `get_design_guide` returns the project-aware brief.
Deprecated aliases stay byte-identical but are omitted from `tools/list` unless
`SIDESHOW_MCP_LEGACY=1`. Stdio `publish_item`/`upload_asset` accept a file path.

## Viewer routes

```
/                          → projects (auto-opens the most recent project)
/project/:name             → items list (phone: list screen)
/project/:name/:slug       → item screen  ?variant=<name>&v=<n>
/session/:id, /session/:id/p/:postId   → keep working; resolve to the item screen
```

Layout, states, and marker behaviour: exactly `docs/tmp/mockups/project-ia.html`,
`states.html`, `markers-a-gesture.html`. Viewport presets 390/820/1280, scale to
fit, phone default on phone. Hit-test bridge message:
viewer → frame `{__sideshow:true,type:"hit-test",x,y,ref}`; frame → viewer
`{__sideshow:true,type:"hit-test-result",ref,path,text,rect:[x,y,w,h]}` (the
frame script is ours, injected by `renderHtmlPage`; the viewer treats the reply as
data and renders it as text only).
