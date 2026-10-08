// A surface document shrunk to fit a box: Home's thumbnails and the pictures on
// question options. Always a sandboxed iframe at an opaque origin, never markup
// in this document; pointer-events are off so it is only ever a picture.

import { createSignal, onCleanup, onMount, Show } from "solid-js";

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
}) {
  let box!: HTMLDivElement;
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  onMount(() => {
    const measure = () => setSize({ w: box.clientWidth, h: box.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    onCleanup(() => ro.disconnect());
  });
  // Without a focus the page fills the width from its top; with one, the part
  // (plus a margin) is scaled to fit and centred.
  const frame = () => {
    const { w, h } = size();
    if (!w || !h) return { s: w / FRAME_W || 0.1, x: 0, y: 0, height: 640 };
    const f = props.focus;
    if (!f) return { s: w / FRAME_W, x: 0, y: 0, height: h / (w / FRAME_W) };
    const pad = 36;
    const fx = Math.max(0, f.x - pad);
    const fy = Math.max(0, f.y - pad);
    const fw = Math.min(FRAME_W - fx, f.w + pad * 2);
    const fh = f.h + pad * 2;
    const s = Math.min(w / fw, h / fh, 1);
    const x = -fx * s + (w - fw * s) / 2;
    const y = -fy * s + (h - fh * s) / 2;
    return {
      s,
      x: Math.min(0, Math.max(x, w - FRAME_W * s)),
      y: Math.min(0, y),
      height: fy + h / s,
    };
  };
  return (
    <div class={`thumb ${props.class ?? ""}`} ref={(el) => (box = el)} aria-hidden="true">
      {/* Keyed by src: a new document is a new element, never a frame navigation
          (which would add a joint-history entry under the user's Back button). */}
      <Show when={props.src} keyed>
        {(src) => (
          <iframe
            src={src}
            sandbox="allow-scripts"
            loading="lazy"
            tabIndex={-1}
            title={props.title ?? ""}
            width={FRAME_W}
            height={Math.ceil(frame().height)}
            style={{
              transform: `translate(${frame().x}px, ${frame().y}px) scale(${frame().s})`,
            }}
          />
        )}
      </Show>
    </div>
  );
}
