// The stage: one variant's surfaces rendered at a viewport preset, with the
// marker overlay above them.
//
// Every surface that becomes HTML renders exactly the way the rest of the viewer
// renders it — a sandboxed iframe pointed at `/s/:id?part=N` (see Card.tsx). The
// overlay lives in the trusted viewer origin ABOVE that frame and never reads
// into it: it asks the in-frame bridge for a hit-test and renders the reply as
// text only.
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import {
  appPath,
  type ImageSurface as ImageSurfaceData,
  type JsonSurface as JsonSurfaceData,
} from "./api.ts";
import { isSandboxedSurfaceKind, SURFACE_FRAME_CLASSES } from "../../server/types.ts";
import { registerCard } from "./Card.tsx";
import { ImageSurface } from "./ImageSurface.tsx";
import { JsonSurface } from "./JsonSurface.tsx";
import { markerLabel, nextRef, type Marker, type MarkerShape } from "./markers.ts";
import type { ViewerSurfaceRef } from "./projects.ts";
import { activeTheme, resolvedMode } from "./theme.ts";

export const VIEWPORTS = [390, 820, 1280] as const;
export type Viewport = (typeof VIEWPORTS)[number];
export const VIEWPORT_LABELS: Record<number, string> = {
  390: "phone",
  820: "tablet",
  1280: "desktop",
};

interface HitResult {
  path?: string;
  text?: string;
  rect?: number[];
}

// One listener for every stage: the sandbox answers a hit-test on the window,
// and the reply is matched back to its request by `ref`.
const pendingHits = new Map<string, (hit: HitResult) => void>();
let hitListening = false;
function listenForHits() {
  if (hitListening) return;
  hitListening = true;
  window.addEventListener("message", (ev: MessageEvent) => {
    const d = ev.data as {
      __sideshow?: boolean;
      type?: string;
      ref?: string;
      path?: unknown;
      text?: unknown;
      rect?: unknown;
    } | null;
    if (!d || !d.__sideshow || d.type !== "hit-test-result") return;
    const resolve = pendingHits.get(String(d.ref));
    if (!resolve) return;
    pendingHits.delete(String(d.ref));
    resolve({
      path: typeof d.path === "string" ? d.path.slice(0, 200) : undefined,
      text: typeof d.text === "string" ? d.text.slice(0, 80) : undefined,
      rect: Array.isArray(d.rect) ? (d.rect as number[]).map(Number) : undefined,
    });
  });
}

