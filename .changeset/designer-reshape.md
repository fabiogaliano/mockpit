---
"sideshow": minor
---

Designer reshape: sideshow is now organised as **project › item › variant ›
version** instead of a stream of posts. A project is a repo, an item is a
component or a page addressed by a stable slug, variants are parallel takes shown
as tabs, and versions are the item's history with the basis version and the
prompt that produced it.

- **Review loop.** Comments accumulate as drafts on a version and are released as
  one batch by the user's decision: **Revise** sends them, **Accept** approves a
  version and archives its sibling variants, **Drop** archives a variant
  (restorable). Agents wake once with the whole batch.
- **Markers.** Comments can carry several anchors drawn on the render, referenced
  as `@1`, `@2` in the text, each with the element's CSS path and visible text,
  plus the viewport preset (390 / 820 / 1280) that was being reviewed.
- **`sideshow init`.** Detects the repo's design system (Tailwind/shadcn, CSS
  custom properties, fonts), imports its palette, picks a kit, uploads a Mage icon
  sprite, and writes `.sideshow/starter.html` — so agent markup speaks the repo's
  vocabulary. `sideshow guide --brief` and `get_design_guide` render the project's
  real tokens, kit and icons.
- **New CLI verbs:** `init`, `publish --item/--variant`, `revise --from`, `page`,
  `ask`, `wait` (batched), `status`, `show`, `export`, plus `--json`/`--quiet`.
- **New MCP tools:** `publish_item`, `revise_item`, `ask_user`, `list_items`,
  `get_item`, `export_item`, `init_project` (stdio), with `wait_for_feedback`
  returning the batch shape.
- **Leaner reads.** `get_item` / `sideshow show` return history metadata only;
  bodies are opt-in behind `--body` / `--history`.
- **Push and webhooks.** Web Push on `ask` and on new versions, plus outbound
  `POST /api/hooks` webhooks.
- **Export.** Accept hands the agent the accepted html, its prompt history and a
  screenshot; `sideshow export` writes them to `.sideshow/accepted/`.

The item screen no longer renders the post card, so the share menu,
per-comment copy and delete-post controls are reachable only on the standalone
`/p/:id` page. Project routes (`/api/projects*`) are not exposed under
session-scoped public read.

Back-compat: legacy HTTP routes, the `parts` body key, `?part=`, the `/s/:id`
alias and the deprecated MCP tool aliases are unchanged. The deprecated aliases
are now hidden from `tools/list` unless `SIDESHOW_MCP_LEGACY=1` is set.
