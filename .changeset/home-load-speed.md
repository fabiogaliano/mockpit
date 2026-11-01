---
"mockpit": patch
---

Home loads in a fraction of the time on a large workspace: the server keeps parsed variants in memory until one changes instead of re-reading every surface and version per request, the projects list no longer reads surfaces at all, and a Node server now gzips its responses. Home no longer says "0 open · all answered" while it is still loading.
