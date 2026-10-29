---
"mockpit": minor
---

A mock can name its area and its source, and a new `edit` verb changes a mock or a project without SQL.

- `--area Shell` (MCP/HTTP `area`) says where in the product a mock belongs, in the project's own words. Home groups every tab by area, alphabetically, with unnamed mocks last; a flow joins an area when all its screens are in it. A project that names no area looks as before.
- `--source apps/web/src/shell` (MCP/HTTP `source`) names the code that implements a mock. Read views return it, and the viewer shows it quietly on Home and in the mock's top bar.
- `mockpit edit --mock <slug>` (MCP `edit`, `PATCH /api/mocks/:id`) changes the slug, title, kind, area or source without a new version; `""` clears area or source. A new slug rewrites every `<mockpit-embed>`, `data-goto` and flow step that names the old one, in every version, so pages and their history keep rendering. A mock still embedded somewhere can't become a sketch, and a page that stops being one is nudged out of its flows rather than removed silently.
- `mockpit edit --project <name> --rename <new>` (MCP `edit({ rename })`, `PATCH /api/projects/:name`) moves a project's mocks, sessions, flows and design settings to a new name; it is refused when that name already has mocks.
