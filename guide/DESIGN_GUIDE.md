# sideshow — design guide

Three sections, each readable on its own:

1. **Surfaces** — what an item's body can be made of.
2. **HTML contract** — the hard rules for the markup you write.
3. **Kits and tokens** — the vocabulary and colors available inside the frame.

For the publish/ask/wait/revise workflow see `sideshow agent-howto`. For this
project's actual palette, kit and icons see `sideshow guide --brief`.

---

## 1. Surfaces

An item version is an ordered list of **surfaces**. Each has a `kind`:

```
{ "kind": "html", "html": "<p>...</p>" }
{ "kind": "html", "html": "<ul class=\"tree\">…</ul>", "kits": ["issues"] }
{ "kind": "markdown", "markdown": "## Plan\n\n1. …" }
{ "kind": "mermaid", "mermaid": "flowchart TD; A[Start] --> B{Ok?}" }
{ "kind": "diff", "patch": "<unified or git diff text>", "layout": "split" }
{ "kind": "diff", "files": [{ "filename": "a.ts", "before": "…", "after": "…", "language": "ts" }] }
{ "kind": "image", "assetId": "<id from an upload>", "alt": "…", "caption": "…" }
{ "kind": "terminal", "text": "<output, may carry ANSI SGR escapes>", "cols": 80 }
{ "kind": "json", "data": { "a": 1 } }
{ "kind": "code", "code": "const x = 42;", "language": "ts", "title": "x.ts", "lineStart": 80 }
```

Pick by what the thing IS:

- **`html`** — you are drawing. UI, diagrams, data viz, anything interactive.
  This is the kind design items use.
- **`markdown`** — prose, plans, tradeoff write-ups. Fenced code is highlighted
  (tag the fence); `![caption](/a/<id>)` embeds an uploaded image. Raw HTML in
  the source is escaped, not rendered.
- **`mermaid`** — the _shape_ of a system, described rather than drawn. Prefer
  `flowchart TD`/`TB`; wide `LR` maps shrink until unreadable. Never set your own
  colors — the viewer themes the diagram. Highlight with `:::accent` on nodes and
  `accentLine` on edges.
- **`diff`** — a changeset, sent as data. `patch` is preferred (changed lines
  only); `files` is the fallback when you have no patch.
- **`code`** — a whole file or excerpt, highlighted. `lineStart` keeps the
  original line numbers.
- **`terminal`** — shell output or build logs, ANSI colors included.
- **`json`** — structured data as a collapsible tree.
- **`image`** — a screenshot or generated picture.

A version can combine surfaces: `[html, diff]` is a design with its code review
in one card; `[markdown, diff]` is a rationale above its changeset.

**Trust rule:** html is sandboxed because you author the markup. Everything else
is rendered by the trusted viewer from data — so for those kinds, send data,
never markup.

### Uploads

Push a binary once, reference it by id:

```
POST /api/assets   (raw)   Content-Type: image/png   <bytes>   ?filename=shot.png&kind=image
POST /api/assets   (json)  { "data": "<base64>", "contentType": "image/png", "filename": "shot.png" }
MCP  upload_asset  { data | path, contentType, filename?, kind? }
CLI  sideshow upload shot.png          # prints { id, url }
```

An asset's **id is the SHA-256 of its bytes**, so the URL is content-addressed:
derive it locally (`sideshow asset-url shot.png`) and write `<img src="/a/<hash>">`
into your markup _before_ uploading — the viewer briefly waits for an in-flight
asset rather than showing a broken image. Identical bytes dedupe; an asset
survives as long as anything references it. Per-asset limit is 5 MB.

---

## 2. HTML contract

An `html` surface is a blank canvas — invent the thing the idea deserves.
Custom SVG, bespoke layout, small interactions, animation: all fair game. What
follows is the short list of hard constraints; everything inside them is yours.

