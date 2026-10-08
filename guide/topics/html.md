# mockpit topic: html

An `html` surface is a blank canvas. Custom SVG, bespoke layout, small
interactions and animation are all fine. Below are the hard rules, the finish
guardrails, and the vocabulary available inside the frame. `mockpit agent-howto`
prints this project's real palette, kit and icons.

## Contract

- Send a body fragment. No `<!doctype>`, `<html>`, `<head>` or `<body>`; the
  server wraps your fragment in a themed, sandboxed document.
- The stage renders your fragment in an 820px-wide frame, scaled to fit the
  user's window. Question pictures and Home thumbnails are the same document,
  shrunk. Height is measured from your content.
- Keep content in normal flow. The frame measures the document box, so anything
  out of flow is invisible to the sizer and can leave the surface clipped or
  stuck at the wrong height.
  - Never use `position: fixed`.
  - Don't stack `position: absolute` layers over a box with a fixed `height` or
    `min-height`. The overlay grows `scrollHeight` but not the measured box.
  - To overlap elements, grid-stack them: `display: grid` on the container,
    `grid-area: 1 / 1` on each child. The container sizes to the tallest child.
    The `slides` kit does this.
- Never hardcode a color. `color: #333` disappears in dark mode. Drive every
  color from the tokens below. Test: if the background were near-black, would
  everything still read?
- `<style>` and `<script>` are allowed. Scripts run in a sandboxed iframe with
  no access to the host page.

## External resources

The CSP allows loads only from `cdnjs.cloudflare.com`, `esm.sh`,
`cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com` and
`fonts.gstatic.com`. Anything else fails silently. Images may load from any
https URL, a `data:` URI, or an uploaded asset (`<img src="/a/<id>">`).

## Parts and knobs

Mark the components you want feedback on with `data-part="name"` (optional
`data-part-label` for the name the user reads, `data-part-key` to tell instances
apart and keep comments anchored across a rename). The viewer measures their
boxes, so never hard-code geometry for it. Knob values arrive as unitless
`--k-<path>` custom properties and `data-k-<path>` attributes on `<html>`; topic
`knobs` has the details.

## Finish

These keep mocks feeling native to the viewer. They shape the finish, not the
idea.

- Flat: no gradients, drop shadows or decorative effects.
- Sentence case for headings and labels. No emoji.
- Two font weights: 400 and 500.
- For diagrams, `<svg width="100%" viewBox="0 0 680 H">` with the classes below.
- One concept per mock. Publish several small mocks with their own slugs rather
  than one giant page.

## Theme tokens

Every html surface has these, re-resolved when the user switches dark and light:

- Backgrounds: `--color-background-primary|secondary|tertiary`, plus semantic
  `--color-background-info|success|warning|danger`
- Text: `--color-text-primary|secondary|tertiary`, plus the same semantic set
- Borders: `--color-border-tertiary` (faint default), `-secondary`, `-primary`,
  plus the semantic set
- Type: `--font-sans|serif|mono`. Radius: `--border-radius-md|lg|xl` (8/12/16px)

If `mockpit init` imported a design system, the project's own `:root` block is
injected too, so `var(--radius)`, `var(--primary)` and its font tokens resolve.

## Base kit (always on)

Bare `button`, `input`, `select` and `textarea` are styled to match the viewer,
hover and focus included. Write the plain element; don't restyle it.
Checkboxes, radios, ranges and progress bars follow `accent-color`.

SVG classes:

| class                                                            | effect                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `t` / `ts` / `th`                                                | text: 14px / 12px muted / 14px medium heading                                            |
| `box`                                                            | neutral rect: secondary fill, faint stroke, rx 8                                         |
| `arr`                                                            | 1.2px connector line                                                                     |
| `leader`                                                         | dashed guide line                                                                        |
| `node`                                                           | pointer cursor and hover dim, for clickable shapes                                       |
| `c-blue` `c-teal` `c-amber` `c-coral` `c-green` `c-red` `c-gray` | color ramp: fill and stroke on shapes or a whole `<g>`; child `<text>` gets readable ink |

Every html surface has a `<marker id="arrow">`. End a line with
`marker-end="url(#arrow)"` and the arrowhead takes the line's stroke color.

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

