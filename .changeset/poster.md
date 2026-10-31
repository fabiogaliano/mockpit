---
"mockpit": minor
---

A heavy page can carry a poster: a still the agent takes of it, sent as `poster` on the html surface (CLI `--poster shot.png`, MCP `poster`, an image path on stdio and in the pi extension, an asset id over HTTP and in `run`). Studio and Home show the picture instead of running the page, so a board of 3D sketches costs no live frames; Stage still runs the page. A version that changes the page without a new poster drops the old one, so a still never shows an older page. A new variant whose page draws on a `<canvas>` without a poster gets a nudge.
