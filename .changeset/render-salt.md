---
"mockpit": patch
---

`MOCKPIT_RENDER_SALT` on the Node server changes every surface document's URL on restart, so browsers re-fetch versions that were changed outside the API (a direct store edit) instead of keeping their year-long cached copy.
