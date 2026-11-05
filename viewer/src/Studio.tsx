// Studio: the state zoomed out, every variant side by side with its newest
// version on top, for exploring before anything is in use. A click looks
// closer without leaving: one version large, flipped through in reading order;
// Stage, where answers are, is a deliberate step from there. What's hidden, archived or
// in use is picked from the bar, and lists as cards. A fork is a column of its own beside the one it came from,
// saying so: the lineage is the agent's data, and nothing here is grouped by hand.
// Each steer (more like this, a comment, a borrow) is its own reply.
// On a phone there is no room for a grid of one state: every state's columns
// run as one strip, a card per swipe, and the state under the snap is the one
// on stage, so the bar's tabs name where you are instead of paging.
// A lab past WALL_FROM opens on a wall instead: one grid of every state's designs,
// narrowed by state, by what is in use, archived or hidden and by text, with a
// preview beside it where there is room and the closer look where there isn't. The
// columns are a click away, and they and everything else here are the same code. The
// controls for all of it are one row in the design's header (StudioBar).

import { Portal } from "solid-js/web";
import { isLive, isSandboxedSurfaceKind } from "../../server/types.ts";
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type JSX,
  For,
  mapArray,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { CopyRef } from "../../server/types.ts";
import { AddCandidates } from "./AddCandidates.tsx";
import { api, assetUrl, surfaceUrl, type VariantView } from "./api.ts";
import { host, readonly } from "./host.ts";
import { Icon } from "./icons.tsx";
import {
  CANVAS_MAX,
  foldText,
  sameVersion,
  versionName,
  versionSteps,
  type VersionRef,
  type VersionStep,
  keepSame,
  stepKey,
  nextKept,
  WALL_FROM,
  WALL_PREVIEW_MIN_W,
  wallCard,
  wallPreviewW,
} from "./logic.ts";
import type { DesignScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { FullView } from "./FullView.tsx";
import { Thumb } from "./Thumb.tsx";
import { linkClick, designPath } from "./route.ts";
import { Reason } from "./Reason.tsx";
import type { Shortlists } from "./shortlist.ts";
import { SaveMenu, type SaveFor } from "./SaveMenu.tsx";
import { SelectBar } from "./SelectBar.tsx";
import { StudioBar, type BarTab } from "./StudioBar.tsx";
import { usePopover } from "./popover.ts";
import { coarse, phoneLayout, win } from "./viewport.ts";

// The agent's still of the page: an image costs no live frame, so it is
// always shown and never counts against the budget.
const Poster = (props: { id: string }) => (
  <img class="sk-poster" src={assetUrl(props.id)} alt="" loading="lazy" decoding="async" />
);

// Without a poster, an image surface is still cheaper than the page. A document has
// neither, and its text is the picture of it.
export function pictureOf(st: VersionStep): string | null {
  const picture = st.kinds.includes("image") ? st.kinds.indexOf("image") : st.kinds.indexOf("html");
  const i = picture >= 0 ? picture : st.kinds.findIndex(isSandboxedSurfaceKind);
  return i < 0
    ? null
    : surfaceUrl(st.postId, i, { version: st.version, mode: theme(), w: st.rewrites });
}

// Full screen is the page itself, live, so the version's own html comes first;
// an image surface is the next best thing.
function pageOf(st: VersionStep): string | null {
  const i = st.kinds.includes("html") ? st.kinds.indexOf("html") : st.kinds.indexOf("image");
  return i < 0
    ? null
    : surfaceUrl(st.postId, i, { version: st.version, mode: theme(), w: st.rewrites });
}

type Draft = { kind: "comment" | "borrow"; to: VersionStep; from?: VersionStep };
type Acts = Record<
  | "look"
  | "closer"
  | "restore"
  | "full"
  | "open"
  | "more"
  | "comment"
  | "borrow"
  | "pick"
  | "remove",
  (st: VersionStep) => void
> & {
  saved: (st: VersionStep) => boolean;
  // `leave` is how it goes from here, for a view that has to step off it first.
  save: (st: VersionStep, from: HTMLElement, leave?: SaveFor["leave"]) => void;
  leave: (st: VersionStep) => ReturnType<SaveFor["leave"]>;
  family: (st: VersionStep) => VersionStep[];
  selecting: () => boolean;
  selected: (st: VersionStep) => boolean;
  select: (st: VersionStep, e: MouseEvent) => void;
};

// What one state shows: its variants as columns, each down its versions.
// Everything here reads the board's own state rather than the one on stage,
// since a phone's strip draws every state at once.
type Board = ReturnType<typeof boardOf>;
function boardOf(s: DesignScreenState, state: string | null) {
  const inState = createMemo(() => s.variants().filter((v) => v.state === state));
  const allSteps = createMemo<VersionStep[]>(
    (was) => keepSame(was, versionSteps(s.variants(), state), stepKey),
    [],
  );
  const drawnOf = (variant: string) =>
    allSteps()
      .filter((st) => st.variant === variant && !st.hidden)
      .reverse();
  // What's still in play, which is what decides whether a × hides or archives.
  const versionsOf = drawnOf;
  const live = (v: VariantView) => isLive(v.status);
  const isFork = (v: VariantView) =>
    !!v.forkedFrom &&
    live(v) &&
    inState().some((p) => p.variant === v.forkedFrom?.variant && live(p));
  // Roots in the order they were made, each followed by its forks.
  const columns = createMemo(() => {
    const vs = inState().filter((v) => live(v) && drawnOf(v.variant).length);
    const out: VariantView[] = [];
    const visit = (v: VariantView) => {
      if (out.includes(v)) return;
      out.push(v);
      for (const c of vs) if (c.forkedFrom?.variant === v.variant) visit(c);
    };
    for (const v of vs)
      if (!v.forkedFrom || !vs.some((p) => p.variant === v.forkedFrom?.variant)) visit(v);
    for (const v of vs) visit(v);
    return out;
  });
  const inUse = (): VersionRef | null => {
    const u = s.design()?.inUse.find((x) => x.state === state);
    return u ? { variant: u.variant, version: u.version } : null;
  };
  // "Dark #2", or "#2" while the state has one variant.
  const nameOf = (ref: VersionRef) => versionName(ref, inState().length > 1);
  // What is in use stays: only a new choice moves it.
  const isUsed = (variant: string) => inUse()?.variant === variant;
  const aside = createMemo(() => inState().filter((v) => !live(v) && versionsOf(v.variant).length));
  // What was forked from this version, which moves along with it, as `move` moves it
  // for an agent.
  const familyOf = (st: VersionStep) =>
    inState()
      .filter(
        (v) =>
          live(v) && v.forkedFrom?.variant === st.variant && v.forkedFrom.version === st.version,
      )
      .flatMap((v) => versionsOf(v.variant));
  // Which the wall can list on purpose. Of an archived variant they went with it.
  const hiddenSteps = () =>
    allSteps().filter(
      (st) => st.hidden && inState().some((v) => v.variant === st.variant && live(v)),
    );
  // What Look closer flips through: the columns left to right, each down its
  // versions, as the eye reads the grid.
  const runs = createMemo(() =>
    columns().map((v) => ({ variant: v.variant, steps: drawnOf(v.variant) })),
  );
  return {
    state,
    columns,
    isUsed,
    drawnOf,
    versionsOf,
    familyOf,
    aside,
    runs,
    hiddenSteps,
    isFork,
    inUse,
    nameOf,
  };
}

// A version as Look closer flips to it: which board it is drawn on decides
// which state goes on stage with it.
type Entry = { b: Board; st: VersionStep };

// What the wall lists. An archived variant is one card, its newest version: what comes
// back is the variant, so a card per version would offer the same Restore many times.
type WallShow = "live" | "use" | "archived" | "hidden";
const FILTER_FROM = 8;
const WALL_SHOWS: { id: WallShow; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "use", label: "In use" },
  { id: "archived", label: "Archived" },
  { id: "hidden", label: "Hidden" },
];
function cardsOf(b: Board, show: WallShow): VersionStep[] {
  if (show === "archived") return b.aside().map((v) => b.versionsOf(v.variant)[0]);
  if (show === "hidden") return b.hiddenSteps();
  const live = b.runs().flatMap((r) => r.steps);
  return show === "use" ? live.filter((st) => sameVersion(b.inUse(), st)) : live;
}

