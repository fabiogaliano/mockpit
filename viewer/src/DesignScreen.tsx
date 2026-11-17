// Focus: one design, decided on. A quiet top bar (project / page / design, the panel's
// toggle), the design live on a canvas with its version and what acts on that above it and
// its tools beside it, its states (or variants, or alternatives) in a margin on its left
// and a panel on its right with Question, Spec and Activity (Margins.tsx). Esc and the
// page in the path go back up to the Board, fit to the frame. A phone has no room beside
// the design: it is one frame a swipe walks through the states, named in tabs above with a
// counter. Its foot is a bar of Question and Spec, each a sheet over the design's lower
// part, the question's open by itself while one waits; above it one bar floats (New
// version, the versions, Use this, Try / Mark / Tune) while no sheet is up, and the version
// label opens the history and the activity as a bottom panel.

import type { DesignDetail, Shortlist } from "./api.ts";
import { rememberRecent } from "./Jump.tsx";
import { AddCandidates } from "./AddCandidates.tsx";
import { createShortlists, type Shortlists } from "./shortlist.ts";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { isProduct } from "../../server/spec.ts";
import { isLive } from "../../server/types.ts";
import { About, type AboutState, createAbout } from "./About.tsx";
import { BottomPanel } from "./BottomPanel.tsx";
import { hasFiles } from "./attach.ts";
import { BuiltFrom } from "./BuiltFrom.tsx";
import { ChangedNote } from "./ChangedNote.tsx";
import { comparable, CompareTwo } from "./Compare.tsx";
import { ReadyMark } from "./ReadyMark.tsx";
import { SystemNote } from "./SystemNote.tsx";
import { FIELD, useFlowKeys } from "./flowKeys.ts";
import { createFlowNav, type FlowNav } from "./flowNav.ts";
import { host, readonly, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import {
  GHOST_W,
  historyRow,
  type VersionStep,
  READING_W,
  readsAsDocument,
  sameVersion,
  stillWorking,
  type VersionRef,
  versionStamp,
} from "./logic.ts";
import { sectionOf } from "./albums.ts";
import { turnClock } from "./Album.tsx";
import {
  createMargins,
  LeftMargin,
  type Margins,
  PanelToggle,
  RightMargin,
  ToolStrip,
} from "./Margins.tsx";
import { NotFound } from "./NotFound.tsx";
import { OutlineChips, PlannedStage, StateAsk } from "./Outlines.tsx";
import { PhoneBar, QuestionCard } from "./QuestionCard.tsx";
import { QuestionDot, questionDotted } from "./QuestionDot.tsx";
import { ArchivedNote } from "./Questions.tsx";
import { AnswerPills } from "./Kept.tsx";
import { Present } from "./Present.tsx";
import { SideOver } from "./SideOver.tsx";
import { SideBySide, sideAsk } from "./SideBySide.tsx";
import { Reader, ReaderSend } from "./Reader.tsx";
import { markSeen, sawBefore } from "./seen.ts";
import {
  boardPath,
  cameFrom,
  designPath,
  homePath,
  linkClick,
  navigate,
  projectPath,
  replaceUrl,
  route,
} from "./route.ts";
import { usePopover } from "./popover.ts";
import { PaletteTool } from "./PaletteTool.tsx";
import { PreviewTool } from "./PreviewTool.tsx";
import { Stage } from "./Stage.tsx";
import type { ScreenOpen } from "./route.ts";
import { carryToast, Toast } from "./toast.tsx";
import { createDesignScreen, type DesignScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";
import { WakeLine } from "./Thread.tsx";
import { createTune } from "./tune.ts";
import { NewVersionButton, UseThis, VersionBar, VersionStepper } from "./VersionBar.tsx";
import {
  canvasBox,
  canvasTop,
  designAt,
  NO_INSET,
  phoneLayout,
  setCanvasTop,
  setCardInset,
  win,
} from "./viewport.ts";
import { setPeek } from "./systemRev.ts";

// A phone's swipe: how far the finger goes before it is a step, and how long the frame
// takes to leave and the next to come in.
const SWIPE_STEP = 60;
const SWIPE_MS = 170;

// One version of one alternative, across every design this screen shows.
const stepKeyOf = (st: VersionStep) => `${st.postId}@${st.version}`;

// Where a design lives on the Board, which Esc and the path go back to: its page, fit to
// the frame on stage and selected (an idea's on the Ideas page, at the alternative on
// stage); or, for what no page draws, the Library page that lists it.
function boardHome(
  m: DesignDetail,
  state: string | null,
  alternative?: string,
): { href: string; name: string } {
  const sel = { slug: m.slug, state };
  if (m.archivedAt) return { href: projectPath(m.project, "archive"), name: "Archive" };
  if (isProduct(m)) {
    if (m.area) return { href: boardPath(m.project, { page: m.area, sel }), name: m.area };
    if (m.kind === "screen")
      return { href: boardPath(m.project, { unsorted: true, sel }), name: "No area" };
    return { href: projectPath(m.project, "components"), name: "Components" };
  }
  const states = m.states.length ? m.states : [null];
  return sectionOf({ ...m, states, asked: m.asks.length }) === "documents"
    ? { href: projectPath(m.project, "documents"), name: "Documents" }
    : {
        href: boardPath(m.project, {
          ideas: true,
          sel: { ...sel, ...(alternative ? { alternative } : {}) },
        }),
        name: "Ideas",
      };
}

// The same Board page, whichever frame is selected on it.
const samePage = (a: string, b: string) => {
  const page = (x: string) => {
    const u = new URL(x, "http://x");
    u.searchParams.delete("sel");
    u.searchParams.delete("alt");
    u.searchParams.sort();
    return `${u.pathname}?${u.searchParams}`;
  };
  return page(a) === page(b);
};

// Up from Focus to the Board at `href`. Opened from that Board page, it is Back, so Back on
// the Board doesn't return to Focus, and the address then selects the frame on stage now;
// else the Board takes Focus's entry.
function upToBoard(href: string) {
  const from = cameFrom().from;
  if (!from || !samePage(from, href)) {
    navigate(href, { replace: true });
    return;
  }
  const w = host().window;
  // A tick after Back's own listeners, which read the address arrived at.
  w.addEventListener("popstate", () => w.setTimeout(() => replaceUrl(href), 0), { once: true });
  host().history.back();
}
const upClick = (e: MouseEvent, href: string) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  e.preventDefault();
  upToBoard(href);
};

export function DesignScreen(props: {
  project: string;
  slug: string;
  open?: ScreenOpen | null;
  flow?: string | null;
}) {
  const opening = new URLSearchParams(host().window.location.search);
  const s = createDesignScreen(
    props.project,
    props.slug,
    props.open ?? null,
    opening.has("owed"),
    opening.get("question"),
  );
  // See before is a look from this screen's note; nowhere else says it is on.
  onCleanup(() => setPeek(null));
  const shortlists = createShortlists(props.project, s.setToast);
  // What's on stage is written: it opens as a column instead of on the canvas. By the
  // version on stage, which can differ from its neighbours (markdown, then a page).
  const reading = createMemo(() => {
    const m = s.design();
    const v = s.activeAlternative();
    if (!m || !v) return false;
    const version = s.frameVersionOf(v);
    const kinds = historyRow(v, version)?.surfaceKinds ?? v.surfaces.map((x) => x.kind);
    return readsAsDocument(m.widths, kinds as string[]);
  });
  // In a state with nothing drawn: the plan stands where the design will.
  const undrawn = () => !!s.design() && !s.alternatives().some((v) => v.state === s.activeState());
  const outlining = () => !reading() && s.outlinable();
  // The question whose answers stand side by side in place of the design, if any. A
  // phone has no room for a row: it keeps one answer at a time on the frame.
  const sideRow = createMemo(() =>
    !reading() && !undrawn() && !phoneLayout() ? sideAsk(s) : null,
  );
  // The URL follows the place on screen. A tick later: Back runs several popstate
  // listeners in turn, and writing between them would stamp the place being left
  // onto the entry just arrived at.
  let urlTimer = 0;
  onCleanup(() => host().window.clearTimeout(urlTimer));
  createEffect(() => {
    if (!s.design()) return;
    s.activeState();
    s.stagePick();
    host().window.clearTimeout(urlTimer);
    urlTimer = host().window.setTimeout(() => {
      const w = host().window;
      const q = new URLSearchParams(w.location.search);
      const put = (key: string, value: string | number | null | undefined) => {
        if (value === null || value === undefined) q.delete(key);
        else q.set(key, String(value));
      };
      const pick = s.stagePick();
      put("state", s.activeState());
      put("alternative", pick?.alternative);
      put("version", pick?.version);
      q.delete("owed");
      q.delete("question");
      const next = q.size ? `?${q}` : "";
      if (next !== w.location.search) replaceUrl(`${w.location.pathname}${next}`);
    }, 0);
  });
  // Back, Forward or a link to another place on this same design: the screen stays
  // mounted and moves there.
  createEffect(
    on(
      () => {
        const r = route();
        return r.screen === "design" ? JSON.stringify(r.open) : null;
      },
      () => {
        const r = route();
        if (r.screen === "design" && r.open) s.landOn(r.open);
      },
      { defer: true },
    ),
  );
  // A question from Needs you while this design is open: the address names it, Focus goes
  // to it and takes it out of the address, so the same question named again goes again.
  createEffect(
    on(
      () => {
        const r = route();
        return r.screen === "design" ? r.question : null;
      },
      (id) => {
        if (!id || !s.design()) return;
        s.openQuestion(id);
        const w = host().window;
        const q = new URLSearchParams(w.location.search);
        q.delete("question");
        q.delete("owed");
        replaceUrl(`${w.location.pathname}${q.size ? `?${q}` : ""}`);
      },
      { defer: true },
    ),
  );
  const nav = createFlowNav(s, props.project, props.slug, props.flow ?? null);
  // Played from the Board's ▶ or P: the flow full screen, ended back on the Board.
  const presenting = opening.has("present");
  const endPresent = () =>
    navigate(designPath(props.project, props.slug, { state: s.activeState(), alternative: null }));
  // A version picked to compare with the one on stage, 2-up in one frame. Another state or
  // design ends it; a reload of this one (a publish, a still landing) doesn't.
  const [comparing, setComparing] = createSignal<VersionStep | null>(null);
  const designId = createMemo(() => s.design()?.id);
  createEffect(on([() => s.activeState(), designId], () => setComparing(null), { defer: true }));
  const t = createTune(s);
  const m = createMargins(
    s,
    nav,
    () => !!s.design() && !phoneLayout(),
    () => (reading() ? READING_W : null),
    outlining,
    () => !!sideRow(),
  );
  // The tools act on a page, and a document isn't one.
  createEffect(() => {
    const tool = s.tool();
    if (reading() && tool) s.toggleTool(tool);
  });
  useFlowKeys(s);
  const about = createAbout(
    () => s.design()?.project ?? props.project,
    () => {
      const m = s.design();
      return m ? `${m.updatedAt}:${versionStamp(m.alternatives)}` : null;
    },
  );
  // On stage is seen (seen.ts): the Board's dot on its frame goes until a newer version.
  // What came before is read first, once for each version that comes on stage, so a changed
  // one keeps offering "Compare with what you saw" while the user is here. An answer's own
  // page isn't the alternative's version, so looking at one sees nothing.
  const [saw, setSaw] = createSignal<ReadonlyMap<string, number | undefined>>(new Map());
  createEffect(() => {
    const m = s.design();
    const st = s.stageStep();
    if (!m || !st || st.hidden) return;
    const before = untrack(saw);
    const at = stepKeyOf(st);
    if (!before.has(at))
      setSaw(new Map(before).set(at, sawBefore(m.project, st.postId, st.version)));
    markSeen(m.project, st.postId, st.version, true);
  });
  const sawStep = createMemo(() => {
    const st = s.stageStep();
    const v = st ? saw().get(stepKeyOf(st)) : undefined;
    if (!st || v === undefined) return null;
    return comparable(s).find((x) => x.postId === st.postId && x.version === v) ?? null;
  });
  createEffect(() => {
    const id = s.design()?.id;
    if (id) rememberRecent(id);
  });
  // The agent renamed the design or its project while it was open: the address
  // follows, so a reload or a shared link still finds it.
  createEffect(() => {
    const m = s.design();
    if (!m || (m.slug === props.slug && m.project === props.project)) return;
    const path = `${projectPath(m.project)}/${encodeURIComponent(m.slug)}`;
    navigate(`${path}${host().location.search}`, { replace: true, focus: true });
  });
  createEffect(() =>
    s.setTunable(
      t
        .components()
        .filter((c) => c.paths.length || s.mixOpts().some((o) => o.part === c.part))
        .map((c) => c.part),
    ),
  );
  let head!: HTMLElement;
  let bottom!: HTMLDivElement;
  const [panelH, setPanelH] = createSignal(0);
  const [bottomTop, setBottomTop] = createSignal(0);
  // A phone's foot: the question's sheet and the bar under it, and the bar alone, which the
  // history's panel sits on.
  const [dockH, setDockH] = createSignal(0);
  const [barH, setBarH] = createSignal(0);
  const measured = (el: HTMLElement, set: (h: number) => void) => {
    const ro = new ResizeObserver(() => set(el.offsetHeight));
    ro.observe(el);
    onCleanup(() => {
      ro.disconnect();
      set(0);
    });
  };
  const sheetUp = () => !s.questionHidden() && !!s.curAsk() && !s.design()?.archivedAt;

  // The canvas starts under the top bar and the flow bar; the border box,
  // since the top padding is the safe-area inset, which Safari changes as its
  // own bars come and go.
  onMount(() => {
    const measure = () => {
      setCanvasTop(head.getBoundingClientRect().bottom);
      if (bottom) setBottomTop(bottom.getBoundingClientRect().top);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(head, { box: "border-box" });
    ro.observe(bottom);
    host().window.addEventListener("resize", measure);
    measure();
    onCleanup(() => {
      ro.disconnect();
      host().window.removeEventListener("resize", measure);
    });
  });
  createEffect(
    on([panelH, dockH, () => s.questions().length, () => s.cardMin()], () =>
      host().window.requestAnimationFrame(() => setBottomTop(bottom.getBoundingClientRect().top)),
    ),
  );
  // What floats over the canvas takes its bands. A phone's bottom stack takes the
  // foot, or the first screen would sit under it. Elsewhere nothing but passing notes
  // floats there, and fitting around those would resize the design as they come and go.
  createEffect(() => {
    if (phoneLayout()) {
      setCardInset({ ...NO_INSET, bottom: Math.max(0, win().h - bottomTop() + 8) });
      return;
    }
    const ghost = m.ghosts() ? GHOST_W : 0;
    setCardInset({ ...NO_INSET, left: m.stripW() + ghost, right: ghost });
  });
  onCleanup(() => setCardInset(NO_INSET));

  // A file dropped beside a drop zone would make the browser open it and leave
  // the page; files land only where a zone takes them.
  onMount(() => {
    const w = host().window;
    const guard = (e: DragEvent) => {
      if (hasFiles(e.dataTransfer)) e.preventDefault();
    };
    w.addEventListener("dragover", guard);
    w.addEventListener("drop", guard);
    onCleanup(() => {
      w.removeEventListener("dragover", guard);
      w.removeEventListener("drop", guard);
    });
  });

  // Esc turns a canvas tool off, then closes what floats, one at a time, then goes back
  // up to the Board, fit to this frame. C takes up Comment, as in a design tool.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || presenting) return;
      const at = e.composedPath()[0];
      if (at instanceof Element && at.closest(FIELD)) return;
      if (e.key === "c" || e.key === "C") {
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (readonly() || reading() || !m.page()) return;
        s.toggleTool("mark");
        e.preventDefault();
        return;
      }
      if (e.key !== "Escape") return;
      if (s.tool()) s.toggleTool(s.tool()!);
      else if (s.askingState()) s.setAskingState(null);
      else if (m.leftFloats()) m.closeLeft();
      else if (s.drawer()) s.setDrawer(false);
      else if (s.design())
        upToBoard(boardHome(s.design()!, s.activeState(), s.activeAlternative()?.alternative).href);
      else return;
      e.preventDefault();
    };
    root().addEventListener("keydown", onKey);
    onCleanup(() => root().removeEventListener("keydown", onKey));
  });

  // On a phone a swipe across the design walks the steps the tabs name, the frame following
  // the finger: past SWIPE_STEP it goes on to the next and the next comes in from the other
  // side, short of that it springs back, and past either end it only gives a little. Only
  // the design takes it, so the answers' own row in the sheet still scrolls.
  const [swipeX, setSwipeX] = createSignal(0);
  const [gliding, setGliding] = createSignal(false);
  onMount(() => {
    let start: { x: number; y: number } | null = null;
    let across = false;
    let timer = 0;
    const still = () =>
      host().window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const glide = (x: number, then: () => void) => {
      setGliding(true);
      setSwipeX(x);
      timer = host().window.setTimeout(then, SWIPE_MS);
    };
    const down = (e: TouchEvent) => {
      const t0 = e.touches[0];
      const onDesign = !!(e.target as Element).closest?.(".stagewrap, .planned-stage");
      start =
        phoneLayout() && onDesign && e.touches.length === 1 && !s.trying() && s.zoom() === "fit"
          ? { x: t0.clientX, y: t0.clientY }
          : null;
      across = false;
    };
    const move = (e: TouchEvent) => {
      const t0 = e.touches[0];
      if (!start || !t0) return;
      if (e.touches.length > 1) {
        start = null;
        setSwipeX(0);
        return;
      }
      const dx = t0.clientX - start.x;
      const dy = t0.clientY - start.y;
      if (!across) {
        if (Math.hypot(dx, dy) < 10) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          start = null;
          return;
        }
        across = true;
      }
      setGliding(false);
      setSwipeX(nav.near(dx < 0 ? 1 : -1) ? dx : dx * 0.25);
    };
    const up = (e: TouchEvent) => {
      const t0 = e.changedTouches[0];
      if (!start || !t0) return;
      const dx = t0.clientX - start.x;
      start = null;
      const by = dx < 0 ? 1 : -1;
      const to = across && Math.abs(dx) >= SWIPE_STEP ? nav.near(by) : undefined;
      if (!to || still()) {
        setSwipeX(0);
        if (to) nav.go(to);
        return;
      }
      const w = win().w;
      glide(-by * w, () => {
        nav.go(to);
        setGliding(false);
        setSwipeX(by * w);
        host().window.requestAnimationFrame(() =>
          host().window.requestAnimationFrame(() => glide(0, () => setGliding(false))),
        );
      });
    };
    const cancel = () => {
      start = null;
      setSwipeX(0);
    };
    const el = root().querySelector(".design-screen");
    el?.addEventListener("touchstart", down as EventListener, { passive: true });
    el?.addEventListener("touchmove", move as EventListener, { passive: true });
    el?.addEventListener("touchend", up as EventListener);
    el?.addEventListener("touchcancel", cancel);
    onCleanup(() => {
      host().window.clearTimeout(timer);
      el?.removeEventListener("touchstart", down as EventListener);
      el?.removeEventListener("touchmove", move as EventListener);
      el?.removeEventListener("touchend", up as EventListener);
      el?.removeEventListener("touchcancel", cancel);
    });
  });
  // A toast that offers an Undo stays until it is answered or dismissed.
  createEffect(() => {
    if (s.error()) s.setToast({ text: s.error()! });
  });
  // The last design gone leaves nothing to look at: up to where this design lives. Not
  // for a design opened empty, whose Archived is what the user came for. Replaces, so
  // Back doesn't return to the empty page.
  let hadLive = false;
  createEffect(() => {
    if (s.alternatives().some((v) => isLive(v.status))) hadLive = true;
    if (!hadLive || !s.emptied()) return;
    const back = `${host().location.pathname}${host().location.search}`;
    navigate(homePath(props.project, s.design()?.area ?? null), { replace: true });
    s.handToast((line) => carryToast(line, back));
  });

  return (
    <div
      class="screen design-screen"
      classList={{ phone: phoneLayout(), sbsmode: !!sideRow(), gliding: gliding() }}
      style={{
        "--swipe-x": `${swipeX()}px`,
        "--pbar-h": `${barH()}px`,
        "--foot-top": `${bottomTop()}px`,
        "--canvas-l": `${m.band().left}px`,
        "--canvas-r": `${m.band().right}px`,
        "--canvas-top": `${canvasTop()}px`,
        "--strip": `${m.stripW()}px`,
        "--design-l": `${designAt()?.left ?? 0}px`,
        "--design-t": `${designAt()?.top ?? 0}px`,
        "--design-r": `${designAt()?.right ?? 0}px`,
        "--canvas-end": `${m.band().right + canvasBox().over}px`,
      }}
    >
      <header class="mhead" ref={(el) => (head = el)}>
        <TopRow
          s={s}
          project={props.project}
          slug={props.slug}
          about={about}
          reading={reading()}
          tabs={m.statesShown()}
          shortlists={shortlists}
          panels={
            <Show when={m.active()}>
              <PanelToggle m={m} />
            </Show>
          }
        />
        {/* Beside a docked left margin the same steps are its first list. */}
        <Show when={m.statesShown() && !m.leftDocked() && !sideRow()}>
          <FlowBar nav={nav} count={phoneLayout()}>
            <Show when={outlining()}>
              <OutlineChips s={s} />
            </Show>
          </FlowBar>
        </Show>
      </header>
      <Show
        when={!s.missing()}
        fallback={
          <main class="main">
            <NotFound
              title={`“${props.slug}” isn't in ${props.project}`}
              hint="It may have been renamed or moved."
              href={projectPath(props.project)}
              back={`Back to ${props.project}`}
            />
          </main>
        }
      >
        <Show when={s.design()}>
          <Show when={!undrawn()} fallback={<PlannedStage s={s} />}>
            <Show
              when={!reading()}
              fallback={
                <Reader
                  s={s}
                  head={
                    <Show when={m.active()}>
                      <VersionCaption s={s} m={m} reading />
                    </Show>
                  }
                />
              }
            >
              <Stage s={s} onGoto={nav.follow} />
              <Show when={sideRow()}>{(ask) => <SideBySide s={s} ask={ask()} />}</Show>
              <Show when={!sideRow() && comparing() && s.stageStep()}>
                <CompareTwo
                  s={s}
                  before={comparing()!}
                  after={s.stageStep()!}
                  saw={comparing() === sawStep()}
                  onClose={() => setComparing(null)}
                />
              </Show>
              <Show when={m.ghosts()}>
                <Ghost s={s} nav={nav} by={-1} />
                <Ghost s={s} nav={nav} by={1} />
              </Show>
            </Show>
          </Show>
        </Show>
        <div
          class="mbottom"
          ref={(el) => (bottom = el)}
          style={{
            bottom: `${(s.panel() ? panelH() : 0) + (phoneLayout() ? dockH() : 0) + 12}px`,
          }}
        >
          <Show when={s.tool()}>
            {(tool) => (
              <div class="modehint" role="status">
                {
                  {
                    try: "Tap the outlined parts",
                    mark: "Tap where something should change",
                    tune: "Tap a part to adjust it",
                  }[tool()]
                }
              </div>
            )}
          </Show>
          <SentNote s={s} slug={props.slug} />
          <Show when={s.design()}>
            <StateAsk s={s} />
            <Show when={phoneLayout()}>
              <Show when={reading()}>
                <ReaderSend s={s} m={m} />
              </Show>
              <Show when={!undrawn() && !sheetUp()}>
                <VersionBar s={s} reading={reading()} />
              </Show>
            </Show>
          </Show>
        </div>
        <Show when={s.design()}>
          <Show
            when={phoneLayout()}
            fallback={
              <>
                <ToolStrip s={s} m={m} />
                <Show when={m.active() && !undrawn() && !reading() && !sideRow()}>
                  <VersionCaption
                    s={s}
                    m={m}
                    reading={false}
                    saw={sawStep()}
                    onCompare={setComparing}
                  />
                </Show>
                <LeftMargin s={s} nav={nav} m={m} />
                <RightMargin s={s} t={t} m={m} sl={shortlists} />
              </>
            }
          >
            <div class="pdock" ref={(el) => measured(el, setDockH)}>
              <QuestionCard s={s} />
              <PhoneBar s={s} ref={(el) => measured(el, setBarH)} />
            </div>
            <Show when={questionDotted(s)}>
              <QuestionDot s={s} />
            </Show>
            <Show when={s.panel()}>
              <BottomPanel s={s} onHeight={setPanelH} />
            </Show>
            <BuiltFrom s={s} t={t} />
          </Show>
        </Show>
      </Show>
      <Toast toast={s.toast()} onDismiss={() => s.setToast(null)} />
      <div class="sr-only" role="status">
        {s.reactStatus()}
      </div>
      <Show when={presenting && s.design()}>
        <Present s={s} nav={nav} onEnd={endPresent} />
      </Show>
    </div>
  );
}

