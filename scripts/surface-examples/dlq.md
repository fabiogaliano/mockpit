### Follow-up: don't `ack` the dead

Right now an exhausted job is `ack`'d and vanishes. Route it to a **dead-letter
queue** instead so nothing is lost silently — the one guarantee this whole
surface is about.

This version is **two surfaces** — a `markdown` rationale stacked above a
`diff`. Composition is the point: one version, the why and the what.
