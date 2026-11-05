// A surface document shrunk to fit a box: Home's thumbnails and the pictures on
// question options. Always a sandboxed iframe at an opaque origin, never markup
// in this document; pointer-events are off so it is only ever a picture.

import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { KnobValue } from "../../server/types.ts";
import { takeTurn } from "./frameQueue.ts";
import { host } from "./host.ts";
import { fitThumb } from "./logic.ts";

export const FRAME_W = 820;

export interface Focus {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function Thumb(props: {
  src: string;
  class?: string;
  focus?: Focus | null;
  title?: string;
  // The width the page lays out at; option pictures match the stage's, so a
  // phone design is pictured at phone width and a part's box lines up.
  width?: number;
  // A picture box whose size is fixed by its CSS (an aspect ratio) before
  // anything loads, so nothing under it moves when the page reports its
  // height. A page shorter than the box is centred in it, not stretched.
  fit?: boolean;
  // The whole page, scaled to fit the box both ways and centred, instead of
  // filling the width and cropping the bottom: a tall phone design in a small
  // picture still reads as a phone.
  whole?: boolean;
  // A box as tall as the page pictured, up to this many times its width: the
  // moodboard packs designs at their own heights.
  grow?: number;
  // Knob values the picture should show, sent to the page once it reports in
  // and again whenever they change, so a picture follows the draft without
  // reloading. A value baked into src is only where the page starts.
  knobs?: Record<string, KnobValue>;
  // What the user is deciding from: ahead of every other picture on the screen,
  // however many the margins started before it.
  first?: boolean;
  // Looked at, not glanced over: the closer look, a column in Studio. It keeps animating, where every other
  // Thumb tells its page it's small, in the fragment so it stays the same cached document.
  large?: boolean;
}) {
  let box!: HTMLDivElement;
  let frameEl: HTMLIFrameElement | undefined;
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  // The page's own height, from the bridge's resize message: a number, clamped.
  const [docH, setDocH] = createSignal<number | null>(null);
  // Near the screen and its turn has come: only then does the page start.
  const [started, setStarted] = createSignal(false);
  let endTurn = () => {};
  const sendKnobs = () => {
    const values = props.knobs;
    if (!values || !Object.keys(values).length) return;
    frameEl?.contentWindow?.postMessage({ __mockpit: true, type: "knobs", values }, "*");
  };
  createEffect(() => {
    void props.knobs;
    if (docH() !== null) sendKnobs();
  });
  onMount(() => {
    // A box hidden with its state measures nothing. Keep the last size: scaling the frame
    // to zero and back would flash on the way back, and resize the page inside it for no one.
    const measure = () => {
      if (box.clientWidth || box.clientHeight) {
        setSize({ w: box.clientWidth, h: box.clientHeight });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    // scrollMargin is what reaches past a scrolling ancestor like Home's;
    // rootMargin only grows the window's own edge.
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        near.disconnect();
        endTurn = takeTurn(() => setStarted(true), props.first);
      },
      { rootMargin: "300px", scrollMargin: "300px" } as IntersectionObserverInit,
    );
    near.observe(box);
    const onMessage = (e: MessageEvent) => {
      if (!frameEl || e.source !== frameEl.contentWindow) return;
      const d = e.data as Record<string, unknown> | null;
      if (!d || d.__mockpit !== true || d.type !== "resize") return;
      const h = typeof d.height === "number" && Number.isFinite(d.height) ? d.height : 0;
      if (h > 0) setDocH(Math.min(h, 20000));
      endTurn();
      // A fresh document starts from the values baked into its URL.
      sendKnobs();
    };
    host().window.addEventListener("message", onMessage);
    onCleanup(() => {
      ro.disconnect();
      near.disconnect();
      endTurn();
      host().window.removeEventListener("message", onMessage);
    });
  });
  const frame = () => {
    const { w } = size();
    const h = props.grow ? w * props.grow : size().h;
    const frameW = props.width ?? FRAME_W;
    const doc = docH();
    if (props.whole && doc && w && h) {
      const s = Math.min(w / frameW, h / doc);
      return { s, x: (w - frameW * s) / 2, y: (h - doc * s) / 2, h, frameH: doc };
    }
    const fit = fitThumb(w, h, doc, props.focus ?? null, frameW);
    return props.fit && fit.h < h ? { ...fit, y: fit.y + (h - fit.h) / 2 } : fit;
  };
  return (
    <div
      class={`thumb ${props.class ?? ""}`}
      ref={(el) => (box = el)}
      // Marks the box once its page has reported a height and the picture in
      // it is placed for good; the box itself never changes size.
      data-sized={docH() !== null ? "" : undefined}
      style={
        props.grow
          ? { height: `${docH() === null ? size().w * 0.6 : Math.ceil(frame().h)}px` }
          : undefined
      }
      aria-hidden="true"
    >
      {/* Keyed by src: a new document is a new element, never a frame navigation
          (which would add a joint-history entry under the user's Back button). */}
      <Show when={started() && (props.large ? props.src : `${props.src}#small`)} keyed>
        {(src) => (
          <iframe
            ref={(el) => {
              frameEl = el;
              setDocH(null);
            }}
            src={src}
            sandbox="allow-scripts"
            onLoad={() => endTurn()}
            tabIndex={-1}
            title={props.title ?? ""}
            width={props.width ?? FRAME_W}
            height={Math.ceil(frame().frameH)}
            style={{
              transform: `translate(${frame().x}px, ${frame().y}px) scale(${frame().s})`,
            }}
          />
        )}
      </Show>
    </div>
  );
}
