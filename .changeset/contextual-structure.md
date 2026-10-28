---
"mockpit": minor
---

Structure is now declared, never assumed. A mock published without `--kind` is a sketch instead of a component; embedding a sketch in another mock makes it a component. Home shows a tab only for the kinds in use, in the order Pages · Flows · Components · Sketches, and no tab bar when only one applies. The Flows tab lists only declared flows. Existing components that nothing embeds and no flow uses become sketches when the workspace opens.
