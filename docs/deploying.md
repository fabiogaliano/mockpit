# Deploying to Cloudflare

Use Workers when agents and the browser are on different machines, or to open the viewer on your phone.

```sh
npx wrangler login
npx wrangler secret put MOCKPIT_TOKEN   # any long random string
npm run deploy                           # https://mockpit.<account>.workers.dev
```

Every request needs the token. Open the viewer once as `/?key=<token>` to set a cookie. The CLI and stdio MCP read these:

```sh
export MOCKPIT_URL=https://mockpit.<account>.workers.dev
export MOCKPIT_TOKEN=<token>
```

Or connect MCP straight to the deployment:

```sh
claude mcp add --transport http mockpit https://mockpit.<account>.workers.dev/mcp \
  --header "Authorization: Bearer $MOCKPIT_TOKEN"
```

## Public read access

Set `MOCKPIT_PUBLIC_READ` to share reads without the token. It affects only `GET`: writes still need `MOCKPIT_TOKEN`, authenticated owners keep the full UI, and invalid values are ignored.

- `full`: every read is public: home, project pages, design pages (`/project/:project/:design`), surface documents, assets and the read API. Without the token the viewer is read-only: no answering, tuning, marking, restoring or Send.
- `session`: only reads addressed by an unguessable id are public, so a shared link can't list the workspace:
  - `/api/designs/:id` and `/api/designs/:id/export` (by design id, never `?project=`)
  - surface documents `/s/:postId` and assets `/a/:id`
  - `/api/comments` and `/api/events` when they carry a `session`, `design` or `post` id
  - the design page shell `/project/:project/:design`, with its link-preview metadata

  Everything addressed by name stays private: home, `/api/projects`, `/api/designs?project=`, `/api/sessions` and drafts.

  The viewer doesn't work in `session` mode: a design page looks up its design by project and slug and subscribes to the unfiltered event feed, and both need the token. Use `session` for API and surface links by id, and `full` when someone without the token should see the viewer.

## Event log

One JSON line per agent call, viewer write and live-feed connection goes to Workers Logs: `npx wrangler tail` or the dashboard. `MOCKPIT_LOG=off` turns it off.

## Link previews

Design pages (`/project/:project/:design`) include Open Graph/Twitter metadata. Crawlers get a useful preview only when the page is publicly readable; `?key=` secrets never go into the metadata. The image is `/s/:postId.png?card=1` (the design's first open alternative), which needs the Browser Rendering binding below.

## Alternative screenshots

`/s/:postId.png` renders an alternative's first renderable surface to a PNG. Agents get the URL as `screenshotUrl` from `export` (`/api/designs/:id/export`) when the deployment can render it. `?card=1` gives the 1200×630 preview image.

A headless browser captures it through Cloudflare's [Browser Rendering](https://developers.cloudflare.com/browser-rendering/) binding in `wrangler.jsonc`:

```jsonc
"browser": { "binding": "BROWSER" }
```

The route is Workers-only: the Node server has no headless browser, so local exports carry `screenshotUrl: null`. The Worker first forwards the request to the alternative's read route, so screenshots are protected like the workspace.

## Architecture

The whole app runs in one Durable Object with SQLite storage. One instance per workspace keeps the in-memory event bus authoritative, so SSE and long-polling behave as on the local server.
