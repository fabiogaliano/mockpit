// A phone's question put away: the sheet and its bar give the whole height to the design,
// and the questions wait as one tab flush against an edge, as tunekit's panel docks. A
// drag carries it, and it snaps to the nearest of six places (each side, high, middle or
// low), remembered per browser; a tap brings the sheet back on the question it left.

import { createSignal, Show } from "solid-js";
import { isBuiltinAsk } from "./logic.ts";
import { host } from "./host.ts";
import type { DesignScreenState } from "./state.ts";

type Side = "left" | "right";
type At = "top" | "middle" | "bottom";
type Spot = { side: Side; at: At };

const KEY = "mockpit:question-dot";
// A finger that moved less than this tapped.
const TAP_SLOP = 6;

const readSpot = (): Spot => {
  try {
    const v = JSON.parse(host().storage?.getItem(KEY) ?? "null") as Partial<Spot> | null;
    const side = v?.side === "left" ? "left" : "right";
    const at = v?.at === "top" || v?.at === "middle" ? v.at : "bottom";
    return { side, at };
  } catch {
    return { side: "right", at: "bottom" };
  }
};
const [spot, setSpotSignal] = createSignal<Spot>(readSpot());
const setSpot = (next: Spot) => {
  setSpotSignal(next);
  host().storage?.setItem(KEY, JSON.stringify(next));
};

// Put away with questions still waiting: the tab stands in for the sheet and its bar.
export const questionDotted = (s: DesignScreenState) =>
  s.cardMin() && !s.panel() && s.flow().length > 0 && !s.design()?.archivedAt;

export function QuestionDot(props: { s: DesignScreenState }) {
  const s = props.s;
  const n = () =>
    new Set(
      s
        .flow()
        .map((e) => e.ask.id)
        .filter((id) => !isBuiltinAsk({ id })),
    ).size;
  let el!: HTMLButtonElement;
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    drag.moved = true;
    el.classList.add("dragging");
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) return s.setCardMin(false);
    // Snap where it was let go, then slide from there into place (first, last, invert).
    const before = el.getBoundingClientRect();
    const w = host().window;
    const cx = before.left + before.width / 2;
    const cy = before.top + before.height / 2;
    const h = w.innerHeight;
    setSpot({
      side: cx < w.innerWidth / 2 ? "left" : "right",
      at: cy < h / 3 ? "top" : cy > (h * 2) / 3 ? "bottom" : "middle",
    });
    el.classList.remove("dragging");
    el.style.transform = "";
    const after = el.getBoundingClientRect();
    el.style.transform = `translate(${before.left - after.left}px, ${before.top - after.top}px)`;
    w.requestAnimationFrame(() => {
      el.classList.add("settling");
      el.style.transform = "";
      w.setTimeout(() => el.classList.remove("settling"), 220);
    });
  };
  const onCancel = () => {
    drag = null;
    el.classList.remove("dragging");
    el.style.transform = "";
  };

  return (
    <button
      type="button"
      class={`qdot ${spot().side} ${spot().at}`}
      aria-label={n() === 1 ? "Show the question" : `Show the questions, ${n()} waiting`}
      title="Show the question; drag to move"
      ref={(x) => (el = x)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          s.setCardMin(false);
        }
      }}
    >
      <span class="qdot-q" aria-hidden="true">
        ?
      </span>
      <Show when={n() > 1}>
        <span class="qdot-n" aria-hidden="true">
          {n()}
        </span>
      </Show>
    </button>
  );
}
