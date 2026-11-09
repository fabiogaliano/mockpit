// URL ⇄ screen. The Board is /project/:name: one page of it, `?page=` (an area; absent,
// the project's first), or `?unsorted=1` for the screens no area claims, with `?sel=`
// (`slug:state`, or `slug` for a design of one unnamed state) the frame it opens fit to.
// "/" is the Board of the most recently active project. A design's own link,
// /project/:name/:slug with an optional `?state=`, lands on the Board too, fit to that
// design or state and selected: it is the link agents and the viewer hand out. The
// Library's and Exploring's pages are `?sec=` inside the Board's frame: components,
// shared, system, documents, ideas (`?for=` narrows them to one design's), archive and
// recent (`?show=`).
// The design screen is the same address with `?focus=1`, or with anything narrower than a
// state the Board can't show (`?alternative=`, `?version=`), or a `?view=` or `?owed=` of
// its own. It keeps `?state=`, `?alternative=`, `?version=` and `?view=` current, so Back
// and a reload land where the entry was.

import { createSignal } from "solid-js";
import { basePath, host } from "./host.ts";

export const HOME_PLACES = [
  "ideas",
  "components",
  "documents",
  "shared",
  "system",
  "archive",
  "recent",
] as const;
export type HomePlace = (typeof HOME_PLACES)[number];
const isHomePlace = (v: string | null): v is HomePlace => HOME_PLACES.includes(v as HomePlace);
export type RecentShow = "decisions" | "designs";
const isRecentShow = (v: string | null): v is RecentShow => v === "decisions" || v === "designs";

// A frame on the Board: one state of a design, or all of it (`state` undefined).
export interface BoardSel {
  slug: string;
  state?: string | null;
}

export type Route =
  | {
      screen: "board";
      project: string | null;
      // An area's name; null: the project's first page, or the one `sel` is on.
      page: string | null;
      // The screens no area claims.
      unsorted: boolean;
      sel: BoardSel | null;
      // A Library or Exploring page in the Board's frame; null: the canvas.
      sec: HomePlace | null;
      // null: all of recent.
      show: RecentShow | null;
      // The ideas for one design, by slug; null: every idea.
      for: string | null;
    }
  | {
      screen: "design";
      project: string;
      slug: string;
      // Open on this state, and this alternative when named (a step of a flow or a
      // screen on Home names the state alone).
      open: ScreenOpen | null;
      // The flow the user came through, which the flow bar keeps to.
      flow: string | null;
    }
  | { screen: "missing" };

export type ScreenOpen = {
  state: string | null;
  alternative: string | null;
  version?: number | null;
};
export type DesignRoute = Extract<Route, { screen: "design" }>;

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
  // A design's own link names no page: the Board finds the one it is on.
  const board = (project: string | null, sel: BoardSel | null, ownLink = false): Route => ({
    screen: "board",
    project,
    page: ownLink ? null : q.get("page") || null,
    unsorted: !ownLink && q.get("unsorted") === "1",
    sel,
    sec: ownLink ? null : isHomePlace(q.get("sec")) ? (q.get("sec") as HomePlace) : null,
    show: isRecentShow(q.get("show")) ? (q.get("show") as RecentShow) : null,
    for: q.get("for") || null,
  });
  if (seg.length && (seg[0] !== "project" || !seg[1] || seg.length > 3)) {
    return { screen: "missing" };
  }
  if (seg[0] === "project" && seg[1]) {
    if (seg[2] && !FOCUS_KEYS.some((k) => q.has(k))) {
      return board(dec(seg[1]), {
        slug: dec(seg[2]),
        ...(q.has("state") ? { state: q.get("state") } : {}),
      });
    }
    if (seg[2]) {
      const alternative = q.get("alternative");
      const version = Number(q.get("version"));
      return {
        screen: "design",
        project: dec(seg[1]),
        slug: dec(seg[2]),
        open:
          alternative || q.has("state")
            ? {
                state: q.get("state"),
                alternative: alternative || null,
                version: Number.isInteger(version) && version > 0 ? version : null,
              }
            : null,
        flow: q.get("flow") || null,
      };
    }
    return board(dec(seg[1]), parseSel(q.get("sel")));
  }
  return board(null, null);
}

// What makes a design's address its own screen rather than a place on the Board.
const FOCUS_KEYS = ["focus", "view", "owed", "alternative", "version"];

// `slug:state`; a slug never holds a colon, a state may.
function parseSel(raw: string | null): BoardSel | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  return at < 0 ? { slug: raw, state: null } : { slug: raw.slice(0, at), state: raw.slice(at + 1) };
}

export const boardPath = (
  project: string,
  place: { page?: string | null; unsorted?: boolean; sel?: BoardSel | null } = {},
) => {
  const q = new URLSearchParams();
  if (place.unsorted) q.set("unsorted", "1");
  else if (place.page) q.set("page", place.page);
  if (place.sel) {
    const st = place.sel.state;
    q.set("sel", st === undefined || st === null ? place.sel.slug : `${place.sel.slug}:${st}`);
  }
  const qs = q.toString();
  return `${basePath()}/project/${encodeURIComponent(project)}${qs ? `?${qs}` : ""}`;
};

export const projectPath = (
  project: string,
  sec: HomePlace | null = null,
  show: RecentShow | null = null,
  forSlug: string | null = null,
) => {
  const q = new URLSearchParams();
  if (sec) q.set("sec", sec);
  if (show) q.set("show", show);
  if (forSlug) q.set("for", forSlug);
  const qs = q.toString();
  return `${basePath()}/project/${encodeURIComponent(project)}${qs ? `?${qs}` : ""}`;
};
export const designPath = (
  project: string,
  slug: string,
  open?: ScreenOpen | null,
  flow?: string | null,
  view?: string | null,
  focus = false,
) => {
  const base = `${projectPath(project)}/${encodeURIComponent(slug)}`;
  const q = new URLSearchParams();
  if (focus) q.set("focus", "1");
  if (open?.alternative) q.set("alternative", open.alternative);
  if (open?.version) q.set("version", String(open.version));
  if (open && open.state !== null) q.set("state", open.state);
  if (flow) q.set("flow", flow);
  if (view) q.set("view", view);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
};
// The design itself, on its own screen: Open from the Board.
export const focusPath = (project: string, slug: string, open?: ScreenOpen | null) =>
  designPath(project, slug, open, null, null, true);
// Straight to what a design still asks: on Stage, on its first open question,
// wherever this browser last left it, or on the one named.
export const questionPath = (project: string, slug: string, question?: string) =>
  `${designPath(project, slug)}?view=stage&owed=1${question ? `&question=${encodeURIComponent(question)}` : ""}`;
export const rootPath = () => `${basePath()}/`;
// Up from a design: the Board's page it is on (its area), or the project's first.
export const homePath = (project: string, area: string | null = null) =>
  boardPath(project, { page: area });

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
