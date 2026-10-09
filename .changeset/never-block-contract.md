---
"mockpit": major
---

The agent contract never blocks. Design decisions take as long as they take,
so nothing an agent calls waits for the user: it publishes, asks, tells the
user in one line where to look, and ends its turn. The user answers in the
browser at their own pace.

- **Nine verbs, the same on every tier.** `publish`, `ask`, `read`,
  `feedback`, `say`, `export`, `upload`, `guide` and `run` (code mode). The MCP
  tools carry those names (the server name is the namespace), the Pi extension
  has `mockpit_<verb>`, and the CLI adds `init` and `watch`.
- **`publish` is the one write.** It creates a mock, state or variant, or the
  next version of an existing one. Send `html`, the full ordered `surfaces`
  list (an entry that is only `{id}` keeps that surface, a missing id removes
  it, the order is the list order), or `parts` to splice marked elements into
  the latest version.
- **`feedback` returns at once** (`GET /api/feedback`) with every batch the
  user sent since the agent last heard, plus `pending` per mock: `viewerOpen`
  and the draft's progress (`answered`, `of`, `comments`, `touchedAt`). `read`
  returns `pending` too. Every write still returns `feedback`, now under that
  name, and each Send is delivered exactly once across writes, `feedback` and
  `mockpit watch`. In Claude Code, `mockpit watch` under Monitor turns a Send
  into a wake-up.
- **`say`** (`POST /api/mocks/:id/say`) posts the agent's plain-text message in
  a mock's thread.
- **Ask discipline.** A publish that leaves several variants with no ask
  binding them returns a nudge and a ready `suggestedAsk`. Until an ask binds
  them, the viewer shows a built-in "Which one?" with a picture per variant;
  its answer arrives like any ask under the reserved id `variant` (per state:
  `variant:<state>`) and accepts and archives per state.
- **Delivered / Not seen yet.** Each Send in the Thread says whether an agent
  has received it, and the Send confirmation suggests telling your agent
  you've answered when none has.
- **`run`** scripts publish and ask in one call; `mockpit.feedback()` replaces
  `mockpit.wait()` and the wall limit is 10 s.

Removed: the CLI's `wait`, `revise`, `comment`, `status`, `show`, `surface`
and `agent-howto` (use `feedback`, `publish`, `say`, `read` and `guide`); the
MCP tools `publish_mock`, `revise_mock`, `ask_user`, `wait_for_feedback`,
`reply_to_user`, `list_mocks`, `get_mock`, `export_mock`, `upload_asset`,
`get_design_guide`, `add_surface`, `edit_surface`, `remove_surface` and
`reorder_surfaces`; `POST /api/mocks/:id/revise`, the `/api/mocks/:id/surfaces`
routes and agent `POST /api/comments`; `timeoutSeconds`; and the `userFeedback`
field; the guide topic `reply` is now `feedback`, the SSE event `comment-seen`
is `comment-delivered`, and the page-slot `item=` attribute alias is gone (use
`slug=`). Refresh pasted setup blocks from `/setup`.
