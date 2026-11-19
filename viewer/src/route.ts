// URL ⇄ screen. The Board is /project/:name: one page of it, `?page=` (an area; absent,
// the project's first), or `?unsorted=1` for the screens no area claims, with `?sel=`
// (`slug:state`, or `slug` for the whole design) the frame it opens fit to.
// "/" is the Board of the most recently active project. A design's own link,
// /project/:name/:slug with an optional `?state=`, lands on the Board too, fit to that
// design or state and selected: it is the link agents and the viewer hand out. The
// Library's and Exploring's pages are `?sec=` inside the Board's frame: components,
// shared, system, documents, archive and recent (`?show=`); ideas is a canvas of its own,
// each idea a section (`?for=` narrows it to one design's).
// Focus, the design's own screen, is the same address entered from the Board (Enter, a
// double-click, Open) or from a question in Needs you: the history entry says so, never
// the address, so every link anyone copies or sends lands on the Board, while Back,
// Forward and a reload keep Focus. Focus keeps `?state=`, `?alternative=` and `?version=`
// current, reads `?owed=` and `?present=` once on entry, and goes to `?question=` whenever
// the address names one.

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

// A frame on the Board: one state of a design, or all of it (`state` undefined); on an
// idea or a variants design, one alternative's (`?alt=`).
export interface BoardSel {
  slug: string;
  state?: string | null;
  alternative?: string;
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
      // screen's frame on the Board names the state alone).
      open: ScreenOpen | null;
      // The flow the user came through, which the flow bar keeps to.
      flow: string | null;
      // A question Needs you named, until Focus has gone to it.
      question: string | null;
      // Open on the sheet (sheet.ts): the knob across, null for the looks, the one
      // frame down if not all of them, and the focused value when inspecting a cell.
      sheet: { knob: string | null; one: string | null; value: string | null } | null;
    }
  | { screen: "missing" };

// A sheet address's word for the looks across, which no knob path can be.
export const SHEET_LOOKS = "@looks";

export type ScreenOpen = {
  state: string | null;
  alternative: string | null;
  version?: number | null;
};
export type DesignRoute = Extract<Route, { screen: "design" }>;

export function parseRoute(pathname: string, base = "", search = "", focus = false): Route {
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
    // A sheet's link is for laying frames out, which only Focus does.
    if (seg[2] && !focus && !q.has("sheet")) {
      return board(dec(seg[1]), {
        slug: dec(seg[2]),
        ...(q.has("state") ? { state: q.get("state") } : {}),
        ...(q.get("alternative") ? { alternative: q.get("alternative")! } : {}),
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
        question: q.get("question") || null,
        sheet: q.has("sheet")
          ? {
              knob: [SHEET_LOOKS, ""].includes(q.get("sheet")!) ? null : q.get("sheet"),
              one: q.get("one") || null,
              value: q.get("value") || null,
            }
          : null,
      };
    }
    const sel = parseSel(q.get("sel"));
    const alt = q.get("alt");
    return board(dec(seg[1]), sel && alt ? { ...sel, alternative: alt } : sel);
  }
  return board(null, null);
}

// `slug:state`, or `slug` for the whole design; a slug never holds a colon, a state may.
function parseSel(raw: string | null): BoardSel | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  return at < 0 ? { slug: raw } : { slug: raw.slice(0, at), state: raw.slice(at + 1) };
}

