# mockpit topic: http

Every verb takes the same fields on the CLI, MCP and raw HTTP. None waits for the user.

| CLI                            | MCP                                         | HTTP                                                                           |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ |
| `mockpit init`                 | none                                        | `PUT /api/projects/:name/system` `{repo, kit}`                                 |
| `mockpit publish`              | `publish`                                   | `POST /api/designs`                                                            |
| `mockpit ask`                  | `ask`                                       | `POST /api/designs/:id/asks`                                                   |
| `mockpit read [slug]`          | `read`                                      | `GET /api/designs?project=…`, `GET /api/designs/:id` (`?body=1` adds the html) |
| `mockpit read --decisions`     | `read({decisions: true})`                   | `GET /api/projects/:name/decisions`                                            |
| `mockpit read --area <a>`      | `read({ area })`                            | `GET /api/projects/:name/areas/:area`                                          |
| `mockpit feedback`             | `feedback`                                  | `GET /api/feedback?session=…`                                                  |
| `mockpit say`                  | `say`                                       | `POST /api/designs/:id/say`                                                    |
| `mockpit move`                 | `move`                                      | `POST /api/designs/:id/move`                                                   |
| `mockpit edit --design <slug>` | `edit`                                      | `PATCH /api/designs/:id`                                                       |
| `mockpit edit --purpose <t>`   | `edit({ purpose })`                         | `PATCH /api/designs/:id` `{purpose}`                                           |
| `mockpit edit --behaviour <t>` | `edit({ behaviour })`                       | `PATCH /api/designs/:id` `{behaviour: [{text, state?, part?}]}`                |
| `mockpit edit <slug> --group`  | `edit({ group })`                           | `PATCH /api/designs/:id` `{group}`                                             |
| `mockpit edit --rename <n>`    | `edit({ rename })`                          | `PATCH /api/projects/:name` `{name}`                                           |
| `mockpit edit --areas`         | `edit({ areas })`                           | `PATCH /api/projects/:name` `{areas}`                                          |
| `mockpit edit --description`   | `edit({ description, area? })`              | `PATCH /api/projects/:name` `{description, area?}`                             |
| `mockpit system`               | `system`                                    | `GET`, `PUT /api/projects/:name/system`                                        |
| `mockpit export`               | `export`                                    | `GET /api/designs/:id/export`                                                  |
| `mockpit export` (no design)   | `export` (no design)                        | `GET /api/projects/:name/system/export`                                        |
| `mockpit upload`               | `upload`                                    | `POST /api/assets`                                                             |
| `mockpit guide`                | `guide`                                     | `GET /agent-howto?project=…`                                                   |
| `mockpit guide --topic <id>`   | `guide({ topic })`                          | `GET /agent-howto?topic=<id>`                                                  |
| `mockpit run <file>`           | `run` on `/mcp?mode=code` (topic `scripts`) | `POST /api/run`                                                                |
| `mockpit watch`                | none                                        | none: a CLI stream for background monitors                                     |

`:id` is the design id or its slug (add `project` for a slug). Over HTTP the first publish
creates a session: pass its `sessionId` as `session` on every later call, or each call starts
a new session and the reply goes elsewhere. `GET /api/feedback` requires it.

## Walkthrough

```sh
B=http://localhost:8228
curl -s -X POST $B/api/designs -H 'content-type: application/json' -d '{
  "project": "demo", "design": "checkout", "title": "Checkout", "state": "Empty cart",
  "agent": "claude", "knobs": {"pad": [16, 8, 32, 2]}, "widths": [390, 1280],
  "description": "One column; the summary carries the empty state",
  "html": "<section data-part=\"summary\" data-part-label=\"Summary\" style=\"padding:calc(var(--k-pad,16)*1px)\">Your cart is empty</section>"}'
# → {"design":{…},"post":{…},"sessionId":"S","url":"…","parts":[{"state":"Empty cart","parts":[{"name":"summary","label":"Summary"}]}],"feedback":[]}

# the same (design, state, alternative) again: its next version
curl -s -X POST $B/api/designs -H 'content-type: application/json' -d '{
  "session": "S", "project": "demo", "design": "checkout", "state": "Empty cart",
  "html": "<section data-part=\"total\" data-part-label=\"Summary\">Nothing here yet</section>"}'
# → …,"partChanges":{"vanished":[],"renamed":[{"from":"summary","to":"total"}]}

curl -s -X POST $B/api/designs/checkout/asks -H 'content-type: application/json' -d '{
  "session": "S", "project": "demo", "asks": [{"id": "pad", "text": "How roomy?", "scope": "part",
  "part": "total", "options": [{"label": "Tight", "set": {"pad": 8}}, {"label": "Roomy", "set": {"pad": 24}}]}]}'

# tell the user where to look and end your turn; once they say they answered:
curl -s "$B/api/feedback?session=S"
# → {"feedback":[{"design":"checkout","reply":{…},"messages":[],"inUse":[…],"archived":[]}],
#    "pending":[{"design":"checkout","viewerOpen":true,"draft":null}]}

curl -s -X POST $B/api/designs/checkout/say -H 'content-type: application/json' -d '{
  "session": "S", "project": "demo", "message": "In use; wiring it up"}'

curl -s "$B/api/designs/checkout/export?project=demo"
```

A publish that leaves two or more alternatives with no question binding them adds
`nudges` and a ready `suggestedAsk`; POST it to `/asks` as `{"asks": [...]}`.

## Errors

Every CLI command fails with one line plus an optional fix, exit code 2:

```
error demo has no design "writr"
  fix: mockpit read --project demo
```

Nothing is written on a failed command, so a retry is safe. HTTP errors are
`{"error": "…"}` with a 4xx status.

## Remote

A deployed mockpit needs `MOCKPIT_URL` and `MOCKPIT_TOKEN` in your environment. The CLI and
MCP server send the token. For curl, add `-H "Authorization: Bearer $MOCKPIT_TOKEN"`.
