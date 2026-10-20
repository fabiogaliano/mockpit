// D1: one stage per mock, never replaced. Every (state, variant) of the version
// on stage is its own sandboxed frame, all loaded at once; only the active one
// is visible, the rest stay laid out (visibility, not display) so they report
// their parts up front and switching is instant.
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
  changedPart,
  clampZoom,
  createHitRefs,
  draftKnobValues,
  frameKey,
  historyRow,
  layoutPins,
  markPins,
  nextMark,
  PANEL_W,
  type PartBox,
  partBox,
  partPinSpot,
  type PartsReport,
  reportIsCurrent,
  screenHeight,
  widthLabel,
} from "./logic.ts";
import { PartReactions } from "./Reactions.tsx";
import type { MockScreenState } from "./state.ts";
import { StageHead } from "./StageHead.tsx";
import { theme } from "./theme.ts";
import { Versions } from "./Versions.tsx";
import { canvasLayout, canvasTop, cardInset, coarse, phoneLayout, safeX, win } from "./viewport.ts";

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

const TOPBAR = 52;
// The canvas, in screen px: a margin round the artboards, a line for each
// one's label, and the space between them (scaled with them).
const BOARD_PAD = 16;
const BOARD_LABEL = 30;
// Page px kept around a focused region, so it reads in its surroundings.
const FOCUS_PAD = 24;
const BOARD_GAP = 64;
// The least height the canvas keeps for the artboards beside an open card.
const MIN_FREE_H = 200;
// Under a finger a pin keeps its size and takes a 44px tap area around it;
// pins step apart far enough that those areas never overlap.
const PIN = 22;
const pinGap = () => (coarse() ? 44 - PIN : 6);
const pinEdge = () => (coarse() ? (44 - PIN) / 2 : 2);

