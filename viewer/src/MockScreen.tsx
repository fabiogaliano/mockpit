// The mock screen: a quiet top bar (where you are, what acts on the version, the
// width, Stage or Studio, the panels), the design on a canvas, states and versions
// in a margin on its left and what's said about it in one on its right, each there
// only with something in it (Margins.tsx). A phone has no room beside the design:
// its states are tabs above, one bar floats below (Revise, the versions, Use this,
// Try / Mark / Tune) with the question above that, and the version label opens the
// history and the thread as a bottom panel.

import type { Shortlist } from "./api.ts";
import { openJump, rememberRecent } from "./Jump.tsx";
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
import { isLive } from "../../server/types.ts";
import { About, type AboutState, createAbout } from "./About.tsx";
import { BottomPanel } from "./BottomPanel.tsx";
import { hasFiles } from "./attach.ts";
import { BuiltFrom } from "./BuiltFrom.tsx";
import { useFlowKeys } from "./flowKeys.ts";
import { createFlowNav, type FlowNav } from "./flowNav.ts";
import { host, readonly, root } from "./host.ts";
import { Icon, type IconName } from "./icons.tsx";
import {
  DEVICE_WIDTHS,
  GHOST_W,
  historyRow,
  isBuiltinAsk,
  READING_W,
  readsAsDocument,
  sameVersion,
  versionStamp,
  WALL_FROM,
  wideWidth,
  widthKind,
  widthLabel,
} from "./logic.ts";
import { questions, sectionOf } from "./albums.ts";
import { createMargins, LeftMargin, PanelTabs, RightMargin, ToolStrip } from "./Margins.tsx";
import { CarriedChip, NextCard } from "./NextCard.tsx";
import { NotFound } from "./NotFound.tsx";
import { QuestionCard, QuestionTab } from "./QuestionCard.tsx";
import { EndedNote } from "./Questions.tsx";
import { Reader, ReaderSend } from "./Reader.tsx";
import { markSeen } from "./seen.ts";
import {
  homePath,
  linkClick,
  mockPath,
  navigate,
  projectPath,
  replaceUrl,
  route,
} from "./route.ts";
import { SituationGrid, SituationSwitch } from "./Situations.tsx";
import { Stage } from "./Stage.tsx";
import { Studio } from "./Studio.tsx";
import type { ScreenOpen } from "./route.ts";
import { carryToast, Toast } from "./toast.tsx";
import { createMockScreen, type MockScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";
import { createTune } from "./tune.ts";
import {
  ReviseButton,
  SituationsButton,
  UseThis,
  VersionBar,
  VersionStepper,
} from "./VersionBar.tsx";
import { canvasTop, NO_INSET, phoneLayout, setCanvasTop, setCardInset, win } from "./viewport.ts";

type View = "stage" | "studio";

export function MockScreen(props: {
  project: string;
  slug: string;
  open?: ScreenOpen | null;
  flow?: string | null;
}) {
  const opening = new URLSearchParams(host().window.location.search);
  const s = createMockScreen(props.project, props.slug, props.open ?? null, opening.has("owed"));
  const shortlists = createShortlists(props.project, s.setToast);
  // Stage or Studio: one version up close, or the state zoomed out. The URL's
  // ?view= wins and isn't remembered, so a link can't move your place. Else the
  // agent's unanswered question opens on Stage, where it is asked (a question
  // that picks a variant doesn't count: Studio is the other way to compare
  // them). Else the view last switched to in this browser, then Studio when
  // there is a choice to look at.
  const asked = opening.get("view");
  const [view, setViewSignal] = createSignal<View | null>(
    asked === "studio" || asked === "stage" ? asked : null,
  );
  const viewKey = (id: string) => `mockpit-view:${id}`;
  const remembered = (): View | null => {
    const id = s.mock()?.id;
    const v = id ? host().storage?.getItem(viewKey(id)) : null;
    return v === "studio" || v === "stage" ? v : null;
  };
  // Studio shows the whole moment, so a variant drawn only in another of its
  // situations still makes it worth stepping out to.
  const momentVariants = () => {
    const sits = s.situations();
    const inMoment = (state: string | null) =>
      sits.length ? sits.some((x) => x.state === state) : state === s.activeState();
    return new Set(
      s
        .variants()
        .filter((v) => inMoment(v.state) && isLive(v.status))
        .map((v) => v.variant),
    ).size;
  };
  // What's on stage is written: it opens as a column instead of on the canvas. By the
  // version on stage, which can differ from its neighbours (markdown, then a page).
  const reading = createMemo(() => {
    const m = s.mock();
    const v = s.activeVariant();
    if (!m || !v) return false;
    const version = s.frameVersionOf(v);
    const kinds = historyRow(v, version)?.surfaceKinds ?? v.surfaces.map((x) => x.kind);
    return readsAsDocument(m.widths, kinds as string[]);
  });
  const wallSized = () => s.variants().length >= WALL_FROM;
  const [onWall, setOnWall] = createSignal(false);
  // Decided once per visit: answering the last question or moving to another
  // state must not swap the view under you.
  const opened = createMemo<View | null>((before) => {
    if (before || !s.mock()) return before;
    return untrack(() => {
      if (s.waitsOnStage()) return "stage";
      // Too many to reach any other way, whichever view was last used here.
      if (wallSized()) return "studio";
      // A gathered idea stays for comparing, below, even if what it holds is written.
      if (reading() && !s.mock()?.shortlist) return "stage";
      // A gathered idea is for comparing, and its Add candidate lives in Studio.
      return remembered() ?? (momentVariants() > 1 || s.mock()?.shortlist ? "studio" : "stage");
    });
  }, null);
  const shownView = (): View => view() ?? opened() ?? "stage";
  let openLooked: (() => void) | null = null;
  // Each step between Stage and Studio is its own history entry, so Back
  // returns to the view you came from rather than leaving the mock.
  const setView = (v: View) => {
    const w = host().window;
    const q = new URLSearchParams(w.location.search);
    q.set("view", v);
    // A closer look belongs to the Studio entry it was opened on, where Back finds it.
    q.delete("look");
    // Before the view changes: the URL's upkeep below writes to the current
    // entry, and the one being left must keep naming the view it was.
    w.history.pushState(w.history.state, "", `${w.location.pathname}?${q}`);
    setViewSignal(v);
    const id = s.mock()?.id;
    try {
      if (id) host().storage?.setItem(viewKey(id), v);
    } catch {
      // Storage refused: the URL still holds it for this visit.
    }
  };
  // The route ignores ?view=, so Back between Stage and Studio keeps this
  // screen mounted; the view follows the URL here.
  const onPop = () => {
    const v = new URLSearchParams(host().window.location.search).get("view");
    setViewSignal(v === "studio" || v === "stage" ? v : null);
  };
  host().window.addEventListener("popstate", onPop);
  onCleanup(() => host().window.removeEventListener("popstate", onPop));
  // The URL follows the place on screen. A tick later: Back runs several popstate
  // listeners in turn, and writing between them would stamp the place being left
  // onto the entry just arrived at.
  let urlTimer = 0;
  onCleanup(() => host().window.clearTimeout(urlTimer));
  createEffect(() => {
    if (!s.mock()) return;
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
  // Back, Forward or a link to another place on this same mock: the screen stays
  // mounted and moves there.
  createEffect(
    on(
      () => {
        const r = route();
        return r.screen === "mock" ? JSON.stringify(r.open) : null;
      },
      () => {
        const r = route();
        if (r.screen === "mock" && r.open) s.landOn(r.open);
      },
      { defer: true },
    ),
  );
  const nav = createFlowNav(s, props.project, props.slug, props.flow ?? null);
  const t = createTune(s);
  const m = createMargins(
    s,
    nav,
    () => !!s.mock() && !phoneLayout() && shownView() === "stage",
    () => (reading() ? READING_W : null),
  );
  // The tools act on a page, and a document isn't one.
  createEffect(() => {
    const tool = s.tool();
    if (reading() && tool) s.toggleTool(tool);
  });
  useFlowKeys(s);
  const about = createAbout(
    () => s.mock()?.project ?? props.project,
    () => {
      const m = s.mock();
      return m ? `${m.updatedAt}:${versionStamp(m.variants)}` : null;
    },
  );
  // On screen is seen: Home's dot for this mock goes until a newer version.
  createEffect(() => {
    const m = s.mock();
    if (m) markSeen(m.project, m.id, versionStamp(m.variants));
  });
  createEffect(() => {
    const id = s.mock()?.id;
    if (id) rememberRecent(id);
  });
  // The agent renamed the mock or its project while it was open: the address
  // follows, so a reload or a shared link still finds it.
  createEffect(() => {
    const m = s.mock();
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
    const el = root().querySelector(".mock-screen");
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
  // The last design gone leaves nothing to look at: up to where this mock lives. Not
  // for a mock opened empty, whose Archived is what the user came for. Replaces, so
  // Back doesn't return to the empty page.
  let hadLive = false;
  createEffect(() => {
    if (s.variants().some((v) => isLive(v.status))) hadLive = true;
    if (!hadLive || !s.emptied()) return;
    const back = `${host().location.pathname}${host().location.search}`;
    navigate(homePath(props.project, s.mock()?.area ?? null), { replace: true });
    s.handToast((line) => carryToast(line, back));
  });

  return (
    <div
      class="screen mock-screen"
      classList={{ phone: phoneLayout() }}
      style={{
        "--canvas-l": `${m.band().left}px`,
        "--canvas-r": `${m.band().right}px`,
        "--canvas-top": `${canvasTop()}px`,
        "--strip": `${m.stripW()}px`,
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
          variants={wallSized() ? s.variants().length : momentVariants()}
          compare={s.variants().length > 1 || s.variants().some((v) => v.version > 1)}
          tabs={m.walkable() || onWall()}
          shortlists={shortlists}
          actions={
            <Show when={m.active()}>
              <div class="mact">
                <Show when={s.steps().length > 1 && !m.leftDocked()}>
                  <VersionStepper
                    s={s}
                    listOpen={m.leftFloats()}
                    listNames="states and versions"
                    onList={m.toggleLeft}
                  />
                </Show>
                <Show when={!readonly()}>
                  <ReviseButton s={s} />
                </Show>
                <Show when={!reading()}>
                  <UseThis s={s} />
                </Show>
              </div>
            </Show>
          }
          panels={
            <Show when={m.active()}>
              <PanelTabs s={s} m={m} />
            </Show>
          }
          onView={(v) => {
            if (v === shownView()) return;
            s.setDrawer(false);
            if (v === "stage" && openLooked) openLooked();
            else setView(v);
          }}
        />
        {/* Beside a docked left margin the same steps are its first list. */}
        <Show when={m.walkable() && !m.leftDocked() && !onWall()}>
          <FlowBar nav={nav} />
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
        <Show when={s.mock()}>
          <Show
            when={shownView() === "stage"}
            fallback={
              <Studio
                s={s}
                top={canvasTop()}
                shortlists={shortlists}
                onOpen={() => setView("stage")}
                onLooking={(open) => (openLooked = open)}
                onWall={setOnWall}
              />
            }
          >
            <Show when={!reading()} fallback={<Reader s={s} />}>
              <Stage s={s} onGoto={nav.follow} />
              <Show when={m.ghosts() && !s.allSituations()}>
                <Ghost s={s} nav={nav} by={-1} />
                <Ghost s={s} nav={nav} by={1} />
              </Show>
            </Show>
            <SituationGrid
              s={s}
              top={canvasTop()}
              bottom={Math.max(0, win().h - bottomTop() + 8)}
            />
          </Show>
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
          <SentNote s={s} project={props.project} slug={props.slug} />
          <Show when={s.mock() && shownView() === "stage"}>
            <SituationSwitch s={s} />
            <Show
              when={phoneLayout()}
              fallback={
                <Show when={momentVariants() <= 1 && s.situations().length > 1}>
                  <SituationsButton s={s} />
                </Show>
              }
            >
              <Show when={reading()}>
                <ReaderSend s={s} m={m} />
              </Show>
              <QuestionCard s={s} />
              <VersionBar s={s} studio={momentVariants() > 1} reading={reading()} />
            </Show>
          </Show>
        </div>
        <Show when={s.mock() && shownView() === "stage"}>
          <Show
            when={phoneLayout()}
            fallback={
              <>
                <ToolStrip s={s} m={m} />
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

// Where you are, as the way up: the project and the area are links, the mock's
// name opens what's around it, then the state. A phone has room for the name
// alone (the tabs below it name the state), so an arrow up to the area (else the
// project) stands in for the rest.
// Beyond it: the name to tell an agent, the width on Stage, and Stage or Studio
// when there is a choice to look at.
function TopRow(props: {
  s: MockScreenState;
  project: string;
  slug: string;
  about: AboutState;
  view: View;
  // A document: no widths to choose between.
  reading: boolean;
  variants: number;
  // More than one design or version to compare, in any state, archived too: Studio is
  // where those are.
  compare: boolean;
  // Whether the state tabs are showing, which name the state where it isn't.
  tabs: boolean;
  shortlists: Shortlists;
  onView: (v: View) => void;
  // What acts on the version on stage, and the right margin's tabs, where a margin
  // can't be: in this row they cost the design no room.
  actions: JSX.Element;
  panels: JSX.Element;
}) {
  const s = props.s;
  const sl = props.shortlists;
  const home = () => homePath(props.project);
  const areaHome = (area: string) => homePath(props.project, area);
  const up = () => {
    const area = s.mock()?.area;
    return area ? { href: areaHome(area), name: area } : { href: home(), name: shortProject() };
  };
  // The owner is the same on every mock; the repo's own name is enough.
  const shortProject = () => props.project.split("/").pop() ?? props.project;
  const title = () => s.mock()?.title ?? props.slug;
  const idea = () => {
    const m = s.mock();
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
  // Whose turn it is, where it can be said from what this screen already holds.
  const turn = () => {
    if (s.mock()?.closedAt) return { kind: "closed", text: "Archived" };
    const open = new Set(s.flow().flatMap((e) => (isBuiltinAsk(e.ask) ? [] : [e.ask.id]))).size;
    if (open) return { kind: "open", text: questions(open) };
    return s.sent() ? { kind: "sent", text: "Sent" } : null;
  };
  const [open, setOpen] = createSignal(false);
  let btn: HTMLButtonElement | undefined;
  let pop: HTMLElement | undefined;
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
  return (
    <div class="mtop">
      <a
        class="ib mup"
        href={up().href}
        aria-label={`Up to ${up().name}`}
        onClick={(e) => linkClick(e, up().href)}
      >
        <Icon name="back" />
      </a>
      <nav class="crumb mcrumb" aria-label="Path">
        <a class="crumb-far crumb-link" href={home()} onClick={(e) => linkClick(e, home())}>
          {shortProject()}
        </a>
        <span class="crumb-far sep">/</span>
        <Show when={s.mock()?.area}>
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
        <Show when={!props.tabs && s.moment()}>
          {(state) => <span class="crumb-far crumb-sit">{`· ${state()}`}</span>}
        </Show>
      </nav>
      <Show when={turn()}>
        {(t) => (
          <span class="mturn alb-turn" data-turn={t().kind}>
            <Show when={t().kind === "open" && !readonly()}>
              <i class="glow-dot" aria-hidden="true" />
            </Show>
            {t().text}
          </span>
        )}
      </Show>
      <Show when={idea() && !s.mock()?.closedAt && !readonly()}>
        <button
          type="button"
          class="ib x-remove mend"
          aria-label={`End ${title()}`}
          title="End this idea"
          onClick={() => void s.endMock()}
        >
          <Icon name="close" />
        </button>
      </Show>
      <Show when={s.mock()}>
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
      <Show when={!phoneLayout() && s.mock()}>
        <button
          type="button"
          class="ib mcopy"
          aria-label={`Copy name: ${spoken()}`}
          title={`Copy name: ${spoken()}`}
          onClick={copyName}
        >
          <Icon name="copy" />
        </button>
      </Show>
      {/* A phone has no key to press, but a row already holding the view switch has
          no room for it either: Home is one step up from there. */}
      <Show when={!phoneLayout() || !(props.compare || props.view === "studio")}>
        <button
          type="button"
          class="ib msearch"
          aria-label="Search"
          title="Search ( / or ⌘K )"
          onClick={openJump}
        >
          <Icon name="search" />
        </button>
      </Show>
      <span class="grow" />
      <Show
        when={
          !readonly() && !s.mock()?.shortlist && sl.current()?.candidates.length
            ? sl.current()
            : null
        }
      >
        {(list) => <ShortlistPill list={list()} project={props.project} />}
      </Show>
      {props.actions}
      <Show when={props.view === "stage" && !props.reading && s.mock()}>
        <WidthMenu s={s} />
      </Show>
      <Show when={props.compare || props.view === "studio"}>
        <div class="vswitch" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={props.view === "stage"}
            aria-label={
              props.view === "studio" && s.waitsOnStage() ? "Stage, a question is waiting" : "Stage"
            }
            onClick={() => props.onView("stage")}
          >
            Stage
            <Show when={props.view === "studio" && s.waitsOnStage()}>
              <i class="vswitch-q" aria-hidden="true" />
            </Show>
          </button>
          <button
            type="button"
            aria-pressed={props.view === "studio"}
            onClick={() => props.onView("studio")}
          >
            Studio
            <span class="num">{props.variants}</span>
          </button>
        </div>
      </Show>
      {props.panels}
    </div>
  );
}

// The way back to the last gathered idea saved to.
function ShortlistPill(props: { list: Shortlist; project: string }) {
  const href = () => mockPath(props.project, props.list.slug);
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

function WidthMenu(props: { s: MockScreenState }) {
  const s = props.s;
  const [open, setOpen] = createSignal(false);
  let btn!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  createEffect(() => {
    if (!open()) return;
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      btn.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu?.contains(t) && !btn.contains(t)) setOpen(false);
    };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });
  const declared = () => s.mock()?.widths ?? [];
  // The mock's own widths when it names them; else the ones the viewer offers.
  const widths = () => (declared().length ? declared() : DEVICE_WIDTHS.map((d) => d.w));
  // A phone shows one artboard at a time, never the row of them.
  const all = () => widths().length > 1 && !phoneLayout();
  const wide = () => wideWidth(widths());
  const iconOf = (w: number): IconName => (w === wide() ? "wide" : widthKind(w));
  const current = (): { icon: IconName; label: string } => {
    if (s.zoom() === "all") return { icon: "all", label: "All widths" };
    const w = s.frameW();
    return { icon: iconOf(w), label: `${widthLabel(w)} · ${w}px` };
  };
  const choose = (w: number | "all") => {
    if (w === "all") s.setZoom("all");
    else {
      if (w !== s.frameW()) s.setFrameW(w);
      s.setZoom("fit");
    }
    setOpen(false);
  };
  return (
    // One width is no choice: the label on the artboard already names it.
    <Show when={widths().length > 1}>
      <div class="wpick">
        <button
          type="button"
          class="ib"
          classList={{ on: open() }}
          ref={(el) => (btn = el)}
          aria-haspopup="menu"
          aria-expanded={open()}
          aria-label={`Width: ${current().label}`}
          title={current().label}
          onClick={() => setOpen(!open())}
        >
          <Icon name={current().icon} />
        </button>
        <Show when={open()}>
          <div class="wmenu" role="menu" aria-label="Width" ref={(el) => (menu = el)}>
            <For each={widths()}>
              {(w) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={s.frameW() === w && s.zoom() !== "all"}
                  data-w={w}
                  onClick={() => choose(w)}
                >
                  <Icon name={iconOf(w)} />
                  {widthLabel(w)}
                  <small>{w}</small>
                </button>
              )}
            </For>
            <Show when={all()}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={s.zoom() === "all"}
                data-w="all"
                onClick={() => choose("all")}
              >
                <Icon name="all" />
                All widths
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

// The steps by name: the declared flow this screen is a step of, else the mock's
// own states in order. A step the agent still waits on is marked. The current
// one stays in view however many there are, the next peeking past the edge.
function FlowBar(props: { nav: FlowNav }) {
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
              aria-current={i() === nav.at() ? "step" : undefined}
              aria-label={nav.owes(x) ? `${nav.label(x)}, a question is waiting` : nav.label(x)}
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
            if (to) nav.go({ mock: nav.here().mock, state: to });
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
// another mock's step shows the design in use there.
function Ghost(props: { s: MockScreenState; nav: FlowNav; by: 1 | -1 }) {
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
function ChangedNote(props: { s: MockScreenState }) {
  const s = props.s;
  const looking = () => sameVersion(s.onStage(), s.changed()?.to);
  return (
    <Show when={!readonly() && !s.mock()?.closedAt && s.changed()}>
      {(c) => (
        <div class="status-note changed-note" role="status">
          <span>
            <b class="alb-turn" data-turn="changed">
              Changed
            </b>
            {` ${s.nameOf(c().to)} is newer than ${s.nameOf(c().use)}, which is in use.`}
          </span>
          <Show when={!looking()}>
            <button type="button" class="btn" onClick={() => s.showVersion(c().to)}>
              {`See ${s.nameOf(c().to)}`}
            </button>
          </Show>
          <button type="button" class="btn" onClick={() => void s.useThis(c().to)}>
            {`Use ${s.nameOf(c().to)}`}
          </button>
          <button type="button" class="btn" onClick={s.stayOnUse}>
            {`Stay on ${s.nameOf(c().use)}`}
          </button>
        </div>
      )}
    </Show>
  );
}

// After a Send: whether it reached the agent, and where to go next.
function SentNote(props: { s: MockScreenState; project: string; slug: string }) {
  const s = props.s;
  return (
    <div class="sentnote">
      <Show when={s.mock()?.closedAt}>
        <EndedNote s={s} />
      </Show>
      <ChangedNote s={s} />
      <Show when={s.sent()} fallback={<CarriedChip project={props.project} slug={props.slug} />}>
        <div class="sentrow" role="status">
          <button
            type="button"
            class="pill count"
            classList={{ waiting: s.sentDelivered() === false }}
            onClick={() => s.setPanel("thread")}
          >
            <i class="dot" classList={{ ok: s.sentDelivered() !== false }} />
            <span>{`Sent · ${s.sentDelivered() === false ? "Not seen yet" : "Delivered"}`}</span>
          </button>
          <Show when={s.nudgeAgent()}>
            <span class="sent-hint">tell your agent you've answered</span>
          </Show>
        </div>
      </Show>
      <NextCard s={s} />
    </div>
  );
}
