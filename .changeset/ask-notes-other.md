---
"mockpit": patch
---

Every question in the viewer now has an "Other…" write-in and an opt-in note.
Other is the answer when no option fits. It arrives in the reply's `asks[]` as
a `chosen` entry `{ id: "other", label, other: true }`, flips no variant and
sets no knob, and `other` is now a reserved option id. A note qualifies the
answer ("Table on desktop, Cards on mobile") and arrives as `note` on that
`asks[]` entry. Either one alone answers the question. Both stay in the draft
until Send. The Tune tab now shows only when there is something to tune: knobs,
marked parts or a part ask.
