---
"mockpit": patch
---

A variants design's entries are `variant` everywhere an agent reads them: `move`'s result (`variants`, `skipped`, `versions`, `saved`) and a feedback batch's `verdict`, `inUse`, `archived` and messages now say `variant`, as `read` and `publish` already did; every other design still says `alternative`. `mockpit watch` (and so the Claude Code plugin's wake) now wakes on a batch from the System page alone, printing what changed, as the pi extension does.
