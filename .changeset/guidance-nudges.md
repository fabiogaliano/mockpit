---
"mockpit": patch
---

Fewer false nudges. `ask` judges option labels, not the question, and no longer flags words like "size", "background", "compact" or "white". A plain ask next to a Look ask is nudged only when an option names a variant or reads visual. Toggles no longer get the knob nudge; a 2–3 option select gets "ask with options that `set` it". A publish's `suggestedAsk` now uses the id `look` (`look-<state>` per state) instead of the built-in's reserved `variant`. The CLI takes `--option Label=knob:path=value` to set a knob from an option. The guide calls the variant-choosing question "the Look ask" throughout.
