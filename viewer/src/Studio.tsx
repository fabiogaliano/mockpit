// Studio: the state zoomed out, every variant side by side with its newest
// version on top, for exploring before anything is in use. A click looks
// closer without leaving: one version large, flipped through in reading order;
// Stage, where answers are, is a deliberate step from there. A fork with a
// single version hangs under the version it came from (a riff) until it has a
// second, then it is a column of its own.
// Each steer (more like this, a comment, a borrow) is its own reply. A moment
// with situations shows one at a time; a variant not drawn in that one keeps
// its column, empty, so the columns never move under the switch.
// On a phone there is no room for a grid of one state: every state's columns
// run as one strip, a card per swipe, and the state under the snap is the one
// on stage, so the flow bar names where you are instead of paging.

import { isLive } from "../../server/types.ts";
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
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
  sameVersion,
  versionName,
  versionSteps,
  type VersionRef,
  type VersionStep,
  keepSame,
  stepKey,
} from "./logic.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { FullView } from "./FullView.tsx";
import { Thumb } from "./Thumb.tsx";
import { linkClick, mockPath } from "./route.ts";
import type { Shortlists } from "./shortlist.ts";
import { ShortlistMenu, type MenuFor } from "./ShortlistMenu.tsx";
import { phoneLayout } from "./viewport.ts";

// More canvas pages live than this and a browser drops the oldest one's WebGL
// context; one past the budget waits as a placeholder until it is pointed at.
// Any other page has no such limit and is live whenever it is near the screen.
const CANVAS_MAX = 16;

// The agent's still of the page: an image costs no live frame, so it is
// always shown and never counts against the budget.
const Poster = (props: { id: string }) => (
  <img class="sk-poster" src={assetUrl(props.id)} alt="" loading="lazy" decoding="async" />
);