## Opt-in kits

List kit ids in a surface's `kits` and that kit's CSS (and JS) is added on top
of the base. A surface with no `kits` is untouched. `mockpit kits` (or
`GET /api/kits`) lists them.

- `builtin`: shadcn-shaped components, CSS only. `.btn` (`.btn-primary`,
  `.btn-secondary`, `.btn-ghost`, `.btn-destructive`, `.btn-sm`, `.btn-lg`),
  `.card` (`.card-header`, `.card-title`, `.card-desc`, `.card-content`,
  `.card-footer`), `.input`, `.textarea`, `.select`, `.label`, `.field`,
  `.badge` (`.badge-secondary`, `.badge-outline`, `.badge-destructive`),
  `.tabs`, `.tabs-list`, `.tab.on`, `.tab-panel.on`, `.dialog`,
  `.dialog-header`, `.dialog-title`, `.dialog-footer`, `.table`, `.sep`. Radius
  follows the project's `--radius` when one was imported. Added automatically
  for projects where `mockpit init` found no Tailwind.
- `issues`: `.card`, a nesting `.tree` rail, `.badge` (`.ok`, `.info`, `.warn`,
  `.danger`), `.dot`, mono `.chip`, `.bar > i` rollup. For an issue, PR or CI
  tree (nest a `.tree` in a `.tree` to indent) or a status overview.
- `slides`: a `.deck` of `.slide` children. The kit shows one at a time
  (grid-stacked, so the frame sizes to the tallest) and adds prev, dots, counter
  and next controls. Arrow keys and PageUp/PageDown navigate.
- `basecoat`: Basecoat UI from jsDelivr, shadcn's look as plain classes:
  `.btn`, `.card` (`header`, `section`, `footer` inside), `.input`, `.label`,
  `.badge`, `.alert`, `.table`, `.tabs`, `.dialog`, `.kbd`. Variants are
  `data-variant="secondary|outline|ghost|destructive"`, sizes `data-size="sm|lg"`.
  Themes from the project's shadcn vars, else from the `--color-*` tokens.

A project kit is your team's own CSS on the CDN allowlist:
`mockpit kit add acme --url <https css> --doc cheatsheet.md [--script <js>]`,
`mockpit kit remove acme`. Name it in `kits` like any other.
`mockpit init --kit <id>` makes a bundled or project kit the default for every
surface, and the brief prints its classes or doc.

The builtin, issues and slides kits also ship layout helpers (`.row`, `.stack`,
`.between`, `.grow`) and text helpers (`.title`, `.dim`, `.faint`, `.mono`,
`.num`, `.kbd`, `.hr`).

```sh
mockpit publish --mock ci-status --html status.html --kit issues   # repeat --kit for more
```

```js
publish_mock({ mock: "ci-status", surfaces: [{ kind: "html", html, kits: ["issues"] }] });
```

A kit only adds vocabulary. Write custom markup right beside kit classes.

## Tailwind projects

When `mockpit init` found Tailwind v4, the sandbox compiles the repo's own
Tailwind stylesheet with the browser build, so write the same utility classes
you write in the repo, including theme classes (`bg-card`,
`text-muted-foreground`). The browser build cannot load plugins or non-core
imports, so init strips them; their utilities (`tw-animate-css`, typography)
are not available, and the brief lists what was stripped. In dark mode the
frame's `<html>` carries `class="dark"`, so the repo's `.dark` theme applies.
A Tailwind v3 repo keeps its theme in `tailwind.config`, which the browser
build cannot load: core utilities work, theme classes do not.

## Icons

Write the icon by name and the server inlines the svg:

```html
<i icon="lucide:check"></i> <i icon="tabler:x" class="dim" data-part="close"></i>
```

The element becomes an inline `<svg class="icon">` at `1em` in `currentColor`.
Other attributes (class, style, data-part) are kept. lucide and mage are always
available. Add any Iconify set with `mockpit icons add tabler` (also `ph`,
`heroicons`, …); `mockpit init` adds the sets your repo already uses, and
`mockpit icons` lists the sets with their counts. A publish names unknown icons
in `warnings`; they render as an empty box.
