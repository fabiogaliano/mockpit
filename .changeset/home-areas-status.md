---
"mockpit": minor
---

Home is organised by area and says where each mock stands; the user can move mocks themselves.

- Once a project names areas, Home gets a rail of them (chips on a phone) with counts and a dot where questions are open, plus an All tab. Area and kind combine, both in the URL (`?view=…&area=…`): pick an area on All to see its pages, flows, components and sketches together. A project with no areas looks as before.
- Areas follow the project's own order: `mockpit edit --project <p> --area-order "Shell,Food"` (MCP `edit({ areaOrder })`, `PATCH /api/projects/:name` `{areaOrder}`). Areas it leaves out follow alphabetically, mocks with none sit last under "No area", and a project rename carries the order.
- Each card carries one quiet status, derived from what is already stored: `N open`, `Changed` (a newer version than the one in use), `Decided` or `Exploring`. Closed mocks are faded and sorted last. It replaces the unexplained check on cards.
- A dot marks mocks with versions this browser hasn't opened yet (per browser, no server state).
- A ⋯ menu on each card moves a mock to Pages, Components or Sketches, sets its area (an existing one or a new one), and closes or reopens it, with the edit verb's rules. The agent hears each move once, as `edited: {kind, area}` in its next feedback batch.
- Sketch thumbnails are shaped to their design width like pages instead of slivers in a wide tile; code paths are cut from the left (`…/spaces/food`), always right after the name, full on hover.
- The mock screen's crumb names its area (a link back to Home on that area), and a Related sidebar (toggled from the top bar, remembered per browser) lists the pages it is used in, what it uses and the flows it is a step of.
- The guide asks agents to title mocks by what they are, not by process ("Round 2 · …", "v2", "Prototype"), and publish nudges when a title does.
