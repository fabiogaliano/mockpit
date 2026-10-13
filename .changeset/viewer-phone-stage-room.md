---
"mockpit": minor
---

A new layout for phones and iPads in portrait. The design is a canvas you pan and pinch under a plain two-row header (where you are, Mark and a menu; then the version, the look and its note, and the widths), and the questions float over it in a card instead of a bottom sheet, so answering never starts with a drag. Drag the card by its grip or its header row and it snaps to a corner, the middle of the top or bottom, or the middle of a side, where it becomes a column and the design fits beside it; carry it to an edge and it tucks into a small tab there. Tune and Thread open in the card from the menu. A width that fits the screen is drawn at true size, and mock-wide question pins are gone from this layout since the card lists them.

Two new publish parameters, on the CLI (`--note`, `--widths`), MCP, HTTP and `run`: `note` is a line on what a variant is, shown on the variant and under its option, so the design itself carries no captions; `widths` names the device widths a mock is judged at, shown side by side on the canvas as artboards. The guide tells agents to keep the html to the UI alone and to declare knobs for what is worth fine-tuning even unasked.

A design wider than the width it opens at is no longer cut off on both sides: unless you picked a width or the mock names its own, the stage steps up to the next width until the design fits. Option pictures render at the stage's width, so a phone design is pictured at phone size. On touch, a tap on an option shows it on the stage and a second tap picks it and moves on, as a click does. Swiping sideways no longer changes the question; the arrow buttons do. A long crumb no longer pushes the page wider than the screen.
