---
"mockpit": patch
---

`pending.viewerOpen` in `feedback`, `read` and the mock list now means "a browser has this mock on screen", not "any browser has the workspace open". Before, every mock in the project read `viewerOpen: true` while a single tab was open, so agents told users a mock was open when it wasn't. The viewer names the mock it shows with `/api/events?viewing=<mockId>`, and the CLI and Pi `pending` lines now print per mock.
