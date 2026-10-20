---
"mockpit": minor
---

Variants can fork. `publish` takes `fork: "quiet@2"` (CLI `--fork`) to start a new variant from a sibling's version: alone it copies it, with `parts`/`fills` it edits the copy. The variant records `forkedFrom`, shown in its version list and the switcher.
