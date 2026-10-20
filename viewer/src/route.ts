// URL ⇄ screen. Home is /project/:name, a mock is /project/:name/:slug; "/" is
// the home of the most recently active project. On Home, `?view=picks` shows
// every accepted design and `?focus=<slug>` opens on that mock's place in the tree.

import { createSignal } from "solid-js";
import { basePath, host } from "./host.ts";

export type Route =
  | { screen: "home"; project: string | null; view: "tree" | "picks"; focus: string | null }
  | {
      screen: "mock";
      project: string;
      slug: string;
      // Open on this state and variant (a tile on the canvas, Picks, the tree).
      open: { state: string | null; variant: string } | null;
    };

export function parseRoute(pathname: string, base = "", search = ""): Route {
  const path = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const seg = path.split("/").filter(Boolean);
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const q = new URLSearchParams(search);
  const home = (project: string | null): Route => ({
    screen: "home",
    project,
    view: q.get("view") === "picks" ? "picks" : "tree",
    focus: q.get("focus") || null,
  });
  if (seg[0] === "project" && seg[1]) {
    if (seg[2]) {
      const variant = q.get("variant");
      return {
        screen: "mock",
        project: dec(seg[1]),
        slug: dec(seg[2]),
        open: variant ? { state: q.get("state"), variant } : null,
      };
    }
    return home(dec(seg[1]));
  }
  return home(null);
}

export const projectPath = (project: string) =>
  `${basePath()}/project/${encodeURIComponent(project)}`;
export const mockPath = (
  project: string,
  slug: string,
  open?: { state: string | null; variant: string },
) => {
  const base = `${projectPath(project)}/${encodeURIComponent(slug)}`;
  if (!open) return base;
  const q = new URLSearchParams({ variant: open.variant });
  if (open.state !== null) q.set("state", open.state);
  return `${base}?${q}`;
};
export const picksPath = (project: string) => `${projectPath(project)}?view=picks`;
export const focusPath = (project: string, slug: string) =>
  `${projectPath(project)}?focus=${encodeURIComponent(slug)}`;

const key = (r: Route) => JSON.stringify(r);
const read = () => parseRoute(host().location.pathname, basePath(), host().location.search);
const [route, setRoute] = createSignal<Route>(read(), { equals: (a, b) => key(a) === key(b) });
export { route };

host().window.addEventListener("popstate", () => setRoute(read()));

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  const h = host().history;
  if (opts.replace) h.replaceState(null, "", path);
  else h.pushState(null, "", path);
  setRoute(read());
}

// `?key=` only bootstraps the cookie, which the server set on this very load.
// Left in the URL it rides into history, copied links and an installed app's
// address, so the URL without it, or null when there is none.
export function withoutKey(href: string): string | null {
  const u = new URL(href);
  if (!u.searchParams.has("key")) return null;
  u.searchParams.delete("key");
  return `${u.pathname}${u.search}${u.hash}`;
}

export function dropKeyParam() {
  const next = withoutKey(host().location.href);
  if (next !== null) host().history.replaceState(host().history.state, "", next);
}

// Plain left clicks on our own links stay in the app; modified clicks open tabs.
export function linkClick(e: MouseEvent, path: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  e.preventDefault();
  navigate(path);
}