// `ideas` is the Ideas page, all of them or (`for`) one design's.
export const boardPath = (
  project: string,
  place: {
    page?: string | null;
    unsorted?: boolean;
    ideas?: boolean;
    for?: string | null;
    sel?: BoardSel | null;
  } = {},
) => {
  const q = new URLSearchParams();
  if (place.ideas) {
    q.set("sec", "ideas");
    if (place.for) q.set("for", place.for);
  } else if (place.unsorted) q.set("unsorted", "1");
  else if (place.page) q.set("page", place.page);
  if (place.sel) {
    const st = place.sel.state;
    q.set("sel", st === undefined || st === null ? place.sel.slug : `${place.sel.slug}:${st}`);
    if (place.sel.alternative) q.set("alt", place.sel.alternative);
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
) => {
  const base = `${projectPath(project)}/${encodeURIComponent(slug)}`;
  const q = new URLSearchParams();
  if (open?.alternative) q.set("alternative", open.alternative);
  if (open?.version) q.set("version", String(open.version));
  if (open && open.state !== null) q.set("state", open.state);
  if (flow) q.set("flow", flow);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
};
// Straight to what a design still asks, in Focus: its first open question, wherever this
// browser last left it, or the one named.
export const questionPath = (project: string, slug: string, question?: string) =>
  `${designPath(project, slug)}?owed=1${question ? `&question=${encodeURIComponent(question)}` : ""}`;
export const rootPath = () => `${basePath()}/`;
// Up from a design: the Board's page it is on (its area), or the project's first.
export const homePath = (project: string, area: string | null = null) =>
  boardPath(project, { page: area });

const key = (r: Route) => JSON.stringify(r);
// The entry's own record: Focus, and whatever the design screen keeps there for Back.
const inFocus = () => {
  const st: unknown = host().history.state;
  return !!st && typeof st === "object" && (st as { focus?: unknown }).focus === true;
};
const read = () =>
  parseRoute(host().location.pathname, basePath(), host().location.search, inFocus());
const [route, setRoute] = createSignal<Route>(read(), { equals: (a, b) => key(a) === key(b) });
export { route };

host().window.addEventListener("popstate", () => setRoute(read()));

// `focus` opens the design at `path` in Focus; anything else lands on the Board.
export function navigate(path: string, opts: { replace?: boolean; focus?: boolean } = {}) {
  const h = host().history;
  // Focus opened from the Board keeps the Board's address, so going back up can be Back;
  // a Focus entry replaced in place keeps it.
  const from =
    opts.focus && !opts.replace && route().screen === "board"
      ? { from: `${host().location.pathname}${host().location.search}` }
      : opts.replace
        ? cameFrom()
        : {};
  const entry = opts.focus ? { focus: true, ...from } : null;
  if (opts.replace) h.replaceState(entry, "", path);
  else h.pushState(entry, "", path);
  setRoute(read());
}

// The Board's address the Focus entry on screen was opened from, as its history state keeps
// it: `{ from }`, or nothing when Focus wasn't opened from the Board.
export function cameFrom(): { from?: string } {
  const st: unknown = host().history.state;
  const from = st && typeof st === "object" ? (st as { from?: unknown }).from : undefined;
  return typeof from === "string" ? { from } : {};
}

// A frame picked on the Board is a step of its own, so Back lets go of it. The entry says
// so, for letting go by hand to go back to the entry before it instead of leaving two of
// the same address.
export function pushSelection(path: string) {
  host().history.pushState({ selection: true }, "", path);
  setRoute(read());
}

export function dropSelection(path: string) {
  const st: unknown = host().history.state;
  if (st && typeof st === "object" && (st as { selection?: unknown }).selection === true)
    host().history.back();
  else replaceUrl(path);
}

// The current entry's address changes with no step in history.
export function replaceUrl(path: string) {
  host().history.replaceState(host().history.state, "", path);
  setRoute(read());
}

// Push a step within Focus (One ↔ Sheet, knob tab switches, Sheet ↔ Cell), keeping
// Focus's history state (`focus: true` and `from`) so Back/Forward stays in Focus.
export function pushUrl(path: string) {
  const st = host().history.state;
  const entry = st && typeof st === "object" ? { ...st } : { focus: true, ...cameFrom() };
  host().history.pushState(entry, "", path);
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

// Plain left clicks on our own links stay in the app; modified clicks open tabs, which
// land on the Board as any link does. `focus` takes a plain click into Focus.
export function linkClick(e: MouseEvent, path: string, focus = false) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  e.preventDefault();
  navigate(path, { focus });
}
