// A surface document shrunk to fit a box: Home's thumbnails and the pictures on
// question options. Always a sandboxed iframe at an opaque origin, never markup
// in this document; pointer-events are off so it is only ever a picture.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
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
  // Size the box to the page (up to 4:3 of its width) instead of the box's own
  // CSS height, so no empty band shows under a short page.
  fit?: boolean;
}) {
  let box!: HTMLDivElement;
  let frameEl: HTMLIFrameElement | undefined;
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  // The page's own height, from the bridge's resize message: a number, clamped.
  const [docH, setDocH] = createSignal<number | null>(null);
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
    };
    host().window.addEventListener("message", onMessage);
    onCleanup(() => {
      ro.disconnect();
      host().window.removeEventListener("message", onMessage);
    });
  });
  const frame = () => {
    const { w, h } = size();
    return fitThumb(
      w,
      props.fit ? Math.round((w * 3) / 4) : h,
      docH(),
      props.focus ?? null,
      FRAME_W,
    );
  };
  return (
    <div
      class={`thumb ${props.class ?? ""}`}
      ref={(el) => (box = el)}
      style={props.fit && size().w ? { height: `${frame().h}px` } : undefined}
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
            width={FRAME_W}
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
