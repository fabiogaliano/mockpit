---
"mockpit": patch
---

The viewer can notify you. Turn on the bell in the top bar and, while a mockpit
tab is open but not in front, a new question, a new version or an agent comment
raises a browser notification for that mock. A burst of writes to one mock is
one notification, and clicking it opens the mock. `post-created` and
`post-updated` feed events now carry `by: "agent" | "user"`.
