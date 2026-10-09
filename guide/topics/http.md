# mockpit topic: http

Every verb works the same on the CLI, MCP and raw HTTP, with the same fields.
None of them waits for the user.

| CLI                          | MCP                                         | HTTP                                             |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------ |
| `mockpit init`               | none                                        | `PUT /api/projects/:name/design`                 |
| `mockpit publish`            | `publish`                                   | `POST /api/mocks`                                |
| `mockpit ask`                | `ask`                                       | `POST /api/mocks/:id/asks`                       |
| `mockpit read [slug]`        | `read`                                      | `GET /api/mocks?project=…`, `GET /api/mocks/:id` |
| `mockpit feedback`           | `feedback`                                  | `GET /api/feedback?session=…`                    |
| `mockpit say`                | `say`                                       | `POST /api/mocks/:id/say`                        |
| `mockpit export`             | `export`                                    | `GET /api/mocks/:id/export`                      |
| `mockpit upload`             | `upload`                                    | `POST /api/assets`                               |
| `mockpit guide`              | `guide`                                     | `GET /agent-howto?project=…`                     |
| `mockpit guide --topic <id>` | `guide({ topic })`                          | `GET /agent-howto?topic=<id>`                    |
| `mockpit run <file>`         | `run` on `/mcp?mode=code` (topic `scripts`) | `POST /api/run`                                  |
| `mockpit watch`              | none                                        | none: a CLI stream for background monitors       |

`:id` is the mock id or its slug (add `project` for a slug). Over HTTP the first
publish creates a session. Pass its `sessionId` as `session` on every later
call; otherwise each call starts a new session and the reply goes elsewhere.
`GET /api/feedback` requires it.

## Walkthrough

```sh
B=http://localhost:8228
curl -s -X POST $B/api/mocks -H 'content-type: application/json' -d '{
  "project": "demo", "mock": "checkout", "title": "Checkout", "state": "Empty cart",
  "agent": "claude", "knobs": {"pad": [16, 8, 32, 2]},
  "html": "<section data-part=\"summary\" data-part-label=\"Summary\" style=\"padding:calc(var(--k-pad,16)*1px)\">Your cart is empty</section>"}'
# → {"mock":{…},"post":{…},"sessionId":"S","url":"…","parts":[{"state":"Empty cart","parts":[{"name":"summary","label":"Summary"}]}],"feedback":[]}

# the same (mock, state, variant) again: its next version
curl -s -X POST $B/api/mocks -H 'content-type: application/json' -d '{
  "session": "S", "project": "demo", "mock": "checkout", "state": "Empty cart",
  "html": "<section data-part=\"total\" data-part-label=\"Summary\">Nothing here yet</section>"}'
# → …,"partChanges":{"vanished":[],"renamed":[{"from":"summary","to":"total"}]}

curl -s -X POST $B/api/mocks/checkout/asks -H 'content-type: application/json' -d '{
  "session": "S", "project": "demo", "asks": [{"id": "pad", "text": "How roomy?", "scope": "part",
  "part": "total", "options": [{"label": "Tight", "set": {"pad": 8}}, {"label": "Roomy", "set": {"pad": 24}}]}]}'

# tell the user where to look and end your turn; once they say they answered:
curl -s "$B/api/feedback?session=S"
# → {"feedback":[{"mock":"checkout","reply":{…},"accepted":[…],"archived":[]}],
#    "pending":[{"mock":"checkout","viewerOpen":true,"draft":null}]}

curl -s -X POST $B/api/mocks/checkout/say -H 'content-type: application/json' -d '{
  "session": "S", "project": "demo", "message": "Accepted; wiring it up"}'

curl -s "$B/api/mocks/checkout/export?project=demo"
```

A publish that leaves two or more variants with no ask binding them adds
`nudges` and a ready `suggestedAsk`; POST it to `/asks` as `{"asks": [...]}`.

## Errors

Every CLI command fails with one line plus an optional fix, exit code 2:

```
error demo has no mock "writr"
  fix: mockpit read --project demo
```

Nothing is written on a failed command, so a retry is safe. HTTP errors are
`{"error": "…"}` with a 4xx status.

## Remote

A deployed mockpit needs `MOCKPIT_URL` and `MOCKPIT_TOKEN` in your environment.
The CLI and MCP server send the token for you. For curl, add
`-H "Authorization: Bearer $MOCKPIT_TOKEN"`.
