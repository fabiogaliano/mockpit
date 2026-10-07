// The host seam. The viewer is an embeddable "engine": it renders into a root
// (the whole document when self-hosted, a shadow root when embedded) and reads
// its base path + route from an injected host instead of touching window/
// location directly. Whoever provides the host owns the URL, chrome, and
// routing; self-hosted mockpit ships the trivial default host below.
//
// Self-hosted parity: when nothing is injected, root() is `document` and host()
// is a History-API host whose URLs/behaviour match the pre-engine viewer
// exactly. The embed path (mountViewer) calls setEngine() with a shadow root +
// the embedder's host before <App/> renders.

import type { ThemeTokens } from "../../server/theme-tokens.ts";
import type { Mode } from "../../server/themes.ts";

// The engine's route. The reshape adds the project › item coordinates; the
// session/post fields stay so `/session/:id` permalinks and the standalone
// `/p/:id` page keep resolving (the engine turns a session route into the item
// screen by reading the post's project+slug).
export type Route = {
  sessionId?: string | null;
  surfaceId?: string | null;
  project?: string | null;
  slug?: string | null;
  variant?: string | null;
  version?: number | null;
};
export type LiveTransport = "sse" | "ws";

export interface HostRouter {
  // The current route the engine should render.
  get(): Route;
  // Ask the host to navigate; `replace` swaps history instead of pushing.
  navigate(to: Route, opts?: { replace?: boolean }): void;
  // Notify the engine when the host's route changes (back/forward, etc).
  subscribe(cb: (route: Route) => void): () => void;
}

export interface MockpitHost {
  // Link/base prefix the engine prepends to every path, e.g. "/alice" ("" at
  // root). API calls are `${basePath}/api/...`.
  basePath: string;
  router: HostRouter;
  // The caller's own identity, when the host knows it (cloud chrome). Optional —
  // self-hosted has no identity.
  identity?: { login: string; workspaceSlug?: string; role?: string };
  // Layout the engine renders. "full" (default) is the whole navigation —
  // projects sidebar, items column, item screen.
  //
  // "stream" is DEPRECATED: it named the mixed post stream, which the reshape
  // removed. It is still accepted and now means "the item screen alone" — no
  // projects sidebar, no items column — and the engine resolves the item from
  // the route's session/post instead of the project reads (which a
  // session-scoped public workspace does not expose). Self-hosted public-read
  // "session" links map to it (see api.ts `layoutMode`), so that flow keeps
  // working.
  layout?: "full" | "stream";
  // Read-only embed: hide write affordances (delete, comment-as-owner, the
  // connect action). Orthogonal to `layout` — a host can have either without the
  // other. Self-hosted drives the same flag via window.__MOCKPIT_READONLY__.
  readonly?: boolean;
  // Live-update transport. Self-hosted defaults to SSE; embedders can opt into
  // WebSocket when their host implements `/api/events` as a hibernatable socket.
  liveTransport?: LiveTransport;
  // Whether this deployment can render a surface as a PNG (the /p/:id.png route).
  // That route is served only by a Cloudflare Worker with the Browser Rendering
  // binding; a plain Node server (local dev, `npm start`) has no way to drive a
  // headless browser, so it is absent there. The engine always shows a
  // screenshot action on each surface, but disables it with an explanatory
  // tooltip when this is false. Self-hosted drives the same flag via
  // window.__MOCKPIT_SCREENSHOTS__. Optional — defaults to off.
  screenshots?: boolean;
  // The host renders its own landing when the route carries no project, so the
  // engine must NOT auto-pick one: it stays on the projects list (route "/")
  // with nothing selected, and clears its selection when the route later
  // becomes project-less. Self-hosted leaves this unset/false and is unchanged —
  // "/" auto-opens the most recent project. Optional — defaults to off.
  // (Before the reshape this was about sessions; it now reads the same way one
  // level up, on projects.)
  homeView?: boolean;
  // Omit the engine's own "mockpit" wordmark (the sidebar/header home-link brand)
  // when the host provides its own branding/header — e.g. a cloud that puts a
  // workspace picker at the top of the sidebar and its own wordmark in the footer.
  // Self-hosted leaves this unset and shows the wordmark as before. Optional —
  // defaults to off.
  hideBrand?: boolean;
  // The engine calls this with the fully-resolved palette on initial mount, on
  // every live theme switch, and on an OS light/dark flip. Symmetric with
  // router.navigate: the engine owns the themes and TELLS the host its colors,
  // so an embedder can mirror them onto its own chrome without reaching across
  // the shadow boundary. Optional — the trivial self-hosted host omits it.
  //
  // `meta` names the resolved theme + scheme behind those tokens. A host that
  // re-renders surfaces out-of-band (e.g. server-side preview frames it can't
  // theme from the token values alone) needs the identifiers to reproduce the
  // exact look via `/s/:id?theme=&mode=`; a host that only paints from the tokens
  // can ignore it. Additive — the tokens argument is unchanged.
  onThemeChange?(tokens: ThemeTokens, meta: { theme: string; mode: Mode }): void;
  // The engine calls this once, after its first route resolution completes and
  // the initial screen (an item, a project, or the empty-workspace onboarding)
  // has been decided — i.e. the moment the engine knows what to show. An embedding host
  // can hold a loading overlay over the mount until then so its users never see
  // the pre-load workspace flash (the engine's own onboarding pane is internally
  // gated on the same signal). Fires even if that fetch failed (the workspace falls
  // back to onboarding), so a host overlay can't get stuck. Optional — the
  // trivial self-hosted host omits it.
  onReady?(): void;
}

