---
"mockpit": patch
---

pi extension: the reply watcher now peeks, so a Send stays on the session until `mockpit_feedback` or the next write delivers it, and a wake names where to look; a batch it has no line for (a request for more answers, a change to the system) is no longer consumed unseen. Every write's piggybacked feedback carries the batches whole after its lines. `mockpit_publish` gains `flow`, `step`, `swaps`, `fork`, `amend`, `withdraw`, `description`, `widths` and the `idea` kind, and its `for` names `flow:<name>`; new `mockpit_move` and `mockpit_system` tools; `mockpit_read` gains `tree` and `decisions`, and a bare read lists flows and the decision log.
