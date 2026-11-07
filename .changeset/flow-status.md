---
"mockpit": patch
---

A flow reads a status derived from its steps, with nothing stored: Ready when every step's screen is Ready, Changed when any is Changed, else In design (a step with nothing drawn keeps it In design). It is in `read`, `read --area`, `read --tree` (and the CLI and pi lines), and Home's Flows rows show the word beside the step count.