// Host-overridable surfaces. A handful of the engine's layout regions carry
// deployment-specific guidance (setup snippets, the connect flow, doc links) that
// only fits self-hosted mockpit. The engine wraps each such region in a
// `<slot name="...">` whose fallback content IS the self-hosted default — so a
// plain (host-less) embed and the self-hosted page look identical. An embedder
// (e.g. mockpit cloud) replaces a whole region by projecting a light-DOM child
// with a matching `slot=` attribute into the mount element.
//
// These are *regions*, not individual strings — keep the list small and coarse.
// Adding one is a deliberate contract change shared with every embedder.
export const SLOTS = {
  // Sidebar header: the host-overridable region at the TOP of the sidebar, above
  // the projects list (`.ss-projects`, ProjectNav.tsx). Empty by default (self-hosted shows
  // nothing here); an embedder projects a header — e.g. a cloud workspace picker +
  // a pinned Home link.
  asideHead: "ss:aside-head",
  // Sidebar footer: design-guide / agent-setup links, the connect action, and the
  // theme picker. (`.ss-side-foot`, App.tsx)
  asideFoot: "ss:aside-foot",
  // Empty-sidebar affordance shown in the projects list when no projects exist.
  // (`.ss-projects`, ProjectNav.tsx) Fallback is the self-hosted "no projects
  // yet" line; an embedder projects its own empty-list nudge here. Renders only
  // on an empty (post-load) workspace.
  asideEmpty: "ss:aside-empty",
  // Empty-workspace onboarding shown before any project exists. (App.tsx)
  empty: "ss:empty",
  // Per-item actions in the item header, beside the title/kind line. Empty by
  // default (self-hosted has no actions here); an embedder projects item-scoped
  // controls such as a cloud "Share" button. (`.ss-head`, Item.tsx)
  itemActions: "ss:item-actions",
  // DEPRECATED alias of `itemActions`: the session header it named is gone with
  // the session screen. Both names are rendered in the item header, so an
  // embedder that still projects `ss:session-actions` keeps working.
  sessionActions: "ss:session-actions",
  // The whole main content pane (onboarding + the item screen). Fallback is the
  // engine's normal workspace; an embedder projects a full-pane view here — e.g. a
  // cloud "Settings" page — to take over the main area while the sidebar (session
  // list, account footer) stays put. Unlike the always-on footer/empty overrides,
  // this is meant to be projected *conditionally*: project a child only while the
  // host view is active, and the engine falls back to the workspace when it's gone.
  // (`<main>`, App.tsx)
  main: "ss:main",
} as const;

export type SlotName = (typeof SLOTS)[keyof typeof SLOTS];

type EngineRoot = Document | ShadowRoot;

let engineRoot: EngineRoot = document;
let injectedHost: MockpitHost | null = null;
let defaultHostCache: MockpitHost | null = null;

// Called once by mountViewer before <App/> renders, to point the engine at a
// shadow root + the embedder's host.
export function setEngine(root: EngineRoot, host: MockpitHost): void {
  engineRoot = root;
  injectedHost = host;
}

// The DOM root the engine queries/scopes to: `document` self-hosted, the shadow
// root when embedded. Both support querySelector/querySelectorAll/activeElement.
export function root(): EngineRoot {
  return engineRoot;
}

export function isShadow(): boolean {
  return engineRoot !== document;
}

