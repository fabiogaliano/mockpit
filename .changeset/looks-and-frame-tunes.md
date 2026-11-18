---
"mockpit": minor
---

A tune belongs to the alternative it was made on: tuning one alternative leaves its siblings as they were. The reply names each one's values in `tunedOn` (alternative → path → value); `tuned` stays for one release, filled with the main alternative's values (the one in use, else the one on screen). Drafts in progress are moved over so every alternative keeps the values it showed, and stored replies read as before. `read` adds `settledOn` where alternatives were tuned apart. Looks: named knob values, saved from Tune with Save as look, or added by an agent's publish (`looks`, CLI `--looks`, alone for no new version). The strip under the frame previews a look on hover and gives it to the frame on click; a look is offered on every design that declares its knobs, and `read` returns them as `looks`. Saved answer combos are gone.
