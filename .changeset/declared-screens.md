---
"mockpit": minor
---

Declared screens. An agent can declare a screen or component before drawing it: `publish` with a `kind` and no body plans it, on every tier, and a `flow` may name it as a step. It shows as an outline on Home and in flows, says how many aren't drawn yet, and the first publish fills it in. The user can ask for it to be drawn or say it isn't needed.

Missing states. A declared page with html shows outlines for Empty, Loading and Failed once each, every one dismissible as doesn't apply, plus + New state, which sends the agent a request as an ordinary reply. `read` carries the answers as `stateOutlines`.

Grid. Where variant names repeat across states, the top bar offers a grid: states one way, variants the other, one tile per render, missing cells shown, and where a component is used. A component with several forms opens on it. Tiles obey the live-frame limit, and tapping one opens it.

Notes, an experiment. A short plain-text spec per mock that an agent drafts with `edit` (`mockpit edit --notes`), the user corrects by hand, and later agents read in `read`. A hand edit holds against later agent drafts until the user clears it, and the agent is told when its draft wasn't applied.

Situations are gone. Existing ones become ordinary states, migrated in place, and the `situation` publish param now names one, as `state · situation`. The situation switch, the side-by-side view and the ↑ and ↓ keys go with them.
