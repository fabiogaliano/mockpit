# Embedding the mockpit viewer

A minimal "host" page that mounts the mockpit viewer **engine** into a shadow
root, with its own chrome above it. It demonstrates the `mockpit/viewer-embed`
entry point: the viewer is a self-contained engine, and the host owns the page.

```js
import { mountViewer } from "mockpit/viewer-embed";

const handle = mountViewer(document.getElementById("mount"), {
  basePath: "/u/alice", // "" at the root; API calls are `${basePath}/api/...`
  router: {
    get: () => parseRouteFromYourUrl(),
    navigate: (route, opts) => yourHistory(route, opts),
    subscribe: (cb) => onYourRouteChange(cb),
  },
});
// handle.dispose() to unmount.
```

Omit the host to use the built-in History-API host (a drop-in for the
self-hosted page).

The engine's route is `project › item › variant › version`
(`{ project, slug, variant, version }`); `{ sessionId, surfaceId }` still resolve
for old permalinks. A host can also project into the engine's layout regions by
putting a light-DOM child with a `slot=` attribute in the mount element — this
demo projects a "Share" button into `ss:item-actions` (the item header).

Host fields that moved with the reshape:

| field                     | now                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `layout: "stream"`        | deprecated; means "the item screen alone" (no sidebar, no items column), resolved from the route's session/post |
| `homeView`                | the engine stays on the projects list instead of auto-opening the most recent project                           |
| slot `ss:session-actions` | deprecated alias of `ss:item-actions`, projected into the item header                                           |

## Run the local demo

The engine fetches `/api/*` (and `/s/*`, `/a/*`, SSE) relative to the page
origin, so the demo proxies those to a running mockpit server:

```sh
npm run build:embed                 # build viewer/dist-embed/engine.js
npm start                           # a mockpit server on :8228 (separate shell)
node examples/embed-host/serve.mjs  # demo on http://localhost:5180
```

`serve.mjs` serves `index.html` + the engine bundle and proxies everything else
to the mockpit server (`ORIGIN`, default `http://localhost:8228`). It is a dev
rig, not production code.
