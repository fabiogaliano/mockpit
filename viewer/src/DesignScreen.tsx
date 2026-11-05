// The design screen: a quiet top bar (where you are, Stage, Studio or Grid, the panels),
// the design on a canvas with its version and what acts on that above it and its tools
// beside it, states and versions in a margin on its left and what's said about it in one
// on its right, each there only with something in it (Margins.tsx). A phone has no room beside the design:
// its states are tabs above, one bar floats below (New version, the versions, Use this,
// Try / Mark / Tune) with the question above that, and the version label opens the
// history and the thread as a bottom panel.

import type { Shortlist } from "./api.ts";
import { rememberRecent } from "./Jump.tsx";
import { ArrangeSwitch, type Arrangement, StudioBar } from "./StudioBar.tsx";
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
  Match,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { isLive } from "../../server/types.ts";
import { About, type AboutState, createAbout } from "./About.tsx";
import { BottomPanel } from "./BottomPanel.tsx";
import { hasFiles } from "./attach.ts";
import { BuiltFrom } from "./BuiltFrom.tsx";
import { useFlowKeys } from "./flowKeys.ts";
import { createFlowNav, type FlowNav } from "./flowNav.ts";
import { Grid } from "./Grid.tsx";
import { host, readonly, root } from "./host.ts";
import { Icon } from "./icons.tsx";
import {
  GHOST_W,
  gridComparesForms,
  historyRow,
  isBuiltinAsk,
  READING_W,
  readsAsDocument,
  repeatsAcrossStates,
  sameVersion,
  stillWorking,
  type VersionRef,
  versionStamp,
  WALL_FROM,
} from "./logic.ts";
import { questions, sectionOf } from "./albums.ts";
import { turnClock, useTurn } from "./Album.tsx";
import {
  createMargins,
  LeftMargin,
  type Margins,
  PanelTabs,
  RightMargin,
  ToolStrip,
} from "./Margins.tsx";
import { CarriedChip, NextCard, WakeLine } from "./NextCard.tsx";
import { NotFound } from "./NotFound.tsx";
import { OutlineChips, PlannedStage, StateAsk } from "./Outlines.tsx";
import { QuestionCard, QuestionTab } from "./QuestionCard.tsx";
import { ArchivedNote } from "./Questions.tsx";
import { SideOver } from "./SideOver.tsx";
import { Reader, ReaderSend } from "./Reader.tsx";
import { markSeen } from "./seen.ts";
import {
  homePath,
  linkClick,
  designPath,
  navigate,
  projectPath,
  replaceUrl,
  route,
} from "./route.ts";
import { usePopover } from "./popover.ts";
import { PreviewTool } from "./PreviewTool.tsx";
import { Stage } from "./Stage.tsx";
import { Studio } from "./Studio.tsx";
import type { ScreenOpen } from "./route.ts";
import { carryToast, Toast } from "./toast.tsx";
import { createDesignScreen, type DesignScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";
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

type View = "stage" | "studio" | "grid";
const isView = (v: string | null | undefined): v is View =>
  v === "stage" || v === "studio" || v === "grid";

export function DesignScreen(props: {
  project: string;
  slug: string;
  open?: ScreenOpen | null;
  flow?: string | null;
}) {
  const opening = new URLSearchParams(host().window.location.search);
  const s = createDesignScreen(props.project, props.slug, props.open ?? null, opening.has("owed"));
  const shortlists = createShortlists(props.project, s.setToast);
  // Stage, Studio or Grid: one version up close, the state zoomed out, or every state
  // against every variant. The URL's ?view= wins and isn't remembered, so a link can't
  // move your place. Else the agent's unanswered question opens on Stage, where it is
  // asked (a question that picks a variant doesn't count: Studio is the other way to
  // compare them). Else the view last switched to in this browser, then Studio when
  // there is a choice to look at, or Grid when those are a component's forms.
  const asked = opening.get("view");
  const [view, setViewSignal] = createSignal<View | null>(isView(asked) ? asked : null);
  const viewKey = (id: string) => `mockpit-view:${id}`;
  const remembered = (): View | null => {
    const id = s.design()?.id;
    const v = id ? host().storage?.getItem(viewKey(id)) : null;
    return isView(v) ? v : null;
  };
  const stateVariants = () =>
    new Set(
      s
        .variants()
        .filter((v) => v.state === s.activeState() && isLive(v.status))
        .map((v) => v.variant),
    ).size;
  // What's on stage is written: it opens as a column instead of on the canvas. By the
  // version on stage, which can differ from its neighbours (markdown, then a page).
  const reading = createMemo(() => {
    const m = s.design();
    const v = s.activeVariant();
    if (!m || !v) return false;
    const version = s.frameVersionOf(v);
    const kinds = historyRow(v, version)?.surfaceKinds ?? v.surfaces.map((x) => x.kind);
    return readsAsDocument(m.widths, kinds as string[]);
  });
  const wallSized = () => s.variants().length >= WALL_FROM;
  const [columns, setColumns] = createSignal(
    new URLSearchParams(host().window.location.search).get("cols") === "1",
  );
  const [barSlot, setBarSlot] = createSignal<HTMLDivElement>();
  // The arrangement left off in, for the Studio button to come back to.
  const [compared, setCompared] = createSignal<"studio" | "grid" | null>(null);
  const comparesForms = () => gridComparesForms(s.design()?.kind ?? "idea", s.variants());
  const gridOffered = () => repeatsAcrossStates(s.variants()) || comparesForms();
  // The grid stands in for Studio on a component. Not on a wall: a component with 85
  // variants (onni's) is more than a table can show, and Studio's wall is how it's read.
  const gridFirst = () => comparesForms() && !wallSized();
  // Decided once per visit: answering the last question or moving to another
  // state must not swap the view under you.
  const opened = createMemo<View | null>((before) => {
    if (before || !s.design()) return before;
    return untrack(() => {
      if (s.waitsOnStage()) return "stage";
      // Too many to reach any other way, whichever view was last used here.
      if (wallSized()) return "studio";
      // A gathered idea stays for comparing, below, even if what it holds is written.
      if (reading() && !s.design()?.shortlist) return "stage";
      const was = remembered();
      if (gridFirst()) return was === "stage" ? "stage" : "grid";
      // A gathered idea is for comparing, and its Add candidate lives in Studio.
      return was ?? (stateVariants() > 1 || s.design()?.shortlist ? "studio" : "stage");
    });
  }, null);
  // A grid left by the last archive falls back rather than show an empty table.
  const shownView = (): View => {
    const v = view() ?? opened() ?? "stage";
    return v === "grid" && !gridOffered() ? "stage" : v;
  };
  // On stage, in a state with nothing drawn: the plan stands where the design will.
  const undrawn = () => !!s.design() && !s.variants().some((v) => v.state === s.activeState());
  const outlining = () => shownView() === "stage" && !reading() && s.outlinable();
  let openLooked: (() => void) | null = null;
  // Each step between the views is its own history entry, so Back
  // returns to the view you came from rather than leaving the design.
  const setView = (v: View) => {
    if (v !== "stage") setCompared(v);
    const w = host().window;
    const q = new URLSearchParams(w.location.search);
    q.set("view", v);
    // A closer look belongs to the Studio entry it was opened on, where Back finds it.
    q.delete("look");
    // Before the view changes: the URL's upkeep below writes to the current
    // entry, and the one being left must keep naming the view it was.
    w.history.pushState(w.history.state, "", `${w.location.pathname}?${q}`);
    setViewSignal(v);
    const id = s.design()?.id;
    try {
      if (id) host().storage?.setItem(viewKey(id), v);
    } catch {
      // Storage refused: the URL still holds it for this visit.
    }
  };
  // The route ignores ?view=, so Back between the views keeps this screen mounted;
  // the view follows the URL here.
  const onPop = () => {
    const v = new URLSearchParams(host().window.location.search).get("view");
    setViewSignal(isView(v) ? v : null);
  };
  host().window.addEventListener("popstate", onPop);
  onCleanup(() => host().window.removeEventListener("popstate", onPop));
  // The URL follows the place on screen. A tick later: Back runs several popstate
  // listeners in turn, and writing between them would stamp the place being left
  // onto the entry just arrived at.
  let urlTimer = 0;
  onCleanup(() => host().window.clearTimeout(urlTimer));
  createEffect(() => {
    if (!s.design()) return;
    shownView();
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
      put("variant", pick?.variant);
      put("version", pick?.version);
      put("view", shownView());
      q.delete("owed");
      const next = `?${q}`;
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
  const arrangement = (): Arrangement =>
    shownView() === "grid" ? "grid" : wallSized() && !columns() ? "wall" : "columns";
  const arrangements = (): Arrangement[] => [
    ...(wallSized() ? (["wall"] as const) : []),
    "columns",
    ...(gridOffered() ? (["grid"] as const) : []),
  ];
  const arrange = (to: Arrangement) => {
    if (to === "grid") return setView("grid");
    setColumns(to === "columns");
    if (shownView() !== "studio") setView("studio");
  };
  const arrangeSwitch = (
    <Show when={arrangements().length > 1}>
      <ArrangeSwitch on={arrangement()} options={arrangements()} onPick={arrange} />
    </Show>
  );
  const nav = createFlowNav(s, props.project, props.slug, props.flow ?? null);
  const t = createTune(s);
  const m = createMargins(
    s,
    nav,
    () => !!s.design() && !phoneLayout() && shownView() === "stage",
    () => (reading() ? READING_W : null),
    outlining,
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
      return m ? `${m.updatedAt}:${versionStamp(m.variants)}` : null;
    },
  );
  // On screen is seen: Home's dot for this design goes until a newer version.
  createEffect(() => {
    const m = s.design();
    if (m) markSeen(m.project, m.id, versionStamp(m.variants));
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
    navigate(`${path}${host().location.search}`, { replace: true });
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
    on([panelH, () => s.questions().length, () => s.cardMin()], () =>
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

  // Esc turns a canvas tool off, then closes what is open, one at a time.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (s.tool()) s.toggleTool(s.tool()!);
      else if (s.askingState()) s.setAskingState(null);
      else if (m.leftFloats()) m.closeLeft();
      else if (s.drawer()) s.setDrawer(false);
      else if (s.panel()) s.setPanel(null);
      else return;
      e.preventDefault();
    };
    root().addEventListener("keydown", onKey);
    onCleanup(() => root().removeEventListener("keydown", onKey));
  });

  // On a phone a swipe across the design moves between the steps. Only on
  // Stage: Studio's strip and its closer look swipe through versions, and a
  // step taken under the same swipe skips whatever the state had left to show.
  onMount(() => {
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t0 = e.touches[0];
      start =
        phoneLayout() &&
        shownView() === "stage" &&
        e.touches.length === 1 &&
        !s.trying() &&
        s.zoom() === "fit"
          ? { x: t0.clientX, y: t0.clientY }
          : null;
    };
    const up = (e: TouchEvent) => {
      const t0 = e.changedTouches[0];
      if (!start || !t0) return;
      const dx = t0.clientX - start.x;
      const dy = t0.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      nav.step(dx < 0 ? 1 : -1);
    };
    const el = root().querySelector(".design-screen");
    el?.addEventListener("touchstart", down as EventListener, { passive: true });
    el?.addEventListener("touchend", up as EventListener);
    onCleanup(() => {
      el?.removeEventListener("touchstart", down as EventListener);
      el?.removeEventListener("touchend", up as EventListener);
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
    if (s.variants().some((v) => isLive(v.status))) hadLive = true;
    if (!hadLive || !s.emptied()) return;
    const back = `${host().location.pathname}${host().location.search}`;
    navigate(homePath(props.project, s.design()?.area ?? null), { replace: true });
    s.handToast((line) => carryToast(line, back));
  });

  return (
    <div
      class="screen design-screen"
      classList={{ phone: phoneLayout() }}
      style={{
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
          view={shownView()}
          reading={reading()}
          compare={s.variants().length > 1 || s.variants().some((v) => v.version > 1)}
          tabs={m.statesShown() || (shownView() !== "stage" && s.states().length > 1)}
          shortlists={shortlists}
          panels={
            <Show when={m.active()}>
              <PanelTabs s={s} m={m} />
            </Show>
          }
          panelsShown={m.active()}
          onView={(v) => {
            if (v === "stage" ? shownView() === "stage" : shownView() !== "stage") return;
            s.setDrawer(false);
            if (v === "stage" && openLooked) openLooked();
            else
              setView(v === "stage" ? "stage" : (compared() ?? (gridFirst() ? "grid" : "studio")));
          }}
        />
        {/* Beside a docked left margin the same steps are its first list. */}
        <Show when={m.statesShown() && !m.leftDocked() && shownView() === "stage"}>
          <FlowBar nav={nav}>
            <Show when={outlining()}>
              <OutlineChips s={s} />
            </Show>
          </FlowBar>
        </Show>
        <div ref={setBarSlot} />
        <Show when={shownView() === "grid" && arrangements().length > 1}>
          <StudioBar arrange={arrangeSwitch} />
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
          <Switch>
            <Match when={shownView() === "stage" && undrawn()}>
              <PlannedStage s={s} />
            </Match>
            <Match when={shownView() === "stage"}>
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
                <Show when={m.ghosts()}>
                  <Ghost s={s} nav={nav} by={-1} />
                  <Ghost s={s} nav={nav} by={1} />
                </Show>
              </Show>
            </Match>
            <Match when={shownView() === "studio"}>
              <Studio
                s={s}
                top={canvasTop()}
                shortlists={shortlists}
                onOpen={() => setView("stage")}
                onLooking={(open) => (openLooked = open)}
                columns={columns}
                barSlot={barSlot()}
                arrange={arrangeSwitch}
                arrangeable={arrangements().length > 1}
              />
            </Match>
            <Match when={shownView() === "grid"}>
              <Grid
                s={s}
                about={about}
                project={props.project}
                slug={props.slug}
                onOpen={(state, ref) => {
                  s.showState(state);
                  s.showVersion(ref);
                  setView("stage");
                }}
              />
            </Match>
          </Switch>
        </Show>
        <div
          class="mbottom"
          ref={(el) => (bottom = el)}
          style={{ bottom: `${(s.panel() ? panelH() : 0) + 12}px` }}
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
          <SentNote s={s} project={props.project} slug={props.slug} view={shownView()} />
          <Show when={s.design() && shownView() === "stage"}>
            <StateAsk s={s} />
            <Show when={phoneLayout()}>
              <Show when={reading()}>
                <ReaderSend s={s} m={m} />
              </Show>
              <QuestionCard s={s} />
              <Show when={!undrawn()}>
                <VersionBar s={s} reading={reading()} />
              </Show>
            </Show>
          </Show>
        </div>
        <Show when={s.design() && shownView() === "stage"}>
          <Show
            when={phoneLayout()}
            fallback={
              <>
                <ToolStrip s={s} m={m} />
                <Show when={m.active() && !undrawn() && !reading()}>
                  <VersionCaption s={s} m={m} reading={false} />
                </Show>
                <LeftMargin s={s} nav={nav} m={m} />
                <RightMargin s={s} t={t} m={m} />
              </>
            }
          >
            <QuestionTab s={s} />
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
    </div>
  );
}

// The version on stage and what acts on it, on the top edge of the design they're about:
// a row of its own over the canvas, or the head of a document's column. Each piece is
// opaque, since panning brings the design under them.
function VersionCaption(props: { s: DesignScreenState; m: Margins; reading: boolean }) {
  const s = props.s;
  const holding = () => s.heldPreview()?.key === s.preview()?.key;
  return (
    <div class="vcap" classList={{ inline: props.reading }} role="group" aria-label="This version">
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

// Where you are, as the way up: the project and the area are links, the design's
// name opens what's around it, then the state. A phone has room for the name
// alone (the tabs below it name the state), so an arrow up to the area (else the
// project) stands in for the rest.
// Three zones: the design on the left, the views in the middle, the panels on the right.
// A phone's row runs them together, and keeps the width since it has no tool strip.
function TopRow(props: {
  s: DesignScreenState;
  project: string;
  slug: string;
  about: AboutState;
  view: View;
  // A document: no widths to choose between.
  reading: boolean;
  // More than one design or version to compare, in any state, archived too: Studio is
  // where those are.
  compare: boolean;
  // Whether the state tabs are showing, which name the state where it isn't.
  tabs: boolean;
  shortlists: Shortlists;
  onView: (v: "stage" | "studio") => void;
  // The right margin's tabs: in this row they cost the design no room.
  panels: JSX.Element;
  // They're showing, so they carry the count of questions.
  panelsShown: boolean;
}) {
  const s = props.s;
  const sl = props.shortlists;
  const home = () => homePath(props.project);
  const areaHome = (area: string) => homePath(props.project, area);
  const up = () => {
    const area = s.design()?.area;
    return area ? { href: areaHome(area), name: area } : { href: home(), name: shortProject() };
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
    const step = props.view === "stage" ? s.stageStep() : null;
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
  const openAsked = () =>
    new Set(s.flow().flatMap((e) => (isBuiltinAsk(e.ask) ? [] : [e.ask.id]))).size;
  // Whose turn it is, by the rule the covers use, from what this screen already holds.
  const shelved = useTurn(() => {
    const m = s.design();
    if (!m) return null;
    const send = s.lastSend();
    return {
      open: openAsked(),
      states: m.states.length ? m.states : [null],
      variants: m.variants,
      inUse: m.inUse,
      archivedAt: m.archivedAt,
      drafting: s.sendable(),
      ...(send ? { lastReplyAt: send.at, lastSend: send } : {}),
    };
  });
  const turn = () =>
    s.design()?.archivedAt ? { kind: "closed" as const, text: "Archived" } : shelved();
  // The words about a Send have their detail in the Thread, which only Stage has.
  const opensThread = (kind: string) =>
    props.view === "stage" && (kind === "unseen" || kind === "working" || kind === "sent");
  // Off Stage the panels are gone, but questions keep the corner their tab has there.
  const questionsTab = () => !phoneLayout() && props.view !== "stage" && turn()?.kind === "open";
  const toQuestions = () => {
    s.showTalk();
    if (!s.curAsk()) s.goOwed();
    props.onView("stage");
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
        <SideOver project={props.project} />
        <a
          class="ib mup"
          href={up().href}
          aria-label={`Up to ${up().name}`}
          onClick={(e) => linkClick(e, up().href)}
        >
          <Icon name="back" />
        </a>
        <div class="mname">
          <nav class="crumb mcrumb" aria-label="Path">
            <a class="crumb-far crumb-link" href={home()} onClick={(e) => linkClick(e, home())}>
              {shortProject()}
            </a>
            <span class="crumb-far sep">/</span>
            <Show when={s.design()?.area}>
              {(area) => (
                <>
                  <a
                    class="crumb-far crumb-link"
                    href={areaHome(area())}
                    onClick={(e) => linkClick(e, areaHome(area()))}
                  >
                    {area()}
                  </a>
                  <span class="crumb-far sep">/</span>
                </>
              )}
            </Show>
            <b class="crumb-name">{title()}</b>
            <Show when={!props.tabs && s.activeState()}>
              {(state) => <span class="crumb-far crumb-sit">{`· ${state()}`}</span>}
            </Show>
          </nav>
          {/* A tab says how many questions wait, so the name needn't too. */}
          <Show
            when={(props.panelsShown || questionsTab()) && turn()?.kind === "open" ? null : turn()}
          >
            {(t) => (
              <Show
                when={opensThread(t().kind)}
                fallback={
                  <span class="mturn alb-turn" data-turn={t().kind}>
                    {t().text}
                  </span>
                }
              >
                <button
                  type="button"
                  class="mturn alb-turn"
                  data-turn={t().kind}
                  title="See it in the Thread"
                  onClick={() => s.setPanel("thread")}
                >
                  {t().text}
                </button>
              </Show>
            )}
          </Show>
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
          <Show when={props.view === "stage" && !props.reading && s.design()}>
            <PreviewTool s={s} qr={false} />
          </Show>
        </Show>
        <Show when={props.compare || props.view !== "stage"}>
          <div class="vswitch" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={props.view === "stage"}
              aria-label={
                phoneLayout() && props.view !== "stage" && s.waitsOnStage()
                  ? "Stage, a question is waiting"
                  : "Stage"
              }
              onClick={() => props.onView("stage")}
            >
              Stage
              <Show when={phoneLayout() && props.view !== "stage" && s.waitsOnStage()}>
                <i class="vswitch-q" aria-hidden="true" />
              </Show>
            </button>
            <button
              type="button"
              aria-pressed={props.view !== "stage"}
              onClick={() => props.onView("studio")}
            >
              Studio
            </button>
          </div>
        </Show>
      </div>
      <div class="mzone mzone-end">
        <Show when={!phoneLayout()}>{pill()}</Show>
        {props.panels}
        <Show when={questionsTab()}>
          <div class="mtabs">
            <button
              type="button"
              class="ib ib-count"
              aria-label={`${questions(openAsked())}, open them on Stage`}
              title={`${questions(openAsked())}, open them on Stage`}
              onClick={toQuestions}
            >
              <Icon name="question" />
              <span class="num">{openAsked()}</span>
            </button>
          </div>
        </Show>
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
function FlowBar(props: { nav: FlowNav; children?: JSX.Element }) {
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
                    ? `${nav.label(x)}, planned`
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
      {/* The way back to what they hold: each state's archive sits in its own Studio. */}
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

// Past Use this, a newer version doesn't take over by itself: look, take it, or stay.
function ChangedNote(props: { s: DesignScreenState }) {
  const s = props.s;
  const looking = () => sameVersion(s.onStage(), s.changed()?.to);
  // Beside each other the design is the same one, so only the number tells them apart.
  const name = (ref: VersionRef) =>
    ref.variant === s.changed()?.to.variant && ref.variant === s.changed()?.use.variant
      ? `version ${ref.version}`
      : s.nameOf(ref);
  return (
    <Show when={!readonly() && !s.design()?.archivedAt && s.changed()}>
      {(c) => (
        <div class="status-note changed-note" role="status">
          <span>{`New version ready. You're using ${name(c().use)}.`}</span>
          <Show when={!looking()}>
            <button type="button" class="btn" onClick={() => s.showVersion(c().to)}>
              See it
            </button>
          </Show>
          <button type="button" class="btn" onClick={() => void s.useThis(c().to)}>
            Use it
          </button>
          <button type="button" class="btn" onClick={s.stayOnUse}>
            {`Keep ${name(c().use)}`}
          </button>
        </div>
      )}
    </Show>
  );
}

// After a Send: how far it has come (not seen, delivered, the agent working, a new
// version), and where to go next. With nothing left to answer this is what the screen
// stays on, so it can't be a dead end.
function SentNote(props: { s: DesignScreenState; project: string; slug: string; view: View }) {
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
  return (
    <div class="sentnote">
      <Show when={s.design()?.archivedAt}>
        <ArchivedNote s={s} />
      </Show>
      <ChangedNote s={s} />
      <Show when={s.sent()} fallback={<CarriedChip project={props.project} slug={props.slug} />}>
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
            <span class="sent-hint">
              {s.sentReply()?.recipient
                ? `${s.sentReply()?.recipient} is listening`
                : "your agent's watcher is open"}
            </span>
          </Show>
        </div>
        {/* The Thread says this itself when it's open beside the design, on Stage alone. */}
        <Show
          when={
            s.beatPassed() &&
            !s.agentListening() &&
            !(props.view === "stage" && s.panel() === "thread")
          }
        >
          <WakeLine slug={props.slug} />
        </Show>
      </Show>
      <NextCard s={s} />
    </div>
  );
}
