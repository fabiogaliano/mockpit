---
"mockpit": major
---

Agents and the app now use the same words. Restart any running agent, CLI or MCP server after upgrading: the old names are gone, with no aliases, and your data is converted in place.

- A mock is now a **design** everywhere: `--mock` is `--design`, `/api/mocks` is `/api/designs`, and every `mock` and `mockId` field follows.
- Kinds are `idea`, `screen` and `component`: `--kind sketch` is `idea`, `--kind page` is `screen`.
- Everything taken away is **archived**: `closedAt` is `archivedAt`, `closeReason` is `archiveReason`, `closed` is `archived`. The app says Archive instead of End. `POST /api/designs/:id/close` and `/reopen` are `/archive` and `/restore`, and the variant routes are now `/variants/archive` and `/variants/restore`.
- A variant's `note` is its `description` (`--description`). What the user adds to an answer is a `comment`, with `commentImages`, and the app says Add a comment. `notes` still means a design's written spec.
- `/api/projects/:name/design` is `/design-system`.
- `--situation` is gone: another render of a state is a state, `--state "Home · Failed"`. `edited.grouped` is gone too.