// The version on stage and what acts on it, on the top edge of the design they're about:
// a row of its own over the canvas, or the head of a document's column. Each piece is
// opaque, since panning brings the design under them.
function VersionCaption(props: {
  s: DesignScreenState;
  m: Margins;
  reading: boolean;
  // The version this browser last had on screen, when a newer one is on stage.
  saw?: VersionStep | null;
  onCompare?: (with_: VersionStep) => void;
}) {
  const s = props.s;
  const holding = () => s.heldPreview()?.key === s.preview()?.key;
  return (
    <div class="vcap" classList={{ inline: props.reading }} role="group" aria-label="This version">
      <AnswerPills s={s} />
      <div class="mact">
        <Show when={s.preview()?.label}>
          {(label) => (
            <div class="previewcap" role="status" title={label()}>
              <b>{holding() ? "Holding" : "Previewing"}</b>
              <span>{label()}</span>
              <Show when={holding()}>
                <button
                  type="button"
                  aria-label="Stop holding this preview"
                  onClick={() => s.setPreview(null)}
                >
                  <Icon name="close" />
                </button>
              </Show>
            </div>
          )}
        </Show>
        <Show when={s.boundVersion() !== null}>
          <div role="status">
            <button
              type="button"
              class="btn vcap-arrived"
              title={`Your answers stay on ${s.arrived()?.bound ?? "this one"} until you do`}
              onClick={() => s.viewNewVersion()}
            >
              {`${s.arrived()?.name ?? "A new version"} arrived`}
              <span class="vcap-view">View</span>
            </button>
          </div>
        </Show>
        <Show when={s.steps().length > 1 && !props.m.leftDocked()}>
          <VersionStepper
            s={s}
            listOpen={props.m.leftFloats()}
            listNames="states and versions"
            onList={props.m.toggleLeft}
          />
        </Show>
        <Show when={props.onCompare && props.saw}>
          {(saw) => (
            <button
              type="button"
              class="btn"
              title={`${s.nameOf(saw())} was on your screen last. Compare it with this one, 2-up`}
              onClick={() => props.onCompare?.(saw())}
            >
              Compare with what you saw
            </button>
          )}
        </Show>
        <Show when={props.onCompare && comparable(s).length}>
          <select
            class="btn vcap-compare"
            aria-label="Compare with another version"
            title="Compare with another version, 2-up"
            value=""
            onChange={(e) => {
              const n = Number(e.currentTarget.value);
              e.currentTarget.value = "";
              const to = comparable(s).find((x) => x.n === n);
              if (to) props.onCompare?.(to);
            }}
          >
            <option value="">Compare with…</option>
            <For each={comparable(s).toReversed()}>
              {(x) => <option value={x.n}>{s.nameOf(x)}</option>}
            </For>
          </select>
        </Show>
        <Show when={!readonly()}>
          <NewVersionButton s={s} />
        </Show>
        <Show when={!props.reading}>
          <UseThis s={s} primary />
        </Show>
      </div>
    </div>
  );
}

