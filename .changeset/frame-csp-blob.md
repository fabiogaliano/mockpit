---
"mockpit": patch
---

A frame's page may now `fetch` the `blob:` and `data:` URLs it makes itself, so a three.js model's embedded textures load instead of the model drawing white. Both are bytes the page already holds: no new way out to the network.
