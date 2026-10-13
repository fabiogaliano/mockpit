// The questions over the canvas: a card that floats above the design instead
// of a bottom sheet, so answering never means dragging a drawer open. Dragged
// by its grip it becomes a chip under the finger, the spots it can land on show
// as small markers, and on release it snaps to the one the finger is in (see
// dock.ts). Carried to an edge it docks as a handle there; a tap brings it back.
// Tune and Thread, opened from the header's menu, take the card's place.

import { createEffect, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import {
  type Area,
  cardWidth,
  type CardPlace,
  DOCK_EDGE,
  dockAt,
  edgeDistance,
  handleRect,
  INSET,
  isColumn,
  OPEN_ZONE,
  PLACE_KEY,
  readPlace,
  type Spot,
  SPOTS,
  spotAt,
  spotForHandle,
  spotRect,
} from "./dock.ts";
import { host } from "./host.ts";
import { NextCard } from "./NextCard.tsx";
import { Questions } from "./Questions.tsx";
import type { MockScreenState } from "./state.ts";
import { Thread } from "./Thread.tsx";
import type { TuneState } from "./tune.ts";
import { PartSelector, Tune } from "./Tune.tsx";
import { canvasTop, setCardInset, win } from "./viewport.ts";

const CHIP = { row: { w: 84, h: 44 }, col: { w: 44, h: 72 } };
const MARK = { row: { w: 48, h: 22 }, col: { w: 22, h: 40 } };

export function QuestionCard(props: { s: MockScreenState; t: TuneState }) {
  const s = props.s;
  const stored = (() => {
    try {
      return host().storage?.getItem(PLACE_KEY) ?? null;
    } catch {
      return null;
    }
  })();
  const [place, setPlace] = createSignal<CardPlace>(readPlace(stored));
  const [carry, setCarry] = createSignal<{ x: number; y: number; hot: Spot } | null>(null);
  const [content, setContent] = createSignal<HTMLElement>();

  const area = (): Area => ({ top: canvasTop(), w: win().w, h: win().h - canvasTop() });
  const save = (p: CardPlace) => {
    setPlace(p);
    try {
      host().storage?.setItem(PLACE_KEY, JSON.stringify(p));
    } catch {
      // Storage denied: the place holds for this visit.
    }
  };
  const col = () => isColumn(carry()?.hot ?? place().at);
  const width = () => cardWidth(place().at, area());
  const rect = () => spotRect(place().at, width(), 0, area());

  // A card resting on a side takes that strip of the canvas, so the artboards
  // fit beside it; anywhere else it floats over them.
  createEffect(() => {
    const p = place();
    const inset = !p.docked && isColumn(p.at) ? width() + 24 : 0;
    setCardInset(p.at === "mid-left" ? { left: inset, right: 0 } : { left: 0, right: inset });
  });
  onCleanup(() => setCardInset({ left: 0, right: 0 }));
  // Tune or Thread opened from the menu brings a docked card back.
  createEffect(
    on(
      () => s.mode(),
      (m) => {
        if (m !== "questions" && place().docked) save({ ...place(), docked: null });
      },
      { defer: true },
    ),
  );

  const startCarry = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = 0;
    const move = (ev: PointerEvent) => {
      moved = Math.max(moved, Math.hypot(ev.clientX - x0, ev.clientY - y0));
      if (moved < 8) return;
      if (moved > 40 && edgeDistance(ev.clientX, ev.clientY, area()) < DOCK_EDGE) {
        end();
        save({ ...place(), docked: dockAt(ev.clientX, ev.clientY, area()) });
        return;
      }
      setCarry({ x: ev.clientX, y: ev.clientY, hot: spotAt(ev.clientX, ev.clientY, area()) });
    };
    const up = (ev: PointerEvent) => {
      const c = carry();
      end();
      if (c && moved >= 8) save({ at: spotAt(ev.clientX, ev.clientY, area()), docked: null });
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setCarry(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  // The handle: a tap opens the card at the spot nearest it; a drag moves it
  // along the edges, or out into the canvas to open it there.
  const [handleAt, setHandleAt] = createSignal<{ x: number; y: number } | null>(null);
  const dragHandle = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = 0;
    const move = (ev: PointerEvent) => {
      moved = Math.max(moved, Math.hypot(ev.clientX - x0, ev.clientY - y0));
      if (moved > 10) setHandleAt({ x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setHandleAt(null);
      const d = place().docked;
      if (!d) return;
      if (moved <= 10) return save({ at: spotForHandle(d), docked: null });
      if (edgeDistance(ev.clientX, ev.clientY, area()) < OPEN_ZONE) {
        return save({ ...place(), docked: dockAt(ev.clientX, ev.clientY, area()) });
      }
      save({ at: spotAt(ev.clientX, ev.clientY, area()), docked: null });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const chip = () => (col() ? CHIP.col : CHIP.row);
  const cardStyle = () => {
    const c = carry();
    if (c) {
      const { w, h } = chip();
      return {
        width: `${w}px`,
        height: `${h}px`,
        transform: `translate3d(${c.x - w / 2}px, ${c.y - h / 2}px, 0)`,
      };
    }
    // Anchored by CSS to the edge it rests against, not placed from a measured
    // height: the card grows and shrinks with each question, and WebKit may not
    // report its first size at all.
    const a = area();
    const v = place().at.split("-")[0];
    return {
      width: `${width()}px`,
      "max-height": `${a.h - 2 * INSET}px`,
      left: `${rect().x}px`,
      top: v === "top" ? `${a.top + INSET}px` : v === "mid" ? `${a.top + a.h / 2}px` : "auto",
      bottom: v === "bottom" ? `calc(${INSET}px + env(safe-area-inset-bottom))` : "auto",
      transform: v === "mid" ? "translateY(-50%)" : "none",
    };
  };
  const owed = () => s.owed().length;

  return (
    <>
      <Show when={carry()}>
        {(c) => (
          <div class="qcard-marks" aria-hidden="true">
            <For each={SPOTS}>
              {(spot) => {
                const m = () => (isColumn(spot) ? MARK.col : MARK.row);
                const r = () => spotRect(spot, m().w, m().h, area());
                return (
                  <i
                    classList={{ hot: c().hot === spot }}
                    style={{
                      left: `${r().x}px`,
                      top: `${r().y}px`,
                      width: `${m().w}px`,
                      height: `${m().h}px`,
                    }}
                  />
                );
              }}
            </For>
          </div>
        )}
      </Show>
      <div
        class="qcard"
        classList={{ col: col(), chip: !!carry(), hidden: !!place().docked && !carry() }}
        style={cardStyle()}
        role="region"
        aria-label="Questions"
        // The grip and the question's header row carry the card; their buttons
        // stay buttons.
        onPointerDown={(e) => {
          const t = e.target as Element;
          if (t.closest("button, a, input, textarea, select")) return;
          if (t.closest(".qcard-grip, .qhd, .qcard-mode")) startCarry(e);
        }}
      >
        <div class="qcard-grip" aria-hidden="true">
          <i />
        </div>
        <div class="qcard-body" ref={setContent}>
          <Switch>
            <Match when={s.mode() === "questions"}>
              <NextCard s={s} />
              <Questions s={s} />
            </Match>
            <Match when={s.mode() === "tune"}>
              <ModeBack s={s} label="Tune" />
              <PartSelector s={s} t={props.t} />
              <Tune s={s} t={props.t} />
            </Match>
            <Match when={s.mode() === "thread"}>
              <ModeBack s={s} label="Thread" />
              <Thread s={s} scroller={content} />
            </Match>
          </Switch>
        </div>
      </div>
      <Show when={carry() ? null : place().docked}>
        {(d) => {
          const r = () => {
            const at = handleAt();
            const base = handleRect(d(), area());
            return at ? { ...base, x: at.x - base.w / 2, y: at.y - base.h / 2 } : base;
          };
          return (
            <button
              type="button"
              class={`qcard-handle ${d().edge}`}
              aria-label={owed() ? `Questions, ${owed()} open` : "Questions"}
              style={{
                left: `${r().x}px`,
                top: `${r().y}px`,
                width: `${r().w}px`,
                height: `${r().h}px`,
              }}
              onPointerDown={dragHandle}
            >
              {owed() ? String(owed()) : "✓"}
            </button>
          );
        }}
      </Show>
    </>
  );
}

function ModeBack(props: { s: MockScreenState; label: string }) {
  return (
    <div class="qcard-mode">
      <button type="button" class="qcard-back" onClick={() => props.s.setMode("questions")}>
        ‹ Questions
      </button>
      <b>{props.label}</b>
    </div>
  );
}
