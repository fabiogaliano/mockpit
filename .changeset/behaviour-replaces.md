---
"mockpit": patch
---

`mockpit edit --behaviour` now replaces every line, as MCP and HTTP do: text is the one line (with `--state` and `--part`), a JSON list keeps several, `""` clears. The CLI no longer reads the spec and appends, so an edit made in between is never lost; to add a line, send the lines you read with it.
