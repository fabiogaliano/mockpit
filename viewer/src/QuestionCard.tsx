// The questions over the canvas: a card that floats above the design instead
// of a bottom sheet, so answering never means dragging a drawer open. Dragged
// by its grip it follows the finger, the spots it can land on show as small
// markers, and on release it glides into the one the finger is in (see
// dock.ts). Carried to an edge it docks as a handle there; a tap brings it back.
// Its fold button shrinks it to one line, the question it is on.
// Tune and Thread, opened from the header's menu, take the card's place.
// On a phone none of that: the card is a sheet fixed to the bottom, and a tap
// or a swipe on its top folds it to one line so the page above can be read.

import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
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
import { canvasTop, NO_INSET, phoneLayout, setCardInset, win } from "./viewport.ts";

// How long the card takes to glide into its spot or open from its line.
const SNAP_MS = 220;
const reducedMotion = () =>
  host().window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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
  const phone = phoneLayout;
  // Where the card rests now: a phone's sheet has one place, whatever an iPad
  // left in storage.
  const spot = (): CardPlace => (phone() ? { at: "bottom-center", docked: null } : place());
  const [folded, setFolded] = createSignal(false);
  const [carry, setCarry] = createSignal<{
    dx: number;
    dy: number;
    hot: Spot;
  } | null>(null);
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
  const col = () => isColumn(carry()?.hot ?? spot().at);
  const width = () => cardWidth(spot().at, area());
  const rect = () => spotRect(spot().at, width(), 0, area());

  // A resting card takes its band of the canvas: a strip down a side, so the
  // artboards fit beside it, or the space above or below it, so they shrink to
  // fit the rest. Its height follows each question, so it is measured; while it
  // is carried the artboards hold still.
  let cardEl!: HTMLDivElement;
  const [cardBox, setCardBox] = createSignal({ top: 0, bottom: 0 });
  const measure = () => {
    const r = cardEl?.getBoundingClientRect();
    if (r) setCardBox({ top: r.top, bottom: r.bottom });
  };
  onMount(() => {
    const ro = new ResizeObserver(measure);
    ro.observe(cardEl);
    onCleanup(() => ro.disconnect());
  });
  createEffect(
    on([spot, folded, win, canvasTop], () => host().window.requestAnimationFrame(measure)),
  );
  createEffect(() => {
    const p = spot();
    if (carry()) return;
    if (p.docked) return setCardInset(NO_INSET);
    if (isColumn(p.at)) {
      const inset = width() + 24;
      return setCardInset(
        p.at === "mid-left" ? { ...NO_INSET, left: inset } : { ...NO_INSET, right: inset },
      );
    }
    const a = area();
    const b = cardBox();
    setCardInset(
      p.at.startsWith("top")
        ? { ...NO_INSET, top: Math.max(0, b.bottom - a.top) }
        : { ...NO_INSET, bottom: Math.max(0, a.top + a.h - b.top) },
    );
  });
  onCleanup(() => setCardInset(NO_INSET));
  // Tune or Thread opened from the menu brings a docked card back.
  createEffect(
    on(
      () => s.mode(),
      (m) => {
        if (m !== "questions" && spot().docked) save({ ...spot(), docked: null });
        if (m !== "questions") setFolded(false);
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
        save({ ...spot(), docked: dockAt(ev.clientX, ev.clientY, area()) });
        return;
      }
      setCarry({
        dx: ev.clientX - x0,
        dy: ev.clientY - y0,
        hot: spotAt(ev.clientX, ev.clientY, area()),
      });
    };
    const up = (ev: PointerEvent) => {
      const c = carry();
      const from = cardEl.getBoundingClientRect();
      end();
      if (!c || moved < 8) return;
      save({ at: spotAt(ev.clientX, ev.clientY, area()), docked: null });
      glideFrom(from);
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
      const d = spot().docked;
      if (!d) return;
      if (moved <= 10) return save({ at: spotForHandle(d), docked: null });
      if (edgeDistance(ev.clientX, ev.clientY, area()) < OPEN_ZONE) {
        return save({ ...spot(), docked: dockAt(ev.clientX, ev.clientY, area()) });
      }
      save({ at: spotAt(ev.clientX, ev.clientY, area()), docked: null });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  // A vertical swipe on the sheet's top folds or unfolds it; a tap on the grip
  // or the folded line toggles it through their own clicks. Followed on the
  // window, not captured, so a tap still lands on the button it started on.
  let swiped = false;
  const startSwipe = (e: PointerEvent) => {
    const y0 = e.clientY;
    swiped = false;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      if (Math.abs(dy) < 32 || dy > 0 === folded()) return;
      swiped = true;
      setFold(dy > 0);
      end();
    };
    const end = () => {
      host().window.removeEventListener("pointermove", move);
      host().window.removeEventListener("pointerup", end);
      host().window.removeEventListener("pointercancel", end);
    };
    host().window.addEventListener("pointermove", move);
    host().window.addEventListener("pointerup", end);
    host().window.addEventListener("pointercancel", end);
  };
  const toggle = (open: boolean) => {
    if (swiped) {
      swiped = false;
      return;
    }
    setFold(!open);
  };
  // What the folded sheet still says: where you are and what is asked.
  const peek = (): { k: string; t: string } => {
    if (s.mode() === "tune") return { k: "Tune", t: "" };
    if (s.mode() === "thread") return { k: "Thread", t: "" };
    const qs = s.questions();
    if (!s.asks().length) return { k: "Decide", t: s.mock()?.title ?? "" };
    if (s.reviewing()) {
      const n = s.owed().length;
      return { k: "Review", t: n ? `${n} still open` : "Ready to send" };
    }
    if (!qs.length) {
      const n = s.owed().length;
      return { k: "Questions", t: n ? `${n} open on other states` : "Nothing open" };
    }
    const i = Math.min(s.cur(), qs.length - 1);
    const q = qs[i];
    return {
      k: `${i + 1} of ${qs.length}`,
      t: q.kind === "ask" ? q.ask.text : "Borrow a part from another look?",
    };
  };

  // From where the card was to where it now rests, as one movement: the place
  // changes at once and the card is drawn travelling there from the old one.
  const glideFrom = (from: DOMRect) => {
    if (reducedMotion()) return;
    host().window.requestAnimationFrame(() => {
      const to = cardEl.getBoundingClientRect();
      const base = getComputedStyle(cardEl).transform;
      const rest = base === "none" ? "" : base;
      cardEl.animate(
        [
          { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) ${rest}` },
          { transform: rest || "none" },
        ],
        { duration: SNAP_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    });
  };
  // Fold to the question's line, or open again; opening fades the questions in.
  const setFold = (on: boolean) => {
    setFolded(on);
    if (on || reducedMotion()) return;
    host().window.requestAnimationFrame(() =>
      cardEl.querySelector(".qcard-body")?.animate(
        [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 160, easing: "ease-out" },
      ),
    );
  };
  const cardStyle = () => {
    // The sheet is placed by CSS alone, so a stale window size can't move it.
    if (phone()) return {};
    const c = carry();
    // Anchored by CSS to the edge it rests against, not placed from a measured
    // height: the card grows and shrinks with each question, and WebKit may not
    // report its first size at all.
    const a = area();
    const v = spot().at.split("-")[0];
    return {
      width: `${width()}px`,
      "max-height": `${a.h - 2 * INSET}px`,
      left: `${rect().x}px`,
      top: v === "top" ? `${a.top + INSET}px` : v === "mid" ? `${a.top + a.h / 2}px` : "auto",
      bottom: v === "bottom" ? `calc(${INSET}px + env(safe-area-inset-bottom))` : "auto",
      // Carried, it follows the finger from where it rests, lifted a little.
      transform:
        [
          c ? `translate3d(${c.dx}px, ${c.dy}px, 0) scale(0.97)` : "",
          v === "mid" ? "translateY(-50%)" : "",
        ]
          .filter(Boolean)
          .join(" ") || "none",
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
        ref={(el) => (cardEl = el)}
        class="qcard"
        classList={{
          "qcard-col": col(),
          carrying: !!carry(),
          hidden: !!spot().docked && !carry(),
          sheet: phone(),
          folded: folded(),
        }}
        style={cardStyle()}
        role="region"
        aria-label="Questions"
        // The grip and the question's header row carry the card; their buttons
        // stay buttons.
        onPointerDown={(e) => {
          const t = e.target as Element;
          if (phone()) {
            if (t.closest(".qcard-grip, .qpeek, .qhd, .qcard-mode") && !t.closest(".qhd button"))
              startSwipe(e);
            return;
          }
          if (t.closest("button, a, input, textarea, select")) return;
          if (t.closest(".qcard-grip, .qhd, .qcard-mode")) startCarry(e);
        }}
      >
        <Show
          when={phone()}
          fallback={
            <div class="qcard-grip">
              <i aria-hidden="true" />
              <button
                type="button"
                class="qcard-fold"
                aria-expanded={!folded()}
                aria-label={folded() ? "Show questions" : "Minimise questions"}
                title={folded() ? "Show questions" : "Minimise"}
                onClick={() => setFold(!folded())}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d={folded() ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} />
                </svg>
              </button>
            </div>
          }
        >
          <button
            type="button"
            class="qcard-grip"
            aria-expanded={!folded()}
            aria-label={folded() ? "Show questions" : "Hide questions"}
            onClick={() => toggle(folded())}
          >
            <i />
          </button>
        </Show>
        <Show when={folded()}>
          <button
            type="button"
            class="qpeek"
            onClick={() => (phone() ? toggle(true) : setFold(false))}
          >
            <span class="qpeek-k">{peek().k}</span>
            <span class="qpeek-t">{peek().t}</span>
            <span class="qpeek-go" aria-hidden="true">
              ⌃
            </span>
          </button>
        </Show>
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
      <Show when={carry() ? null : spot().docked}>
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