// Without a poster, an image surface is still cheaper than the page.
function pictureOf(st: VersionStep): string | null {
  const i = st.kinds.includes("image") ? st.kinds.indexOf("image") : st.kinds.indexOf("html");
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
  "look" | "full" | "open" | "more" | "comment" | "borrow" | "pick" | "remove",
  (st: VersionStep) => void
> & {
  // null where a version can't be saved: a shortlist's own candidates.
  saved: (st: VersionStep) => boolean | null;
  save: (st: VersionStep, from: HTMLElement) => void;
};

// What one state shows: its variants as columns, each down its versions.
// Everything here reads the board's own state rather than the one on stage,
// since a phone's strip draws every state at once.
type Board = ReturnType<typeof boardOf>;
function boardOf(s: MockScreenState, moment: string | null, state: () => string | null) {
  const inState = createMemo(() => s.variants().filter((v) => v.state === state()));
  const shown = createMemo<VersionStep[]>(
    (was) =>
      keepSame(
        was,
        versionSteps(s.variants(), state()).filter((st) => !st.hidden),
        stepKey,
      ),
    [],
  );
  const versionsOf = (variant: string) =>
    shown()
      .filter((st) => st.variant === variant)
      .reverse();
  const live = (v: VariantView) => isLive(v.status);
  const here = (v: VariantView) => v.state === state();
  // Only the moment on stage switches between its situations.
  const sits = () => (s.moment() === moment ? s.situations() : []);
  // One view per variant across the moment, in the order the situations name
  // them, so a switch keeps every column in place.
  const pool = createMemo(() => {
    const all = sits();
    if (!all.length) return inState();
    const inMoment = (v: VariantView) => all.some((x) => x.state === v.state);
    const names = [
      ...new Set(
        s
          .variants()
          .filter(inMoment)
          .map((v) => v.variant),
      ),
    ];
    return names.flatMap((n) => {
      const v =
        inState().find((p) => p.variant === n) ??
        s.variants().find((p) => p.variant === n && live(p) && inMoment(p));
      return v ? [v] : [];
    });
  });
  const situationName = () => sits().find((x) => x.state === state())?.name ?? "";
  const isRiff = (v: VariantView) =>
    !!v.forkedFrom &&
    live(v) &&
    versionsOf(v.variant).length === 1 &&
    inState().some((p) => p.variant === v.forkedFrom?.variant && live(p));
  // Roots in the order they were made, each followed by the forks that grew
  // into columns of their own.
  const columns = createMemo(() => {
    const vs = pool().filter(
      (v) => live(v) && !isRiff(v) && (!here(v) || versionsOf(v.variant).length),
    );
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
    const u = s.mock()?.inUse.find((x) => x.state === state());
    return u ? { variant: u.variant, version: u.version } : null;
  };
  // "Dark #2", or "#2" while the state has one variant.
  const nameOf = (ref: VersionRef) => versionName(ref, inState().length > 1);
  // A column goes as a whole: the variant and the forks hanging in it, except
  // what is in use, which only a new choice moves.
  const forksIn = (v: VariantView) =>
    here(v) ? versionsOf(v.variant).flatMap((st) => riffsOf(st).map((r) => r.variant)) : [];
  const isUsed = (variant: string) => inUse()?.variant === variant;
  const columnOut = (v: VariantView) =>
    isUsed(v.variant) ? [] : [v.variant, ...forksIn(v)].filter((n) => !isUsed(n));
  const columnLabel = (v: VariantView) => {
    const n = columnOut(v).length - 1;
    return n > 0 ? `${v.variant} and ${n} fork${n === 1 ? "" : "s"}` : v.variant;
  };
  const aside = createMemo(() => inState().filter((v) => !live(v) && versionsOf(v.variant).length));
  const riffsOf = (st: VersionStep) =>
    inState()
      .filter(
        (v) =>
          isRiff(v) && v.forkedFrom?.variant === st.variant && v.forkedFrom.version === st.version,
      )
      .map((v) => versionsOf(v.variant)[0]);
  // What Look closer flips through: the columns left to right, each down its
  // versions, a version's forks right after it, as the eye reads the grid.
  const runs = createMemo(() =>
    columns()
      .filter(here)
      .map((v) => ({
        variant: v.variant,
        steps: versionsOf(v.variant).flatMap((st) => [st, ...riffsOf(st)]),
      })),
  );
  return {
    moment,
    state,
    here,
    columns,
    columnOut,
    columnLabel,
    versionsOf,
    riffsOf,
    aside,
    runs,
    situationName,
    inUse,
    nameOf,
  };
}

// A version as Look closer flips to it: which board it is drawn on decides
// which state goes on stage with it.
type Entry = { b: Board; st: VersionStep };

export function Studio(props: {
  s: MockScreenState;
  top: number;
  shortlists: Shortlists;
  onOpen: () => void;
}) {
  const s = props.s;
  const sl = props.shortlists;
  const isShortlist = () => !!s.mock()?.shortlist;
  // The mocks a shortlist's candidates came from, to name and link them.
  const [projectMocks] = createResource(
    () => (isShortlist() ? s.mock()?.project : null),
    (project) => api.mocks(project),
  );
  const [saving, setSaving] = createSignal<{
    item: NonNullable<MenuFor>;
    from: HTMLElement;
  } | null>(null);
  const [adding, setAdding] = createSignal(false);
  const boards = mapArray(s.moments, (m) =>
    boardOf(s, m, () => (s.moment() === m ? s.activeState() : m)),
  );
  const active = () => boards().find((b) => b.moment === s.moment()) ?? boards()[0];
  const strip = phoneLayout;
  const drawn = () => (strip() ? boards() : [active()]);
  const countIn = (state: string | null) =>
    s.variants().filter((v) => v.state === state && isLive(v.status)).length;
  const runs = createMemo(() =>
    drawn().flatMap((b) =>
      b.runs().map((r) => ({
        variant: r.variant,
        steps: r.steps.map((st): Entry => ({ b, st })),
      })),
    ),
  );
  const order = createMemo(() => runs().flatMap((r) => r.steps));

  // Archived variants are out of the exploration: a quiet count in the window's
  // corner, opened on purpose.
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  // Live frames: the versions in view; for canvas pages, up to the budget.
  const [inView, setInView] = createSignal<string[]>([]);
  const [onScreen, setOnScreen] = createSignal<string[]>([]);
  const [pointedAt, setPointedAt] = createSignal<string[]>([]);
  const places = new Map<string, { top: number; left: number; canvas: boolean }>();
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
  const key = (st: VersionStep) => `${st.variant}@${st.version}`;
  // Variant names repeat across states, so a frame is told apart by both.
  const frameKey = (b: Board, st: VersionStep) => `${b.state() ?? ""}\n${key(st)}`;
  // Look closer: in the URL (?look=), so Back on a phone closes it and Back
  // from Stage reopens it where you were. It names a version of the state on stage.
  const readParam = (name: string) => new URLSearchParams(host().window.location.search).get(name);
  const withParam = (name: string, k: string | null) => {
    const w = host().window;
    const q = new URLSearchParams(w.location.search);
    if (k) q.set(name, k);
    else q.delete(name);
    return `${w.location.pathname}?${q}`;
  };
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
      ? (order().find((e) => e.b.state() === s.activeState() && key(e.st) === k) ?? null)
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
      if (e.b.state() !== s.activeState()) s.showState(e.b.state());
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
      ? (order().find((e) => e.b.state() === s.activeState() && key(e.st) === k) ?? null)
      : null;
  };
  const openFull = (e: Entry) => {
    const h = host().window.history;
    h.pushState(h.state, "", withParam("full", key(e.st)));
    fullPushed = true;
    batch(() => {
      if (e.b.state() !== s.activeState()) s.showState(e.b.state());
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
  const step = (d: number) => {
    const list = order();
    const i = list.findIndex((e) => e === looking());
    const next = list[i + d];
    if (i >= 0 && next) look(next);
  };

  const inBudget = (b: Board, st: VersionStep) => {
    // The closer look or full screen covers the grid: its one live frame
    // stands in for all of them.
    if (lookKey() || fullKey()) return false;
    const key = frameKey(b, st);
    if (!inView().includes(key)) return false;
    if (!places.get(key)?.canvas) return true;
    return canvasOrder().indexOf(key) < CANVAS_MAX - (archivedOpen() ? active().aside().length : 0);
  };
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
    });
  };

  const [borrowFrom, setBorrowFrom] = createSignal<Entry | null>(null);
  const [writing, setWriting] = createSignal<Draft | null>(null);

  // The strip: the state whose card sits at the snap goes on stage once a
  // swipe settles, and a state put on stage from elsewhere (the flow bar, the
  // situation switch) brings its first card to the snap.
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
      if (!b || b.state() === s.activeState()) return;
      followed = b.state();
      s.showState(b.state());
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
    else if (archivedOpen()) setArchivedOpen(false);
  };
  let corner: HTMLElement | undefined;
  const onDown = (e: PointerEvent) => {
    if (archivedOpen() && !corner?.contains(e.target as Node)) setArchivedOpen(false);
  };
  onMount(() => host().window.addEventListener("pointerdown", onDown, true));
  onCleanup(() => host().window.removeEventListener("pointerdown", onDown, true));
  onMount(() => host().window.addEventListener("keydown", onKey));
  onCleanup(() => host().window.removeEventListener("keydown", onKey));

  // A board's steers: each acts on the state on stage, so the board's own
  // state goes on stage first.
  const actsFor = (b: Board): Acts => {
    const here = () => {
      if (b.state() !== s.activeState()) s.showState(b.state());
    };
    return {
      look: (st) => look({ b, st }),
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
        const id = s.mock()?.id;
        if (!id || isShortlist()) return null;
        return sl.isSaved({ mock: id, state: b.state(), variant: st.variant, version: st.version });
      },
      // One click once a list is chosen. A version already saved, or no list
      // yet, opens the menu: taking it back or naming one is a choice to see.
      save(st, from) {
        const id = s.mock()?.id;
        if (!id) return;
        const item = {
          ref: { mock: id, state: b.state(), variant: st.variant, version: st.version },
          name: b.nameOf(st),
        };
        const list = sl.current();
        if (list && !sl.isSaved(item.ref)) void sl.save(item.ref, item.name, { to: list.id });
        else setSaving(saving()?.from === from ? null : { item, from });
      },
    };
  };

  const card = (b: Board, act: Acts, st: VersionStep, small = false) => {
    // A borrow goes between versions of one state.
    const borrowing = () => borrowFrom()?.b === b;
    return (
      <Sketch
        s={s}
        b={b}
        st={st}
        small={small}
        live={inBudget(b, st)}
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
      classList={{ strip: strip() }}
      ref={(el) => (scroller = el)}
      style={{ top: `${props.top}px` }}
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
      <Show when={s.situations().length > 1}>
        <div class="studio-sits" role="radiogroup" aria-label="Situation">
          <For each={s.situations()}>
            {(x) => (
              <button
                type="button"
                role="radio"
                aria-checked={x.state === s.activeState()}
                onClick={() => {
                  setBorrowFrom(null);
                  setWriting(null);
                  if (x.state !== s.activeState()) s.showState(x.state);
                }}
              >
                {x.name}
                <span class="n">{countIn(x.state)}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="studio-cols">
        <For each={drawn()}>
          {(b, i) => {
            const act = actsFor(b);
            return (
              <section
                class="studio-state"
                data-board={i()}
                data-state={b.state() ?? ""}
                aria-label={strip() ? (b.moment ?? undefined) : undefined}
              >
                <Show when={strip() && drawn().length > 1}>
                  <h2 class="studio-sth">
                    {b.moment}
                    <span class="n">{countIn(b.state())}</span>
                  </h2>
                </Show>
                <div class="studio-run">
                  <For each={b.columns()}>
                    {(v) => (
                      <section class="studio-col" aria-label={v.variant}>
                        <header class="studio-colh">
                          <h2>{v.variant}</h2>
                          <Show when={v.forkedFrom}>
                            {(f) => <span class="studio-from">{`from ${f().variant}`}</span>}
                          </Show>
                          <Show when={!readonly() && !borrowFrom() && b.columnOut(v).length}>
                            <button
                              type="button"
                              class="ib x-remove col-x"
                              aria-label={
                                isShortlist()
                                  ? `Remove ${b.columnLabel(v)} from the shortlist`
                                  : `Archive ${b.columnLabel(v)}`
                              }
                              title={
                                isShortlist()
                                  ? `Remove ${b.columnLabel(v)} from the shortlist`
                                  : `Archive ${b.columnLabel(v)}`
                              }
                              onClick={() => {
                                if (b.state() !== s.activeState()) s.showState(b.state());
                                void s.archiveVariants(b.columnOut(v), b.columnLabel(v));
                              }}
                            >
                              <Icon name="close" />
                            </button>
                          </Show>
                        </header>
                        <Show when={v.copiedFrom}>
                          {(c) => <Origin from={c()} mocks={projectMocks()?.mocks ?? []} />}
                        </Show>
                        <Show
                          when={b.here(v)}
                          fallback={<div class="studio-hole">{`No ${b.situationName()} yet`}</div>}
                        >
                          <For each={b.versionsOf(v.variant)}>
                            {(st) => (
                              <>
                                {card(b, act, st)}
                                <Show when={b.riffsOf(st).length}>
                                  <div class="studio-riffs">
                                    <For each={b.riffsOf(st)}>{(r) => card(b, act, r, true)}</For>
                                  </div>
                                </Show>
                              </>
                            )}
                          </For>
                        </Show>
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
          <ShortlistMenu sl={sl} anchor={m.from} item={m.item} onClose={() => setSaving(null)} />
        )}
      </Show>
      <Show when={adding() && s.mock()}>
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
      <Show when={active().aside().length}>
        <div class="studio-archived" ref={(el) => (corner = el)}>
          <section
            class="arch-pop"
            classList={{ open: archivedOpen() }}
            aria-label="Archived"
            aria-hidden={!archivedOpen()}
            inert={!archivedOpen() || undefined}
          >
            <h3>Archived</h3>
            <For each={active().aside()}>
              {(v) => {
                const st = () => active().versionsOf(v.variant)[0];
                return (
                  <div class="arch-row">
                    <span class="arch-th">
                      <Show
                        when={st()?.poster}
                        fallback={
                          <Show when={archivedOpen() && st() && pictureOf(st())}>
                            {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
                          </Show>
                        }
                      >
                        {(p) => <Poster id={p()} />}
                      </Show>
                    </span>
                    <span class="arch-nm">{v.variant}</span>
                    <Show when={!readonly()}>
                      <button
                        type="button"
                        class="ib"
                        aria-label={`Restore ${v.variant}`}
                        title="Restore"
                        onClick={() => void s.restoreVariant(v.variant, [s.activeState()])}
                      >
                        <Icon name="undo" />
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
          </section>
          <button
            type="button"
            class="arch-count"
            aria-expanded={archivedOpen()}
            onClick={() => setArchivedOpen(!archivedOpen())}
          >
            {`${active().aside().length} archived`}
            <Icon name="down" />
          </button>
        </div>
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
            runs={runs()}
            last={e().b.versionsOf(e().st.variant).length === 1}
            onStep={step}
            onGo={look}
            onClose={closeLook}
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

function Sketch(props: {
  s: MockScreenState;
  b: Board;
  st: VersionStep;
  small: boolean;
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
  return (
    <div
      class="sk"
      classList={{
        small: props.small,
        source: props.source,
        target: props.borrowing && !props.source,
      }}
      data-key={`${st().variant}@${st().version}`}
      data-state={props.b.state() ?? ""}
      // A poster is an image: it holds no context, so it takes no budget.
      data-canvas={st().canvas && !st().poster ? "" : undefined}
      ref={props.ref}
      onPointerEnter={() => !props.live && props.onWake()}
    >
      <button
        type="button"
        class="sk-art"
        aria-label={
          props.borrowing && !props.source ? `Borrow into ${label()}` : `Look closer at ${label()}`
        }
        title={st().prompt ?? ""}
        onClick={() => (props.borrowing ? props.act.pick(st()) : props.act.look(st()))}
        onFocus={() => !props.live && props.onWake()}
      >
        <Show
          when={st().poster}
          fallback={
            <Show when={props.live && src()}>
              {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
            </Show>
          }
        >
          {(p) => <Poster id={p()} />}
        </Show>
      </button>
      <Show when={props.small}>
        <span class="sk-name" title={st().variant}>
          {st().variant}
        </span>
      </Show>
      <Show when={!props.small}>
        <div class="sk-foot">
          <span class="sk-n">{`#${st().version}`}</span>
          <Show when={inUse()}>
            <span class="sk-tag">in use</span>
          </Show>
          <Show when={can()}>
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
      <Show when={can() && props.act.saved(st()) !== null}>
        <button
          type="button"
          class="ib sk-save"
          aria-pressed={!!props.act.saved(st())}
          aria-label={`Save ${name()} to a shortlist`}
          title={props.act.saved(st()) ? "Saved to a shortlist" : "Save to a shortlist"}
          onClick={(e) => props.act.save(st(), e.currentTarget)}
        >
          <Icon name="bookmark" />
        </button>
      </Show>
      <Show when={can() && !inUse()}>
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

// Where a shortlist's candidate came from, and the way back to it.
function Origin(props: {
  from: CopyRef;
  mocks: { id: string; slug: string; title: string; project: string }[];
}) {
  const mock = () => props.mocks.find((m) => m.id === props.from.mock);
  return (
    <Show when={mock()}>
      {(m) => {
        const label = () => [m().title, props.from.state].filter(Boolean).join(" · ");
        const href = () =>
          mockPath(m().project, m().slug, {
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
function Look(props: {
  s: MockScreenState;
  entry: Entry;
  top: number;
  order: Entry[];
  runs: { variant: string; steps: Entry[] }[];
  last: boolean;
  onStep: (d: number) => void;
  onGo: (e: Entry) => void;
  onClose: () => void;
  act: Acts;
}) {
  const s = props.s;
  const st = () => props.entry.st;
  const at = () => props.order.indexOf(props.entry);
  const name = () => s.nameOf(st());
  const inUse = () => sameVersion(s.inUse(), st());
  const note = () =>
    s.variants().find((v) => v.state === s.activeState() && v.variant === st().variant)?.note;
  const can = () => !readonly();
  let box: HTMLDivElement | undefined;
  onMount(() => box?.focus({ preventScroll: true }));
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
  const hide = () => {
    const list = props.order;
    const next = list[at() + 1] ?? list[at() - 1];
    // Together: an archive leaves at once, and the look closes on a version gone
    // from under it.
    batch(() => {
      props.act.remove(st());
      if (next) props.onGo(next);
      else props.onClose();
    });
  };
  let dots: HTMLElement | undefined;
  // The strip can run longer than the screen; the version shown stays in it.
  createEffect(
    on(
      () => props.entry,
      () =>
        dots
          ?.querySelector<HTMLElement>(".look-dot.on")
          ?.scrollIntoView({ block: "nearest", inline: "center" }),
    ),
  );
  return (
    <div
      class="look"
      ref={(el) => (box = el)}
      tabIndex={-1}
      role="dialog"
      aria-label={`Look closer: ${name()}`}
      style={{ top: `${props.top}px` }}
    >
      <header class="look-h">
        <h2>{name()}</h2>
        <Show when={inUse()}>
          <span class="sk-tag">in use</span>
        </Show>
        <span class="look-at">{`${at() + 1} of ${props.order.length}`}</span>
        <span class="look-sp" />
        <button type="button" class="btn look-stage" onClick={() => props.act.open(st())}>
          Open on Stage
        </button>
        <button
          type="button"
          class="ib"
          aria-label="Back to Studio"
          title="Back to Studio (Esc)"
          onClick={props.onClose}
        >
          <Icon name="close" />
        </button>
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
          <Show when={pageOf(st())}>
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
            {(u) => <Thumb src={u} width={s.frameW()} fit whole title={name()} />}
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
      <Show when={note()}>
        <p class="look-note">{note()}</p>
      </Show>
      <Show when={can()}>
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
          <Show when={props.act.saved(st()) !== null}>
            <button
              type="button"
              class="btn look-save"
              aria-pressed={!!props.act.saved(st())}
              onClick={(e) => props.act.save(st(), e.currentTarget)}
            >
              <Icon name="bookmark" />
              {props.act.saved(st()) ? "Saved" : "Save"}
            </button>
          </Show>
          <Show when={!inUse()}>
            <button type="button" class="btn quiet" onClick={hide}>
              {props.last ? "Archive" : "Hide"}
            </button>
          </Show>
        </div>
      </Show>
      <nav class="look-strip" aria-label="Versions" ref={(el) => (dots = el)}>
        <For each={props.runs}>
          {(run) => (
            <div class="look-group">
              <span class="look-gname">{run.variant}</span>
              <div class="look-dots">
                <For each={run.steps}>
                  {(x) => (
                    <button
                      type="button"
                      class="look-dot"
                      classList={{ on: x === props.entry }}
                      aria-label={x.b.nameOf(x.st)}
                      aria-current={x === props.entry || undefined}
                      title={x.b.nameOf(x.st)}
                      onClick={() => props.onGo(x)}
                    />
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </nav>
    </div>
  );
}

// A comment on one version, or what to borrow from where: one line, aimed at a
// part when the version declares any, sent as its own reply.
function NoteBox(props: { s: MockScreenState; draft: Draft; onDone: () => void }) {
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