let hitSeq = 0;
// Ask a surface frame what is at a point. `x`/`y` are normalized 0..1 of the
// frame; `xPx`/`yPx` carry the same point in the frame's own CSS pixels so the
// sandbox script can use whichever it prefers. Resolves to an empty hit if the
// frame doesn't answer.
function hitTest(
  frame: HTMLIFrameElement,
  x: number,
  y: number,
  xPx: number,
  yPx: number,
): Promise<HitResult> {
  listenForHits();
  const ref = `h${++hitSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingHits.delete(ref);
      resolve({});
    }, 600);
    pendingHits.set(ref, (hit) => {
      clearTimeout(timer);
      resolve(hit);
    });
    frame.contentWindow?.postMessage(
      { __sideshow: true, type: "hit-test", x, y, xPx, yPx, ref },
      "*",
    );
  });
}

export function Stage(props: {
  postId: string;
  version: number;
  surfaces: ViewerSurfaceRef[];
  viewport: number;
  marking: boolean;
  markers: Marker[];
  // Markers already sent with a comment: kept visible but dimmed until a newer
  // version renders, so the user can see what they pointed at.
  sentMarkers: Marker[];
  highlight: number | null;
  onAdd: (marker: Marker) => void;
  onChange: (ref: number, patch: Partial<Marker>) => void;
  onRemove: (ref: number) => void;
  badge?: () => JSX.Element;
}) {
  let wrap!: HTMLDivElement;
  let frame!: HTMLDivElement;
  let overlay!: HTMLDivElement;
  const iframes = new Set<HTMLIFrameElement>();
  const surfaceFrames = new Map<number, HTMLIFrameElement>();
  const [scale, setScale] = createSignal(1);
  const [draft, setDraft] = createSignal<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [popFor, setPopFor] = createSignal<number | null>(null);
  const [popAt, setPopAt] = createSignal<{ left: number; top: number }>({ left: 0, top: 0 });

  const src = (index: number) =>
    appPath(
      `/s/${props.postId}?part=${index}&ver=${props.version}&cb=${props.version}&theme=${activeTheme()}&mode=${resolvedMode()}`,
    );

  // The frame is laid out at the preset width and scaled down to fit the stage,
  // so a 1280px design stays truthful on a narrow screen.
  const fit = () => {
    if (!wrap || !frame) return;
    const available = wrap.clientWidth;
    const width = frame.offsetWidth || props.viewport;
    const s = Math.min(1, available / width);
    setScale(s);
    wrap.style.height = `${Math.max(120, frame.offsetHeight * s)}px`;
  };

  onMount(() => {
    // Register with the shared card registry so the postMessage resize bridge
    // sizes these iframes exactly like a card's.
    onCleanup(registerCard(props.postId, wrap, iframes));
    const ro = new ResizeObserver(() => fit());
    ro.observe(frame);
    ro.observe(wrap);
    onCleanup(() => ro.disconnect());
    window.addEventListener("resize", fit);
    onCleanup(() => window.removeEventListener("resize", fit));
    fit();
  });

  // Re-fit when the preset or the rendered version changes: both re-lay the
  // frame out, and the scale is derived from its size. (Reading the props IS
  // the subscription; `on` names them instead of leaving bare expressions.)
  createEffect(
    on(
      () => [props.viewport, props.version],
      () => queueMicrotask(fit),
    ),
  );

  const norm = (clientX: number, clientY: number) => {
    const r = frame.getBoundingClientRect();
    return [(clientX - r.left) / r.width, (clientY - r.top) / r.height] as const;
  };

  // Which surface frame is under a viewport point, and where inside it.
  const frameUnder = (clientX: number, clientY: number) => {
    for (const [index, el] of surfaceFrames) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return {
          index,
          el,
          x: (clientX - r.left) / r.width,
          y: (clientY - r.top) / r.height,
          xPx: (clientX - r.left) / scale(),
          yPx: (clientY - r.top) / scale(),
          rect: r,
        };
      }
    }
    return null;
  };

  // Convert a rect the sandbox reported (normalized to its own document) into
  // frame-normalized coordinates, so markers stay put when the stage rescales.
  const toFrameBox = (target: HTMLIFrameElement, rect: number[]) => {
    const fr = frame.getBoundingClientRect();
    const ir = target.getBoundingClientRect();
    const scaleToFrame = (v: number, size: number, offset: number, frameSize: number) =>
      (v * size + offset) / frameSize;
    const normalized = rect.every((v) => v >= 0 && v <= 1);
    const [rx, ry, rw, rh] = rect;
    if (!normalized) {
      // px in the frame's own coordinate space
      const s = scale() || 1;
      return [
        (ir.left - fr.left + rx * s) / fr.width,
        (ir.top - fr.top + ry * s) / fr.height,
        (rw * s) / fr.width,
        (rh * s) / fr.height,
      ];
    }
    return [
      scaleToFrame(rx, ir.width, ir.left - fr.left, fr.width),
      scaleToFrame(ry, ir.height, ir.top - fr.top, fr.height),
      (rw * ir.width) / fr.width,
      (rh * ir.height) / fr.height,
    ];
  };

  let drag: { x0: number; y0: number; cx: number; cy: number; x: number; y: number } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (!props.marking) return;
    if ((e.target as HTMLElement).closest(".ss-mk")) return;
    e.preventDefault();
    setPopFor(null);
    overlay.setPointerCapture(e.pointerId);
    const [x, y] = norm(e.clientX, e.clientY);
    drag = { x0: x, y0: y, x, y, cx: e.clientX, cy: e.clientY };
    setDraft({ x, y, w: 0, h: 0 });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    const [x, y] = norm(e.clientX, e.clientY);
    drag.x = x;
    drag.y = y;
    setDraft({
      x: Math.min(drag.x0, x),
      y: Math.min(drag.y0, y),
      w: Math.abs(x - drag.x0),
      h: Math.abs(y - drag.y0),
    });
  };

  const onPointerUp = async (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    setDraft(null);
    const w = Math.abs(d.x - d.x0);
    const h = Math.abs(d.y - d.y0);
    // A tap is a drag that went nowhere: the gesture decides the shape, so
    // there's no tool to arm first.
    const isPin = w < 0.01 || h < 0.01;
    const centerX = isPin ? d.cx : (d.cx + e.clientX) / 2;
    const centerY = isPin ? d.cy : (d.cy + e.clientY) / 2;
    const target = frameUnder(centerX, centerY);
    const ref = nextRef([...props.markers, ...props.sentMarkers]);
    const marker: Marker = {
      ref,
      shape: isPin ? "pin" : "rect",
      x: isPin ? d.x0 : Math.min(d.x0, d.x),
      y: isPin ? d.y0 : Math.min(d.y0, d.y),
      w: isPin ? 0 : w,
      h: isPin ? 0 : h,
      surfaceIndex: target?.index ?? 0,
    };
    props.onAdd(marker);
    if (!target) return;
    const hit = await hitTest(target.el, target.x, target.y, target.xPx, target.yPx);
    if (!hit.path && !hit.text) return;
    props.onChange(ref, {
      path: hit.path,
      text: hit.text,
      ...(hit.rect && hit.rect.length === 4 ? { rect: toFrameBox(target.el, hit.rect) } : {}),
    });
  };

  const reshape = (shape: MarkerShape | "del") => {
    const ref = popFor();
    setPopFor(null);
    if (ref === null) return;
    if (shape === "del") {
      props.onRemove(ref);
      return;
    }
    const m = props.markers.find((x) => x.ref === ref);
    if (!m) return;
    if (m.shape === "pin") {
      // Snap a pin to the element the sandbox named; fall back to a small box
      // around the point when it couldn't name one.
      const box = m.rect;
      props.onChange(ref, {
        shape,
        x: box ? box[0] : Math.max(0, m.x - 0.06),
        y: box ? box[1] : Math.max(0, m.y - 0.06),
        w: box ? box[2] : 0.12,
        h: box ? box[3] : 0.12,
      });
    } else {
      props.onChange(ref, { shape });
    }
  };

  const openPop = (ref: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    setPopAt({
      left: Math.max(4, Math.min(r.left - w.left + wrap.scrollLeft, wrap.clientWidth - 150)),
      top: r.top - w.top + wrap.scrollTop + r.height + 10,
    });
    setPopFor(ref);
  };

  const markerStyle = (m: Marker) => ({
    left: `${m.x * 100}%`,
    top: `${m.y * 100}%`,
    ...(m.shape === "pin" ? {} : { width: `${m.w * 100}%`, height: `${m.h * 100}%` }),
  });

  return (
    <div class="ss-stagewrap" classList={{ marking: props.marking }} ref={(el) => (wrap = el)}>
      {props.badge?.()}
      <Show when={popFor() !== null}>
        <div class="ss-pop" style={{ left: `${popAt().left}px`, top: `${popAt().top}px` }}>
          <button type="button" onClick={() => reshape("circle")}>
            ◯ circle
          </button>
          <button type="button" onClick={() => reshape("rect")}>
            ▭ box
          </button>
          <button type="button" class="d" onClick={() => reshape("del")}>
            ✕ delete
          </button>
        </div>
      </Show>
      <div
        class="ss-frame"
        ref={(el) => (frame = el)}
        style={{ width: `${props.viewport}px`, transform: `scale(${scale()})` }}
      >
        <For each={props.surfaces}>
          {(surface, i) => (
            <Switch
              fallback={
                <div class="surface-unsupported">
                  Can&rsquo;t show this surface — refresh sideshow to update the viewer.
                </div>
              }
            >
              <Match when={isSandboxedSurfaceKind(surface.kind as never)}>
                <iframe
                  ref={(el) => {
                    surfaceFrames.set(i(), el);
                    iframes.add(el);
                    onCleanup(() => {
                      surfaceFrames.delete(i());
                      iframes.delete(el);
                    });
                  }}
                  sandbox="allow-scripts"
                  loading="lazy"
                  class={SURFACE_FRAME_CLASSES[surface.kind as keyof typeof SURFACE_FRAME_CLASSES]}
                  title={`surface ${i() + 1}`}
                  src={src(i())}
                ></iframe>
              </Match>
              <Match when={surface.kind === "image"}>
                <ImageSurface surface={surface as unknown as ImageSurfaceData} />
              </Match>
              <Match when={surface.kind === "json"}>
                <JsonSurface surface={surface as unknown as JsonSurfaceData} />
              </Match>
            </Switch>
          )}
        </For>
        <div
          class="ss-overlay"
          classList={{ off: !props.marking }}
          ref={(el) => (overlay = el)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => void onPointerUp(e)}
        >
          <For each={props.sentMarkers}>
            {(m) => (
              <div
                class={`ss-mk ${m.shape} sent`}
                classList={{ hover: props.highlight === m.ref }}
                style={markerStyle(m)}
              >
                <span class="n">{m.ref}</span>
              </div>
            )}
          </For>
          <For each={props.markers}>
            {(m) => (
              <div
                class={`ss-mk ${m.shape}`}
                classList={{ hover: props.highlight === m.ref }}
                style={markerStyle(m)}
                title={markerLabel(m)}
                onClick={(e) => {
                  e.stopPropagation();
                  openPop(m.ref, e.currentTarget);
                }}
              >
                <span class="n">{m.ref}</span>
              </div>
            )}
          </For>
          <Show when={draft()} keyed>
            {(d) => (
              <div
                class="ss-draft"
                style={{
                  left: `${d.x * 100}%`,
                  top: `${d.y * 100}%`,
                  width: `${d.w * 100}%`,
                  height: `${d.h * 100}%`,
                }}
              ></div>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

export function ViewportTabs(props: { value: number; onPick: (v: number) => void }) {
  return (
    <div class="ss-tabs ss-vp" role="group" aria-label="Viewport">
      <For each={VIEWPORTS}>
        {(w) => (
          <button
            type="button"
            classList={{ on: props.value === w }}
            aria-pressed={props.value === w}
            onClick={() => props.onPick(w)}
          >
            {VIEWPORT_LABELS[w]}
          </button>
        )}
      </For>
    </div>
  );
}
