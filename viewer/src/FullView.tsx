// One version's page alone on the whole screen, at the width it was designed
// for, live: a tap still reaches the page (a lab's creature still reacts).
// A pinch zooms it and its midpoint pans; one finger scrolls it natively.
// The page itself never zooms: its bridge keeps two fingers from the browser
// and reports them here (surfacePage.ts), as Stage's canvas is zoomed. A page
// takes its full height, so it has nothing of its own to scroll and a finger
// on it moves this view instead.

import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { host } from "./host.ts";
import { Icon } from "./icons.tsx";
import { useInspectGestures } from "./gestures.ts";
import { win } from "./viewport.ts";

// Far enough in to read a page's smallest print at a phone's width.
const FULL_MAX = 4;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function FullView(props: {
  src: string;
  width: number;
  title: string;
  onClose: () => void;
}) {
  let box!: HTMLDivElement;
  let scroller!: HTMLDivElement;
  let frame: HTMLIFrameElement | undefined;
  let closer: HTMLButtonElement | undefined;
  // The page's height from its bridge; the screen's until it reports.
  const [docH, setDocH] = createSignal<number | null>(null);
  // null: fitted to the screen's width, which a resize or a turn changes.
  const [zoom, setZoom] = createSignal<number | null>(null);
  const fit = createMemo(() => Math.min(1, win().w / props.width));
  const scale = () => zoom() ?? fit();
  const h = () => docH() ?? win().h;

  const gestures = useInspectGestures({
    scroller: () => scroller,
    enabled: () => true,
    // One finger is the browser's: it scrolls this view, or taps the page.
    pointers: () => false,
    scale,
    fit,
    max: () => FULL_MAX,
    setZoom,
  });
  // A point the page reports, in its px, onto the screen through the frame's drawn box.
  const onScreen = (v: unknown) => {
    const p = (v ?? {}) as Record<string, unknown>;
    const r = frame!.getBoundingClientRect();
    const k = r.width / frame!.offsetWidth;
    return { x: r.left + num(p.x) * k, y: r.top + num(p.y) * k };
  };
  const onMessage = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data as Record<string, unknown> | null;
    if (!d || d.__mockpit !== true) return;
    if (d.type === "resize") {
      const height = num(d.height);
      if (height > 0) setDocH(Math.min(height, 20000));
    } else if (d.type === "pinch") {
      const phase = d.phase === "start" || d.phase === "move" || d.phase === "end" ? d.phase : null;
      if (phase && frame.offsetWidth) gestures.pinch(phase, onScreen(d.a), onScreen(d.b));
    } else if (d.type === "zoom" && frame.offsetWidth) {
      const at = onScreen(d);
      gestures.zoomAt(Math.exp(-Math.max(-200, Math.min(200, num(d.dy))) * 0.01), at.x, at.y);
    }
  };
  onMount(() => {
    host().window.addEventListener("message", onMessage);
    onCleanup(() => host().window.removeEventListener("message", onMessage));
  });
  // Two fingers that land around the page rather than on it, and a trackpad
  // pinch there: this view's zoom too, never the viewer's.
  onMount(() => {
    let pinching = false;
    const at = (t: Touch | undefined) => ({ x: t?.clientX ?? 0, y: t?.clientY ?? 0 });
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      pinching = true;
      gestures.pinch("start", at(e.touches[0]), at(e.touches[1]));
    };
    const move = (e: TouchEvent) => {
      if (!pinching || e.touches.length < 2) return;
      e.preventDefault();
      gestures.pinch("move", at(e.touches[0]), at(e.touches[1]));
    };
    const end = (e: TouchEvent) => {
      if (!pinching || e.touches.length >= 2) return;
      pinching = false;
      gestures.pinch("end", at(undefined), at(undefined));
    };
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      gestures.zoomAt(
        Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.01),
        e.clientX,
        e.clientY,
      );
    };
    scroller.addEventListener("touchstart", start, { passive: false });
    scroller.addEventListener("touchmove", move, { passive: false });
    scroller.addEventListener("touchend", end);
    scroller.addEventListener("touchcancel", end);
    scroller.addEventListener("wheel", wheel, { passive: false });
    onCleanup(() => {
      scroller.removeEventListener("touchstart", start);
      scroller.removeEventListener("touchmove", move);
      scroller.removeEventListener("touchend", end);
      scroller.removeEventListener("touchcancel", end);
      scroller.removeEventListener("wheel", wheel);
    });
  });
  // A dialog over everything: what is under it can't be reached until it
  // closes, and focus goes back to what opened it.
  onMount(() => {
    const doc = host().window.document;
    const opener = doc.activeElement as HTMLElement | null;
    const quieted: HTMLElement[] = [];
    for (let el: HTMLElement = box; el.parentElement && el !== doc.body; el = el.parentElement) {
      for (const sib of el.parentElement.children) {
        if (sib === el || !(sib instanceof HTMLElement) || sib.inert) continue;
        sib.inert = true;
        quieted.push(sib);
      }
    }
    closer?.focus();
    onCleanup(() => {
      for (const el of quieted) el.inert = false;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
  });
  const percent = () => Math.round(scale() * 100);

  // On the body: whatever opened it may sit in a stacking context of its own
  // (Studio is fixed), under which no z-index would clear the viewer's header.
  return (
    <Portal mount={host().window.document.body}>
      <div
        class="full"
        ref={(el) => (box = el)}
        role="dialog"
        aria-modal="true"
        aria-label={`Full screen: ${props.title}`}
      >
        <div class="full-scroll" ref={(el) => (scroller = el)}>
          <div
            class="full-sizer"
            style={{
              width: `${props.width * scale()}px`,
              height: `${h() * scale()}px`,
            }}
          >
            <iframe
              ref={(el) => (frame = el)}
              src={props.src}
              sandbox="allow-scripts"
              title={props.title}
              width={props.width}
              height={Math.ceil(h())}
              style={{ transform: `scale(${scale()})` }}
            />
          </div>
        </div>
        <div class="full-bar">
          <Show when={zoom() !== null && Math.abs(scale() - fit()) > 0.01}>
            <button
              type="button"
              class="full-zoom"
              aria-label={`Zoomed to ${percent()}%. Fit to screen`}
              onClick={() => setZoom(null)}
            >
              {`${percent()}%`}
            </button>
          </Show>
          <button
            type="button"
            class="ib full-close"
            ref={(el) => (closer = el)}
            aria-label="Close full screen"
            title="Close (Esc)"
            onClick={props.onClose}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
    </Portal>
  );
}