// Where to append the engine's <style> nodes (theme palette): the <head> for a
// document, the shadow root itself when embedded.
export function styleContainer(): Node & ParentNode {
  return engineRoot instanceof Document ? engineRoot.head : engineRoot;
}

// The element carrying inherited theme vars / drawer class. Self-hosted that is
// <html> for vars and <body> for the drawer class (matching the existing
// `body.nav-open` rule); embedded it's the shadow host for both.
export function rootElement(): HTMLElement {
  return engineRoot instanceof Document
    ? engineRoot.documentElement
    : (engineRoot.host as HTMLElement);
}

// Element to toggle the mobile-drawer class on. Self-hosted: <body> (the CSS
// rule is `body.nav-open`). Embedded: the shadow host.
export function navHostEl(): HTMLElement {
  return engineRoot instanceof Document ? engineRoot.body : (engineRoot.host as HTMLElement);
}

// Element to read computed theme vars / fonts from. Self-hosted <body> inherits
// the :root vars AND carries the body font; embedded the shadow host carries the
// :host vars. (A document's <body> is the faithful probe for self-host parity.)
export function probeEl(): HTMLElement {
  return engineRoot instanceof Document ? engineRoot.body : (engineRoot.host as HTMLElement);
}

export function host(): MockpitHost {
  if (injectedHost) return injectedHost;
  return (defaultHostCache ??= createDefaultHost());
}

// Self-hosted default host: base path from the hosted-wrapper global (set by any
// wrapper before the engine loads; empty at root), routing over the History API.
// Writes canonical URL shapes (/session/:id and /session/:id/p/:pid) and still
// parses the legacy /s/ spellings on the way in.
export function createDefaultHost(): MockpitHost {
  const basePath = window.__MOCKPIT_BASE_PATH__ ?? "";
  const subs = new Set<(r: Route) => void>();

  const get = (): Route => {
    const rest = location.pathname.startsWith(basePath)
      ? location.pathname.slice(basePath.length)
      : location.pathname;
    const query = new URLSearchParams(location.search);
    const qSurface = query.get("surface") ?? undefined;
    // /project/:name[/:slug] — the project name may itself contain a slash
    // (owner/repo), so it is percent-encoded into one path segment.
    const item = rest.match(/^\/project\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (item) {
      const version = Number(query.get("v"));
      return {
        project: decodeURIComponent(item[1]),
        slug: item[2] ? decodeURIComponent(item[2]) : null,
        variant: query.get("variant"),
        version: Number.isFinite(version) && version > 0 ? version : null,
      };
    }
    const m = rest.match(/^\/session\/([^/]+)(?:\/[sp]\/([^/]+))?/);
    if (m) return { sessionId: m[1], surfaceId: m[2] ?? qSurface };
    const surfaceOnly = rest.match(/^\/[sp]\/([^/]+)/);
    if (surfaceOnly) return { surfaceId: surfaceOnly[1] };
    return { surfaceId: qSurface };
  };

  const urlFor = (to: Route): string => {
    if (to.project) {
      const base = `${basePath}/project/${encodeURIComponent(to.project)}`;
      return to.slug ? `${base}/${encodeURIComponent(to.slug)}` : base;
    }
    if (!to.sessionId) return to.surfaceId ? `${basePath}/p/${to.surfaceId}` : basePath || "/";
    return to.surfaceId
      ? `${basePath}/session/${to.sessionId}/p/${to.surfaceId}`
      : `${basePath}/session/${to.sessionId}`;
  };

  // Variant + browsed version live in the query so the item path stays the
  // item's identity (and a copied link restores exactly what was on screen).
  const queryFor = (to: Route): string => {
    if (!to.project || !to.slug) return "";
    const q = new URLSearchParams();
    if (to.variant) q.set("variant", to.variant);
    if (to.version) q.set("v", String(to.version));
    const s = q.toString();
    return s ? `?${s}` : "";
  };

  const navigate = (to: Route, opts?: { replace?: boolean }): void => {
    const target = urlFor(to) + queryFor(to);
    const here = location.pathname + location.search;
    if (opts?.replace) {
      history.replaceState(null, "", target);
    } else if (here !== target) {
      history.pushState(null, "", target);
    }
    for (const cb of subs) cb(get());
  };

  window.addEventListener("popstate", () => {
    const r = get();
    for (const cb of subs) cb(r);
  });

  return {
    basePath,
    router: {
      get,
      navigate,
      subscribe: (cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    },
  };
}

declare global {
  interface Window {
    __MOCKPIT_BASE_PATH__?: string;
  }
}