export function Stage(props: { s: MockScreenState }) {
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
  const [vbtn, setVbtn] = createSignal<HTMLElement>();
  const [pending, setPending] = createSignal<PendingMark | null>(null);
  const [headH, setHeadH] = createSignal(44);
  const zoom = s.zoom;
  const setZoom = s.setZoom;
  // The other widths' artboards report their own page heights.
  const [boardH, setBoardH] = createStore<Record<number, number>>({});
  let layersEl!: HTMLDivElement;

  const multiState = () => s.states().length > 1;
  const banner = () => s.viewVersion() !== null || s.boundVersion() !== null;
  const frameW = () => s.frameW();
  const inspecting = () => s.inspect();
  // Without room for the panel beside it the stage is a canvas under its own
  // header: Inspect's pan and pinch, always on, with the question card floating
  // over it instead of a bottom sheet.
  const canvas = () => canvasLayout() && !inspecting();
  const pannable = () => inspecting() || canvas();
  // On a phone the canvas is one page: a single artboard fitted to the width,
  // edge to edge under the header, with nothing beside or below it to pan to.
  const phone = () => canvas() && phoneLayout();
  // Above a phone's page, no label: only room for the tap area of a pin on its
  // very first line, which would otherwise sit under the header.
  const labelH = () => (phone() ? 12 : BOARD_LABEL);
  // A finger scrolls the page, not the frame: the frame takes its full height
  // and the stage scrolls natively. Inspect does the same with any pointer.
  const uncapped = () => coarse() || pannable();
  // Every width on the canvas in the mock's order, the live one in its place
  // (or first, when the user picked one the mock does not name).
  const order = createMemo(() => {
    const declared = canvas() && !phone() ? (s.mock()?.widths ?? []) : [];
    return declared.includes(frameW()) ? declared : [frameW(), ...declared];
  });
  const others = createMemo(() => order().filter((w) => w !== frameW()));
  // Beside the panel, the column between the gutters; on the canvas or in
  // Inspect, the whole screen inside its safe area.
  const availW = createMemo(() => {
    const w = win().w;
    if (canvas()) return w - safeX() - cardInset().left - cardInset().right;
    return inspecting() ? w - safeX() : w - 48 - PANEL_W - 12;
  });
  // The canvas's left margin, past a card resting on its left side: the live
  // artboard fitted is centred on the screen; all of them start at the margin.
  const padL = () => {
    if (!canvas()) return BOARD_PAD;
    const centred = Math.max(0, (availW() - frameW() * fitScale()) / 2);
    return cardInset().left + (zoom() === "all" ? BOARD_PAD : centred);
  };
  // The canvas's height the card leaves free, above or below it. A card taller
  // than most of the screen still leaves the artboards a usable strip.
  const freeH = createMemo(() => {
    const full = win().h - canvasTop();
    const c = cardInset();
    return Math.max(Math.min(full, MIN_FREE_H), full - c.top - c.bottom);
  });
  const activeKey = createMemo(() => {
    const v = s.activeVariant();
    return v ? frameKey(v.state, v.variant) : "";
  });
  // On a phone a whole screen fits beside the card only at a scale too small to
  // read a change by, so a question about one region fits that region instead.
  // Its height only grows while the question is on: previewing a smaller fill
  // must not make the stage jump.
  const focusBox = createMemo(() =>
    canvas() ? partBox(reports[activeKey()], s.focusPart()) : undefined,
  );
  const [focusH, setFocusH] = createSignal(0);
  createEffect(on([() => s.focusPart(), activeKey], () => setFocusH(0)));
  createEffect(() => {
    const h = focusBox()?.h;
    if (h) setFocusH((prev) => Math.max(prev, h));
  });
  const fitScale = createMemo(() => {
    // On the canvas the live width fits one whole screen of its device into the
    // space the card leaves, never past true size: a 390 design on a phone reads
    // as a phone screen, and shrinks again when the card opens over it.
    if (phone()) return Math.max(0.1, Math.min(1, availW() / frameW()));
    if (canvas()) {
      const room = freeH() - BOARD_LABEL - BOARD_PAD;
      const whole = room / screenHeight(frameW());
      const h = focusH() ? Math.max(whole, room / (focusH() + 2 * FOCUS_PAD)) : whole;
      return Math.max(0.1, Math.min(1, availW() / frameW(), h));
    }
    const floor = inspecting() ? 0.1 : 0.3;
    // Less the stage's 1px border on each side, so the frame is never clipped.
    const border = inspecting() ? 0 : 2;
    return Math.max(floor, Math.min(1, (availW() - border) / frameW()));
  });
  // Every artboard side by side across the screen.
  const fitAll = createMemo(() => {
    const total = others().reduce((sum, w) => sum + BOARD_GAP + w, frameW());
    return Math.max(0.05, Math.min(fitScale(), (availW() - 2 * BOARD_PAD) / total));
  });
  // How far a pinch zooms out: to fit (or all widths) in Inspect; on the
  // canvas, to half of fit too, to see a design smaller than its screen.
  // A phone's page never zooms out past its width: nothing sits beside it.
  const zoomFloor = () => Math.min(fitAll(), canvas() && !phone() ? fitScale() / 2 : fitScale());
  const scale = createMemo(() => {
    if (!pannable()) return fitScale();
    const z = zoom();
    if (z === "fit") return fitScale();
    if (z === "all") return fitAll();
    return clampZoom(z, zoomFloor());
  });
  createEffect(() => s.setStageScale(scale()));
  createEffect(() => s.setZoomMin(Math.min(zoomFloor(), 1)));
  const availH = createMemo(() =>
    canvas()
      ? win().h - canvasTop()
      : inspecting()
        ? win().h - headH()
        : win().h - TOPBAR - 48 - (multiState() ? 56 : 0) - headH() - (banner() ? 32 : 0) - 2,
  );
  createEffect(
    on(inspecting, (open) => {
      if (!open) setZoom("fit");
    }),
  );

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
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (s.marking()) {
        if (pending()) setPending(null);
        else s.setMarking(false);
      } else if (inspecting()) s.setInspect(false);
    };
    root().addEventListener("keydown", onKey);
    onCleanup(() => root().removeEventListener("keydown", onKey));
  });
  onCleanup(() => s.setInspect(false));

  // On the canvas every artboard stops at the canvas's height and its page
  // scrolls inside it, so a long page reads top to bottom without panning the
  // whole board out from under the other widths. In page px. Fitted, that is the
  // height the card leaves; at a zoom the user picked, the card floats over it.
  const boardCap = () => {
    const h = typeof zoom() === "number" ? availH() : freeH();
    return Math.max(160, (h - BOARD_LABEL - BOARD_PAD) / scale());
  };
  // Under a finger the live frame's overlay steps aside and the page takes the
  // touch itself, so the browser scrolls it natively (momentum, bounce) and the
  // canvas can't move with it: touches inside a frame never reach this document.
  // The canvas pans from the space around the artboards. Mark puts it back.
  // A phone has no space around its page, so there the page never scrolls
  // itself: it takes its full height, the stage is the one thing a finger
  // scrolls (natively, both ways once zoomed), and two fingers zoom it.
  const passthrough = () => s.trying() || (canvas() && coarse() && !s.marking() && !phone());
  const gestures = useInspectGestures({
    scroller: () => layersEl,
    enabled: pannable,
    pointers: () => !phone(),
    anywhere: canvas,
    scale,
    fit: zoomFloor,
    setZoom,
  });
  // A phone's pinch, from touches: the browser keeps one-finger scrolling, and
  // a second finger is taken from it before it can pan or zoom the viewer.
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
      if (!canvas() || typeof z !== "string") return;
      const left = z === "all" ? 0 : xOf(frameW()) - padL();
      host().window.requestAnimationFrame(() => layersEl?.scrollTo?.(left, 0));
    }),
  );

  // Each question brings the region it is about into view once, and a question
  // about no region returns to the top; later scrolls are the user's own. A
  // capped frame scrolls its page; an uncapped one scrolls the stage.
  let scrolledFor = "";
  createEffect(() => {
    if (s.mode() !== "questions" || (pannable() && zoom() !== "fit")) return;
    const key = activeKey();
    const r = reports[key];
    if (!r) return;
    const part = s.focusPart();
    const want = `${key}|${part ?? ""}`;
    if (want === scrolledFor) return;
    const b = partBox(r, part);
    if (part && !b) return;
    scrolledFor = want;
    if ((canvas() && !phone()) || !uncapped()) {
      const dy = b ? b.y - FOCUS_PAD - r.scroll.y : -r.scroll.y;
      if (dy) post(key, { type: "scroll", dx: 0, dy });
    } else if (b) {
      host().window.requestAnimationFrame(() =>
        layersEl
          ?.querySelector(".frame.on .box.sel")
          // A phone's sheet covers the lower half: the region goes to the top.
          ?.scrollIntoView({ block: phone() ? "start" : "center", behavior: "smooth" }),
      );
    }
  });

  const activeH = () => contentH[activeKey()] ?? 640;
  const layersH = () =>
    pannable() ? availH() : Math.min(activeH() * scale(), Math.max(200, availH()));
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
  // The artboards start under a card resting at the top.
  const padT = () => (canvas() ? cardInset().top : 0);
  // Room under the artboards to pan them up past a card resting at the bottom;
  // on a phone, just enough to bring the page's end above the sheet.
  const canvasH = () =>
    phone()
      ? labelH() + activeH() * scale() + cardInset().bottom
      : padT() +
        BOARD_LABEL +
        Math.max(activeH(), ...others().map((w) => Math.min(boardH[w] ?? 640, boardCap()))) *
          scale() +
        availH() * 0.4;

  return (
    <div
      class="stagewrap"
      classList={{ inspect: inspecting(), canvas: canvas() }}
      style={
        canvas()
          ? { top: `${canvasTop()}px` }
          : inspecting()
            ? undefined
            : { width: `${frameW() * scale() + 2}px` }
      }
    >
      <div class="stage" classList={{ old: s.viewVersion() !== null }}>
        <Show when={!canvas()}>
          <StageHead
            s={s}
            anchor={setVbtn}
            onHeight={setHeadH}
            zoom={zoom()}
            scale={scale()}
            setZoom={setZoom}
          />
        </Show>
        <Show when={s.viewVersion() !== null}>
          <div class="banner">
            <b>{`Viewing v${s.viewVersion()}`}</b>
            <span class="sep">·</span>
            <button type="button" onClick={() => s.backToLatest()}>
              {`↶ back to v${s.latest()}`}
            </button>
            <span class="sep">·</span>
            <button type="button" onClick={() => void s.restoreViewed()}>
              {`restore as v${s.latest() + 1}`}
            </button>
          </div>
        </Show>
        <Show when={s.viewVersion() === null && s.boundVersion() !== null}>
          <div class="banner">
            <b>{`v${s.latest()} arrived`}</b>
            <span class="sep">·</span>
            <button type="button" onClick={() => s.viewNewVersion()}>
              view
            </button>
            <span class="banner-note">{`your answers stay on v${s.boundVersion()} until you do`}</span>
          </div>
        </Show>
        <div class="layers" ref={(el) => (layersEl = el)} style={{ height: `${layersH()}px` }}>
          <div
            class="layers-sizer"
            style={
              canvas()
                ? { height: `${canvasH()}px`, width: `${canvasW()}px` }
                : { height: `${activeH() * scale()}px`, width: `${frameW() * scale()}px` }
            }
          />
          <Show when={canvas()}>
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
                        cap={boardCap()}
                        onHeight={(h) => setBoardH(w, h)}
                      />
                    </>
                  )}
                </For>
              )}
            </Show>
          </Show>
          <div
            class="board-live"
            style={
              canvas() ? { left: `${xOf(frameW())}px`, top: `${padT() + labelH()}px` } : undefined
            }
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
                      capH={
                        canvas() && !phone()
                          ? boardCap()
                          : uncapped()
                            ? Infinity
                            : availH() / scale()
                      }
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
      {/* On the canvas the question card lists these; corner pins would only
          crowd a phone-sized design. */}
      <Show when={!inspecting() && !canvasLayout()}>
        <CornerPins s={s} />
      </Show>
      <Show when={s.versionsOpen() && !canvas()}>
        <Versions s={s} anchor={vbtn()} />
      </Show>
    </div>
  );
}

