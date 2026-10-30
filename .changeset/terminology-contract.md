---
"mockpit": major
---

The agent contract speaks the viewer's words, with no aliases. Every tier changes together (HTTP, MCP, the stdio MCP server, the CLI, `run`, the pi extension, the guide and the skill). Old name → new name:

- `POST /api/mocks/:id/resolve` → `POST /api/mocks/:id/close` (`/reopen` is unchanged); a mock's `resolvedAt` → `closedAt`; the feedback batch's `resolved: true` → `closed: true` (`dismissed` is unchanged); `pending[].resolved` → `pending[].closed`.
- The feedback batch's `comments` (the user's thread messages) → `messages`; `mockpit watch` prints `mockpit message on <mock>` and `mockpit closed <mock>`.
- `reply.decision` `{kind: accept|revise|drop}` → `reply.verdict` `{kind: use|revise}`. Drop is gone: the reply body no longer takes it and no variant is ever `dropped`.
- `accepted` (feedback batch) → `inUse`; a variant's `status: "accepted"` → `status: "inUse"` and `acceptedVersion` → `inUseVersion` (in `read`, the tree, publish, export and restore). The feedback batch's `dropped` is gone.
- `reply.mix` and the draft's `mix` → `borrowed`; `decisions…from` → `decisions…borrowedFrom`.
- Publish's `slots` → `fills` and `suggestedSlotAsks` → `suggestedFillAsks`; `decisions.states[…].slots` and a fill's nested `slots` → `parts`. The `<mockpit-slot>` alias is gone: write `<mockpit-embed>`.
- `read --tree`: `uses` → `embeds`, `usedIn` → `embeddedIn`.
- `export`: `source` → `allFills`; the CLI writes `all-fills.html` instead of `source.html`.
- The suggested variant question publish offers is id `choice` (per state `choice-<state>`), "Which variant?", instead of `look`, "Which one?".
- Guide, skill and tool descriptions call an ask a question, a slot a part with fills, and a state a state (screen only glosses `page`).

An existing workspace migrates in place on the first start: the `resolvedAt` column becomes `closedAt`, `dropped` variants become `archived`, stored replies and drafts are rewritten into the new keys (`decision` accept/revise → `verdict` use/revise, a `drop` decision is removed, `mix` → `borrowed`, `resolved` → `closed`), and `<mockpit-slot>` tags in stored html, current and history, become `<mockpit-embed>`.
