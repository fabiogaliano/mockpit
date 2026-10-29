// The mock screen: a quiet top bar (back, where you are, the width, Built
// from), the design on a canvas with its flow's steps above it, and one bar
// floating below it (New, the versions, Use this, Try / Mark / Tune). The
// agent's question floats above that bar; the version label opens the history
// and the thread as a bottom panel; Built from opens beside the canvas.

import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { BottomPanel } from "./BottomPanel.tsx";
import { BuiltFrom } from "./BuiltFrom.tsx";
import { useFlowKeys } from "./flowKeys.ts";
import { createFlowNav, type FlowNav } from "./flowNav.ts";
import { host, root } from "./host.ts";
import { Icon, type IconName } from "./icons.tsx";
import { boardWidths, DEVICE_WIDTHS, wideWidth, widthKind, widthLabel } from "./logic.ts";
import { CarriedChip, NextCard } from "./NextCard.tsx";
import { QuestionCard, QuestionTab } from "./QuestionCard.tsx";
import { ResolvedNote } from "./Questions.tsx";
import { homePath, linkClick, navigate, projectPath } from "./route.ts";
import { Stage } from "./Stage.tsx";
import type { ScreenOpen } from "./route.ts";
import { createMockScreen, type MockScreenState } from "./state.ts";
import { Thumb } from "./Thumb.tsx";
import { createTune } from "./tune.ts";
import { VersionBar } from "./VersionBar.tsx";
import { NO_INSET, phoneLayout, setCanvasTop, setCardInset, win } from "./viewport.ts";

// The neighbouring steps beside the canvas, and the room they take.
const GHOST_W = 112;
const TOAST_MS = 2400;

export function MockScreen(props: {
  project: string;
  slug: string;
  open?: ScreenOpen | null;
  flow?: string | null;
}) {
  const s = createMockScreen(props.project, props.slug, props.open ?? null);
  const nav = createFlowNav(s, props.project, props.slug, props.flow ?? null);
  const t = createTune(s);
  useFlowKeys(s);
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
  // What floats over the canvas takes its bands: the bottom stack below, the
  // neighbouring steps at the sides.
  const walkable = () => nav.steps().length > 1 && nav.at() >= 0;
  // Beside a row of artboards the neighbours would sit on the next one: they
  // step aside while more than one width is on the canvas, and the flow bar
  // walks the steps alone.
  const oneBoard = () =>
    boardWidths(s.mock()?.widths ?? [], s.frameW(), s.zoom(), phoneLayout()).length === 1;
  const ghosts = () => !phoneLayout() && walkable() && oneBoard();
  createEffect(() => {
    const below = Math.max(0, win().h - bottomTop() + 8);
    const side = ghosts() ? GHOST_W : 0;
    setCardInset({ ...NO_INSET, bottom: below, left: side, right: side });
  });
  onCleanup(() => setCardInset(NO_INSET));

  // Esc turns a canvas tool off, then closes what is open, one at a time.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (s.tool()) s.setTool(null);
      else if (s.drawer()) s.setDrawer(false);
      else if (s.panel()) s.setPanel(null);
      else return;
      e.preventDefault();
    };
    root().addEventListener("keydown", onKey);
    onCleanup(() => root().removeEventListener("keydown", onKey));
  });

  // On a phone a swipe across the design moves between the steps.
  onMount(() => {
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t0 = e.touches[0];
      start =
        phoneLayout() && e.touches.length === 1 && !s.trying() && s.zoom() === "fit"
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
    const tst = s.toast();
    if (!tst || tst.undo) return;
    const timer = host().window.setTimeout(() => s.setToast(null), TOAST_MS);
    onCleanup(() => host().window.clearTimeout(timer));
  });
  createEffect(() => {
    if (s.error()) s.setToast({ text: s.error()! });
  });

  return (
    <div class="screen mock-screen" classList={{ phone: phoneLayout() }}>
      <header class="mhead" ref={(el) => (head = el)}>
        <TopRow s={s} project={props.project} slug={props.slug} />
        <Show when={walkable()}>
          <FlowBar s={s} nav={nav} />
        </Show>
      </header>
      <Show
        when={!s.missing()}
        fallback={
          <main class="main">
            <p class="home-empty">{`No mock "${props.slug}" in ${props.project}.`}</p>
          </main>
        }
      >
        <Show when={s.mock()}>
          <Stage s={s} onGoto={nav.follow} />
          <Show when={ghosts()}>
            <Ghost s={s} nav={nav} by={-1} />
            <Ghost s={s} nav={nav} by={1} />
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
          <Show when={s.mock()}>
            <QuestionCard s={s} />
            <VersionBar s={s} />
          </Show>
        </div>
        <Show when={s.mock()}>
          <QuestionTab s={s} />
          <Show when={s.panel()}>
            <BottomPanel s={s} onHeight={setPanelH} />
          </Show>
          <BuiltFrom s={s} t={t} />
        </Show>
      </Show>
      <Toast s={s} />
      <div class="sr-only" role="status">
        {s.reactStatus()}
      </div>
    </div>
  );
}

