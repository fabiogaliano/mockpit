// The canvas's header: a plain page row above it (pull-to-refresh and the
// browser's edge swipes stay the browser's there), in two lines so nothing in
// it is squeezed. The first says where you are and holds Mark and the menu;
// the second says what is on the canvas: version, state, look and its note,
// and the widths it is judged at.

import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { readonly, root } from "./host.ts";
import { DEVICE_WIDTHS, MAX_ZOOM, widthLabel, type Zoom } from "./logic.ts";
import { bell, toggleBell } from "./notify.ts";
import { ReactionBar } from "./Reactions.tsx";
import { linkClick, projectPath } from "./route.ts";
import type { MockScreenState } from "./state.ts";
import { TryButton } from "./TryButton.tsx";
import { theme, toggleTheme } from "./theme.ts";
import { useThreadRows } from "./Thread.tsx";
import { Versions } from "./Versions.tsx";
import { phoneLayout, setCanvasTop } from "./viewport.ts";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, MAX_ZOOM];

// Opens one popover at a time and closes it on Escape or a press outside it.
function usePopover() {
  const [open, setOpen] = createSignal<string | null>(null);
  let pop: HTMLElement | undefined;
  let anchor: HTMLElement | undefined;
  createEffect(() => {
    if (!open()) return;
    const doc = root();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop?.contains(t) && !anchor?.contains(t)) setOpen(null);
    };
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("pointerdown", onDown, true);
    });
  });
  return {
    open,
    toggle: (id: string, el: HTMLElement) => {
      anchor = el;
      setOpen(open() === id ? null : id);
    },
    close: () => setOpen(null),
    ref: (el: HTMLElement) => (pop = el),
  };
}

