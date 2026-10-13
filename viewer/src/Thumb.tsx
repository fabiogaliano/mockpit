// A surface document shrunk to fit a box: Home's thumbnails and the pictures on
// question options. Always a sandboxed iframe at an opaque origin, never markup
// in this document; pointer-events are off so it is only ever a picture.

import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { KnobValue } from "../../server/types.ts";
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
  // Knob values the picture should show, sent to the page once it reports in
  // and again whenever they change, so a picture follows the draft without
  // reloading. A value baked into src is only where the page starts.
  knobs?: Record<string, KnobValue>;
}) {
  let box!: HTMLDivElement;
  let frameEl: HTMLIFrameElement | undefined;
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  // The page's own height, from the bridge's resize message: a number, clamped.
  const [docH, setDocH] = createSignal<number | null>(null);
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
    const measure = () => setSize({ w: box.clientWidth, h: box.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    const onMessage = (e: MessageEvent) => {
      if (!frameEl || e.source !== frameEl.contentWindow) return;
      const d = e.data as Record<string, unknown> | null;
      if (!d || d.__mockpit !== true || d.type !== "resize") return;
      const h = typeof d.height === "number" && Number.isFinite(d.height) ? d.height : 0;
      if (h > 0) setDocH(Math.min(h, 20000));
      // A fresh document starts from the values baked into its URL.
      sendKnobs();
    };
    host().window.addEventListener("message", onMessage);
    onCleanup(() => {
      ro.disconnect();
      host().window.removeEventListener("message", onMessage);
    });
  });
  const frame = () => {
    const { w, h } = size();
    const fit = fitThumb(w, h, docH(), props.focus ?? null, props.width ?? FRAME_W);
    return props.fit && fit.h < h ? { ...fit, y: fit.y + (h - fit.h) / 2 } : fit;
  };
  return (
    <div
      class={`thumb ${props.class ?? ""}`}
      ref={(el) => (box = el)}
      // Marks the box once its page has reported a height and the picture in
      // it is placed for good; the box itself never changes size.
      data-sized={docH() !== null ? "" : undefined}
      aria-hidden="true"
    >
      {/* Keyed by src: a new document is a new element, never a frame navigation
          (which would add a joint-history entry under the user's Back button). */}
      <Show when={props.src} keyed>
        {(src) => (
          <iframe
            ref={(el) => {
              frameEl = el;
              setDocH(null);
            }}
            src={src}
            sandbox="allow-scripts"
            loading="lazy"
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
