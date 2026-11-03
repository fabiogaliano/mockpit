// URL ⇄ screen. Home is /project/:name, a mock is /project/:name/:slug; "/" is
// the home of the most recently active project. Home's place is `?sec=`: a
// section (ideas, screens, flows, components, documents), or needs, decisions,
// archive or activity; absent, or a section the project hasn't lit, is its first.
// `?area=` alone is everything in one of the project's areas, and with `?sec=`
// that section of it. On a mock the URL is the whole place: `?state=`,
// `?variant=`, `?version=`, `?view=`. The mock screen keeps them current, so Back
// and a reload land where the entry was.

import { createSignal } from "solid-js";
import { basePath, host } from "./host.ts";

export const HOME_PLACES = [
  "ideas",
  "screens",
  "flows",
  "components",
  "documents",
  "needs",
  "decisions",
  "archive",
  "activity",
] as const;
export type HomePlace = (typeof HOME_PLACES)[number];
const isHomePlace = (v: string | null): v is HomePlace => HOME_PLACES.includes(v as HomePlace);

export type Route =
  | {
      screen: "home";
      project: string | null;
      // null: the first section the project has lit, or all of one area.
      sec: HomePlace | null;
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
    }
  | { screen: "missing" };

export type ScreenOpen = { state: string | null; variant: string | null; version?: number | null };
export type MockRoute = Extract<Route, { screen: "mock" }>;

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
    sec: isHomePlace(q.get("sec")) ? (q.get("sec") as HomePlace) : null,
    area: q.get("area") || null,
  });
  if (seg.length && (seg[0] !== "project" || !seg[1] || seg.length > 3)) {
    return { screen: "missing" };
  }
  if (seg[0] === "project" && seg[1]) {
    if (seg[2]) {
      const variant = q.get("variant");
      const version = Number(q.get("version"));
      return {
        screen: "mock",
        project: dec(seg[1]),
        slug: dec(seg[2]),
        open:
          variant || q.has("state")
            ? {
                state: q.get("state"),
                variant: variant || null,
                version: Number.isInteger(version) && version > 0 ? version : null,
              }
            : null,
        flow: q.get("flow") || null,
      };
    }
    return home(dec(seg[1]));
  }
  return home(null);
}

export const projectPath = (
  project: string,
  sec: HomePlace | null = null,
  area: string | null = null,
) => {
  const q = new URLSearchParams();
  if (sec) q.set("sec", sec);
  if (area) q.set("area", area);
  const qs = q.toString();
  return `${basePath()}/project/${encodeURIComponent(project)}${qs ? `?${qs}` : ""}`;
};
export const mockPath = (
  project: string,
  slug: string,
  open?: ScreenOpen | null,
  flow?: string | null,
  view?: string | null,
) => {
  const base = `${projectPath(project)}/${encodeURIComponent(slug)}`;
  const q = new URLSearchParams();
  if (open?.variant) q.set("variant", open.variant);
  if (open?.version) q.set("version", String(open.version));
  if (open && open.state !== null) q.set("state", open.state);
  if (flow) q.set("flow", flow);
  if (view) q.set("view", view);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
};
// Straight to what a mock still asks: on Stage, on its first open question,
// wherever this browser last left it.
export const questionPath = (project: string, slug: string) =>
  `${mockPath(project, slug)}?view=stage&owed=1`;
// The place on Home last shown, per project, so going up from a mock lands there.
const lastPlace = new Map<string, { sec: HomePlace | null; area: string | null }>();
export const rememberHomePlace = (project: string, sec: HomePlace | null, area: string | null) =>
  lastPlace.set(project, { sec, area });
export const rootPath = () => `${basePath()}/`;
// The project's crumb means the whole project, in the section last open. An area
// crumb means everything in that area, unless that's the area you came from: the
// mock it names may not be in the section last open, which would land on nothing.
export const homePath = (project: string, area: string | null = null) => {
  const last = lastPlace.get(project);
  const sec = area === null || last?.area === area ? (last?.sec ?? null) : null;
  return projectPath(project, sec, area);
};

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

// The current entry's address changes with no step in history.
export function replaceUrl(path: string) {
  host().history.replaceState(host().history.state, "", path);
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
