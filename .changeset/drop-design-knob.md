---
"mockpit": patch
---

A publish can now drop a design knob: a path set to `null` in `knobs` (`--knobs '{"media": null}'`) takes it off the design, as when the knob moves to one alternative's `alternativeKnobs`. Knobs otherwise still add up across publishes, so `{}` changes nothing.