// Where you are, as the way up: project / page / design, where the page is the Board's
// page the design is on and goes back there fit to it, as Esc does. The design's name
// opens what's around it, then the state. A phone has room for the name alone (the tabs
// below it name the state), so an arrow up to the page stands in for the rest.
// Two zones: the design on the left, the panel's toggle on the right. A phone's row runs
// them together, and keeps the width since it has no tool strip.
function TopRow(props: {
  s: DesignScreenState;
  project: string;
  slug: string;
  about: AboutState;
  // A document: no widths to choose between.
  reading: boolean;
  // Whether the state tabs are showing, which name the state where it isn't.
  tabs: boolean;
  shortlists: Shortlists;
  // The right panel's toggle: in this row it costs the design no room.
  panels: JSX.Element;
}) {
  const s = props.s;
  const sl = props.shortlists;
  // A new idea started here is for this screen or component.
  const [ideaFor, setIdeaFor] = createSignal(false);
  const home = () => boardPath(props.project);
  const up = () => {
    const m = s.design();
    return m
      ? boardHome(m, s.activeState(), s.activeAlternative()?.alternative)
      : { href: home(), name: shortProject() };
  };
  // The owner is the same on every design; the repo's own name is enough.
  const shortProject = () => props.project.split("/").pop() ?? props.project;
  const title = () => s.design()?.title ?? props.slug;
  const idea = () => {
    const m = s.design();
    if (!m) return false;
    const states = m.states.length ? m.states : [null];
    return sectionOf({ ...m, states, asked: m.asks.length }) === "ideas";
  };
  // The name an agent finds this by, as far down as the screen is looking.
  const spoken = () => {
    const step = s.stageStep();
    const named = step && (s.steps().length > 1 || !s.nameOf(step).startsWith("#"));
    return [title(), s.activeState(), named ? s.nameOf(step) : null].filter(Boolean).join(", ");
  };
  const copyName = () => {
    const name = spoken();
    // Without a secure origin there is no clipboard: the toast still gives the name.
    const failed = () => s.setToast({ text: `Couldn't copy. The name: ${name}` });
    const copying = host().window.navigator.clipboard?.writeText(name);
    if (!copying) return failed();
    copying.then(() => s.setToast({ text: `Copied: ${name}` }), failed);
  };
  const [more, setMore] = createSignal(false);
  let moreMenu: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);
  let btn: HTMLButtonElement | undefined;
  let pop: HTMLElement | undefined;
  usePopover(
    more,
    () => setMore(false),
    () => btn,
    () => moreMenu,
  );
  createEffect(() => {
    if (!open()) return;
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      btn?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop?.contains(t) && !btn?.contains(t)) setOpen(false);
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });
  const archive = () => idea() && !s.design()?.archivedAt && !readonly();
  const pill = () => (
    <Show
      when={
        !readonly() && !s.design()?.shortlist && sl.current()?.candidates.length
          ? sl.current()
          : null
      }
    >
      {(list) => <ShortlistPill list={list()} project={props.project} />}
    </Show>
  );
  return (
    <div class="mtop">
      <div class="mzone">
        <SideOver project={props.project} area={s.design()?.area ?? null} />
        <a
          class="ib mup"
          href={up().href}
          aria-label={`Up to ${up().name}`}
          onClick={(e) => upClick(e, up().href)}
        >
          <Icon name="back" />
        </a>
        <div class="mname">
          <nav class="crumb mcrumb" aria-label="Path">
            <a class="crumb-far crumb-link" href={home()} onClick={(e) => linkClick(e, home())}>
              {shortProject()}
            </a>
            <span class="crumb-far sep">/</span>
            <Show when={s.design()}>
              <a
                class="crumb-far crumb-link"
                href={up().href}
                title={`Back to ${up().name} (Esc)`}
                onClick={(e) => upClick(e, up().href)}
              >
                {up().name}
              </a>
              <span class="crumb-far sep">/</span>
            </Show>
            <b class="crumb-name">{title()}</b>
            <Show when={!props.tabs && s.activeState()}>
              {(state) => <span class="crumb-far crumb-sit">{`· ${state()}`}</span>}
            </Show>
          </nav>
          <ReadyMark s={s} />
        </div>
        <Show when={s.design()}>
          <Show
            when={!phoneLayout()}
            fallback={
              <>
                <Show when={archive()}>
                  <button
                    type="button"
                    class="ib x-remove mend"
                    aria-label={`Archive ${title()}`}
                    title="Archive"
                    onClick={() => void s.archiveDesign()}
                  >
                    <Icon name="close" />
                  </button>
                </Show>
                <button
                  type="button"
                  class="ib mabout"
                  aria-label={`About ${title()}`}
                  title="About"
                  aria-expanded={open()}
                  aria-haspopup="dialog"
                  ref={(el) => (btn = el)}
                  onClick={() => {
                    props.about.wake();
                    setOpen(!open());
                  }}
                >
                  <Icon name="info" />
                </button>
              </>
            }
          >
            <div class="mmore">
              <button
                type="button"
                class="ib"
                classList={{ on: more() || open() }}
                aria-label={`More about ${title()}`}
                title="More"
                aria-expanded={more()}
                aria-haspopup="menu"
                ref={(el) => (btn = el)}
                onClick={() => (open() ? setOpen(false) : setMore(!more()))}
              >
                <Icon name="more" />
              </button>
              <Show when={more()}>
                <div
                  class="wmenu"
                  role="menu"
                  aria-label={`More about ${title()}`}
                  ref={(el) => (moreMenu = el)}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMore(false);
                      props.about.wake();
                      setOpen(true);
                    }}
                  >
                    <Icon name="info" />
                    About
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    title={spoken()}
                    onClick={() => {
                      setMore(false);
                      copyName();
                    }}
                  >
                    <Icon name="copy" />
                    Copy name
                  </button>
                  <Show when={s.product() && !readonly()}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMore(false);
                        setIdeaFor(true);
                      }}
                    >
                      <Icon name="idea" />
                      New idea for this
                    </button>
                  </Show>
                  <Show when={archive()}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMore(false);
                        void s.archiveDesign();
                      }}
                    >
                      <Icon name="close" />
                      Archive
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
        <Show when={ideaFor() && s.design()}>
          {(m) => (
            <AddCandidates
              sl={sl}
              project={props.project}
              typed={{ for: { id: m().id, title: m().title } }}
              onClose={() => setIdeaFor(false)}
            />
          )}
        </Show>
        <About
          s={s}
          r={props.about}
          project={props.project}
          slug={props.slug}
          open={open()}
          onClose={() => setOpen(false)}
          ref={(el) => (pop = el)}
        />
      </div>
      <Show when={phoneLayout()}>
        <span class="grow" />
      </Show>
      <div class="mzone mzone-mid">
        <Show when={phoneLayout()}>
          {pill()}
          <Show when={!props.reading && s.design()}>
            <PreviewTool s={s} qr={false} />
            <PaletteTool s={s} />
          </Show>
        </Show>
      </div>
      <div class="mzone mzone-end">
        <Show when={!phoneLayout()}>{pill()}</Show>
        {props.panels}
      </div>
    </div>
  );
}

