// The touch gestures of Inspect and the canvas, on the stage overlay and the
// artboards, which alone have touch-action: none there: one finger pans the scroller, two pinch it between fit and 2×.
// Pointer Events only (no WebKit gesture events), and the page's own zoom is
// never disabled. A pinch that lands on a page the canvas lets touches through
// to is caught by the page's bridge and fed in through `pinch`.

import { onCleanup, onMount } from "solid-js";
import { clampZoom, zoomScroll } from "./logic.ts";

type Point = { x: number; y: number };

export function useInspectGestures(opts: {
  scroller: () => HTMLElement;
  enabled: () => boolean;
  // Whether a finger's pointer pans and pinches here; when not, only `pinch`
  // moves it and the browser scrolls the scroller itself.
  pointers?: () => boolean;
  // The whole scroller is the surface (the canvas), not just what is drawn on it.
  anywhere?: () => boolean;
  scale: () => number;
  fit: () => number;
  setZoom: (z: number) => void;
}) {
  const touches = new Map<number, Point>();
  let gesture:
    | { kind: "pan"; x: number; y: number; left: number; top: number }
    | { kind: "pinch"; dist: number; z: number; mid: { x: number; y: number } }
    | null = null;
  let swallowClick = false;

  const pair = (el: HTMLElement) => {
    const [a, b] = [...touches.values()];
    const box = el.getBoundingClientRect();
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top },
    };
  };
  const panFrom = (el: HTMLElement, x: number, y: number) => {
    gesture = { kind: "pan", x, y, left: el.scrollLeft, top: el.scrollTop };
  };
  const down = (e: PointerEvent) => {
    if (touches.size === 0) swallowClick = false;
    if (!opts.enabled() || e.pointerType !== "touch" || opts.pointers?.() === false) return;
    // The live frame's overlay, or an artboard of another width beside it; on
    // the canvas, the empty space between and around them too.
    if (!opts.anywhere?.() && !(e.target as Element).closest?.(".overlay, .board")) return;
    const el = opts.scroller();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) panFrom(el, e.clientX, e.clientY);
    else if (touches.size === 2) {
      const p = pair(el);
      gesture = { kind: "pinch", dist: p.dist, z: opts.scale(), mid: p.mid };
      swallowClick = true;
    }
  };
  const move = (e: PointerEvent) => {
    if (!touches.has(e.pointerId) || !gesture) return;
    const el = opts.scroller();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.kind === "pan" && touches.size === 1) {
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (Math.hypot(dx, dy) > 8) swallowClick = true;
      el.scrollLeft = gesture.left - dx;
      el.scrollTop = gesture.top - dy;
    } else if (gesture.kind === "pinch" && touches.size === 2) pinchTo(el);
  };
  const pinchTo = (el: HTMLElement) => {
    if (gesture?.kind !== "pinch") return;
    const p = pair(el);
    const z0 = opts.scale();
    const z1 = clampZoom((gesture.z * p.dist) / gesture.dist, opts.fit());
    // The midpoint's own travel pans; the spread zooms around it.
    const left = zoomScroll(el.scrollLeft + gesture.mid.x - p.mid.x, p.mid.x, z0, z1);
    const top = zoomScroll(el.scrollTop + gesture.mid.y - p.mid.y, p.mid.y, z0, z1);
    gesture.mid = p.mid;
    opts.setZoom(z1);
    el.scrollLeft = left;
    el.scrollTop = top;
  };
  // Two fingers on a page inside a frame, already in this document's px.
  const pinch = (phase: "start" | "move" | "end", a: Point, b: Point) => {
    if (!opts.enabled()) return;
    if (phase === "end") {
      touches.clear();
      gesture = null;
      return;
    }
    const el = opts.scroller();
    touches.clear();
    touches.set(-1, a);
    touches.set(-2, b);
    if (phase === "start" || gesture?.kind !== "pinch") {
      const p = pair(el);
      gesture = { kind: "pinch", dist: p.dist, z: opts.scale(), mid: p.mid };
    } else pinchTo(el);
  };
  const up = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    const [rest] = [...touches.values()];
    // Lifting one finger of a pinch carries on as a pan from where it is.
    if (rest) panFrom(opts.scroller(), rest.x, rest.y);
    else gesture = null;
  };
  // A pan or pinch ends in a click on the overlay; it must not select a part.
  const click = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
  };
  onMount(() => {
    const el = opts.scroller();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    onCleanup(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
    });
  });
  return { pinch };
}

// A row that a finger swipes left to act on it (resolve a mock on Home). The
// row follows the finger once the move is clearly sideways, and the action
// fires past a share of its width or on a quick flick; short of that it springs
// back. Touch and pen only: a mouse has the row's button instead. The row's
// `touch-action: pan-y` leaves vertical scrolling to the browser, which cancels
// the pointer when it takes the gesture, so a scroll never turns into a swipe.
const SWIPE_SLOP = 10;
export const swipeCommits = (dx: number, width: number, velocity: number): boolean =>
  dx < -Math.min(140, width * 0.4) || (dx < -48 && velocity < -0.6);

export function useSwipeAction(
  el: HTMLElement,
  opts: {
    enabled: () => boolean;
    // How far the row has travelled, ≤ 0; null when it lets go.
    move: (dx: number | null) => void;
    commit: () => void;
  },
) {
  let start: { id: number; x: number; y: number } | null = null;
  let engaged = false;
  let dx = 0;
  let last = { x: 0, t: 0 };
  let velocity = 0;
  let swallowClick = false;

  const down = (e: PointerEvent) => {
    swallowClick = false;
    if (!opts.enabled() || e.pointerType === "mouse" || !e.isPrimary) return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY };
    engaged = false;
    dx = 0;
    velocity = 0;
    last = { x: e.clientX, t: e.timeStamp };
  };
  const move = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const mx = e.clientX - start.x;
    const my = e.clientY - start.y;
    if (!engaged) {
      if (Math.hypot(mx, my) < SWIPE_SLOP) return;
      // Down, up or to the right first: not ours.
      if (Math.abs(my) >= Math.abs(mx) || mx > 0) {
        start = null;
        return;
      }
      engaged = true;
      swallowClick = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser no longer tracks: the row still follows it here.
      }
    }
    const dt = Math.max(1, e.timeStamp - last.t);
    velocity = (e.clientX - last.x) / dt;
    last = { x: e.clientX, t: e.timeStamp };
    dx = Math.min(0, mx);
    opts.move(dx);
  };
  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const was = engaged;
    start = null;
    engaged = false;
    if (!was) return;
    if (e.type === "pointerup" && swipeCommits(dx, el.clientWidth, velocity)) opts.commit();
    else opts.move(null);
  };
  // The swipe ends where it began, on the row's link: that must not open it.
  const click = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("click", click, true);
  onCleanup(() => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("click", click, true);
  });
}