// Back, where you are, then the width and Built from: nothing else up here.
function TopRow(props: { s: MockScreenState; project: string; slug: string }) {
  const s = props.s;
  const home = () => homePath(props.project);
  const component = () => s.mock()?.kind === "component";
  return (
    <div class="mtop">
      <a class="ib" href={home()} aria-label="Back" onClick={(e) => linkClick(e, home())}>
        <Icon name="back" />
      </a>
      <div class="crumb mcrumb">
        <span class="crumb-far">{props.project}</span>
        <span class="crumb-far sep">/</span>
        <Show when={s.activeState() !== null} fallback={<b>{s.mock()?.title ?? props.slug}</b>}>
          <span class="crumb-far">{s.mock()?.title ?? props.slug}</span>
          <span class="crumb-far sep">/</span>
          <b>{s.activeState()}</b>
        </Show>
        <Show when={s.mock()?.source}>
          {(src) => (
            <span class="crumb-far msrc" title={src()}>
              {src()}
            </span>
          )}
        </Show>
      </div>
      <span class="grow" />
      <WidthMenu s={s} />
      <button
        type="button"
        class="ib"
        classList={{ on: s.drawer() }}
        aria-label={component() ? "Used in" : "Built from"}
        title={component() ? "Where it's used" : "What it's built from"}
        aria-expanded={s.drawer()}
        onClick={() => s.setDrawer(!s.drawer())}
      >
        <Icon name="layers" />
      </button>
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
  );
}

// The steps of the flow: the declared one this screen is a step of, else the
// mock's own states in order. The current one is a short pill; a step still
// owing answers is marked.
function FlowBar(props: { s: MockScreenState; nav: FlowNav }) {
  const nav = props.nav;
  const at = () => nav.at();
  const n = () => nav.steps().length;
  const prev = () => nav.near(-1);
  const next = () => nav.near(1);
  return (
    <nav class="flowbar" aria-label="Steps">
      <button
        type="button"
        class="ib fnav"
        disabled={!prev()}
        aria-label={prev() ? `Previous step: ${nav.label(prev()!)}` : "Previous step"}
        onClick={() => nav.step(-1)}
      >
        <Icon name="prev" />
      </button>
      <b class="flowname">{nav.name()}</b>
      <span class="dots" aria-hidden="true">
        <For each={nav.steps()}>
          {(x, i) => <i classList={{ on: i() === at(), owe: nav.owes(x) }} />}
        </For>
      </span>
      <span
        class="num"
        aria-label={`${nav.label(nav.steps()[at()] ?? { mock: "", state: props.s.activeState() })}, step ${at() + 1} of ${n()}`}
      >
        {`${at() + 1} of ${n()}`}
      </span>
      <button
        type="button"
        class="ib fnav"
        disabled={!next()}
        aria-label={next() ? `Next step: ${nav.label(next()!)}` : "Next step"}
        onClick={() => nav.step(1)}
      >
        <Icon name="next" />
      </button>
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

// After a Send: whether it reached the agent, and where to go next.
function SentNote(props: { s: MockScreenState; project: string; slug: string }) {
  const s = props.s;
  return (
    <div class="sentnote">
      <Show when={s.mock()?.resolvedAt}>
        <ResolvedNote s={s} />
      </Show>
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

function Toast(props: { s: MockScreenState }) {
  const s = props.s;
  return (
    <div class="toast" classList={{ on: !!s.toast() }} role="status" aria-live="polite">
      <Show when={s.toast()}>
        {(tst) => (
          <>
            <span>{tst().text}</span>
            <Show when={tst().undo}>
              {(undo) => (
                <>
                  <button type="button" class="toast-undo" onClick={() => undo()()}>
                    Undo
                  </button>
                  <button
                    type="button"
                    class="ib toast-x"
                    aria-label="Dismiss"
                    onClick={() => s.setToast(null)}
                  >
                    <Icon name="close" />
                  </button>
                </>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
