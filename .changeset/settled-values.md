---
"mockpit": minor
---

Answers and tuning stay in force after Send. The stage, Tune and every later question's pictures render on top of everything already sent, so a later choice is judged in the context of earlier ones. `read` and `export` return it as `settled` (every value sent, later replies winning), replacing `read`'s `tuned`, which held only the last reply's.
