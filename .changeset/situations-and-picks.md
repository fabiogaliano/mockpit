---
"mockpit": minor
---

Situations: another render of one state ("Couldn't save", "Loading", "12 items"), published with `--situation` beside `--state`. The flow still steps through states; a quiet switch under the design flips the state between its situations (↑/↓), and a grid button in the version bar shows them side by side. Each situation is a state of its own key (`"Writing · Couldn't save"`), so asks, comments, decisions and export reach it like any state.

An ask can mark the option the agent would pick (`"recommended": true`, `mockpit ask --recommend <label>`): a small dot on its corner, the why on hover.

Home: the project name gives way to the bell and theme buttons on a phone, a page's new dot sits after its name, and the status chip stays clear of a phone-shaped picture's round corner.
