---
"mockpit": minor
---

Flows: an agent declares the screens a user moves between, across mocks, with `publish --flow Morning --step 2` (MCP/HTTP `flow`, `step`; `step: 0` takes a screen out, `flow` without html places an existing screen). `read` and `read --tree` return `flows`. The mock screen's flow bar and edge neighbours walk the declared flow, opening the other mock at its state with Back returning; with Try on, a design's `data-goto="next"`, `"prev"` or `"<mock>:<state>"` moves the user there. Thread rows number versions as the version bar does.
