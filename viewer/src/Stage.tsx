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
} from "solid-js";
import { createStore } from "solid-js/store";
import { isSandboxedSurfaceKind, type Surface } from "../../server/types.ts";
import { assetUrl, surfaceUrl, type VariantView } from "./api.ts";
import { host, readonly, root } from "./host.ts";
import { JsonTree } from "./JsonTree.tsx";
import {
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
} from "./logic.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { FRAME_W } from "./Thumb.tsx";
import { Versions } from "./Versions.tsx";
import { narrow, win } from "./viewport.ts";

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
function readReport(d: Record<string, unknown>): PartsReport | null {
  if (!Array.isArray(d.parts)) return null;
  const scroll = (d.scroll ?? {}) as Record<string, unknown>;
  const viewport = (d.viewport ?? {}) as Record<string, unknown>;
  return {
    version: num(d.version),
    width: num(viewport.w, FRAME_W) || FRAME_W,
    height: num(d.height),
    scroll: { x: num(scroll.x), y: num(scroll.y) },
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

export const PANEL_W = 380;
const TOPBAR = 52;
const HEAD = 44;
// The collapsed bottom sheet: grip plus mode row.
const SHEET = 96;

export function Stage(props: { s: MockScreenState }) {
  const s = props.s;
  const { reports, setReports } = s;
  const [heights, setHeights] = createStore<Record<string, number>>({});
  const [contentH, setContentH] = createStore<Record<string, number>>({});
  const frames = new Map<
    HTMLIFrameElement,
    { key: string; index: number; primary: boolean; version: number }
  >();
  const refs = createHitRefs();
  const [vbtn, setVbtn] = createSignal<HTMLElement>();
  const [pending, setPending] = createSignal<PendingMark | null>(null);

  const multiState = () => s.states().length > 1;
  const banner = () => s.viewVersion() !== null || s.boundVersion() !== null;
  const scale = createMemo(() => {
    const avail = narrow() ? win().w - 24 : win().w - 48 - PANEL_W - 12;
    return Math.max(narrow() ? 0.1 : 0.3, Math.min(1, avail / FRAME_W));
  });
  const availH = createMemo(
    () =>
      win().h -
      TOPBAR -
      (narrow() ? 24 + SHEET : 48) -
      (multiState() ? 56 : 0) -
      HEAD -
      (banner() ? 32 : 0) -
      2,
  );

  const shown = createMemo(() =>
    s.variants().filter((v) => v.status !== "archived" || v === s.variantFor(v.state)),
  );
  // Frames are keyed by (state, variant), not by object: every refetch brings
  // new variant objects, and keying by them would remount every frame (a fresh
  // load and fade-in) even though the version on stage did not change.
  const shownKeys = createMemo(() => shown().map((v) => frameKey(v.state, v.variant)), [], {
    equals: (a, b) => a.length === b.length && a.every((k, i) => k === b[i]),
  });
  const byKey = (key: string) => shown().find((v) => frameKey(v.state, v.variant) === key);
  const activeKey = createMemo(() => {
    const v = s.activeVariant();
    return v ? frameKey(v.state, v.variant) : "";
  });

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
    let info: { key: string; index: number; primary: boolean; version: number } | undefined;
    for (const [el, i] of frames) if (el.contentWindow === e.source) info = i;
    if (!info) return;
    if (d.type === "resize") {
      setHeights(`${info.key}#${info.index}`, Math.max(1, Math.min(num(d.height), 20000)));
    } else if (d.type === "parts" && info.primary) {
      if (!reportIsCurrent(info.version, d.version)) return;
      const r = readReport(d);
      if (r) setReports(info.key, r);
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
      if (e.key !== "Escape" || !s.marking()) return;
      if (pending()) setPending(null);
      else s.setMarking(false);
    };
    root().addEventListener("keydown", onKey);
    onCleanup(() => root().removeEventListener("keydown", onKey));
  });

  const activeH = () => contentH[activeKey()] ?? 640;
  const layersH = () => Math.min(activeH() * scale(), Math.max(200, availH()));

  return (
    <div class="stagewrap" style={{ width: `${FRAME_W * scale()}px` }}>
      <div class="stage" classList={{ old: s.viewVersion() !== null }}>
        <StageHead s={s} anchor={setVbtn} />
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
        <div class="layers" style={{ height: `${layersH()}px` }}>
          <div class="layers-sizer" style={{ height: `${activeH() * scale()}px` }} />
          <For each={shownKeys()}>
            {(key) => (
              <Show when={byKey(key)}>
                {(variant) => (
                  <VariantFrame
                    s={s}
                    variant={variant()}
                    active={key === activeKey()}
                    scale={scale()}
                    capH={availH() / scale()}
                    report={reports[key]}
                    heights={heights}
                    frames={frames}
                    refs={refs}
                    post={(msg) => post(key, msg)}
                    pending={pending()}
                    setPending={setPending}
                    onContent={(h) => setContentH(key, h)}
                    onReload={() => setReports(key, undefined)}
                    height={contentH[key] ?? 640}
                  />
                )}
              </Show>
            )}
          </For>
        </div>
      </div>
      <CornerPins s={s} />
      <Show when={s.versionsOpen()}>
        <Versions s={s} anchor={vbtn()} />
      </Show>
    </div>
  );
}