- **Body fragment only.** No `<!doctype>`, `<html>`, `<head>`, or `<body>` — the
  server wraps your fragment in a themed, sandboxed document.
- **Sizing.** The rendered column is roughly 720–800px wide by default; the
  operator can also view it at the 390 / 820 / 1280 viewport presets, so make it
  responsive. Height is measured from your content.
- **Keep content in normal flow.** The frame measures the document box, so
  anything out of flow is invisible to the sizer and can leave the surface
  clipped or frozen at the wrong height.
  - Never use `position: fixed`.
  - Don't stack `position: absolute` layers over a fixed-`height`/`min-height`
    box (the usual cross-fade-deck mistake): the overlay grows `scrollHeight`
    but not the measured box, so the frame won't follow it.
  - To **overlap** elements, grid-stack them in normal flow instead:
    `display: grid` on the container, `grid-area: 1 / 1` on each child. They
    overlap, but the container still sizes to the tallest child. (The `slides`
    kit does exactly this.)
- **Never hardcode a color.** `color: #333` is invisible in dark mode. Drive
  every color from the tokens in section 3. Mental test: if the background were
  near-black, would every element still read?
- `<style>` and `<script>` are allowed. Scripts run inside a sandboxed iframe
  with no access to the host page.

### External resources

A CSP allows loading ONLY from these origins (anything else silently fails):
`cdnjs.cloudflare.com`, `esm.sh`, `cdn.jsdelivr.net`, `unpkg.com`,
`fonts.googleapis.com`, `fonts.gstatic.com`. Images may load from any https URL,
a `data:` URI, or an asset you uploaded (`<img src="/a/<id>">`).

### Host bridge

Two globals are injected into every html surface:

- `sendPrompt(text)` — posts `text` to the item's thread as a _surface_ message.
  The operator sees it; it does NOT reach you on its own and can never
  impersonate them. Use it for "explore X" affordances they can relay
  deliberately.
- `openLink(url)` — asks the operator to confirm opening an external link. Plain
  `<a href>` clicks are routed through this automatically.

### Finish

Guardrails that keep items feeling native to the viewer. They shape the finish,
not the idea:

- Flat and clean: no gradients, drop shadows, or decorative effects.
- Sentence case for headings and labels. No emoji.
- Two font weights: 400 and 500.
- For diagrams, `<svg width="100%" viewBox="0 0 680 H">` with the classes below.
- One concept per item. Publish several small items with distinct slugs rather
  than one giant page.

---

## 3. Kits and tokens

### Theme tokens

Available in every html surface, and re-resolved whenever the operator switches
theme or color scheme:

- Backgrounds: `--color-background-primary|secondary|tertiary`, plus semantic
  `--color-background-info|success|warning|danger`
- Text: `--color-text-primary|secondary|tertiary`, plus the same semantic set
- Borders: `--color-border-tertiary` (faint default), `-secondary`, `-primary`,
  plus the semantic set
- Type: `--font-sans|serif|mono`; radius: `--border-radius-md|lg|xl` (8/12/16px)

If `sideshow init` imported a design system, that project's own `:root` block is
injected too — `var(--radius)`, `var(--primary)`, its font tokens — and
`sideshow guide --brief` prints the real values.

### Base kit (always on)

Bare `button`, `input`, `select`, and `textarea` are pre-styled to match the
viewer, hover and focus included — write the plain element, don't restyle it.
Checkboxes, radios, ranges and progress bars are themed via `accent-color`.

SVG utility classes:

| class                                                            | effect                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `t` / `ts` / `th`                                                | text presets: 14px / 12px muted / 14px medium heading                                                           |
| `box`                                                            | neutral rect — secondary fill, faint stroke, rx 8                                                               |
| `arr`                                                            | 1.2px connector line                                                                                            |
| `leader`                                                         | dashed guide line                                                                                               |
| `node`                                                           | pointer cursor + hover dim, for clickable shapes                                                                |
| `c-blue` `c-teal` `c-amber` `c-coral` `c-green` `c-red` `c-gray` | color ramp: fill+stroke on shapes (or a whole `<g>`); child `<text>` switches to readable ink in light and dark |

