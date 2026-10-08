# Deploying to Cloudflare

The same app runs on Cloudflare Workers — for when agents run on a different
machine than the browser, or you want the viewer on your phone.

```sh
npx wrangler login
npx wrangler secret put MOCKPIT_TOKEN   # any long random string
npm run deploy                           # https://mockpit.<account>.workers.dev
```

A deployed instance requires the token on every request. Open the viewer once as
`/?key=<token>` to set a cookie. Agents need two environment variables; the CLI
and stdio MCP pick them up automatically:

```sh
export MOCKPIT_URL=https://mockpit.<account>.workers.dev
export MOCKPIT_TOKEN=<token>
```

To share read-only access without handing out the token, set
`MOCKPIT_PUBLIC_READ` on the deployment. Only `GET` requests are affected;
writes still require `MOCKPIT_TOKEN`, authenticated owners keep the full UI,
and invalid values are ignored.

- `MOCKPIT_PUBLIC_READ=full` makes every read public: home, project pages,
  mock pages (`/project/:project/:mock`), surface documents, assets, and the
  read API. The viewer opens read-only for anyone without the token: no
  answering, tuning, marking, restoring, or Send.
- `MOCKPIT_PUBLIC_READ=session` makes public only the reads addressed by an
  unguessable id, so one shared link can't be used to list the workspace:
  `/api/mocks/:id` and `/api/mocks/:id/export` (by mock id, never by
  `?project=`), surface documents `/s/:postId`, assets `/a/:id`, and
  `/api/comments` and `/api/events` when they carry a `session`, `mock`, or
  `post` id. The mock page shell `/project/:project/:mock` is served too, with
  its link-preview metadata. Everything addressed by name stays private: home,
  `/api/projects`, `/api/mocks?project=`, `/api/sessions`, and drafts.
  The viewer itself does not work in this mode: a mock page looks its mock up
  by project and slug and subscribes to the unfiltered event feed, and both of
  those need the token. Use `session` to hand out API and surface links by id.
  Use `full` when someone without the token should see the viewer.

Mock pages (`/project/:project/:mock`) include Open Graph/Twitter metadata for
inline previews. Crawlers only get a useful preview when the page is publicly
readable under the settings above; tokened or private workspaces never put
`?key=` secrets into preview metadata. The preview image is
`/s/:postId.png?card=1` (the mock's first open variant). It needs the
Cloudflare Browser Rendering binding from `wrangler.jsonc` on deployed Workers.

Remote agents can connect MCP straight to the deployment:

```sh
claude mcp add --transport http mockpit https://mockpit.<account>.workers.dev/mcp \
  --header "Authorization: Bearer $MOCKPIT_TOKEN"
```

## Variant screenshots

A variant's first renderable surface can be rendered to a PNG at `/s/:postId.png`.
Agents get the URL as `screenshotUrl` in export responses (`export_mock`,
`/api/mocks/:id/export`) when the deployment can render it. `?card=1` produces the 1200×630 Open Graph/Twitter image used in mock
page previews. A real headless browser captures the image through Cloudflare's
[Browser Rendering](https://developers.cloudflare.com/browser-rendering/)
binding, declared in `wrangler.jsonc`:

```jsonc
"browser": { "binding": "BROWSER" }
```

The plain Node server has no headless browser, so `/s/:id.png` is a
Workers-only route and local exports carry `screenshotUrl: null`. Auth is
unchanged: the Worker first forwards the request to the variant's read route,
so a private workspace's screenshots are protected the same way as the
workspace.

The whole app runs inside a single Durable Object with SQLite storage. One
instance per workspace keeps the in-memory event bus authoritative, so SSE and
long-polling behave the same as the local server.
