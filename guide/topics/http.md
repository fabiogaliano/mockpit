# mockpit topic: http

Every verb works the same on the CLI, MCP and raw HTTP, with the same fields.

| CLI                      | MCP                                                                 | HTTP                                             |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------ |
| `mockpit init`           | none                                                                | none                                             |
| `mockpit publish`        | `publish_mock`                                                      | `POST /api/mocks`                                |
| `mockpit revise`         | `revise_mock`                                                       | `POST /api/mocks/:id/revise`                     |
| `mockpit ask`            | `ask_user`                                                          | `POST /api/mocks/:id/asks`                       |
| `mockpit wait` / `watch` | `wait_for_feedback`                                                 | `GET /api/comments?session=…&author=user&wait=N` |
| `mockpit comment`        | `reply_to_user`                                                     | `POST /api/comments`                             |
| `mockpit status`         | `list_mocks`                                                        | `GET /api/mocks?project=…`                       |
| `mockpit show`           | `get_mock`                                                          | `GET /api/mocks/:id`                             |
| `mockpit export`         | `export_mock`                                                       | `GET /api/mocks/:id/export`                      |
| `mockpit upload`         | `upload_asset`                                                      | `POST /api/assets`                               |
| `mockpit agent-howto`    | `get_design_guide`                                                  | `GET /agent-howto?project=…`                     |
| `… --topic <id>`         | `get_design_guide({ topic })`                                       | `GET /agent-howto?topic=<id>`                    |
| `mockpit surface …`      | `add_surface`, `edit_surface`, `remove_surface`, `reorder_surfaces` | `/api/mocks/:id/surfaces`                        |

`:id` is the mock id or its slug (add `project` for a slug). Over HTTP the first
publish creates a session. Pass its `sessionId` as `session` on every later
call; otherwise each call starts a new session and the reply goes elsewhere.

## Walkthrough

```sh
B=http://localhost:8228
curl -s -X POST $B/api/mocks -H 'content-type: application/json' -d '{
  "project": "demo", "mock": "checkout", "title": "Checkout", "state": "Empty cart",
  "agent": "claude", "knobs": {"pad": [16, 8, 32, 2]},
  "html": "<section data-part=\"summary\" data-part-label=\"Summary\" style=\"padding:calc(var(--k-pad,16)*1px)\">Your cart is empty</section>"}'
# → {"mock":{…},"post":{…},"sessionId":"S","url":"…","parts":[{"state":"Empty cart","parts":[{"name":"summary","label":"Summary"}]}]}

curl -s -X POST $B/api/mocks/checkout/revise -H 'content-type: application/json' -d '{
  "session": "S", "project": "demo", "state": "Empty cart",
  "html": "<section data-part=\"total\" data-part-label=\"Summary\">Nothing here yet</section>"}'
# → …,"partChanges":{"vanished":[],"renamed":[{"from":"summary","to":"total"}]}

curl -s -X POST $B/api/mocks/checkout/asks -H 'content-type: application/json' -d '{
  "session": "S", "project": "demo", "asks": [{"id": "pad", "text": "How roomy?", "scope": "part",
  "part": "total", "options": [{"label": "Tight", "set": {"pad": 8}}, {"label": "Roomy", "set": {"pad": 24}}]}]}'

# wait is seconds, max 230; the CLI and MCP default to 120
curl -s "$B/api/comments?session=S&author=user&wait=120"
# → {"comments":[…],"lastSeq":6,"feedback":[{"mock":"checkout","reply":{…},"accepted":[…],"archived":[]}]}

curl -s -X POST $B/api/comments -H 'content-type: application/json' -d '{
  "session": "S", "project": "demo", "mock": "checkout", "text": "Accepted; wiring it up"}'

curl -s "$B/api/mocks/checkout/export?project=demo"
```

## Errors

Every CLI command fails with one line plus an optional fix, exit code 2:

```
error demo has no mock "writr"
  fix: mockpit status --project demo
```

Nothing is written on a failed command, so a retry is safe. HTTP errors are
`{"error": "…"}` with a 4xx status.

## Remote

A deployed mockpit needs `MOCKPIT_URL` and `MOCKPIT_TOKEN` in your environment.
The CLI and MCP server send the token for you. For curl, add
`-H "Authorization: Bearer $MOCKPIT_TOKEN"`.