// The way back to the last gathered idea saved to.
function ShortlistPill(props: { list: Shortlist; project: string }) {
  const href = () => designPath(props.project, props.list.slug);
  return (
    <div class="slpill">
      <a href={href()} title={`Open ${props.list.title}`} onClick={(e) => linkClick(e, href())}>
        <Icon name="bookmark" />
        <span class="slpill-nm">{props.list.title}</span>
        <span class="num">{props.list.candidates.length}</span>
      </a>
    </div>
  );
}

// The steps by name: the declared flow this screen is a step of, else the design's
// own states in order. A step the agent still waits on is marked. The current
// one stays in view however many there are, the next peeking past the edge.
function FlowBar(props: { nav: FlowNav; count?: boolean; children?: JSX.Element }) {
  const nav = props.nav;
  let list!: HTMLDivElement;
  createEffect(() => {
    const el = list.children[nav.at()] as HTMLElement | undefined;
    if (el) list.scrollLeft = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
  });
  return (
    <nav class="flowbar" aria-label={nav.flow() ? `Steps of ${nav.name()}` : "States"}>
      <Show when={nav.flow()}>
        <b class="flowname">{nav.name()}</b>
      </Show>
      <div class="ftabs" ref={(el) => (list = el)}>
        <For each={nav.steps()}>
          {(x, i) => (
            <button
              type="button"
              class="ftab"
              classList={{ "ftab-outline": nav.planned(x) }}
              aria-current={i() === nav.at() ? "step" : undefined}
              aria-label={
                nav.owes(x)
                  ? `${nav.label(x)}, a question is waiting`
                  : nav.planned(x)
                    ? `${nav.label(x)}, not drawn`
                    : nav.label(x)
              }
              title={nav.label(x)}
              onClick={() => nav.go(x)}
            >
              <span>{nav.label(x)}</span>
              <Show when={nav.owes(x)}>
                <i class="ftab-q" aria-hidden="true" />
              </Show>
            </button>
          )}
        </For>
        <Show when={nav.outside().length}>
          <span class="ftab-others" role="group" aria-label="Other states">
            <For each={nav.outside()}>
              {(x) => (
                <button
                  type="button"
                  class="ftab"
                  aria-current={x.state === nav.here().state ? "step" : undefined}
                  title={nav.label(x)}
                  onClick={() => nav.go(x)}
                >
                  <span>{nav.label(x)}</span>
                </button>
              )}
            </For>
          </span>
        </Show>
        {props.children}
      </div>
      {/* A phone's swipe walks them: where it is, of how many. */}
      <Show when={props.count && nav.at() >= 0 && nav.steps().length > 1}>
        <span class="fcount" aria-label={`Step ${nav.at() + 1} of ${nav.steps().length}`}>
          {`${nav.at() + 1} / ${nav.steps().length}`}
        </span>
      </Show>
      {/* The way back to what they hold: each state's archived alternatives fold under it. */}
      <Show when={nav.emptied().length}>
        <select
          class="ftab-emptied"
          aria-label="States with everything archived"
          title="States with everything archived"
          value=""
          onChange={(e) => {
            const to = e.currentTarget.value;
            e.currentTarget.value = "";
            if (to) nav.go({ design: nav.here().design, state: to });
          }}
        >
          <option value="">{`${nav.emptied().length} empty`}</option>
          <For each={nav.emptied()}>{(m) => <option value={m ?? ""}>{m}</option>}</For>
        </select>
      </Show>
    </nav>
  );
}