// Another width of the variant on stage, beside the live one on the canvas: a
// picture only (no parts, marks or hits), with the draft's knob values baked
// into its URL so it shows what the live frame shows.
function Board(props: {
  s: MockScreenState;
  variant: VariantView;
  w: number;
  scale: number;
  x: number;
  y: number;
  height: number;
  // The tallest it is drawn, in page px; a longer page scrolls inside.
  cap: number;
  onHeight: (h: number) => void;
}) {
  const s = props.s;
  let frameEl: HTMLIFrameElement | undefined;
  const shownH = () => Math.min(props.height, props.cap);
  const index = () => props.variant.surfaces.findIndex((x) => x.kind === "html");
  const src = () => {
    const m = s.mock();
    if (!m || index() < 0) return "";
    const knobs = {
      ...draftKnobValues(m, props.variant.knobs, s.draft()),
      ...s.preview()?.knobs,
    };
    return surfaceUrl(props.variant.postId, index(), {
      version: s.frameVersionOf(props.variant),
      mode: theme(),
      knobs,
      e: props.variant.embedsKey,
    });
  };
  const onMessage = (e: MessageEvent) => {
    if (!frameEl || e.source !== frameEl.contentWindow) return;
    const d = e.data as Record<string, unknown> | null;
    if (!d || d.__mockpit !== true || d.type !== "resize") return;
    const h = num(d.height);
    if (h > 0) props.onHeight(Math.min(h, 20000));
  };
  host().window.addEventListener("message", onMessage);
  onCleanup(() => host().window.removeEventListener("message", onMessage));
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
      <Show when={src()} keyed>
        {(url) => (
          <iframe
            ref={(el) => (frameEl = el)}
            src={url}
            sandbox="allow-scripts"
            tabIndex={-1}
            aria-hidden="true"
            title={`${props.variant.variant} at ${props.w}`}
            width={props.w}
            height={shownH()}
            style={{ transform: `scale(${props.scale})` }}
          />
        )}
      </Show>
    </div>
  );
}

