// URL ⇄ screen. Home is /project/:name, a mock is /project/:name/:slug; "/" is
// the home of the most recently active project.

import { createSignal } from "solid-js";
import { basePath, host } from "./host.ts";

export type Route =
  | { screen: "home"; project: string | null }
  | { screen: "mock"; project: string; slug: string };

export function parseRoute(pathname: string, base = ""): Route {
  const path = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const seg = path.split("/").filter(Boolean);
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  if (seg[0] === "project" && seg[1]) {
    if (seg[2]) return { screen: "mock", project: dec(seg[1]), slug: dec(seg[2]) };
    return { screen: "home", project: dec(seg[1]) };
  }
  return { screen: "home", project: null };
}

export const projectPath = (project: string) =>
  `${basePath()}/project/${encodeURIComponent(project)}`;
export const mockPath = (project: string, slug: string) =>
  `${projectPath(project)}/${encodeURIComponent(slug)}`;

const key = (r: Route) => JSON.stringify(r);
const read = () => parseRoute(host().location.pathname, basePath());
const [route, setRoute] = createSignal<Route>(read(), { equals: (a, b) => key(a) === key(b) });
export { route };

host().window.addEventListener("popstate", () => setRoute(read()));

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  const h = host().history;
  if (opts.replace) h.replaceState(null, "", path);
  else h.pushState(null, "", path);
  setRoute(read());
}

// Plain left clicks on our own links stay in the app; modified clicks open tabs.
export function linkClick(e: MouseEvent, path: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  e.preventDefault();
  navigate(path);
}