function StageHead(props: { s: MockScreenState; anchor: (el: HTMLElement) => void }) {
  const s = props.s;
  const v = () => s.activeVariant();
  const siblings = () => s.variants().filter((x) => x.state === s.activeState());
  return (
    <div class="stage-head">
      <b class="stage-title">{s.mock()?.title}</b>
      <Show when={s.activeState() !== null}>
        <span class="stage-state">{s.activeState()}</span>
      </Show>
      <Show when={v()}>
        {(variant) => (
          <button
            type="button"
            class="vbtn"
            ref={props.anchor}
            aria-haspopup="menu"
            aria-expanded={s.versionsOpen()}
            onClick={(e) => {
              e.stopPropagation();
              s.setVersionsOpen(!s.versionsOpen());
            }}
          >
            {`v${s.frameVersionOf(variant())} ▾`}
          </button>
        )}
      </Show>
      <span class="grow" />
      {/* Q9: variants without a Look ask get a plain switcher. */}
      <Show when={!s.look() && siblings().length > 1}>
        <div class="variant-switch" role="tablist" aria-label="Variant">
          <For each={siblings()}>
            {(x) => (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={x.variant === v()?.variant}
                  classList={{ on: x.variant === v()?.variant, arch: x.status === "archived" }}
                  data-variant={x.variant}
                  title={x.status === "archived" ? `${x.variant} · archived` : undefined}
                  onClick={() => s.chooseVariant(x.variant)}
                >
                  {x.variant}
                  <Show when={x.status === "accepted"}>
                    <span class="vok" aria-label="accepted">
                      ✓
                    </span>
                  </Show>
                </button>
                <Show when={x.status === "archived" && !readonly()}>
                  <button
                    type="button"
                    class="vrestore"
                    aria-label={`Restore ${x.variant}`}
                    onClick={() => void s.restoreVariant(x.variant, [x.state])}
                  >
                    restore
                  </button>
                </Show>
              </>
            )}
          </For>
        </div>
      </Show>
      <Show when={!readonly()}>
        <button
          type="button"
          class="markbtn"
          classList={{ on: s.marking() }}
          aria-pressed={s.marking()}
          title="Mark: click the stage to leave a comment there (Esc to stop)"
          onClick={() => s.setMarking(!s.marking())}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Z" />
            <circle cx="12" cy="10" r="2" />
          </svg>
          Mark
        </button>
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
  const over = () => {
    const a = ask();
    return a ? s.overridden()[a.id] : undefined;
  };
  const cur = () => s.mode() === "questions" && s.cur() === props.index;
  return (
    <button
      type="button"
      class="pin"
      classList={{ ok: answered() && !over(), ovr: answered() && !!over(), cur: cur() }}
      style={props.style}
      title={`Question ${props.index + 1}${over() ? " · overridden by Mix" : ""}`}
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
  capH: number;
  report: PartsReport | undefined;
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

  onMount(() => {
    const measure = () => {
      props.onContent(column.offsetHeight);
      if (primaryWrap) setPrimaryTop(primaryWrap.offsetTop);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(column);
    measure();
    onCleanup(() => ro.disconnect());
  });
  createEffect(on(version, () => props.onReload(), { defer: true }));

  // Knob values follow the draft (defaults, picked knob-set options, tuning);
  // a hovered knob-set option overlays the frame on stage. Re-sent whenever a
  // fresh document reports in, since a reload starts from the baked values.
  let lastKnobs = "";
  createEffect(() => {
    const m = s.mock();
    const reported = props.report?.version;
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

  return (
    <div
      class="frame"
      classList={{ on: props.active }}
      style={{ height: `${props.height * props.scale}px` }}
      data-state={props.variant.state ?? ""}
      data-variant={props.variant.variant}
      aria-hidden={!props.active}
    >
      <div
        class="frame-scale"
        ref={(el) => (column = el)}
        style={{ transform: `scale(${props.scale})` }}
      >
        <For each={kinds()}>
          {(kind, i) => {
            const surface = () => props.variant.surfaces[i()];
            if (isSandboxedSurfaceKind(kind)) {
              const isPrimary = i() === primary();
              const src = () =>
                surfaceUrl(props.variant.postId, i(), { version: version(), mode: theme() });
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
                        width={FRAME_W}
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
    });
    props.setPending(null);
  };
  const onWheel = (e: WheelEvent) => {
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
            return [{ index: i, ...partPinSpot(at(p), FRAME_W * props.scale) }];
          }),
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
      classList={{ marking: s.marking() }}
      ref={(el) => (layer = el)}
      style={{ top: `${props.top}px`, height: `${props.height}px` }}
      onPointerMove={(e) => hit(e, props.refs.hover())}
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
                classList={{ moved: m().moved }}
                style={{ left: `${at().x - 11}px`, top: `${at().y - 11}px` }}
                title={`${m().part ?? "page"}: ${m().text}${m().moved ? " · may have moved" : ""}`}
                data-mark={m().n}
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
        <Show when={props.pending}>
          {(p) => (
            <MarkField
              n={nextMark(s.draft()?.comments ?? [])}
              at={toView(p().x, p().y)}
              width={layer.clientWidth}
              height={props.height}
              where={p().part === undefined ? "" : (p().part ?? "page")}
              onSave={save}
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
}) {
  const [value, setValue] = createSignal("");
  const W = 260;
  const left = () => Math.max(4, Math.min(props.at.x + 16, props.width - W - 4));
  const below = () => props.at.y + 16 + 76 < props.height;
  const top = () => Math.max(4, below() ? props.at.y + 16 : props.at.y - 16 - 76);
  const submit = () => {
    const t = value().trim();
    if (t) props.onSave(t);
  };
  return (
    <>
      <span
        class="pin mark pending"
        style={{ left: `${props.at.x - 11}px`, top: `${props.at.y - 11}px` }}
        aria-hidden="true"
      >
        {String(props.n)}
      </span>
      <div
        class="markfield"
        style={{ left: `${left()}px`, top: `${top()}px`, width: `${W}px` }}
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
          ref={(el) => queueMicrotask(() => el.focus())}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </div>
    </>
  );
}

function PartBoxView(props: {
  b: { p: PartBox; r: { x: number; y: number; w: number; h: number } };
  cls: string;
}) {
  const edge = () => props.b.r.y < 22;
  return (
    <div
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
      <span class="lbl">{props.b.p.label}</span>
    </div>
  );
}