export function Studio(props: {
  s: DesignScreenState;
  onLooking: (openOnStage: (() => void) | null) => void;
  columns: () => boolean;
  // Where the bar goes: the design's header, which a preview doesn't narrow.
  barSlot: HTMLElement | undefined;
  arrange: JSX.Element;
  arrangeable: boolean;
  top: number;
  shortlists: Shortlists;
  onOpen: () => void;
}) {
  const s = props.s;
  const sl = props.shortlists;
  const isShortlist = () => !!s.design()?.shortlist;
  // The designs a gathered idea's candidates came from, to name and link them.
  const [projectDesigns] = createResource(
    () => (isShortlist() ? s.design()?.project : null),
    (project) => api.designs(project),
  );
  const [saving, setSaving] = createSignal<{
    item: SaveFor;
    from: HTMLElement;
    onDone?: () => void;
  } | null>(null);
  const [adding, setAdding] = createSignal(false);
  const boards = mapArray(s.states, (st) => boardOf(s, st));
  const active = () => boards().find((b) => b.state === s.activeState()) ?? boards()[0];
  const readParam = (name: string) => new URLSearchParams(host().window.location.search).get(name);
  const withParam = (name: string, k: string | null) => {
    const w = host().window;
    const q = new URLSearchParams(w.location.search);
    if (k) q.set(name, k);
    else q.delete(name);
    return `${w.location.pathname}?${q}`;
  };
  const key = (st: VersionStep) => `${st.variant}@${st.version}`;
  // Variant names repeat across states, so a frame is told apart by both.
  const frameKey = (b: Board, st: VersionStep) => `${b.state ?? ""}\n${key(st)}`;

  // The wall's filters live in the URL, so Back from Stage finds the wall as it was left.
  const sized = () => s.variants().length >= WALL_FROM;
  const columnsOn = () => !sized() || props.columns();
  // Only what's live has columns: anything else is a list of what to bring back or open.
  const wall = () => !columnsOn() || show() !== "live";
  const strip = () => phoneLayout() && !wall();
  const [statePick, setStatePick] = createSignal(readParam("in"));
  const narrowedTo = () => {
    const m = statePick();
    return s.states().includes(m) ? m : null;
  };
  // Columns are always of one state.
  const within = () => (columnsOn() ? s.activeState() : narrowedTo());
  const [showPick, setShowPick] = createSignal(readParam("show"));
  // A lab with everything archived would otherwise open on nothing.
  // So would one whose last archived variant was just brought back.
  const show = (): WallShow =>
    WALL_SHOWS.find((x) => x.id === showPick() && boards().some((b) => cardsOf(b, x.id).length))
      ?.id ?? (s.variants().some((v) => isLive(v.status)) ? "live" : "archived");
  const [query, setQuery] = createSignal(readParam("find") ?? "");
  const wallText = createMemo(() => {
    const out = new Map<string, string>();
    for (const v of s.variants()) {
      out.set(`${v.state ?? ""}\n${v.variant}`, foldText(`${v.variant}\n${v.description ?? ""}`));
    }
    return out;
  });
  const matches = (b: Board, variant: string) => {
    const q = foldText(query().trim());
    return (
      !q ||
      !!wallText()
        .get(`${b.state ?? ""}\n${variant}`)
        ?.includes(q)
    );
  };
  const wallCards = (b: Board, which: WallShow) =>
    cardsOf(b, which).filter((st) => matches(b, st.variant));
  const columnsIn = (b: Board) => b.columns().filter((v) => matches(b, v.variant));
  const inWithin = (b: Board) => within() === null || b.state === within();
  // Every state's cards stay in the page, a state not picked hidden: its frames keep
  // their documents and their place in the DOM, either of which would reload them.
  const wallMounted = createMemo(() =>
    wall()
      ? boards()
          .map((b) => ({ b, steps: wallCards(b, show()) }))
          .filter((x) => x.steps.length > 0)
      : [],
  );
  const wallMap = createMemo(() => wallMounted().filter((x) => inWithin(x.b)));
  // The states alone, which stay the same objects: a keystroke mustn't remount a grid.
  const wallSections = createMemo(() => wallMounted().map((x) => x.b));
  const wallStates = createMemo(() => wallMap().map((x) => x.b));
  const stepsIn = (b: Board) => wallMounted().find((x) => x.b === b)?.steps ?? [];
  const goneShown = (): "archived" | "hidden" | undefined => {
    if (!wall()) return undefined;
    const now = show();
    return now === "archived" || now === "hidden" ? now : undefined;
  };
  // The state narrowed to on the wall is the one its columns open on.
  createEffect(
    on(
      columnsOn,
      (on) => {
        const m = narrowedTo();
        if (on && m !== null && m !== s.activeState()) s.showState(m);
      },
      { defer: true },
    ),
  );
  const tabs = (): BarTab[] => {
    const named = boards().filter((b) => b.state !== null);
    const list = named
      .filter((b) => wallCards(b, show()).length > 0 || within() === b.state)
      .map((b) => ({
        id: b.state as string,
        label: b.state as string,
        n: wallCards(b, show()).length,
        on: within() === b.state,
        owes: s.askedIn(b.state) > 0,
        onPick: () => (columnsOn() ? s.showState(b.state) : setStatePick(b.state)),
      }));
    if (columnsOn() || named.length < 2) return list;
    return [
      {
        id: "",
        label: "All",
        n: boards().flatMap((b) => wallCards(b, show())).length,
        on: narrowedTo() === null,
        onPick: () => setStatePick(null),
      },
      ...list,
    ];
  };
  const showing = () =>
    WALL_SHOWS.map((x) => ({
      ...x,
      n: boards()
        .filter((b) => columnsOn() || within() === null || b.state === within())
        .flatMap((b) => wallCards(b, x.id)).length,
    })).filter((x) => x.n > 0 || x.id === show());
  // Columns are of one state, and what's picked may only be in another: go where it is.
  const pickShow = (id: string) =>
    batch(() => {
      setShowPick(id);
      const which = id as WallShow;
      if (!columnsOn() || wallCards(active(), which).length) return;
      const there = boards().find((b) => wallCards(b, which).length);
      if (there) s.showState(there.state);
    });
  // A handful is read at a glance; a filter only earns its place past that.
  const filterable = () => s.variants().length > FILTER_FROM || !!query();
  const barShown = () =>
    tabs().length > 1 ||
    filterable() ||
    showing().length > 1 ||
    props.arrangeable ||
    (wall() && isShortlist() && !readonly());
  const clearFilters = () =>
    batch(() => {
      setQuery("");
      setStatePick(null);
      setShowPick(null);
    });

  // The strip passes over a state with nothing left in it, as its tabs do.
  const drawn = () =>
    wall()
      ? []
      : strip()
        ? boards().filter((b) => b.state === s.activeState() || b.columns().length > 0)
        : [active()];
  const countIn = (state: string | null) =>
    s.variants().filter((v) => v.state === state && isLive(v.status)).length;
  const runs = createMemo(() =>
    drawn().flatMap((b) =>
      b
        .runs()
        .filter((r) => matches(b, r.variant))
        .map((r) => ({
          variant: r.variant,
          steps: r.steps.map((st): Entry => ({ b, st })),
        })),
    ),
  );
  const order = createMemo<Entry[]>(() =>
    wall()
      ? wallMap().flatMap(({ b, steps }) => steps.map((st): Entry => ({ b, st })))
      : runs().flatMap((r) => r.steps),
  );

  // The preview stands beside the wall where a pointer can aim at it and the window
  // has room. It follows a click and not the pointer: crossing the cards on the way to
  // the preview's own buttons would change what they act on.
  const beside = () => wall() && !coarse() && win().w >= WALL_PREVIEW_MIN_W;
  const [peekKey, setPeekKey] = createSignal(readParam("at"));
  const peeked = createMemo<Entry | null>(() => {
    if (!beside()) return null;
    const list = order();
    return list.find((e) => frameKey(e.b, e.st) === peekKey()) ?? list[0] ?? null;
  });
  // Debounced: Safari refuses more than a hundred of these in thirty seconds, and a
  // held arrow key would get there.
  let wallUrl = 0;
  onCleanup(() => host().window.clearTimeout(wallUrl));
  createEffect(() => {
    const put: [string, string | null][] = [
      ["cols", sized() && props.columns() ? "1" : null],
      ["in", narrowedTo()],
      ["show", show() === showPick() ? show() : null],
      ["find", query().trim() || null],
      ["at", beside() ? peekKey() : null],
    ];
    host().window.clearTimeout(wallUrl);
    wallUrl = host().window.setTimeout(() => {
      const w = host().window;
      const q = new URLSearchParams(w.location.search);
      for (const [name, value] of put) {
        if (value) q.set(name, value);
        else q.delete(name);
      }
      const next = `?${q}`;
      if (next !== w.location.search) {
        w.history.replaceState(w.history.state, "", `${w.location.pathname}${next}`);
      }
    }, 150);
  });

  // A selection is of versions, since that is what a card is, in the state on
  // show: leaving the state lets it go.
  const [picked, setPicked] = createSignal<string[]>([]);
  let pickedFrom: string | null = null;
  const chosen = createMemo(() => {
    const keys = new Set(picked());
    return order()
      .filter((e) => e.b === active() && !e.st.hidden && keys.has(stepKey(e.st)))
      .map((e) => e.st);
  });
  const selecting = () => chosen().length > 0;
  createEffect(on(s.activeState, () => setPicked([]), { defer: true }));
  const select = (b: Board, st: VersionStep, range: boolean) => {
    if (b.state !== s.activeState()) s.showState(b.state);
    const key = stepKey(st);
    // A hidden version dims in the run, and a range passes over it.
    const here = order()
      .filter((e) => e.b === b && !e.st.hidden)
      .map((e) => e.st);
    const keys = here.map(stepKey);
    const from = pickedFrom ? keys.indexOf(pickedFrom) : -1;
    const to = keys.indexOf(key);
    pickedFrom = key;
    if (range && from >= 0 && to >= 0) {
      const between = here.slice(Math.min(from, to), Math.max(from, to) + 1);
      setPicked([...new Set([...picked(), ...between.map(stepKey)])]);
    } else if (picked().includes(key)) {
      setPicked(picked().filter((k) => k !== key));
    } else {
      setPicked([...picked(), key]);
    }
  };
  // A version dims; all of a variant's going takes it to Archived.
  const variantsGone = (b: Board, out: VersionStep[]) =>
    [...new Set(out.map((st) => st.variant))].filter(
      (v) => b.versionsOf(v).length === out.filter((st) => st.variant === v).length,
    );
  const leaveAll = async (b: Board, out: VersionStep[]) => {
    if (b.state !== s.activeState()) s.showState(b.state);
    const gone = variantsGone(b, out);
    const undos: (() => void)[] = [];
    for (const st of out) {
      if (gone.includes(st.variant)) continue;
      const undo = await s.hideVersion(st, true, true);
      if (undo) undos.push(undo);
    }
    if (gone.length) {
      const undo = await s.archiveVariants(gone, undefined, true);
      if (undo) undos.push(undo);
    }
    if (!undos.length) return undefined;
    return () => {
      for (const undo of undos.reverse()) undo();
    };
  };
  const saveFor = (b: Board, steps: VersionStep[], leave?: SaveFor["leave"]): SaveFor | null => {
    const m = s.design();
    if (!m) return null;
    const state = b.state;
    const out = steps.filter((st) => !sameVersion(b.inUse(), st));
    const archives = variantsGone(b, out);
    return {
      items: steps.map((st) => ({
        ref: { design: m.id, state, variant: st.variant, version: st.version },
        name: b.nameOf(st),
      })),
      here: state ? `${m.title} · ${state}` : m.title,
      leaves: !out.length ? null : archives.length ? "archived" : "hidden",
      out: out.length,
      archives,
      leave: leave ?? (() => leaveAll(b, out)),
    };
  };
  const archiveChosen = async () => {
    const b = active();
    const out = chosen().filter((st) => !sameVersion(b.inUse(), st));
    const stays = chosen().length - out.length;
    const gone = variantsGone(b, out);
    const single = out.length === 1 ? b.nameOf(out[0]) : null;
    setPicked([]);
    const undo = await leaveAll(b, out);
    if (!undo) return;
    const hid = out.filter((st) => !gone.includes(st.variant)).length;
    const parts = [
      gone.length ? `Archived ${single ?? gone.length}` : "",
      hid ? `${gone.length ? "hid" : "Hid"} ${single ?? hid}` : "",
      stays ? `${stays} in use stays` : "",
    ];
    s.setToast({
      text: parts.filter(Boolean).join(", "),
      undo: () => {
        s.setToast(null);
        undo();
      },
    });
  };
  // The top bar's Stage, from a closer look, means the design being looked at.
  createEffect(() => {
    const e = looking() ?? peeked();
    // An archived design has no place on stage to open in.
    props.onLooking(e && !goneShown() ? () => actsFor(e.b).open(e.st) : null);
  });
  onCleanup(() => props.onLooking(null));
  const barPic = (st: VersionStep, large = false) => (
    <Show
      when={st.poster}
      fallback={
        // A canvas page is a whole live context: one large, never a row of them.
        <Show when={(large || !st.canvas) && pictureOf(st)}>
          {(u) => <Thumb src={u()} width={s.frameW()} fit whole large={large} />}
        </Show>
      }
    >
      {(p) => <Poster id={p()} />}
    </Show>
  );

  // Live frames: the versions in view; for canvas pages, up to the budget.
  const [inView, setInView] = createSignal<string[]>([]);
  const [onScreen, setOnScreen] = createSignal<string[]>([]);
  const [pointedAt, setPointedAt] = createSignal<string[]>([]);
  const places = new Map<
    string,
    { top: number; left: number; canvas: boolean; frame: boolean; gl: boolean }
  >();
  // Who gets the canvas budget: what was pointed at, then what the screen shows,
  // then what sits just off it. Top rows first, so a budget that runs out takes
  // older versions from every column rather than a whole column from the right.
  const canvasOrder = createMemo(() => {
    const seen = new Set(onScreen());
    const at = (k: string) => places.get(k) ?? { top: 0, left: 0, canvas: false };
    const rest = inView()
      .filter((k) => at(k).canvas && !pointedAt().includes(k))
      .sort(
        (a, b) =>
          Number(seen.has(b)) - Number(seen.has(a)) ||
          at(a).top - at(b).top ||
          at(a).left - at(b).left,
      );
    return [...pointedAt().filter((k) => inView().includes(k) && at(k).canvas), ...rest];
  });
  // Look closer: in the URL (?look=), so Back on a phone closes it and Back
  // from Stage reopens it where you were. It names a version of the state on stage.
  const readLook = () => readParam("look");
  const lookUrl = (k: string | null) => withParam("look", k);
  const [lookKey, setLookKey] = createSignal<string | null>(readLook());
  // Whether the entry under this one is Studio without a closer look, so
  // closing can step back to it instead of stacking another.
  let pushed = false;
  let openedOn: string | null = null;
  const looking = () => {
    const k = lookKey();
    return k
      ? (order().find((e) => e.b.state === s.activeState() && key(e.st) === k) ?? null)
      : null;
  };
  const look = (e: Entry) => {
    const h = host().window.history;
    if (lookKey()) h.replaceState(h.state, "", lookUrl(key(e.st)));
    else {
      h.pushState(h.state, "", lookUrl(key(e.st)));
      pushed = true;
      openedOn = s.activeState();
    }
    // Together, or the look would find nothing on the state it left and close.
    batch(() => {
      if (e.b.state !== s.activeState()) s.showState(e.b.state);
      setLookKey(key(e.st));
    });
  };
  const closeLook = () => {
    if (!lookKey()) return;
    // Back would also put back the state the look was opened on; flipped into
    // another since, closing stays there, on the card it was showing.
    if (pushed && s.activeState() === openedOn) {
      pushed = false;
      host().window.history.back();
      return;
    }
    pushed = false;
    host().window.history.replaceState(host().window.history.state, "", lookUrl(null));
    setLookKey(null);
  };
  // Full screen: in the URL too (?full=), over a closer look or the strip, so
  // Back closes it. It names a version of the state on stage, as ?look= does.
  const [fullKey, setFullKey] = createSignal<string | null>(readParam("full"));
  let fullPushed = false;
  const fullOn = () => {
    const k = fullKey();
    return k
      ? (order().find((e) => e.b.state === s.activeState() && key(e.st) === k) ?? null)
      : null;
  };
  const openFull = (e: Entry) => {
    const h = host().window.history;
    h.pushState(h.state, "", withParam("full", key(e.st)));
    fullPushed = true;
    batch(() => {
      if (e.b.state !== s.activeState()) s.showState(e.b.state);
      setFullKey(key(e.st));
    });
  };
  const closeFull = () => {
    if (!fullKey()) return;
    if (fullPushed) {
      fullPushed = false;
      host().window.history.back();
      return;
    }
    host().window.history.replaceState(host().window.history.state, "", withParam("full", null));
    setFullKey(null);
  };
  const onPop = () => {
    const k = readLook();
    pushed = !!k;
    fullPushed = false;
    batch(() => {
      setLookKey(k);
      setFullKey(readParam("full"));
    });
  };
  onMount(() => host().window.addEventListener("popstate", onPop));
  onCleanup(() => host().window.removeEventListener("popstate", onPop));
  // A version hidden or archived from under the closer look takes it away.
  createEffect(() => {
    if (lookKey() && order().length && !looking()) closeLook();
  });
  createEffect(() => {
    if (fullKey() && order().length && !fullOn()) closeFull();
  });
  const frameOf = (state: string | null, k: string, sel = "") =>
    [...(scroller?.querySelectorAll<HTMLElement>(`[data-key]${sel}`) ?? [])].find(
      (el) => el.dataset.key === k && el.dataset.state === (state ?? ""),
    );
  // Closing puts you back on the card you were looking at.
  createEffect(
    on(lookKey, (now, before) => {
      if (now || !before) return;
      queueMicrotask(() =>
        frameOf(s.activeState(), before)
          ?.querySelector<HTMLElement>(".sk-art")
          ?.focus({ preventScroll: false }),
      );
    }),
  );
  // Where a closer look goes when its state has nothing left to flip through.
  const firstOfNextState = (): Entry | undefined => {
    const m = s.nextLiveState();
    const b = boards().find((x) => x.state === m);
    const st = b?.runs()[0]?.steps[0];
    return b && st ? { b, st } : undefined;
  };
  const step = (d: number) => {
    const list = order();
    const i = list.findIndex((e) => e === looking());
    const next = list[i + d];
    if (i >= 0 && next) look(next);
  };
  const peek = (e: Entry) => {
    setPeekKey(frameKey(e.b, e.st));
    queueMicrotask(() => frameOf(e.b.state, key(e.st))?.scrollIntoView({ block: "nearest" }));
  };
  const stepPeek = (d: number) => {
    const list = order();
    const at = peeked();
    const next = at ? list[list.indexOf(at) + d] : undefined;
    if (next) peek(next);
  };
  const wallRows = () => {
    const at = peeked();
    const grid = at && frameOf(at.b.state, key(at.st))?.closest(".wall-grid");
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 1;
  };

  const inBudget = (key: string) => {
    // The closer look or full screen covers the grid: its one live frame
    // stands in for all of them.
    if (lookKey() || fullKey()) return false;
    if (!inView().includes(key)) return false;
    if (!places.get(key)?.canvas) return true;
    const taken = peeked() ? 1 : 0;
    return canvasOrder().indexOf(key) < CANVAS_MAX - taken;
  };
  // On a wall a card that leaves the screen keeps its frame for the way back.
  const kept = createMemo<{ live: Set<string>; keys: string[] }>(
    (was) => {
      if (!wall() || lookKey() || fullKey()) return { live: new Set(), keys: [] };
      const live = new Set(inView().filter((k) => places.get(k)?.frame && inBudget(k)));
      return {
        live,
        // A card gone from the wall took its frame with it.
        keys: nextKept(
          was.keys.filter((k) => places.has(k)),
          was.live,
          live,
          (k) => !!places.get(k)?.gl,
        ),
      };
    },
    { live: new Set(), keys: [] },
  );
  const bump = (b: Board, st: VersionStep) =>
    setPointedAt((l) => [frameKey(b, st), ...l.filter((k) => k !== frameKey(b, st))]);
  let scroller: HTMLDivElement | undefined;
  const observers: IntersectionObserver[] = [];
  const keyOf = (e: IntersectionObserverEntry) => {
    const d = (e.target as HTMLElement).dataset;
    return `${d.state}\n${d.key}`;
  };
  // Both lists follow the same rule: in on entering, out on leaving.
  const track = (
    set: (fn: (l: string[]) => string[]) => void,
    entries: IntersectionObserverEntry[],
  ) =>
    set((l) => {
      let next = l;
      for (const e of entries) {
        const k = keyOf(e);
        next = e.isIntersecting
          ? next.includes(k)
            ? next
            : [...next, k]
          : next.filter((x) => x !== k);
      }
      return next;
    });
  onMount(() => {
    const root = scroller ?? null;
    observers.push(
      new IntersectionObserver(
        (entries) => {
          // In the scroller's own coordinates, so places noted at different
          // scroll positions still compare.
          for (const e of entries) {
            places.set(keyOf(e), {
              top: e.boundingClientRect.top + (root?.scrollTop ?? 0),
              left: e.boundingClientRect.left + (root?.scrollLeft ?? 0),
              canvas: (e.target as HTMLElement).dataset.canvas !== undefined,
              frame: (e.target as HTMLElement).dataset.frame !== undefined,
              gl: (e.target as HTMLElement).dataset.gl !== undefined,
            });
          }
          track(setInView, entries);
          // Leaving the margin is the end of being pointed at.
          setPointedAt((l) => {
            const gone = entries.filter((e) => !e.isIntersecting).map(keyOf);
            return gone.length ? l.filter((k) => !gone.includes(k)) : l;
          });
        },
        { root, rootMargin: "200px" },
      ),
      new IntersectionObserver((entries) => track(setOnScreen, entries), { root }),
    );
    for (const el of scroller?.querySelectorAll<HTMLElement>("[data-key]") ?? []) {
      for (const o of observers) o.observe(el);
    }
  });
  onCleanup(() => {
    for (const o of observers) o.disconnect();
  });
  const watch = (el: HTMLElement) => {
    queueMicrotask(() => {
      for (const o of observers) o.observe(el);
    });
    onCleanup(() => {
      for (const o of observers) o.unobserve(el);
      // A card filtered off the wall sends no leaving report, and would hold its share
      // of the budget from the ones on screen.
      const k = `${el.dataset.state}\n${el.dataset.key}`;
      const out = (l: string[]) => (l.includes(k) ? l.filter((x) => x !== k) : l);
      places.delete(k);
      setInView(out);
      setOnScreen(out);
      setPointedAt(out);
    });
  };

  const [borrowFrom, setBorrowFrom] = createSignal<Entry | null>(null);
  const [writing, setWriting] = createSignal<Draft | null>(null);

  // The strip: the state whose card sits at the snap goes on stage once a
  // swipe settles, and a state put on stage from elsewhere (the flow bar) brings its
  // first card to the snap.
  let followed: string | null | undefined;
  let settle = 0;
  const snapPad = () =>
    scroller ? parseFloat(getComputedStyle(scroller).scrollPaddingLeft) || 0 : 0;
  const atSnap = () => {
    if (!scroller) return null;
    const x = scroller.getBoundingClientRect().left + snapPad();
    let best: HTMLElement | null = null;
    let gap = Infinity;
    for (const col of scroller.querySelectorAll<HTMLElement>(".studio-col")) {
      const d = Math.abs(col.getBoundingClientRect().left - x);
      if (d < gap) [best, gap] = [col, d];
    }
    const i = Number(best?.closest<HTMLElement>("[data-board]")?.dataset.board);
    return Number.isInteger(i) ? (drawn()[i] ?? null) : null;
  };
  const follow = () => {
    host().window.clearTimeout(settle);
    if (!strip() || lookKey() || writing()) return;
    // Mid-swipe the snap hasn't landed: naming every state passed on the way
    // would make the flow bar flicker.
    settle = host().window.setTimeout(() => {
      if (lookKey() || writing()) return;
      const b = atSnap();
      if (!b || b.state === s.activeState()) return;
      followed = b.state;
      s.showState(b.state);
    }, 120);
  };
  onCleanup(() => host().window.clearTimeout(settle));
  createEffect(
    on([strip, s.activeState] as const, ([phone, st]) => {
      if (!phone || st === followed) return;
      const first = followed === undefined;
      followed = st;
      host().window.requestAnimationFrame(() => {
        const sec = [...(scroller?.querySelectorAll<HTMLElement>("[data-board]") ?? [])].find(
          (el) => el.dataset.state === (st ?? ""),
        );
        // A closer look flipped across states: the strip waits under it on that card.
        const k = lookKey();
        const col =
          (k && frameOf(st, k)?.closest<HTMLElement>(".studio-col")) ||
          sec?.querySelector<HTMLElement>(".studio-col");
        if (!scroller || !col) return;
        const left =
          scroller.scrollLeft +
          col.getBoundingClientRect().left -
          scroller.getBoundingClientRect().left -
          snapPad();
        const still = host().window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        scroller.scrollTo({ left, behavior: first || still ? "instant" : "smooth" });
      });
    }),
  );

  const onKey = (e: KeyboardEvent) => {
    // A popover already took this Esc: it shuts that alone.
    if (e.defaultPrevented) return;
    // Full screen is over everything: Esc closes it, and nothing under it moves.
    if (fullKey()) {
      if (e.key !== "Escape") return;
      closeFull();
      e.preventDefault();
      return;
    }
    if (lookKey() && !writing()) {
      const at = e.target as Element | null;
      const typing = !!at?.closest?.("input, textarea, select, [contenteditable]");
      // Space presses a focused button; anywhere else it closes, as Quick Look does.
      const pressing = typing || !!at?.closest?.("button");
      if (e.key === "ArrowRight" && !typing) step(1);
      else if (e.key === "ArrowLeft" && !typing) step(-1);
      else if (e.key === "Escape" || (e.key === " " && !pressing)) closeLook();
      else return;
      e.preventDefault();
      return;
    }
    if (e.key !== "Escape") return;
    if (writing()) setWriting(null);
    else if (borrowFrom()) setBorrowFrom(null);
    else if (selecting()) setPicked([]);
  };
  // In the capture phase, ahead of the flow's keys, which would also walk the versions
  // of the state on stage while the preview walks the wall.
  const onWallKey = (e: KeyboardEvent) => {
    if (!peeked() || lookKey() || fullKey() || writing() || saving() || adding()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const at = e.target as Element | null;
    if (at?.closest?.("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowRight") stepPeek(1);
    else if (e.key === "ArrowLeft") stepPeek(-1);
    else if (e.key === "ArrowDown") stepPeek(wallRows());
    else if (e.key === "ArrowUp") stepPeek(-wallRows());
    // Space presses a focused button, as in the closer look.
    else if (e.key === " " && !at?.closest?.("button")) {
      const on = peeked();
      if (on) look(on);
    } else return;
    e.preventDefault();
  };
  onMount(() => host().window.addEventListener("keydown", onWallKey, true));
  onCleanup(() => host().window.removeEventListener("keydown", onWallKey, true));
  onMount(() => host().window.addEventListener("keydown", onKey));
  onCleanup(() => host().window.removeEventListener("keydown", onKey));

  // A board's steers: each acts on the state on stage, so the board's own
  // state goes on stage first.
  const actsFor = (b: Board): Acts => {
    const here = () => {
      if (b.state !== s.activeState()) s.showState(b.state);
    };
    return {
      selecting,
      selected: (st) => b === active() && picked().includes(stepKey(st)),
      select: (st, e) => select(b, st, e.shiftKey),
      look: (st) => (beside() ? peek({ b, st }) : look({ b, st })),
      closer: (st) => look({ b, st }),
      restore(st) {
        here();
        if (st.hidden) void s.hideVersion(st, false);
        else {
          void s
            .restoreVariant(st.variant, [b.state])
            .then(() => s.setToast({ text: `Restored ${st.variant}` }));
        }
      },
      full: (st) => openFull({ b, st }),
      open(st) {
        here();
        s.showVersion(st);
        props.onOpen();
      },
      more(st) {
        here();
        void s
          .steer({ variant: st.variant, version: st.version, reaction: "more" })
          .then((ok) => ok && s.setToast({ text: `More like ${b.nameOf(st)}, sent` }));
      },
      comment(st) {
        here();
        setBorrowFrom(null);
        setWriting({ kind: "comment", to: st });
      },
      borrow(st) {
        here();
        setWriting(null);
        closeLook();
        setBorrowFrom({ b, st });
      },
      pick(st) {
        const from = borrowFrom();
        if (!from || from.b !== b || sameVersion(from.st, st)) return;
        here();
        setBorrowFrom(null);
        setWriting({ kind: "borrow", to: st, from: from.st });
      },
      // The last version of a variant can't be hidden; it archives the variant.
      remove(st) {
        here();
        if (b.versionsOf(st.variant).length > 1) void s.hideVersion(st, true);
        else void s.archiveVariants([st.variant]);
      },
      saved(st) {
        const id = s.design()?.id;
        if (!id) return false;
        return sl.isSaved({ design: id, state: b.state, variant: st.variant, version: st.version });
      },
      family: (st) => b.familyOf(st),
      leave: (st) =>
        leaveAll(
          b,
          [st, ...b.familyOf(st)].filter((x) => !sameVersion(b.inUse(), x)),
        ),
      save(st, from, leave) {
        if (saving()?.from === from) return setSaving(null);
        const item = saveFor(b, [st, ...b.familyOf(st)], leave);
        if (item) setSaving({ item, from });
      },
    };
  };

  // On the wall a card is one design among many, in no column: its name has to say
  // which version it is, and that it was forked from another.
  const wallCaption = (b: Board, st: VersionStep) => {
    const v = s.variants().find((x) => x.state === b.state && x.variant === st.variant);
    const name =
      st.hidden || b.versionsOf(st.variant).length > 1 ? versionName(st, true) : st.variant;
    return v && b.isFork(v) ? `↳ ${name}` : name;
  };
  const card = (b: Board, act: Acts, st: VersionStep, small = false, onWall = false) => {
    // A borrow goes between versions of one state.
    const borrowing = () => borrowFrom()?.b === b;
    return (
      <StudioCard
        s={s}
        b={b}
        st={st}
        small={small}
        wall={onWall}
        caption={onWall ? wallCaption(b, st) : undefined}
        gone={(onWall ? goneShown() : undefined) ?? (st.hidden ? "hidden" : undefined)}
        peek={onWall && peeked()?.b === b && sameVersion(peeked()?.st, st)}
        elsewhere={onWall && selecting() && b !== active()}
        live={inBudget(frameKey(b, st)) || kept().keys.includes(frameKey(b, st))}
        borrowing={borrowing()}
        source={borrowing() && sameVersion(borrowFrom()?.st, st)}
        last={b.versionsOf(st.variant).length === 1}
        ref={watch}
        onWake={() => bump(b, st)}
        act={act}
      />
    );
  };

  return (
    <div
      class="studio"
      classList={{ strip: strip(), selecting: selecting(), wall: wall(), peeking: !!peeked() }}
      ref={(el) => (scroller = el)}
      style={{
        top: `${props.top}px`,
        ...(peeked() ? { "--peek-w": `${wallPreviewW(s.frameW(), win().w)}px` } : {}),
        ...(wall()
          ? {
              "--wall-card": `${wallCard(s.frameW()).min}px`,
              "--wall-art": wallCard(s.frameW()).art,
            }
          : {}),
      }}
      onScroll={follow}
    >
      <Show when={borrowFrom()}>
        {(from) => (
          <div class="studio-banner" role="status">
            <span>{`Borrow from ${from().b.nameOf(from().st)}: pick where it goes`}</span>
            <button type="button" class="btn" onClick={() => setBorrowFrom(null)}>
              Cancel
            </button>
          </div>
        )}
      </Show>
      <Show when={barShown() && props.barSlot}>
        {(slot) => (
          <Portal mount={slot()}>
            <StudioBar
              tabs={tabs()}
              {...(filterable() ? { query: query(), onQuery: setQuery } : {})}
              show={showing()}
              showOn={show()}
              onShow={pickShow}
              {...(wall() && isShortlist() && !readonly() && !borrowFrom()
                ? { onAdd: () => setAdding(true) }
                : {})}
              arrange={props.arrange}
            />
          </Portal>
        )}
      </Show>
      <Show when={wall()}>
        <Show when={phoneLayout() && filterable()}>
          <input
            class="slpick-filter sbar-phonefind"
            type="search"
            placeholder="Filter by name or description"
            aria-label="Filter by name or description"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </Show>
        <For each={wallSections()}>
          {(b) => {
            const act = actsFor(b);
            return (
              <section class="wall-state" aria-label={b.state ?? undefined} hidden={!inWithin(b)}>
                <Show when={wallStates().length > 1}>
                  <h2 class="studio-sth">
                    {b.state}
                    <span class="n">{stepsIn(b).length}</span>
                  </h2>
                </Show>
                <div class="wall-grid">
                  <For each={stepsIn(b)}>{(st) => card(b, act, st, true, true)}</For>
                </div>
              </section>
            );
          }}
        </For>
        <Show when={!wallStates().length}>
          <p class="wall-empty">
            Nothing matches.{" "}
            <button type="button" class="lnk" onClick={clearFilters}>
              Clear the filters
            </button>
          </p>
        </Show>
      </Show>
      <Show when={!wall() && !drawn().some((b) => columnsIn(b).length > 0)}>
        <p class="wall-empty">
          <Show
            when={!query().trim() && active().aside().length}
            fallback={
              <>
                Nothing matches.{" "}
                <button type="button" class="lnk" onClick={clearFilters}>
                  Clear the filters
                </button>
              </>
            }
          >
            {(n) => (
              <>
                Nothing live here.{" "}
                <button type="button" class="lnk" onClick={() => setShowPick("archived")}>
                  {`Show ${n()} archived`}
                </button>
              </>
            )}
          </Show>
        </p>
      </Show>
      <div class="studio-cols">
        <For each={drawn()}>
          {(b, i) => {
            const act = actsFor(b);
            return (
              <section
                class="studio-state"
                data-board={i()}
                data-state={b.state ?? ""}
                aria-label={strip() ? (b.state ?? undefined) : undefined}
              >
                <Show when={strip() && drawn().length > 1}>
                  <h2 class="studio-sth">
                    {b.state}
                    <span class="n">{countIn(b.state)}</span>
                  </h2>
                </Show>
                <div class="studio-run">
                  <For each={columnsIn(b)}>
                    {(v) => (
                      <section class="studio-col" aria-label={v.variant}>
                        <header class="studio-colh">
                          <h2>{v.variant}</h2>
                          <Show when={v.forkedFrom}>
                            {(f) => <span class="studio-from">{`from ${f().variant}`}</span>}
                          </Show>
                          <Show when={!readonly() && !borrowFrom() && !b.isUsed(v.variant)}>
                            <button
                              type="button"
                              class="ib x-remove col-x"
                              aria-label={
                                isShortlist()
                                  ? `Remove ${v.variant} from this idea`
                                  : `Archive ${v.variant}`
                              }
                              title={
                                isShortlist()
                                  ? `Remove ${v.variant} from this idea`
                                  : `Archive ${v.variant}`
                              }
                              onClick={() => {
                                if (b.state !== s.activeState()) s.showState(b.state);
                                void s.archiveVariants([v.variant]);
                              }}
                            >
                              <Icon name="close" />
                            </button>
                          </Show>
                        </header>
                        <Show when={v.copiedFrom}>
                          {(c) => <Origin from={c()} designs={projectDesigns()?.designs ?? []} />}
                        </Show>
                        <For each={b.drawnOf(v.variant)}>{(st) => card(b, act, st)}</For>
                      </section>
                    )}
                  </For>
                  <Show when={isShortlist() && !readonly() && !borrowFrom()}>
                    <button type="button" class="studio-add" onClick={() => setAdding(true)}>
                      <Icon name="plus" />
                      Add candidate
                    </button>
                  </Show>
                </div>
              </section>
            );
          }}
        </For>
      </div>
      <Show when={saving()} keyed>
        {(m) => (
          <SaveMenu
            sl={sl}
            project={s.design()?.project ?? ""}
            anchor={m.from}
            item={m.item}
            onClose={() => setSaving(null)}
            onDone={m.onDone}
          />
        )}
      </Show>
      <Show when={selecting() && !readonly() && !borrowFrom()}>
        <SelectBar
          steps={chosen()}
          total={order().filter((e) => e.b === active() && !e.st.hidden).length}
          name={(st) => active().nameOf(st)}
          inUse={(st) => sameVersion(active().inUse(), st)}
          pic={barPic}
          onAll={() =>
            setPicked(
              order()
                .filter((e) => e.b === active() && !e.st.hidden)
                .map((e) => stepKey(e.st)),
            )
          }
          onClear={() => setPicked([])}
          onSave={(from) => {
            if (saving()?.from === from) return setSaving(null);
            const item = saveFor(active(), chosen());
            if (item) setSaving({ item, from, onDone: () => setPicked([]) });
          }}
          onArchive={() => void archiveChosen()}
          onSend={(notes, text, sent) => {
            setPicked([]);
            void s.steerMany(notes, text).then((ok) => ok && s.setToast({ text: sent }));
          }}
        />
      </Show>
      <Show when={adding() && s.design()}>
        {(m) => (
          <AddCandidates
            sl={sl}
            project={m().project}
            list={{ id: m().id, title: m().title }}
            onDone={(n) => s.setToast({ text: `Added ${n} to ${m().title}` })}
            onClose={() => setAdding(false)}
          />
        )}
      </Show>
      {/* Under full screen the closer look steps aside, so its frame isn't a
          second live copy of the same page. */}
      <Show when={!fullKey() && looking()}>
        {(e) => (
          <Look
            s={s}
            entry={e()}
            top={props.top}
            order={order()}
            last={e().b.versionsOf(e().st.variant).length === 1}
            wall={wall()}
            perState={strip() && drawn().length > 1}
            gone={goneShown()}
            onStep={step}
            onGo={look}
            nextState={firstOfNextState}
            onClose={closeLook}
            act={actsFor(e().b)}
          />
        )}
      </Show>
      {/* Out while the closer look is up: its one live frame stands in for all of them. */}
      <Show when={!fullKey() && !lookKey() && peeked()}>
        {(e) => (
          <Look
            s={s}
            entry={e()}
            top={props.top}
            order={order()}
            last={e().b.versionsOf(e().st.variant).length === 1}
            wall
            beside
            gone={goneShown()}
            onStep={stepPeek}
            onGo={peek}
            nextState={() => undefined}
            onClose={() => setPeekKey(null)}
            act={actsFor(e().b)}
          />
        )}
      </Show>
      <Show when={writing()}>
        {(w) => <NoteBox s={s} draft={w()} onDone={() => setWriting(null)} />}
      </Show>
      <Show when={fullOn()}>
        {(e) => (
          <Show when={pageOf(e().st)} keyed>
            {(src) => (
              <FullView
                src={src}
                width={s.frameW()}
                title={e().b.nameOf(e().st)}
                onClose={closeFull}
              />
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}

function StudioCard(props: {
  s: DesignScreenState;
  b: Board;
  st: VersionStep;
  small: boolean;
  wall: boolean;
  caption?: string;
  // Archived or hidden: the one thing to do with it is bring it back.
  gone?: string;
  peek: boolean;
  elsewhere: boolean;
  live: boolean;
  borrowing: boolean;
  source: boolean;
  last: boolean;
  ref: (el: HTMLElement) => void;
  onWake: () => void;
  act: Acts;
}) {
  const s = props.s;
  const st = () => props.st;
  const src = () => pictureOf(st());
  const inUse = () => sameVersion(props.b.inUse(), st());
  const name = () => props.b.nameOf(st());
  const label = () => `${name()}${inUse() ? ", in use" : ""}`;
  const can = () => !readonly() && !props.borrowing;
  const steers = () => can() && !props.gone;
  const target = () => props.borrowing && !props.source && !props.gone;
  return (
    <div
      class="sk"
      classList={{
        on: props.act.selected(st()),
        small: props.small,
        source: props.source,
        target: target(),
        peek: props.peek,
        elsewhere: props.elsewhere,
        gone: !!props.gone,
        hid: st().hidden,
      }}
      data-key={`${st().variant}@${st().version}`}
      data-state={props.b.state ?? ""}
      // A poster is an image: it holds no context, so it takes no budget.
      // On a wall any page counts: there can be a screenful of them with no canvas at all.
      data-canvas={(st().canvas || props.wall) && !st().poster ? "" : undefined}
      data-frame={st().poster ? undefined : ""}
      data-gl={st().canvas && !st().poster ? "" : undefined}
      ref={props.ref}
      // While selecting the whole card is the target, not only its picture and tick.
      onClick={(e) => {
        if (!steers() || !props.act.selecting()) return;
        if ((e.target as Element).closest("button, a, input, textarea")) return;
        props.act.select(st(), e);
      }}
      onPointerEnter={() => !props.live && props.onWake()}
    >
      <button
        type="button"
        class="sk-art"
        aria-current={props.peek || undefined}
        aria-label={
          target()
            ? `Borrow into ${label()}`
            : props.act.selecting()
              ? `Select ${label()}`
              : `Look closer at ${label()}`
        }
        title={st().prompt ?? ""}
        onClick={(e) => {
          if (props.borrowing && !props.gone) props.act.pick(st());
          // Once one is ticked the whole picture is the target, not just the number.
          else if (steers() && (props.act.selecting() || e.shiftKey || e.metaKey || e.ctrlKey)) {
            props.act.select(st(), e);
          } else props.act.look(st());
        }}
        onFocus={() => !props.live && props.onWake()}
      >
        <Show
          when={st().poster}
          fallback={
            <Show when={props.live && src()}>
              {/* Columns are for comparing, motion included; a wall is a screenful of small ones. */}
              {(u) => <Thumb src={u()} width={s.frameW()} fit whole large={!props.wall} />}
            </Show>
          }
        >
          {(p) => <Poster id={p()} />}
        </Show>
      </button>
      <Show when={props.wall && inUse()}>
        <span class="sk-tag wall-use">in use</span>
      </Show>
      <Show when={props.small && steers()}>
        <button
          type="button"
          class="sk-box sk-tick"
          role="checkbox"
          aria-checked={props.act.selected(st())}
          aria-label={`Select ${name()}`}
          onClick={(e) => props.act.select(st(), e)}
        >
          <Icon name="check" />
        </button>
      </Show>
      <Show when={props.small}>
        <span class="sk-name" title={st().variant}>
          {props.caption ?? st().variant}
        </span>
      </Show>
      <Show when={!props.small}>
        <div class="sk-foot">
          <Show when={steers()} fallback={<span class="sk-n">{`#${st().version}`}</span>}>
            <button
              type="button"
              class="sk-n sk-pick"
              role="checkbox"
              aria-checked={props.act.selected(st())}
              aria-label={`Select ${name()}`}
              onClick={(e) => props.act.select(st(), e)}
            >
              <span class="sk-box">
                <Icon name="check" />
              </span>
              {`#${st().version}`}
            </button>
          </Show>
          <Show when={inUse()}>
            <span class="sk-tag">in use</span>
          </Show>
          <Show when={steers()}>
            <div class="sk-acts" role="group" aria-label={`Steer ${name()}`}>
              <button
                type="button"
                class="ib"
                aria-label={`More like ${name()}`}
                title="More like this"
                onClick={() => props.act.more(st())}
              >
                <Icon name="spark" />
              </button>
              <button
                type="button"
                class="ib"
                aria-label={`Comment on ${name()}`}
                title="Comment"
                onClick={() => props.act.comment(st())}
              >
                <Icon name="mark" />
              </button>
              <button
                type="button"
                class="ib"
                aria-label={`Borrow from ${name()}`}
                title="Borrow"
                onClick={() => props.act.borrow(st())}
              >
                <Icon name="borrow" />
              </button>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={can() && props.gone}>
        <button
          type="button"
          class="ib sk-x sk-restore wall-restore"
          aria-label={`Restore ${name()}`}
          title="Restore"
          onClick={() => props.act.restore(st())}
        >
          <Icon name="undo" />
        </button>
      </Show>
      <Show when={steers()}>
        <button
          type="button"
          class="ib sk-save"
          aria-pressed={props.act.saved(st())}
          aria-label={`Move or save ${name()}`}
          title={props.act.saved(st()) ? "Saved elsewhere too" : "Move or save"}
          onClick={(e) => props.act.save(st(), e.currentTarget)}
        >
          <Icon name="move" />
        </button>
      </Show>
      <Show when={steers() && !inUse()}>
        <button
          type="button"
          class="ib x-remove sk-x"
          aria-label={props.last ? `Archive ${st().variant}` : `Hide ${name()}`}
          title={props.last ? "Archive" : "Hide"}
          onClick={() => props.act.remove(st())}
        >
          <Icon name="close" />
        </button>
      </Show>
    </div>
  );
}

// Where a gathered idea's candidate came from, and the way back to it.
function Origin(props: {
  from: CopyRef;
  designs: { id: string; slug: string; title: string; project: string }[];
}) {
  const design = () => props.designs.find((m) => m.id === props.from.design);
  return (
    <Show when={design()}>
      {(m) => {
        const label = () => [m().title, props.from.state].filter(Boolean).join(" · ");
        const href = () =>
          designPath(m().project, m().slug, {
            state: props.from.state,
            variant: props.from.variant,
            version: props.from.version,
          });
        return (
          <a
            class="studio-origin"
            href={href()}
            title={`Open the original in ${label()}`}
            onClick={(e) => linkClick(e, href())}
          >
            {label()}
          </a>
        );
      }}
    </Show>
  );
}

// One version large over the grid. Arrows, the strip or a swipe flip through
// Studio's reading order; Esc, Space or a swipe down go back to the card. The
// steers are the card's, and Stage is one deliberate step away.
// One line until asked for: an agent's note can run to a paragraph, and the
// picture is what a closer look is for. Stays open while flipping, to read through.
function LookNote(props: { text: string }) {
  const [open, setOpen] = createSignal(false);
  const [long, setLong] = createSignal(false);
  let line: HTMLSpanElement | undefined;
  const measure = () => {
    if (!line) return;
    setLong(
      open()
        ? line.offsetHeight > parseFloat(getComputedStyle(line).lineHeight) * 1.5
        : line.scrollWidth > line.clientWidth,
    );
  };
  createEffect(on(() => props.text, measure));
  onMount(() => {
    const seen = new ResizeObserver(measure);
    if (line) seen.observe(line);
    onCleanup(() => seen.disconnect());
  });
  return (
    <p class="look-note" classList={{ open: open() }}>
      {/* Only opens: open, the text stays selectable. */}
      <span
        ref={(el) => (line = el)}
        class="look-note-tx"
        classList={{ more: long() && !open() }}
        onClick={() => {
          if (long()) setOpen(true);
        }}
      >
        {props.text}
      </span>
      <Show when={long()}>
        <button
          type="button"
          class="ib look-note-more"
          aria-expanded={open()}
          aria-label={open() ? "Show less" : "Show all"}
          title={open() ? "Show less" : "Show all"}
          onClick={() => setOpen(!open())}
        >
          <Icon name="down" />
        </button>
      </Show>
    </p>
  );
}

// The name is also the way to any other: every one in the run, in the order the arrows
// walk it, with the states marked where it crosses them.
function LookPick(props: { name: string; order: Entry[]; entry: Entry; onGo: (e: Entry) => void }) {
  const [open, setOpen] = createSignal(false);
  let button: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  usePopover(
    open,
    () => setOpen(false),
    () => button,
    () => pop,
  );
  const crosses = () => new Set(props.order.map((e) => e.b)).size > 1;
  return (
    <Show when={props.order.length > 1} fallback={<h2>{props.name}</h2>}>
      <div class="look-pick">
        <h2>
          <button
            type="button"
            ref={(el) => (button = el)}
            aria-haspopup="menu"
            aria-expanded={open()}
            onClick={() => setOpen((on) => !on)}
          >
            <span>{props.name}</span>
            <Icon name="down" />
          </button>
        </h2>
        <Show when={open()}>
          <div
            class="look-list"
            role="menu"
            ref={(el) => {
              pop = el;
              queueMicrotask(() =>
                el.querySelector("[aria-current]")?.scrollIntoView({ block: "center" }),
              );
            }}
          >
            <For each={props.order}>
              {(e, i) => (
                <>
                  <Show when={crosses() && props.order[i() - 1]?.b !== e.b}>
                    <span class="look-list-h">{e.b.state}</span>
                  </Show>
                  <button
                    type="button"
                    role="menuitem"
                    aria-current={e === props.entry || undefined}
                    onClick={() => {
                      props.onGo(e);
                      setOpen(false);
                      button?.focus();
                    }}
                  >
                    {props.order.filter((x) => x.b === e.b && x.st.variant === e.st.variant)
                      .length > 1
                      ? e.b.nameOf(e.st)
                      : e.st.variant}
                  </button>
                </>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function Look(props: {
  s: DesignScreenState;
  entry: Entry;
  top: number;
  order: Entry[];
  last: boolean;
  wall?: boolean;
  // Standing beside the wall as its preview, rather than over it.
  beside?: boolean;
  // On the phone's strip, where a count across every state says nothing useful.
  perState?: boolean;
  gone?: string;
  onStep: (d: number) => void;
  onGo: (e: Entry) => void;
  nextState: () => Entry | undefined;
  onClose: () => void;
  act: Acts;
}) {
  const s = props.s;
  const st = () => props.entry.st;
  // The board's own answers: a preview needn't be of the state on stage.
  const b = () => props.entry.b;
  const at = () => props.order.indexOf(props.entry);
  const name = () => b().nameOf(st());
  const inUse = () => sameVersion(b().inUse(), st());
  const row = () => s.variants().find((x) => x.state === b().state && x.variant === st().variant);
  const can = () => !readonly();
  // Where the reason can be written, the box says it.
  const note = () => {
    const v = row();
    return v?.archiveReason && !(can() && props.gone === "archived")
      ? `Archived: ${v.archiveReason}`
      : v?.description;
  };
  const counter = () => {
    const among = props.perState ? props.order.filter((e) => e.b === b()) : props.order;
    const count = `${among.indexOf(props.entry) + 1} of ${among.length}`;
    return (props.perState || props.wall) && b().state ? `${b().state}, ${count}` : count;
  };
  let box: HTMLDivElement | undefined;
  // A preview waits beside the wall: focus stays on the card or the filter.
  onMount(() => {
    if (!props.beside) box?.focus({ preventScroll: true });
  });
  // A swipe across flips, a swipe down closes; a tap is left alone.
  let start: { x: number; y: number; id: number } | null = null;
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) props.onStep(dx < 0 ? 1 : -1);
    else if (dy > 90 && dy > Math.abs(dx) * 1.5) props.onClose();
  };
  // Removed while its state is still on stage: the next version may be on another.
  const stepOff = (remove: () => void, going: VersionStep[] = []) => {
    const stays = (e: Entry) => !going.some((g) => e.b === props.entry.b && sameVersion(g, e.st));
    const next =
      props.order.slice(at() + 1).find(stays) ??
      props.order.slice(0, Math.max(at(), 0)).findLast(stays) ??
      props.nextState();
    // Together: an archive leaves at once, and the look closes on a version gone
    // from under it.
    batch(() => {
      remove();
      if (next) props.onGo(next);
      else props.onClose();
    });
  };
  const hide = () => stepOff(() => props.act.remove(st()));
  const restore = () => stepOff(() => props.act.restore(st()));
  // The copies land first, and the look may have moved on by then.
  const leave = (from: VersionStep): ReturnType<SaveFor["leave"]> => {
    if (!sameVersion(st(), from)) return props.act.leave(from);
    let out: ReturnType<SaveFor["leave"]> = Promise.resolve(undefined);
    stepOff(() => (out = props.act.leave(from)), props.act.family(from));
    return out;
  };
  return (
    <div
      class="look"
      classList={{ beside: props.beside }}
      ref={(el) => (box = el)}
      tabIndex={-1}
      role={props.beside ? "complementary" : "dialog"}
      aria-label={props.beside ? `Preview: ${name()}` : `Look closer: ${name()}`}
      style={{ top: `${props.top}px` }}
    >
      <header class="look-h">
        <LookPick name={name()} order={props.order} entry={props.entry} onGo={props.onGo} />
        <Show when={inUse()}>
          <span class="sk-tag">in use</span>
        </Show>
        <span class="look-at">{counter()}</span>
        <span class="look-sp" />
        <Show
          when={!props.beside}
          fallback={
            <button
              type="button"
              class="ib"
              aria-label={`Look closer at ${name()}`}
              title="Look closer (Space)"
              onClick={() => props.act.closer(st())}
            >
              <Icon name="expand" />
            </button>
          }
        >
          <button
            type="button"
            class="ib"
            aria-label="Back to Studio"
            title="Back to Studio (Esc)"
            onClick={props.onClose}
          >
            <Icon name="close" />
          </button>
        </Show>
      </header>
      <div
        class="look-art"
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={() => (start = null)}
      >
        <button
          type="button"
          class="ib look-nav"
          aria-label="Previous"
          disabled={at() <= 0}
          onClick={() => props.onStep(-1)}
        >
          <Icon name="prev" />
        </button>
        <div class="look-frame">
          <Show when={!props.beside && pageOf(st())}>
            <button
              type="button"
              class="ib look-full"
              aria-label={`Full screen: ${name()}`}
              title="Full screen"
              onClick={() => props.act.full(st())}
            >
              <Icon name="expand" />
            </button>
          </Show>
          <Show
            when={pictureOf(st())}
            keyed
            fallback={<Show when={st().poster}>{(p) => <Poster id={p()} />}</Show>}
          >
            {(u) => <Thumb src={u} width={s.frameW()} fit whole large title={name()} />}
          </Show>
        </div>
        <button
          type="button"
          class="ib look-nav"
          aria-label="Next"
          disabled={at() >= props.order.length - 1}
          onClick={() => props.onStep(1)}
        >
          <Icon name="next" />
        </button>
      </div>
      <Show when={note()}>{(text) => <LookNote text={text()} />}</Show>
      <Show when={can() && props.gone === "archived"}>
        <div class="look-reason">
          <Reason
            value={row()?.archiveReason}
            onSave={(r) => s.saveArchiveReason(st().variant, r, b().state)}
          />
        </div>
      </Show>
      <Show when={can() && props.gone}>
        <div class="look-acts">
          <button type="button" class="btn" onClick={restore}>
            <Icon name="undo" />
            Restore
          </button>
        </div>
      </Show>
      <Show when={can() && !props.gone}>
        <div class="look-acts" role="group" aria-label={`Steer ${name()}`}>
          <button type="button" class="btn" onClick={() => props.act.more(st())}>
            <Icon name="spark" />
            More like this
          </button>
          <button type="button" class="btn" onClick={() => props.act.comment(st())}>
            <Icon name="mark" />
            Comment
          </button>
          <button type="button" class="btn" onClick={() => props.act.borrow(st())}>
            <Icon name="borrow" />
            Borrow
          </button>
          <button
            type="button"
            class="btn look-save"
            aria-pressed={props.act.saved(st())}
            onClick={(e) => {
              const from = st();
              props.act.save(from, e.currentTarget, () => leave(from));
            }}
          >
            <Icon name="move" />
            {props.act.saved(st()) ? "Saved" : "Move"}
          </button>
          <Show when={!inUse()}>
            <button type="button" class="btn quiet" onClick={hide}>
              {props.last ? "Archive" : "Hide"}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// A comment on one version, or what to borrow from where: one line, aimed at a
// part when the version declares any, sent as its own reply.
function NoteBox(props: { s: DesignScreenState; draft: Draft; onDone: () => void }) {
  const s = props.s;
  const [text, setText] = createSignal("");
  const [part, setPart] = createSignal<string | null>(null);
  const to = () => props.draft.to;
  const from = () => props.draft.from;
  const parts = () =>
    s.variants().find((v) => v.state === s.activeState() && v.variant === (from() ?? to()).variant)
      ?.parts ?? [];
  let input: HTMLInputElement | undefined;
  onMount(() => input?.focus());
  const send = () => {
    const f = from();
    const what = text().trim();
    if (!f && !what) return;
    const sent = f ? `Borrow into ${s.nameOf(to())}, sent` : `Comment on ${s.nameOf(to())}, sent`;
    void s
      .steer({
        variant: to().variant,
        version: to().version,
        part: f ? null : part(),
        text: what,
        ...(f ? { borrow: { from: f, ...(part() ? { part: part()! } : {}) } } : {}),
      })
      .then((ok) => ok && s.setToast({ text: sent }));
    props.onDone();
  };
  return (
    <form
      class="studio-note"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label for="studio-note-in">
        {from()
          ? `From ${s.nameOf(from()!)} into ${s.nameOf(to())}: what should it take?`
          : `Comment on ${s.nameOf(to())}`}
      </label>
      <Show when={parts().length}>
        <div class="studio-parts" role="group" aria-label="Part">
          <For each={parts()}>
            {(p) => (
              <button
                type="button"
                class="chip"
                aria-pressed={part() === p}
                onClick={() => setPart(part() === p ? null : p)}
              >
                {p}
              </button>
            )}
          </For>
        </div>
      </Show>
      <input
        id="studio-note-in"
        ref={(el) => (input = el)}
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        placeholder={from() ? "e.g. the face" : "e.g. sleepier eyes"}
        autocomplete="off"
      />
      <div class="studio-note-foot">
        <button type="button" class="btn" onClick={props.onDone}>
          Cancel
        </button>
        <button type="submit" class="btn go">
          Send
        </button>
      </div>
    </form>
  );
}
