// URL ⇄ screen. Home is /project/:name, a mock is /project/:name/:slug; "/" is
// the home of the most recently active project. Home's tab is `?view=`: all,
// pages, flows, components or sketches; absent, or a tab the project lacks, is
// its first. `?area=` narrows Home to one of the project's areas.

import { createSignal } from "solid-js";
import { basePath, host } from "./host.ts";

export const HOME_VIEWS = ["all", "pages", "flows", "components", "sketches"] as const;
export type HomeView = (typeof HOME_VIEWS)[number];
const isHomeView = (v: string | null): v is HomeView => HOME_VIEWS.includes(v as HomeView);

export type Route =
  | {
      screen: "home";
      project: string | null;
      // null: the first tab the project has.
      view: HomeView | null;
      // null: every area.
      area: string | null;
    }
  | {
      screen: "mock";
      project: string;
      slug: string;
      // Open on this state, and this variant when named (a step of a flow or a
      // screen on Home names the state alone).
      open: ScreenOpen | null;
      // The flow the user came through, which the flow bar keeps to.
      flow: string | null;
    };

export type ScreenOpen = { state: string | null; variant: string | null };

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
    view: isHomeView(q.get("view")) ? (q.get("view") as HomeView) : null,
    area: q.get("area") || null,
  });
  if (seg[0] === "project" && seg[1]) {
    if (seg[2]) {
      const variant = q.get("variant");
      return {
        screen: "mock",
        project: dec(seg[1]),
        slug: dec(seg[2]),
        open:
          variant || q.has("state") ? { state: q.get("state"), variant: variant || null } : null,
        flow: q.get("flow") || null,
      };
    }
    return home(dec(seg[1]));
  }
  return home(null);
}

export const projectPath = (
  project: string,
  view: HomeView | null = null,
  area: string | null = null,
) => {
  const q = new URLSearchParams();
  if (view) q.set("view", view);
  if (area) q.set("area", area);
  const qs = q.toString();
  return `${basePath()}/project/${encodeURIComponent(project)}${qs ? `?${qs}` : ""}`;
};
export const mockPath = (
  project: string,
  slug: string,
  open?: ScreenOpen | null,
  flow?: string | null,
) => {
  const base = `${projectPath(project)}/${encodeURIComponent(slug)}`;
  const q = new URLSearchParams();
  if (open?.variant) q.set("variant", open.variant);
  if (open && open.state !== null) q.set("state", open.state);
  if (flow) q.set("flow", flow);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
};
// The tab and area Home was last on, per project, so Back from a mock returns to it.
const lastView = new Map<string, { view: HomeView | null; area: string | null }>();
export const rememberHomeView = (project: string, view: HomeView | null, area: string | null) =>
  lastView.set(project, { view, area });
export const homePath = (project: string) =>
  projectPath(project, lastView.get(project)?.view ?? null, lastView.get(project)?.area ?? null);

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
