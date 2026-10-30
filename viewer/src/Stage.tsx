// D1: one stage per mock, never replaced: a pannable, zoomable canvas under the
// top bar. Every (state, variant) of the version on stage is its own sandboxed
// frame, all loaded at once; only the active one is visible, the rest stay laid
// out (visibility, not display) so they report their parts up front and
// switching is instant. The mock's other widths sit beside the live one as
// picture-only artboards.
//
// The overlay above the active frame is ours (trusted origin) and is built only
// from what the frames report as data: boxes, names, numbers. Hover and click
// ask the frame itself what is under the pointer (`hit`), because only the page
// knows its own stacking.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { createStore } from "solid-js/store";
import { isLive, isSandboxedSurfaceKind, type Surface } from "../../server/types.ts";
import { assetUrl, surfaceUrl, type VariantView } from "./api.ts";
import { host, readonly, root } from "./host.ts";
import { useInspectGestures } from "./gestures.ts";
import { JsonTree } from "./JsonTree.tsx";
import {
  boardWidths,
  changedPart,
  clampZoom,
  createHitRefs,
  draftKnobValues,
  frameKey,
  historyRow,
  layoutPins,
  markPins,
  nextMark,
  type PartBox,
  partBox,
  partPinSpot,
  type PartsReport,
  reportIsCurrent,
  widthLabel,
} from "./logic.ts";
import { PartReactions } from "./Reactions.tsx";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { canvasTop, cardInset, coarse, phoneLayout, safeX, win } from "./viewport.ts";

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const MAX_TEXT = 200;
const text = (v: unknown, max = MAX_TEXT) => String(v ?? "").slice(0, max);
const MAX_PROMPT = 4000;
const MAX_SELECTOR = 500;

// A mark being placed: where the click landed (document px and normalized to
// the document box), then what the frame says is there, as it arrives.
interface PendingMark {
  ref: number;
  x: number;
  y: number;
  offset: [number, number];
  part?: string | null;
  selector?: string;
  quote?: string;
  rect?: [number, number, number, number];
}

const httpUrl = (v: unknown): string | null => {
  try {
    const u = new URL(String(v));
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
};

// Everything a frame says is untrusted: copy out plain strings and numbers only.
function readReport(d: Record<string, unknown>, frameW: number): PartsReport | null {
  if (!Array.isArray(d.parts)) return null;
  const scroll = (d.scroll ?? {}) as Record<string, unknown>;
  const viewport = (d.viewport ?? {}) as Record<string, unknown>;
  return {
    version: num(d.version),
    width: num(viewport.w, frameW) || frameW,
    height: num(d.height),
    scroll: { x: num(scroll.x), y: num(scroll.y) },
    scrollW: num(viewport.scrollW),
    parts: d.parts.slice(0, 200).flatMap((p: Record<string, unknown>) => {
      if (!p || typeof p !== "object") return [];
      const b = (p.box ?? {}) as Record<string, unknown>;
      const name = text(p.name);
      if (!name) return [];
      return [
        {
          name,
          label: text(p.label) || name,
          box: { x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h) },
          visible: p.visible === true,
          depth: num(p.depth),
          order: num(p.order),
        },
      ];
    }),
  };
}

// The canvas, in screen px: a margin round the artboards, a line for each
// one's label, and the space between them (scaled with them).
const BOARD_PAD = 16;
const BOARD_LABEL = 30;
const BOARD_GAP = 64;
// Under a finger a pin keeps its size and takes a 44px tap area around it;
// pins step apart far enough that those areas never overlap.
const PIN = 22;
const pinGap = () => (coarse() ? 44 - PIN : 6);
const pinEdge = () => (coarse() ? (44 - PIN) / 2 : 2);

