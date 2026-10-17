---
"mockpit": minor
---

Slots: a region of the design with alternative fills, declared in the markup. Elements that share a `data-part` name and carry distinct `data-fill` values make one slot (`data-fill-label` names a fill for the user, `data-fill-default` picks the default, else the first). mockpit shows only the chosen fill, with no switching CSS from the agent; each slot is a select knob on its part, so an ask option chooses a fill with `set: {"entry": "skeleton"}`. A fill may hold further slots. `publish` lists the slots it found and hands back `suggestedSlotAsks` for any slot no ask sets. A reply carries `decisions`, the screen as decided (per state the look and each slot's fill, nested slots under the fill that holds them, plus the knob values set), and `export` returns the composed screen with only the chosen fills (the authored markup as `source`); the CLI writes `index.html`, `source.html` and `decisions.json`.