A `<marker id="arrow">` is injected into every html surface — end any line with
`marker-end="url(#arrow)"` and the arrowhead inherits the line's stroke color.

```html
<svg width="100%" viewBox="0 0 680 70">
  <g class="c-blue">
    <rect class="box" x="10" y="10" width="130" height="40" />
    <text class="th" x="75" y="35" text-anchor="middle">API</text>
  </g>
  <text class="ts" x="250" y="24" text-anchor="middle">202 + job id</text>
  <line class="arr" x1="140" y1="30" x2="360" y2="30" marker-end="url(#arrow)" />
</svg>
```

### Opt-in kits

List kit ids in a surface's `kits` and that kit's CSS (and JS) is injected on top
of the base. A surface with no `kits` is untouched, so default html stays fully
freeform. Discover them with `sideshow kits` (or `GET /api/kits`).

- **`builtin`** — shadcn-shaped components, CSS only, no build step: `.btn`
  (`.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-destructive`, `.btn-sm`/`.btn-lg`),
  `.card` (`.card-header`/`.card-title`/`.card-desc`/`.card-content`/`.card-footer`),
  `.input`/`.textarea`/`.select`/`.label`/`.field`, `.badge`
  (`.badge-secondary`/`.badge-outline`/`.badge-destructive`),
  `.tabs`/`.tabs-list`/`.tab.on`/`.tab-panel.on`,
  `.dialog`/`.dialog-header`/`.dialog-title`/`.dialog-footer`, `.table`, `.sep`.
  Radius follows the project's `--radius` when one was imported. This kit is
  injected automatically for projects where `sideshow init` found no Tailwind.
- **`issues`** — `.card` · nesting `.tree` rail · `.badge`
  (`.ok`/`.info`/`.warn`/`.danger`) · `.dot` · mono `.chip` · `.bar > i` rollup.
  Composes an issue/PR/CI tree — nest a `.tree` inside a `.tree` to indent — or a
  status board.
- **`slides`** — author a `.deck` with `.slide` children; the kit cross-fades one
  at a time (grid-stacked, so the frame sizes to the tallest slide) and injects
  prev/dots/counter/next controls. Arrow keys and PageUp/Down navigate.

Any kit also ships layout (`.row`/`.stack`/`.between`/`.grow`) and text
(`.title`/`.dim`/`.faint`/`.mono`/`.num`/`.kbd`/`.hr`) helpers.

```sh
sideshow publish --item ci-board --html board.html --kit issues   # repeatable: --kit a --kit b
```

```js
publish_item({ slug: "ci-board", surfaces: [{ kind: "html", html, kits: ["issues"] }] });
```

A kit only adds vocabulary — hand-roll custom markup right beside kit classes in
the same surface.

### Tailwind projects

When `sideshow init` detected Tailwind, the sandbox loads the Tailwind browser
build, so you write the same utility classes you write in the repo. The repo's
**compiled theme is not loaded** — only its custom properties — so reach its
tokens through arbitrary values: `bg-[var(--card)]`, not `bg-card`.

### Icons

When `init` uploaded the icon sprite, every html surface can use it:

```html
<svg class="icon"><use href="#mage-check" /></svg>
```

Names are the [mage](https://icon-sets.iconify.design/mage/) set prefixed with
`mage-` (`mage-home`, `mage-search`, `mage-settings`, `mage-user`,
`mage-chevron-right`, …). `.icon` sizes to `1em` and inherits `currentColor`.
Without a sprite, inline your own `<svg>` — or the Tabler webfont, which is on
the CDN allowlist:
`<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3/dist/tabler-icons.min.css">`
then `<i class="ti ti-check"></i>`.
