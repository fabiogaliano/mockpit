---
"mockpit": minor
---

Composition goes deeper. Any mock can embed another (`<mockpit-embed slug="card">`), and an embedded component's own embeds expand in turn, so pages build from sections and sections from components. An embed without `version` now follows the component's latest version (with `version` it stays pinned), and one without `variant` follows the component's accepted variant. A component's new version reloads every page that shows it, and the stage's Components row lets the user peek at older versions. A chain that loops back on itself is refused at publish. `read` lists each variant's `embeds` as they render now and `publishedWith`, what the version rendered with when published.
