---
"mockpit": minor
---

Questions live with their state. Each state now shows only the questions about it: a `state` ask on its state, a `part` ask on every state that marks the part, and a mock-wide ask that picks between variants on every state that has them, answered once for all. The count ("Lab open · Question 1 of 2") is per state, the state tabs show how many each still owes, and after the last question on a state the flow moves on to the next state that asks something. The arrows walk every state in turn, one Send and one reply as before.

Answered questions stay answered. Only open questions are shown and counted: once a Send answers one, it folds into a collapsed, read-only Answered list showing what you picked, and new questions from the agent no longer sit beside it. Changing a sent answer takes its "Change answer" button (and "Keep sent answer" backs out).

Resolve a mock from the project list: swipe its row left on a phone, or use the Resolve button that shows on hover or keyboard focus elsewhere. Its open questions close unanswered, it moves to a folded Resolved list, and Undo or Reopen bring it back. The agent hears it once in `feedback`, as a batch with `resolved: true` and the `dismissed` asks (`mockpit watch` prints a `mockpit resolved on …` line, `pending` marks the mock `resolved`); a dismissed ask reads `dismissed: true`, and `ask` skips re-asking it with a nudge. A new ask reopens the mock.