export function CanvasHead(props: { s: MockScreenState; project: string; right?: JSX.Element }) {
  const s = props.s;
  const pop = usePopover();
  const rows = useThreadRows(s);
  let head!: HTMLElement;
  let vbtn: HTMLButtonElement | undefined;
  onMount(() => {
    const ro = new ResizeObserver(() => setCanvasTop(head.getBoundingClientRect().bottom));
    ro.observe(head);
    setCanvasTop(head.getBoundingClientRect().bottom);
    onCleanup(() => ro.disconnect());
  });

  const v = () => s.activeVariant();
  const siblings = () => s.variants().filter((x) => x.state === s.activeState());
  const declared = () => s.mock()?.widths ?? [];
  // The mock's own widths when it names them; else the ones the viewer offers.
  const widths = () => (declared().length ? declared() : DEVICE_WIDTHS.map((d) => d.w));
  const phone = phoneLayout;
  // A phone shows one artboard at a time, never the row of them.
  const all = () => declared().length > 1 && !phone();
  const pct = () => Math.round(s.stageScale() * 100);
  const home = () => projectPath(props.project);
  const pick = (w: number) => {
    if (w !== s.frameW()) s.setFrameW(w);
    s.setZoom("fit");
  };
  const onWidth = (w: number) => s.frameW() === w && s.zoom() !== "all";
  // Only the steps the stage can reach: a phone's page never zooms out past
  // its width, so a step below that would only show the floor again.
  const zoomSteps = () => ZOOM_STEPS.filter((z) => z >= s.zoomMin() - 0.005);
  const setZoom = (z: Zoom) => {
    s.setZoom(z);
    pop.close();
  };

  return (
    <header class="chead" ref={(el) => (head = el)}>
      <div class="crow">
        <div class="crumb">
          <a class="home" href={home()} onClick={(e) => linkClick(e, home())}>
            {`‹ ${props.project}`}
          </a>
          <span class="sep">/</span>
          <b>{s.mock()?.title}</b>
        </div>
        <span class="grow" />
        {props.right}
        <TryButton s={s} label={!phone()} />
        <Show when={!readonly()}>
          <button
            type="button"
            class="markbtn"
            classList={{ on: s.marking() }}
            aria-pressed={s.marking()}
            title="Mark: tap the design to leave a comment there"
            onClick={() => s.setMarking(!s.marking())}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Z" />
              <circle cx="12" cy="10" r="2" />
            </svg>
            <Show when={!phone()}>
              <span>Mark</span>
            </Show>
          </button>
        </Show>
        <button
          type="button"
          class="morebtn"
          classList={{ on: pop.open() === "more" }}
          aria-label="More"
          aria-expanded={pop.open() === "more"}
          onClick={(e) => pop.toggle("more", e.currentTarget)}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
        <Show when={pop.open() === "more"}>
          <div class="chead-menu" ref={pop.ref} role="menu">
            <Show when={!readonly() && siblings().length > 1 && v()}>
              {(variant) => (
                <div class="menu-react">
                  <span class="more-k">{variant().variant}</span>
                  <ReactionBar s={s} part={null} about={`variant ${variant().variant}`} />
                </div>
              )}
            </Show>
            <Show when={s.tuneShown()}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  s.setMode("tune");
                  pop.close();
                }}
              >
                Tune
              </button>
            </Show>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                s.setMode("thread");
                pop.close();
              }}
            >
              Thread
              <small>{rows().length}</small>
            </button>
            <Show when={bell() !== "hidden"}>
              <button type="button" role="menuitem" onClick={() => void toggleBell()}>
                {bell() === "on" ? "Notifications on" : "Notify me"}
              </button>
            </Show>
            <button type="button" role="menuitem" onClick={toggleTheme}>
              {theme() === "dark" ? "Light theme" : "Dark theme"}
            </button>
          </div>
        </Show>
      </div>
      <div class="sr-only" role="status">
        {s.reactStatus()}
      </div>
      <div class="crow crow-stage">
        <Show when={v()}>
          {(variant) => (
            <button
              type="button"
              class="vbtn"
              ref={(el) => (vbtn = el)}
              aria-haspopup="menu"
              aria-expanded={s.versionsOpen()}
              onClick={(e) => {
                e.stopPropagation();
                s.setVersionsOpen(!s.versionsOpen());
              }}
            >
              {`v${s.frameVersionOf(variant())} ▾`}
            </button>
          )}
        </Show>
        <Show when={s.states().length > 1}>
          <label class="chead-pick">
            <span class="sr-only">State</span>
            <select
              value={String(s.states().indexOf(s.activeState()))}
              onChange={(e) => s.showState(s.states()[Number(e.currentTarget.value)])}
            >
              <For each={s.states()}>
                {(state, i) => (
                  <option value={String(i())}>
                    {`${state ?? "default"}${s.owedIn(state) ? ` · ${s.owedIn(state)} open` : ""}`}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
        {/* Without a Look ask the looks switch here; with one, Questions does it. */}
        <Show when={!s.look() && siblings().length > 1}>
          <label class="chead-pick">
            <span class="sr-only">Variant</span>
            <select
              value={v()?.variant ?? ""}
              onChange={(e) => s.chooseVariant(e.currentTarget.value)}
            >
              <For each={siblings()}>{(x) => <option value={x.variant}>{x.variant}</option>}</For>
            </select>
          </label>
        </Show>
        <button
          type="button"
          class="chead-look"
          disabled={!v()?.note}
          onClick={(e) => pop.toggle("note", e.currentTarget)}
        >
          <Show when={s.look() || siblings().length <= 1}>
            <span class="chead-name">{v()?.variant}</span>
          </Show>
          <Show when={v()?.note}>
            <span class="chead-note">{` · ${v()?.note}`}</span>
          </Show>
        </button>
        <Show when={pop.open() === "note" && v()?.note}>
          <div class="chead-notepop" ref={pop.ref} role="dialog" aria-label="About this look">
            <b>{v()?.variant}</b>
            <p>{v()?.note}</p>
          </div>
        </Show>
        <div class="chead-widths">
          <Show
            when={!phone()}
            fallback={
              <label class="chead-pick">
                <span class="sr-only">Width</span>
                <select
                  value={s.zoom() === "all" ? "all" : String(s.frameW())}
                  onChange={(e) => {
                    const val = e.currentTarget.value;
                    if (val === "all") s.setZoom("all");
                    else pick(Number(val));
                  }}
                >
                  <For each={widths()}>
                    {(w) => <option value={String(w)}>{widthLabel(w)}</option>}
                  </For>
                  <Show when={all()}>
                    <option value="all">All</option>
                  </Show>
                </select>
              </label>
            }
          >
            <div class="chead-seg" role="group" aria-label="Width">
              <For each={widths()}>
                {(w) => (
                  <button
                    type="button"
                    classList={{ on: onWidth(w) }}
                    aria-pressed={onWidth(w)}
                    title={`${w} px`}
                    onClick={() => pick(w)}
                  >
                    {widthLabel(w)}
                  </button>
                )}
              </For>
              <Show when={all()}>
                <button
                  type="button"
                  classList={{ on: s.zoom() === "all" }}
                  aria-pressed={s.zoom() === "all"}
                  onClick={() => s.setZoom("all")}
                >
                  All
                </button>
              </Show>
            </div>
          </Show>
          <button
            type="button"
            class="zoomval"
            classList={{ shrunk: pct() < 100, on: pop.open() === "zoom" }}
            aria-haspopup="menu"
            aria-expanded={pop.open() === "zoom"}
            aria-label={`Zoom ${pct()}%`}
            onClick={(e) => pop.toggle("zoom", e.currentTarget)}
          >
            {`${pct()}%`}
          </button>
        </div>
        <Show when={pop.open() === "zoom"}>
          <div class="chead-menu zoom-menu" ref={pop.ref} role="menu" aria-label="Zoom">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={s.zoom() === "fit"}
              onClick={() => setZoom("fit")}
            >
              Fit
            </button>
            <For each={zoomSteps()}>
              {(z) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={typeof s.zoom() === "number" && pct() === Math.round(z * 100)}
                  onClick={() => setZoom(z)}
                >
                  {`${Math.round(z * 100)}%`}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={s.versionsOpen()}>
          <Versions s={s} anchor={vbtn} />
        </Show>
      </div>
    </header>
  );
}