export function Stage(props: { s: MockScreenState; onGoto?: (to: string) => void }) {
  const s = props.s;
  const { reports, setReports } = s;
  // Per frame, the version whose knob runtime has said it is listening.
  const [ready, setReady] = createStore<Record<string, number | undefined>>({});
  const [heights, setHeights] = createStore<Record<string, number>>({});
  const [contentH, setContentH] = createStore<Record<string, number>>({});
  const frames = new Map<
    HTMLIFrameElement,
    { key: string; index: number; primary: boolean; version: number }
  >();
  const refs = createHitRefs();
  const [pending, setPending] = createSignal<PendingMark | null>(null);
  const zoom = s.zoom;
  const setZoom = s.setZoom;
  // The other widths' artboards report their own page heights.
  const [boardH, setBoardH] = createStore<Record<number, number>>({});
  let layersEl!: HTMLDivElement;

  const frameW = () => s.frameW();
  // On a phone the canvas is one page: a single artboard fitted to the width,
  // edge to edge under the header, with nothing beside or below it to pan to.
  const phone = phoneLayout;
  // Above a phone's page, no label: only room for the tap area of a pin on its
  // very first line, which would otherwise sit under the header.
  const labelH = () => (phone() ? 12 : BOARD_LABEL);
  const order = createMemo(() => boardWidths(s.mock()?.widths ?? [], frameW(), zoom(), phone()));
  const others = createMemo(() => order().filter((w) => w !== frameW()));
  // The whole screen inside its safe area, less what floats at its sides.
  const availW = createMemo(
    () => win().w - safeX() - cardInset().left - cardInset().right - (phone() ? 0 : 2 * BOARD_PAD),
  );
  // The canvas's left margin, past what floats on its left: the live artboard
  // fitted is centred on the screen; all of them start at the margin.
  const padL = () => {
    const centred = Math.max(0, (availW() - frameW() * fitScale()) / 2);
    return cardInset().left + (zoom() === "all" ? BOARD_PAD : centred);
  };
  const activeKey = createMemo(() => {
    const v = s.activeVariant();
    return v ? frameKey(v.state, v.variant) : "";
  });
  // The design is shown whole across, fitted to the width between what floats
  // at the sides and never past true size; on a tablet or wider it also fits
  // the height above the bottom bar, so the bar never covers the first screen.
  // Its full height is the canvas's to pan and zoom.
  const availH = createMemo(() => win().h - canvasTop());
  const activeH = () => contentH[activeKey()] ?? 640;
  const fitScale = createMemo(() => {
    const across = Math.min(1, availW() / frameW());
    if (phone()) return Math.max(0.1, across);
    const room = availH() - cardInset().bottom - BOARD_LABEL - BOARD_PAD;
    const tall = Math.min(activeH(), win().h);
    return Math.max(0.1, Math.min(across, room > 120 ? room / tall : across));
  });
  // Every artboard side by side across the screen.
  const fitAll = createMemo(() => {
    const total = others().reduce((sum, w) => sum + BOARD_GAP + w, frameW());
    return Math.max(0.05, Math.min(fitScale(), (availW() - 2 * BOARD_PAD) / total));
  });
  // How far a pinch zooms out: to all widths, or half of fit, to see a design
  // smaller than its screen. A phone's page never zooms out past its width:
  // nothing sits beside it.
  const zoomFloor = () => Math.min(fitAll(), phone() ? fitScale() : fitScale() / 2);
  const scale = createMemo(() => {
    const z = zoom();
    if (z === "fit") return fitScale();
    if (z === "all") return fitAll();
    return clampZoom(z, zoomFloor());
  });
  createEffect(() => s.setStageScale(scale()));
  createEffect(() => s.setZoomMin(Math.min(zoomFloor(), 1)));

  const shown = createMemo(() =>
    s.variants().filter((v) => isLive(v.status) || v === s.variantFor(v.state)),
  );
  // Frames are keyed by (state, variant), not by object: every refetch brings
  // new variant objects, and keying by them would remount every frame (a fresh
  // load and fade-in) even though the version on stage did not change.
  const shownKeys = createMemo(() => shown().map((v) => frameKey(v.state, v.variant)), [], {
    equals: (a, b) => a.length === b.length && a.every((k, i) => k === b[i]),
  });
  const byKey = (key: string) => shown().find((v) => frameKey(v.state, v.variant) === key);

  function primaryOf(key: string): HTMLIFrameElement | null {
    for (const [el, info] of frames) if (info.key === key && info.primary) return el;
    return null;
  }
  function post(key: string, msg: Record<string, unknown>) {
    primaryOf(key)?.contentWindow?.postMessage({ ...msg, __mockpit: true }, "*");
  }

  const onMessage = (e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null;
    if (!d || typeof d !== "object" || d.__mockpit !== true) return;
    if (d.type === "pinch") return pinchFromFrame(e.source, d);
    if (d.type === "zoom") return zoomFromFrame(e.source, d);
    let info: { key: string; index: number; primary: boolean; version: number } | undefined;
    for (const [el, i] of frames) if (el.contentWindow === e.source) info = i;
    if (!info) return;
    if (d.type === "resize") {
      setHeights(`${info.key}#${info.index}`, Math.max(1, Math.min(num(d.height), 20000)));
    } else if (d.type === "ready" && info.primary) {
      if (reportIsCurrent(info.version, d.version)) setReady(info.key, info.version);
    } else if (d.type === "parts" && info.primary) {
      if (!reportIsCurrent(info.version, d.version)) return;
      const r = readReport(d, frameW());
      if (!r) return;
      const prev = reports[info.key];
      if (prev && info.key === activeKey() && s.flashArmed()) {
        const part = changedPart(prev, r);
        if (part) s.showFlash(part);
      }
      setReports(info.key, r);
    } else if (
      d.type === "tap" &&
      info.primary &&
      info.key === activeKey() &&
      passthrough() &&
      !s.trying()
    ) {
      // A tap the page took itself while the overlay stepped aside: ask which
      // part is under it, exactly as a click on the overlay would.
      post(info.key, { type: "hit", ref: refs.click(), x: num(d.x), y: num(d.y) });
    } else if (d.type === "hit" && info.primary && info.key === activeKey()) {
      const kind = refs.resolve(d.ref);
      const part = d.part == null ? null : text(d.part);
      if (kind === "hover") s.setHoverPart(part);
      else if (kind === "click") s.selectPart(part);
      else if (kind === "mark") updatePending(d.ref, { part });
    } else if (d.type === "goto") {
      // A click through the design names where to go; honoured only while the
      // user is trying it, from the document on stage, and resolved by the
      // host to a screen of this project, never followed as a URL.
      if (info.primary && info.key === activeKey() && s.trying()) {
        if (reportIsCurrent(info.version, d.version)) props.onGoto?.(text(d.to));
      }
    } else if (d.type === "hit-test-result" && info.primary && info.key === activeKey()) {
      const r = Array.isArray(d.rect) ? d.rect.slice(0, 4).map((v) => num(v)) : [];
      updatePending(d.ref, {
        selector: text(d.path, MAX_SELECTOR) || undefined,
        quote: text(d.text) || undefined,
        rect: r.length === 4 ? (r as [number, number, number, number]) : undefined,
      });
    } else if (info.key === activeKey()) {
      // The page's own channels to the user, honoured only from what is on stage.
      if (d.type === "send-prompt") {
        const t = text(d.text, MAX_PROMPT).trim();
        if (t && !readonly()) s.prefill(t);
      } else if (d.type === "open-link") {
        const url = httpUrl(d.url);
        if (url) host().window.open(url, "_blank", "noopener");
      } else if (d.type === "copy") {
        void host()
          .window.navigator.clipboard?.writeText(text(d.text, MAX_PROMPT))
          .catch(() => {});
      }
    }
  };
  // Two fingers on a page the canvas lets touches through to (the live frame or
  // an artboard): its points arrive in that page's px, mapped here onto the
  // screen through the frame's drawn box. Only ever a zoom of our own canvas.
  function pinchFromFrame(source: MessageEventSource | null, d: Record<string, unknown>) {
    const phase = d.phase === "start" || d.phase === "move" || d.phase === "end" ? d.phase : null;
    if (!phase || !layersEl) return;
    const frame = [...layersEl.querySelectorAll("iframe")].find((f) => f.contentWindow === source);
    if (!frame || !frame.offsetWidth) return;
    const r = frame.getBoundingClientRect();
    const k = r.width / frame.offsetWidth;
    const at = (v: unknown) => {
      const p = (v ?? {}) as Record<string, unknown>;
      return { x: r.left + num(p.x) * k, y: r.top + num(p.y) * k };
    };
    gestures.pinch(phase, at(d.a), at(d.b));
  }
  // ⌘/Ctrl+scroll or a trackpad pinch over a page the user is trying: the page
  // keeps it from the browser and reports where, in its px; mapped like a pinch.
  function zoomFromFrame(source: MessageEventSource | null, d: Record<string, unknown>) {
    if (!layersEl) return;
    const frame = [...layersEl.querySelectorAll("iframe")].find((f) => f.contentWindow === source);
    if (!frame || !frame.offsetWidth) return;
    const r = frame.getBoundingClientRect();
    const k = r.width / frame.offsetWidth;
    const dy = Math.max(-200, Math.min(200, num(d.dy)));
    gestures.zoomAt(Math.exp(-dy * 0.01), r.left + num(d.x) * k, r.top + num(d.y) * k);
  }
  function updatePending(ref: unknown, patch: Partial<PendingMark>) {
    const p = pending();
    if (p && p.ref === ref) setPending({ ...p, ...patch });
  }
  host().window.addEventListener("message", onMessage);
  onCleanup(() => host().window.removeEventListener("message", onMessage));

  // The frame keeps the in-page highlight in step with the hovered part.
  createEffect(
    on([() => s.hoverPart(), activeKey], ([part, key]) => {
      post(key, part ? { type: "highlight", parts: [part] } : { type: "clear" });
    }),
  );
  // Switching what is on stage drops the old frame's hover and a half-placed mark.
  createEffect(
    on(activeKey, (_k, prev) => {
      if (prev) post(prev, { type: "clear" });
      s.setHoverPart(null);
      refs.leave();
      setPending(null);
    }),
  );
  createEffect(() => {
    if (!s.marking()) setPending(null);
  });
  // Esc drops a half-placed mark first; the screen's own Esc (tools off) waits
  // for the next one. Captured, so it runs before the screen's.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !pending()) return;
      setPending(null);
      e.preventDefault();
    };
    root().addEventListener("keydown", onKey, true);
    onCleanup(() => root().removeEventListener("keydown", onKey, true));
  });

  // On the canvas every artboard stops at the canvas's height and its page
  // scrolls inside it, so a long page reads top to bottom without panning the
  // whole board out from under the other widths. In page px. Fitted, that is the
  // height the card leaves; at a zoom the user picked, the card floats over it.
  // Pages take their full height, so a finger always moves the stage, never a
  // page inside it; only Try hands touches to the design itself.
  const passthrough = () => s.trying();
  const gestures = useInspectGestures({
    scroller: () => layersEl,
    enabled: () => true,
    pointers: () => !phone(),
    anywhere: () => true,
    scale,
    fit: zoomFloor,
    setZoom,
  });
  // A phone's pinch, from touches: the browser keeps one-finger scrolling, and
  // a second finger is taken from it before it can pan or zoom the viewer.
  // ⌘/Ctrl+scroll and a trackpad pinch (which arrives as ctrl+wheel) zoom the
  // stage around the pointer instead of the browser's page.
  onMount(() => {
    const el = layersEl;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      gestures.zoomAt(
        Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.01),
        e.clientX,
        e.clientY,
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    onCleanup(() => el.removeEventListener("wheel", wheel));
  });
  onMount(() => {
    const el = layersEl;
    let pinching = false;
    const at = (t: Touch | undefined) => ({ x: t?.clientX ?? 0, y: t?.clientY ?? 0 });
    const start = (e: TouchEvent) => {
      if (!phone() || e.touches.length !== 2) return;
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
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    onCleanup(() => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    });
  });
  // Picking a width brings its artboard into view, fitted; "all" shows them all.
  createEffect(
    on([frameW, zoom], ([, z]) => {
      if (typeof z !== "string") return;
      const left = z === "all" ? 0 : xOf(frameW()) - padL();
      host().window.requestAnimationFrame(() => layersEl?.scrollTo?.(left, 0));
    }),
  );

  // Each question brings the region it is about into view once, and a question
  // about no region returns to the top; later scrolls are the user's own. A
  // capped frame scrolls its page; an uncapped one scrolls the stage.
  let scrolledFor = "";
  createEffect(() => {
    if (zoom() !== "fit") return;
    const key = activeKey();
    const r = reports[key];
    if (!r) return;
    const part = s.focusPart();
    const want = `${key}|${part ?? ""}`;
    if (want === scrolledFor) return;
    const b = partBox(r, part);
    if (part && !b) return;
    scrolledFor = want;
    if (b) {
      host().window.requestAnimationFrame(() =>
        layersEl
          ?.querySelector(".frame.on .box.sel")
          // A phone's sheet covers the lower half: the region goes to the top.
          ?.scrollIntoView({ block: phone() ? "start" : "center", behavior: "smooth" }),
      );
    }
  });

  // Canvas layout, in screen px: each artboard's left edge, in order.
  const xOf = (w: number) => {
    let x = padL();
    for (const o of order()) {
      if (o === w) return x;
      x += (o + BOARD_GAP) * scale();
    }
    return x;
  };
  const canvasW = () =>
    xOf(order().at(-1)!) +
    order().at(-1)! * scale() +
    (phone() ? 0 : BOARD_PAD) +
    cardInset().right;
  // The artboards start under whatever rests at the top.
  const padT = () => cardInset().top;
  // Room under the artboards to pan them up past a card resting at the bottom;
  // on a phone, just enough to bring the page's end above the sheet.
  const canvasH = () =>
    phone()
      ? labelH() + activeH() * scale() + cardInset().bottom
      : padT() +
        BOARD_LABEL +
        Math.max(activeH(), ...others().map((w) => boardH[w] ?? 640)) * scale() +
        availH() * 0.4;

  return (
    <div class="stagewrap canvas" style={{ top: `${canvasTop()}px` }}>
      <div class="stage" classList={{ tuning: s.tuning() }}>
        <Show when={s.boundVersion() !== null}>
          <div class="banner" role="status">
            <b>{`${s.arrived()?.name ?? "A new version"} arrived`}</b>
            <span class="sep">·</span>
            <button type="button" onClick={() => s.viewNewVersion()}>
              view
            </button>
            <span class="banner-note">{`your answers stay on ${s.arrived()?.bound ?? "this one"} until you do`}</span>
          </div>
        </Show>
        <div class="layers" ref={(el) => (layersEl = el)} style={{ height: `${availH()}px` }}>
          <div class="layers-sizer" style={{ height: `${canvasH()}px`, width: `${canvasW()}px` }} />
          <Show when={!phone()}>
            <div
              class="board-label"
              style={{ left: `${Math.max(10, xOf(frameW()))}px`, top: `${padT() + 8}px` }}
            >
              {`${widthLabel(frameW())} · ${frameW()}`}
            </div>
          </Show>
          <Show when={s.activeVariant()}>
            {(variant) => (
              <For each={others()}>
                {(w) => (
                  <>
                    <div
                      class="board-label"
                      style={{ left: `${Math.max(10, xOf(w))}px`, top: `${padT() + 8}px` }}
                    >
                      {`${widthLabel(w)} · ${w}`}
                    </div>
                    <Board
                      s={s}
                      variant={variant()}
                      w={w}
                      scale={scale()}
                      x={xOf(w)}
                      y={padT() + BOARD_LABEL}
                      height={boardH[w] ?? 640}
                      cap={Infinity}
                      onHeight={(h) => setBoardH(w, h)}
                    />
                  </>
                )}
              </For>
            )}
          </Show>
          <div
            class="board-live"
            style={{ left: `${xOf(frameW())}px`, top: `${padT() + labelH()}px` }}
          >
            <For each={shownKeys()}>
              {(key) => (
                <Show when={byKey(key)}>
                  {(variant) => (
                    <VariantFrame
                      s={s}
                      variant={variant()}
                      active={key === activeKey()}
                      scale={scale()}
                      frameW={frameW()}
                      capH={Infinity}
                      passthrough={passthrough()}
                      report={reports[key]}
                      ready={ready[key]}
                      heights={heights}
                      frames={frames}
                      refs={refs}
                      post={(msg) => post(key, msg)}
                      pending={pending()}
                      setPending={setPending}
                      onContent={(h) => setContentH(key, h)}
                      onReload={() => {
                        setReports(key, undefined);
                        setReady(key, undefined);
                      }}
                      height={contentH[key] ?? 640}
                    />
                  )}
                </Show>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}

// Another width of the variant on stage, beside the live one on the canvas: a
// picture only (no parts, marks or hits) of every surface the live frame shows,
// with the draft's knob values baked into its html's URL so it matches.
function Board(props: {
  s: MockScreenState;
  variant: VariantView;
  w: number;
  scale: number;
  x: number;
  y: number;
  height: number;
  // The tallest it is drawn, in page px; a longer page is cut off.
  cap: number;
  onHeight: (h: number) => void;
}) {
  const s = props.s;
  const [heights, setHeights] = createStore<Record<number, number>>({});
  const frames = new Map<HTMLIFrameElement, number>();
  let column!: HTMLDivElement;
  const shownH = () => Math.min(props.height, props.cap);
  const version = () => s.frameVersionOf(props.variant);
  const current = () => version() === props.variant.version;
  const kinds = () =>
    historyRow(props.variant, version())?.surfaceKinds ?? props.variant.surfaces.map((x) => x.kind);
  const primary = () => kinds().indexOf("html");
  const src = (index: number) => {
    const m = s.mock();
    if (!m) return "";
    const knobs =
      index === primary()
        ? { ...draftKnobValues(m, props.variant.knobs, s.draft()), ...s.preview()?.knobs }
        : undefined;
    return surfaceUrl(props.variant.postId, index, {
      version: version(),
      mode: theme(),
      knobs,
      e: props.variant.embedsKey,
    });
  };
  const onMessage = (e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null;
    if (!d || d.__mockpit !== true || d.type !== "resize") return;
    for (const [el, index] of frames) {
      if (e.source !== el.contentWindow) continue;
      const h = num(d.height);
      if (h > 0) setHeights(index, Math.min(h, 20000));
    }
  };
  host().window.addEventListener("message", onMessage);
  onCleanup(() => host().window.removeEventListener("message", onMessage));
  onMount(() => {
    const ro = new ResizeObserver(() => props.onHeight(column.offsetHeight));
    ro.observe(column);
    onCleanup(() => ro.disconnect());
  });
  return (
    <div
      class="board"
      style={{
        left: `${props.x}px`,
        top: `${props.y}px`,
        width: `${props.w * props.scale}px`,
        height: `${shownH() * props.scale}px`,
      }}
    >
      <div
        class="frame-scale"
        ref={(el) => (column = el)}
        style={{ width: `${props.w}px`, transform: `scale(${props.scale})` }}
      >
        <For each={kinds()}>
          {(kind, i) => {
            if (!isSandboxedSurfaceKind(kind)) {
              return (
                <NativeSurface
                  kind={kind}
                  surface={
                    current() ? (props.variant.surfaces[i()] as Surface | undefined) : undefined
                  }
                  version={version()}
                />
              );
            }
            return (
              <div class="surface">
                <Show when={src(i())} keyed>
                  {(url) => (
                    <iframe
                      ref={(el) => {
                        frames.set(el, i());
                        onCleanup(() => frames.delete(el));
                      }}
                      src={url}
                      sandbox="allow-scripts"
                      tabIndex={-1}
                      aria-hidden="true"
                      title={`${props.variant.variant} ${kind} at ${props.w}`}
                      width={props.w}
                      height={heights[i()] ?? (i() === primary() ? 640 : 160)}
                    />
                  )}
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

// Image and json arrive whole and render as data, never as markup; an older
// version's body is not sent, so it shows as a placeholder.
function NativeSurface(props: { kind: unknown; surface: Surface | undefined; version: number }) {
  const sf = props.surface;
  if (sf?.kind === "image") {
    return (
      <figure class="surface surface-image">
        <img src={assetUrl(sf.assetId)} alt={sf.alt ?? ""} />
        <Show when={sf.caption}>
          <figcaption>{sf.caption}</figcaption>
        </Show>
      </figure>
    );
  }
  if (sf?.kind === "json") {
    return (
      <div class="surface surface-json">
        <JsonTree data={sf.data} />
      </div>
    );
  }
  return <div class="surface surface-gone">{`${String(props.kind)} (#${props.version})`}</div>;
}

function Pin(props: { s: MockScreenState; index: number; style: JSX.CSSProperties }) {
  const s = props.s;
  const q = () => s.questions()[props.index];
  const ask = () => {
    const x = q();
    return x?.kind === "ask" ? x.ask : null;
  };
  const answered = () => {
    const a = ask();
    return a ? s.answerOf(a) !== undefined : false;
  };
  const cur = () => !s.cardMin() && s.cur() === props.index;
  return (
    <button
      type="button"
      class="pin"
      classList={{ ok: answered(), cur: cur() }}
      style={props.style}
      title={`Question ${props.index + 1}`}
      data-question={props.index + 1}
      onClick={(e) => {
        e.stopPropagation();
        s.goQuestion(props.index);
      }}
    >
      {answered() ? "✓" : String(props.index + 1)}
    </button>
  );
}

function VariantFrame(props: {
  s: MockScreenState;
  variant: VariantView;
  active: boolean;
  scale: number;
  frameW: number;
  capH: number;
  passthrough: boolean;
  report: PartsReport | undefined;
  // The version of a document whose knob runtime is listening, before it has
  // reported its parts (a slow stylesheet can hold that report back).
  ready: number | undefined;
  heights: Record<string, number>;
  frames: Map<HTMLIFrameElement, { key: string; index: number; primary: boolean; version: number }>;
  refs: ReturnType<typeof createHitRefs>;
  post: (msg: Record<string, unknown>) => void;
  pending: PendingMark | null;
  setPending: (p: PendingMark | null) => void;
  onContent: (h: number) => void;
  onReload: () => void;
  height: number;
}) {
  const s = props.s;
  const key = () => frameKey(props.variant.state, props.variant.variant);
  // A memo, not a getter: the reload below must fire only when this frame's own
  // version changes, not whenever the stage's version moves. A frame whose
  // document stays put would lose its parts report and never send another.
  const version = createMemo(() => s.frameVersionOf(props.variant));
  const current = () => version() === props.variant.version;
  const kinds = () =>
    historyRow(props.variant, version())?.surfaceKinds ?? props.variant.surfaces.map((x) => x.kind);
  const primary = () => kinds().indexOf("html");
  let column!: HTMLDivElement;
  let primaryWrap: HTMLDivElement | undefined;
  const [primaryTop, setPrimaryTop] = createSignal(0);

  const measure = () => {
    if (!column) return;
    props.onContent(column.offsetHeight);
    if (primaryWrap) setPrimaryTop(primaryWrap.offsetTop);
  };
  onMount(() => {
    const ro = new ResizeObserver(measure);
    ro.observe(column);
    measure();
    onCleanup(() => ro.disconnect());
  });
  createEffect(on(version, () => props.onReload(), { defer: true }));

  // Knob values follow the draft (defaults, picked knob-set options, tuning);
  // a hovered knob-set option overlays the frame on stage. Re-sent whenever a
  // fresh document says it is listening, since a reload starts from the values
  // baked into its URL.
  let lastKnobs = "";
  createEffect(() => {
    const m = s.mock();
    const reported = props.report?.version ?? props.ready;
    if (!m || reported === undefined) return;
    const values = {
      ...draftKnobValues(m, props.variant.knobs, s.draft()),
      ...(props.active ? (s.preview()?.knobs ?? {}) : {}),
    };
    const k = `${reported}|${JSON.stringify(values)}`;
    if (k === lastKnobs || !Object.keys(values).length) return;
    lastKnobs = k;
    props.post({ type: "knobs", values });
  });

  // Try outlines the design's data-goto elements and lets a click on one move
  // the user; re-sent to each fresh document, which starts with Try off.
  let lastTry = "";
  createEffect(() => {
    const reported = props.report?.version ?? props.ready;
    if (reported === undefined) return;
    const on = props.active && s.trying();
    const k = `${reported}|${on}`;
    if (k === lastTry || (!on && !lastTry.endsWith("|true"))) return;
    lastTry = k;
    props.post({ type: "try", on });
  });

  const register = (el: HTMLIFrameElement, index: number) => {
    props.frames.set(el, { key: key(), index, primary: index === primary(), version: version() });
    // A new document at the same version (a theme switch) starts from the
    // declared defaults yet reports the same version as the old one: drop the
    // old report so the knobs go out again when the new one reports in.
    if (index === primary()) {
      lastKnobs = "";
      lastTry = "";
      props.onReload();
    }
    onCleanup(() => props.frames.delete(el));
  };
  // The registry is read by the message handler, outside any tracking scope.
  createEffect(() => {
    const v = version();
    const p = primary();
    for (const info of props.frames.values()) {
      if (info.key !== key()) continue;
      info.version = v;
      info.primary = info.index === p;
    }
  });

  const surfaceH = (i: number) => {
    const h = props.heights[`${key()}#${i}`];
    if (i === primary()) return Math.min(h ?? 640, Math.max(160, props.capH));
    return h ?? 160;
  };
  // A frame's new height is measured in the same task it is set. ResizeObserver
  // alone only reports on WebKit's next rendering update, and until then the
  // stage keeps the old height and the page below the fold can't be scrolled to.
  createEffect(
    on(
      () => kinds().map((_, i) => surfaceH(i)),
      () => measure(),
      { defer: true },
    ),
  );

  return (
    <div
      class="frame"
      classList={{ on: props.active, trying: props.active && s.trying() }}
      style={{
        height: `${props.height * props.scale}px`,
        width: `${props.frameW * props.scale}px`,
      }}
      data-state={props.variant.state ?? ""}
      data-variant={props.variant.variant}
      aria-hidden={!props.active}
    >
      <div
        class="frame-scale"
        ref={(el) => (column = el)}
        style={{ width: `${props.frameW}px`, transform: `scale(${props.scale})` }}
      >
        <For each={kinds()}>
          {(kind, i) => {
            const surface = () => props.variant.surfaces[i()];
            if (isSandboxedSurfaceKind(kind)) {
              const isPrimary = i() === primary();
              // The draft's values ride in the URL so the first paint already
              // shows the user's answers, scripts or no scripts. Read untracked:
              // a pick must not reload the frame; it goes over the bridge.
              const src = () =>
                surfaceUrl(props.variant.postId, i(), {
                  version: version(),
                  mode: theme(),
                  e: props.variant.embedsKey,
                  knobs: isPrimary
                    ? untrack(() => {
                        const m = s.mock();
                        if (!m) return undefined;
                        // Only declared paths: the route refuses the whole URL
                        // over one value it can't check, which would blank the stage.
                        const declared = { ...m.knobs, ...props.variant.knobs };
                        return Object.fromEntries(
                          Object.entries(draftKnobValues(m, props.variant.knobs, s.draft())).filter(
                            ([path]) => path in declared,
                          ),
                        );
                      })
                    : undefined,
                });
              // A new document gets a new element: navigating an existing frame
              // would add a joint-history entry, and Back would walk the frames.
              return (
                <div class="surface" ref={(el) => isPrimary && (primaryWrap = el)}>
                  <Show when={src()} keyed>
                    {(url) => (
                      <iframe
                        ref={(el) => register(el, i())}
                        src={url}
                        sandbox="allow-scripts"
                        title={`${props.variant.variant} ${kind}`}
                        width={props.frameW}
                        height={surfaceH(i())}
                        tabIndex={props.active ? 0 : -1}
                      />
                    )}
                  </Show>
                </div>
              );
            }
            return (
              <NativeSurface
                kind={kind}
                surface={current() ? (surface() as Surface | undefined) : undefined}
                version={version()}
              />
            );
          }}
        </For>
      </div>
      {/* Without html there is no overlay, and a touch on a page's frame would
          go to the page (iOS Safari scrolls a frame itself, pointer-events or
          not): a cover of our own takes it for the canvas's pan and pinch. */}
      <Show when={primary() < 0 && !props.passthrough}>
        <div class="frame-cover" />
      </Show>
      <Show when={props.active && primary() >= 0}>
        <Overlay
          s={s}
          report={props.report}
          scale={props.scale}
          frameW={props.frameW}
          capped={Number.isFinite(props.capH)}
          passthrough={props.passthrough}
          top={primaryTop() * props.scale}
          height={surfaceH(primary()) * props.scale}
          refs={props.refs}
          post={props.post}
          pending={props.pending}
          setPending={props.setPending}
        />
      </Show>
    </div>
  );
}

function Overlay(props: {
  s: MockScreenState;
  report: PartsReport | undefined;
  scale: number;
  frameW: number;
  // The frame is shorter than its page and scrolls inside; else the stage
  // around it scrolls natively and a wheel needs no forwarding.
  capped: boolean;
  // The page takes touches itself (see Stage); only pins and controls stay live.
  passthrough: boolean;
  top: number;
  height: number;
  refs: ReturnType<typeof createHitRefs>;
  post: (msg: Record<string, unknown>) => void;
  pending: PendingMark | null;
  setPending: (p: PendingMark | null) => void;
}) {
  const s = props.s;
  let layer!: HTMLDivElement;
  const at = (p: PartBox) => {
    const r = props.report!;
    const k = props.scale;
    return {
      x: (p.box.x - r.scroll.x) * k,
      y: (p.box.y - r.scroll.y) * k,
      w: p.box.w * k,
      h: p.box.h * k,
    };
  };
  // The deepest visible box for a name: what the page draws on top.
  const find = (name: string | null) =>
    name
      ? props.report?.parts
          .filter((p) => p.name === name && p.visible)
          .sort((a, b) => b.depth - a.depth || a.order - b.order)[0]
      : undefined;

  // The pointer in the frame's document px.
  const docPoint = (e: MouseEvent) => {
    const r = props.report!;
    const b = layer.getBoundingClientRect();
    return {
      x: (e.clientX - b.left) / props.scale + r.scroll.x,
      y: (e.clientY - b.top) / props.scale + r.scroll.y,
    };
  };
  const hit = (e: MouseEvent, ref: number) => {
    if (!props.report) return;
    props.post({ type: "hit", ref, ...docPoint(e) });
  };
  // One ref asks both questions: which part (hit) and which element (hit-test).
  const mark = (e: MouseEvent) => {
    const r = props.report;
    if (!r || props.pending) return;
    const p = docPoint(e);
    const ref = props.refs.mark();
    const offset: [number, number] = [
      Math.max(0, Math.min(1, p.x / r.width)),
      Math.max(0, Math.min(1, p.y / Math.max(1, r.height))),
    ];
    props.setPending({ ref, ...p, offset });
    props.post({ type: "hit", ref, ...p });
    props.post({ type: "hit-test", ref, x: offset[0], y: offset[1] });
  };
  const toView = (x: number, y: number) => {
    const r = props.report!;
    return { x: (x - r.scroll.x) * props.scale, y: (y - r.scroll.y) * props.scale };
  };
  const marks = createMemo(() =>
    markPins(s.draft()?.comments ?? [], s.activeState(), props.report),
  );
  const save = (body: string) => {
    const p = props.pending;
    const r = props.report;
    if (!p || !r) return;
    const part = p.part ?? null;
    const live = partBox(r, part);
    const box = live
      ? [live.x, live.y, live.w, live.h]
      : p.rect
        ? [p.rect[0] * r.width, p.rect[1] * r.height, p.rect[2] * r.width, p.rect[3] * r.height]
        : [p.x, p.y, 0, 0];
    s.addComment(part, s.activeState(), body, {
      offset: p.offset,
      ...(p.selector ? { selector: p.selector } : {}),
      ...(p.quote ? { quote: p.quote } : {}),
      box: box.map((v) => Math.round(v * 10) / 10),
      width: Math.round(r.width),
    });
    props.setPending(null);
  };
  const onWheel = (e: WheelEvent) => {
    if (!props.capped || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    props.post({ type: "scroll", dx: e.deltaX / props.scale, dy: e.deltaY / props.scale });
  };
  onMount(() => {
    // Overlays sit above the frame and would swallow scrolling; forward it.
    layer.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => layer.removeEventListener("wheel", onWheel));
  });

  // Two asks on one part would share a spot; layoutPins steps the later one aside.
  const partPins = createMemo(() =>
    props.report
      ? layoutPins(
          s.questions().flatMap((q, i) => {
            if (q.kind !== "ask" || q.ask.scope !== "part" || !q.ask.part) return [];
            const p = find(q.ask.part);
            if (!p) return [];
            return [
              { index: i, ...partPinSpot(at(p), props.frameW * props.scale, PIN, pinEdge()) },
            ];
          }),
          PIN,
          pinGap(),
        )
      : [],
  );
  const box = (name: string | null) => {
    const p = find(name);
    return p ? { p, r: at(p) } : null;
  };
  // One outline per part name: its deepest visible box.
  const tunable = createMemo(() => {
    const names = [
      ...new Set(
        (props.report?.parts ?? [])
          .filter((p) => p.visible && s.tunable().includes(p.name))
          .map((p) => p.name),
      ),
    ];
    return names.flatMap((n) => find(n) ?? []);
  });

  return (
    <div
      class="overlay"
      classList={{ marking: s.marking(), passthrough: props.passthrough }}
      ref={(el) => (layer = el)}
      // The width the frame's document reports laying out at: a number, for tests.
      data-doc-width={props.report?.width}
      style={{ top: `${props.top}px`, height: `${props.height}px` }}
      // Only a mouse hovers: a finger's move is a scroll, and its tap selects.
      onPointerMove={(e) => e.pointerType === "mouse" && hit(e, props.refs.hover())}
      onPointerLeave={() => {
        props.refs.leave();
        s.setHoverPart(null);
      }}
      onClick={(e) => (s.marking() ? mark(e) : hit(e, props.refs.click()))}
    >
      <Show when={props.report}>
        {/* Tune: every part the page reports, outlined, so a tap finds one. */}
        <Show when={s.tuning()}>
          <For each={tunable()}>
            {(p) => {
              const r = () => at(p);
              return (
                <div
                  class="box tunebox"
                  classList={{ on: p.name === s.selectedPart() }}
                  data-part={p.name}
                  style={{
                    left: `${r().x - 2}px`,
                    top: `${r().y - 2}px`,
                    width: `${r().w + 4}px`,
                    height: `${r().h + 4}px`,
                  }}
                />
              );
            }}
          </For>
        </Show>
        <Show when={box(s.focusPart())}>
          {(b) => (
            <div
              class="spot"
              style={{
                left: `${b().r.x - 6}px`,
                top: `${b().r.y - 6}px`,
                width: `${b().r.w + 12}px`,
                height: `${b().r.h + 12}px`,
              }}
            />
          )}
        </Show>
        <Show when={s.hoverPart() !== s.stagePart() && box(s.hoverPart())}>
          {(b) => <PartBoxView b={b()} cls="hov" />}
        </Show>
        <Show when={box(s.stagePart())}>{(b) => <PartBoxView b={b()} cls="sel" />}</Show>
        <Show when={s.flash() !== s.stagePart() && box(s.flash())}>
          {(b) => (
            <PartBoxView
              b={b()}
              cls="flash"
              label={s.flashLabel() ?? undefined}
              ref={(el) => {
                // Out of sight means the answer looked like it did nothing.
                const r = b().r;
                if (r.y >= 0 && r.y + r.h <= props.height) return;
                if (props.capped)
                  props.post({ type: "scroll", dx: 0, dy: (r.y - 24) / props.scale });
                else
                  host().window.requestAnimationFrame(() =>
                    el.scrollIntoView({ block: "nearest", behavior: "smooth" }),
                  );
              }}
            />
          )}
        </Show>
        <Index each={partPins()}>
          {(p) => <Pin s={s} index={p().index} style={{ left: `${p().x}px`, top: `${p().y}px` }} />}
        </Index>
        <Index each={marks()}>
          {(m) => {
            const at = () => toView(m().x, m().y);
            return (
              <button
                type="button"
                class="pin mark"
                classList={{ moved: m().moved, elsewhere: m().placedAt !== null }}
                style={{
                  left: `${at().x - PIN / 2}px`,
                  top: `${at().y - PIN / 2}px`,
                }}
                title={`${m().part ?? "page"}: ${m().text}${m().moved ? " · may have moved" : ""}${
                  m().placedAt !== null ? ` · placed at ${m().placedAt}px wide` : ""
                }`}
                aria-label={`Comment ${m().n}${m().placedAt !== null ? `, placed at ${m().placedAt}px wide` : ""}`}
                data-mark={m().n}
                data-placed-at={m().placedAt ?? undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  s.selectPart(m().part);
                }}
              >
                {String(m().n)}
              </button>
            );
          }}
        </Index>
        <Show when={!readonly() && !s.marking() && !props.pending ? box(s.reactPart()) : null}>
          {(b) => (
            <PartReactions
              s={s}
              r={b().r}
              label={b().p.label}
              part={b().p.name}
              width={props.frameW * props.scale}
              height={props.height}
            />
          )}
        </Show>
        <Show when={props.pending}>
          {(p) => (
            <MarkField
              n={nextMark(s.draft()?.comments ?? [])}
              at={toView(p().x, p().y)}
              width={props.frameW * props.scale}
              height={props.height}
              where={p().part === undefined ? "" : (p().part ?? "page")}
              onSave={save}
              onCancel={() => props.setPending(null)}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}

// The pin being placed and its comment field, kept inside the overlay's box.
function MarkField(props: {
  n: number;
  at: { x: number; y: number };
  width: number;
  height: number;
  where: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = createSignal("");
  const W = () => Math.min(280, props.width - 8);
  const H = () => (coarse() ? 150 : 112);
  const left = () => Math.max(4, Math.min(props.at.x + 16, props.width - W() - 4));
  const below = () => props.at.y + 16 + H() < props.height;
  const top = () => Math.max(4, below() ? props.at.y + 16 : props.at.y - 16 - H());
  let input: HTMLInputElement | undefined;
  const submit = () => {
    const t = value().trim();
    if (t) props.onSave(t);
    else input?.focus();
  };
  return (
    <>
      <span
        class="pin mark pending"
        style={{ left: `${props.at.x - PIN / 2}px`, top: `${props.at.y - PIN / 2}px` }}
        aria-hidden="true"
      >
        {String(props.n)}
      </span>
      <div
        class="markfield"
        style={{ left: `${left()}px`, top: `${top()}px`, width: `${W()}px` }}
        onClick={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
      >
        <div class="markfield-hd">
          {props.where ? `Comment ${props.n} · ${props.where}` : `Comment ${props.n}`}
        </div>
        <input
          class="up-text-input"
          placeholder="Comment, for the agent…"
          aria-label={`Text of comment ${props.n}`}
          value={value()}
          ref={(el) => {
            input = el;
            queueMicrotask(() => el.focus());
          }}
          onInput={(e) => setValue(e.currentTarget.value)}
          enterkeyhint="done"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.isComposing) submit();
          }}
        />
        <div class="markfield-actions">
          <button type="button" class="markfield-cancel" onClick={() => props.onCancel()}>
            Cancel
          </button>
          <button type="button" class="markfield-save" onClick={submit}>
            Save
          </button>
        </div>
      </div>
    </>
  );
}

function PartBoxView(props: {
  b: { p: PartBox; r: { x: number; y: number; w: number; h: number } };
  cls: string;
  ref?: (el: HTMLDivElement) => void;
  label?: string;
}) {
  const edge = () => props.b.r.y < 22;
  return (
    <div
      ref={props.ref}
      class={`box ${props.cls}`}
      classList={{ edge: edge() }}
      data-part={props.b.p.name}
      style={{
        left: `${props.b.r.x - 2}px`,
        top: `${props.b.r.y - 2}px`,
        width: `${props.b.r.w + 4}px`,
        height: `${props.b.r.h + 4}px`,
      }}
    >
      <span class="lbl">{props.label ?? props.b.p.label}</span>
    </div>
  );
}
