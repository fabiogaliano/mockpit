---
"mockpit": patch
---

A page reading a knob through `dataset.kMedia` (or `dataset["kMedia"]`) now shows that knob only, instead of every knob of the design, and `data-k-*` selectors match a path in any case. A page that builds the name in script, or listens for `mockpit:knobs`, still shows them all.
