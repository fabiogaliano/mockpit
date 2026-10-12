// Inspect's touch gestures on the stage overlay, which alone has touch-action:
// none there: one finger pans the scroller, two pinch it between fit and 2×.
// Pointer Events only (no WebKit gesture events), and the page's own zoom is
// never disabled.

import { onCleanup, onMount } from "solid-js";
import { clampZoom, zoomScroll } from "./logic.ts";

export function useInspectGestures(opts: {
  scroller: () => HTMLElement;
  enabled: () => boolean;
  scale: () => number;
  fit: () => number;
  setZoom: (z: number) => void;
}) {
  const touches = new Map<number, { x: number; y: number }>();
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
    if (!opts.enabled() || e.pointerType !== "touch") return;
    if (!(e.target as Element).closest?.(".overlay")) return;
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
    } else if (gesture.kind === "pinch" && touches.size === 2) {
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
    }
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
}