// Mock- and state-wide questions pin to the stage's top-left corner, in a row
// along its top edge; part questions pin to their part (in the frame overlay).
function CornerPins(props: { s: MockScreenState }) {
  const s = props.s;
  const corner = createMemo(() =>
    layoutPins(
      s.questions().flatMap((q, i) => {
        if (q.kind !== "ask") return [];
        const a = q.ask;
        if (a.scope === "mock" || (a.scope === "state" && a.state === s.activeState())) {
          return [{ index: i, x: -10, y: -10 }];
        }
        return [];
      }),
      PIN,
      pinGap(),
    ),
  );
  return (
    <div class="pins">
      <Index each={corner()}>
        {(p) => <Pin s={s} index={p().index} style={{ left: `${p().x}px`, top: `${p().y}px` }} />}
      </Index>
    </div>
  );
}

export function Pin(props: { s: MockScreenState; index: number; style: JSX.CSSProperties }) {
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
  const cur = () => s.mode() === "questions" && s.cur() === props.index;
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

  const register = (el: HTMLIFrameElement, index: number) => {
    props.frames.set(el, { key: key(), index, primary: index === primary(), version: version() });
    // A new document at the same version (a theme switch) starts from the
    // declared defaults yet reports the same version as the old one: drop the
    // old report so the knobs go out again when the new one reports in.
    if (index === primary()) {
      lastKnobs = "";
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
      classList={{ on: props.active }}
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
                  embed: props.variant === s.activeVariant() ? s.embedPeek() : undefined,
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
            // Native kinds arrive whole (only sandboxed kinds drop their body).
            const sf = surface() as Surface | undefined;
            if (kind === "image" && current() && sf?.kind === "image") {
              return (
                <figure class="surface surface-image">
                  <img src={assetUrl(sf.assetId)} alt={sf.alt ?? ""} />
                  <Show when={sf.caption}>
                    <figcaption>{sf.caption}</figcaption>
                  </Show>
                </figure>
              );
            }
            if (kind === "json" && current() && sf?.kind === "json") {
              return (
                <div class="surface surface-json">
                  <JsonTree data={sf.data} />
                </div>
              );
            }
            return <div class="surface surface-gone">{`${kind} (v${version()})`}</div>;
          }}
        </For>
      </div>
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
    if (!props.capped) return;
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
                aria-label={`Mark ${m().n}${m().placedAt !== null ? `, placed at ${m().placedAt}px wide` : ""}`}
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
          {props.where ? `Mark ${props.n} · ${props.where}` : `Mark ${props.n}`}
        </div>
        <input
          class="up-text-input"
          placeholder="Comment, for the agent…"
          aria-label={`Comment for mark ${props.n}`}
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