// The previous or next step as a small dimmed picture at the canvas's edge;
// another design's step shows the design in use there.
function Ghost(props: { s: DesignScreenState; nav: FlowNav; by: 1 | -1 }) {
  const s = props.s;
  const step = () => props.nav.near(props.by);
  const label = () => (step() ? props.nav.label(step()!) : "");
  return (
    <Show when={step()}>
      {(x) => (
        <button
          type="button"
          class="ghost"
          classList={{ left: props.by < 0, right: props.by > 0 }}
          aria-label={`${props.by < 0 ? "Previous" : "Next"} step: ${label()}`}
          onClick={() => props.nav.go(x())}
        >
          <Show when={props.nav.picture(x())} fallback={<span class="ghost-blank" />}>
            {(u) => (
              <Thumb
                src={u()}
                width={s.frameW()}
                class={s.frameW() > 600 ? "ghost-thumb flat" : "ghost-thumb"}
                fit
                whole
              />
            )}
          </Show>
          <span class="lbl">{props.by < 0 ? `‹ ${label()}` : `${label()} ›`}</span>
        </button>
      )}
    </Show>
  );
}

// After a Send: how far it has come (not seen, delivered, the agent working, a new
// version). What's next is Needs you's to say.
function SentNote(props: { s: DesignScreenState; slug: string }) {
  const s = props.s;
  const looking = (a: VersionRef & { state: string | null }) =>
    s.activeState() === a.state && sameVersion(s.onStage(), a);
  const progress = () => {
    if (s.sentDelivered() === false) return "Not seen yet";
    const to = s.sentReply()?.recipient;
    const delivered = to ? `Delivered to ${to}` : "Delivered";
    return stillWorking(s.sentReply()?.calledAt, turnClock())
      ? `${delivered} · Agent working`
      : delivered;
  };
  const listeningHint = () => {
    const to = s.sentReply()?.recipient;
    return to ? `${to} is listening` : "Your agent's watcher is open";
  };
  return (
    <div class="sentnote">
      <Show when={s.design()?.archivedAt}>
        <ArchivedNote s={s} />
      </Show>
      <SystemNote s={s} />
      <ChangedNote s={s} />
      <Show when={s.sent()}>
        <div class="sentrow" role="status">
          <Show
            when={s.sinceSend()}
            fallback={
              <button
                type="button"
                class="pill count"
                classList={{ waiting: s.sentDelivered() === false }}
                onClick={() => s.setPanel("thread")}
              >
                <i class="dot" classList={{ ok: s.sentDelivered() !== false }} />
                <span>{`Sent · ${progress()}`}</span>
              </button>
            }
          >
            {(a) => (
              <Show when={!sameVersion(s.changed()?.to, a())}>
                <Show
                  when={!looking(a())}
                  fallback={
                    <span class="pill count">
                      <i class="dot ok" />
                      <span>{`New version · ${s.nameOf(a())} is on stage`}</span>
                    </span>
                  }
                >
                  <button type="button" class="pill count" onClick={s.seeSinceSend}>
                    <i class="dot ok" />
                    <span>{`New version · See ${s.nameOf(a())} ›`}</span>
                  </button>
                </Show>
              </Show>
            )}
          </Show>
          <Show when={s.beatPassed() && s.agentListening()}>
            <span class="sent-hint" title={listeningHint()}>
              {listeningHint()}
            </span>
          </Show>
        </div>
        {/* Activity says this itself when it's open beside the design. */}
        <Show when={s.beatPassed() && !s.agentListening() && s.panel() !== "thread"}>
          <WakeLine slug={props.slug} />
        </Show>
      </Show>
    </div>
  );
}
