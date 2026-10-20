# mockpit topic: surfaces

A variant version is an ordered list of surfaces. Each has a `kind`:

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

On the CLI: `--html`, `--md`, `--diff`, `--mermaid`, `--terminal`, `--code`,
`--data`, `--image`, alone or after `--html`.

## Picking a kind

Pick by what the thing is:

- `html`: you are drawing. UI, diagrams, data viz, anything interactive. Design
  mocks use this. Topic `html` has its contract.
- `markdown`: prose, plans, tradeoffs. Tag fenced code to highlight it.
  `![caption](/a/<id>)` embeds an uploaded image. Raw HTML in the source is
  escaped.
- `mermaid`: the shape of a system, described rather than drawn. Prefer
  `flowchart TD` or `TB`; wide `LR` maps shrink until unreadable. Don't set
  colors; the viewer themes the diagram. Highlight with `:::accent` on nodes and
  `accentLine` on edges.
- `diff`: a changeset, sent as data. Prefer `patch` (changed lines only); use
  `files` when you have no patch.
- `code`: a whole file or an excerpt, highlighted. `lineStart` keeps the
  original line numbers.
- `terminal`: shell output or build logs, ANSI colors included.
- `json`: structured data as a collapsible tree.
- `image`: a screenshot or generated picture.

A version can combine surfaces. `[html, diff]` is a design with its code review;
`[markdown, diff]` is a rationale above its changeset.

html is sandboxed because you author the markup. Every other kind is rendered
from data, so send data, never markup.

## Composition: embeds

Any mock can embed another mock of the project in its html with
`<mockpit-embed slug="button"></mockpit-embed>` (`<mockpit-slot>` still works;
a slot is now a region with fills, topic `asks`). The server inlines that
mock's html body in place, inside the embedding frame, and expands the
component's own embeds in turn (up to 6 levels), so build a page from
sections and sections from components, each its own mock with its own
variants and questions.

- No `version`: the embed follows the component's latest version, so a new
  version of the button shows in every page that uses it without republishing
  them. `version="3"` pins it.
- No `variant`: the component's accepted variant (else `default`). Name one to
  show a specific variant.
- The component shows as decided: its slots keep only the fills the user
  settled on, and its other settled knob values ride on the embed's wrapper
  (`data-k-<path>` and `--k-<path>`), so write its knob CSS as
  `[data-k-tone="loud"] .chip`, not `html[data-k-tone=…]`.
- `read` lists each variant's `embeds` as they render now (nested included,
  with every version, for the user to peek back) and `publishedWith`, the
  versions it rendered with when you published it.
- A chain that loops back on itself is refused at publish. An unknown slug
  renders as an empty placeholder, not silently dropped.

## Editing one surface

`publish` with `surfaces` takes the full ordered list, so one call adds, edits,
removes and reorders. Every write returns each surface's `id`
(`post.surfaces`). In the next list, an entry that is only `{ "id": "…" }`
keeps that surface unchanged, an `id` with content replaces it in place, an
entry without an `id` is new, an id you leave out is removed, and the list
order is the new order:

```json
{ "mock": "writer", "surfaces": [{ "kind": "markdown", "markdown": "## Why" }, { "id": "s1" }] }
```

An unknown id fails with the surfaces present and writes nothing.

## Uploads

Push a binary once and reference it by id:

```
CLI  mockpit upload shot.png          # prints { id, url }
MCP  upload        { data | path, contentType, filename?, kind? }
POST /api/assets   (raw)   Content-Type: image/png   <bytes>   ?filename=shot.png&kind=image
POST /api/assets   (json)  { "data": "<base64>", "contentType": "image/png", "filename": "shot.png" }
```

An asset's id is the SHA-256 of its bytes. You can derive the URL locally
(`mockpit asset-url shot.png`) and write `<img src="/a/<hash>">` before the
upload finishes; the viewer waits briefly for an in-flight asset. Identical
bytes dedupe. An asset lives as long as something references it. The limit is
5 MB per asset.

## What the user sees

Each thing you add lights up its part of the viewer.

| you publish            | the user gets                                        |
| ---------------------- | ---------------------------------------------------- |
| a plain mock, any kind | the stage and Thread, with Accept / Revise / Drop    |
| several variants       | a switcher, plus a built-in Look ask until you ask   |
| asks                   | Questions: picture options on the stage, then Send   |
| `data-part`            | Tune's component list and comments anchored on parts |
| `knobs`                | Tune's controls, live on the stage                   |
| several states         | the state strip under the stage                      |
