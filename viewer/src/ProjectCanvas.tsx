// The project canvas: every mock as a cluster of its designs, laid out by
// canvasLayout.ts, pannable (drag, scroll) and zoomable (pinch, ctrl+scroll,
// the buttons). Embed edges run from a mock to the components it is built
// from. Pictures are sandboxed Thumbs, mounted only for tiles on screen and
// large enough to read; the rest are named cards.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { surfaceUrl, type TreeNode, type TreeVariant } from "./api.ts";
import {
  CLUSTER_HEAD,
  designWidth,
  layoutProject,
  type Rect,
  stackKey,
  tilesToRender,
} from "./canvasLayout.ts";
import { host } from "./host.ts";
import { mockPath, navigate } from "./route.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

// Opening below this, the canvas starts at it on the first mocks instead:
// a whole project at a few percent is cards nobody can read.
const READABLE_SCALE = 0.6;
// Below this a picture is too small to tell designs apart; cards say more.
const PICTURE_MIN_SCALE = 0.18;
const PICTURE_CAP = 24;
const MIN_SCALE = 0.05;
const MAX_SCALE = 2;

export interface CanvasHandle {
  // Bring a mock's cluster into view and mark it for a moment.
  locate: (slug: string) => void;
}

export function ProjectCanvas(props: {
  project: string;
  nodes: TreeNode[];
  ref?: (h: CanvasHandle) => void;
}) {
  let box!: HTMLDivElement;
  const [view, setView] = createSignal({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [marked, setMarked] = createSignal<string | null>(null);
  const live = createMemo(() => props.nodes.filter((n) => !n.resolvedAt));
  const layout = createMemo(() => layoutProject(live(), expanded()));
  const bySlug = createMemo(() => new Map(props.nodes.map((n) => [n.slug, n])));

  const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  const fitTo = (r: Rect, max = 1) => {
    const { w, h } = size();
    if (!w || !h || !r.w || !r.h) return;
    const scale = clamp(Math.min((w - 48) / r.w, (h - 48) / r.h, max));
    setView({
      scale,
      x: (w - r.w * scale) / 2 - r.x * scale,
      y: (h - r.h * scale) / 2 - r.y * scale,
    });
  };
  const fitAll = () => {
    const l = layout();
    fitTo({ x: 0, y: 0, w: l.w, h: l.h });
  };
  // The whole project when it fits at a readable size, else the first mocks at
  // that size, from the top left; the minimap shows the rest.
  const openReadable = () => {
    const l = layout();
    const { w, h } = size();
    const whole = Math.min((w - 48) / l.w, (h - 48) / l.h, 1);
    if (whole >= READABLE_SCALE) return fitAll();
    setView({ scale: READABLE_SCALE, x: 24, y: 24 });
  };
  // The minimap: every cluster as a box, the visible area outlined; a press
  // there centres the canvas on that point.
  const MINI_W = 180;
  const MINI_H = 120;
  const mini = createMemo(() => {
    const l = layout();
    const k = Math.min(MINI_W / Math.max(1, l.w), MINI_H / Math.max(1, l.h));
    const v = view();
    const s = size();
    return {
      k,
      boxes: l.clusters.map((c) => ({ x: c.x * k, y: c.y * k, w: c.w * k, h: c.h * k })),
      vp: {
        x: (-v.x / v.scale) * k,
        y: (-v.y / v.scale) * k,
        w: (s.w / v.scale) * k,
        h: (s.h / v.scale) * k,
      },
    };
  });
  const miniJump = (e: PointerEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { k } = mini();
    const wx = (e.clientX - r.left) / k;
    const wy = (e.clientY - r.top) / k;
    setView((v) => ({ ...v, x: size().w / 2 - wx * v.scale, y: size().h / 2 - wy * v.scale }));
  };
  const zoomAt = (factor: number, px: number, py: number) =>
    setView((v) => {
      const scale = clamp(v.scale * factor);
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });

  let timer = 0;
  // Asked before the canvas had a size or a layout: done after the first fit.
  let pending: string | null = null;
  const locate = (slug: string) => {
    const c = layout().clusters.find((x) => x.node.slug === slug);
    if (!c || !size().w) {
      pending = slug;
      return;
    }
    pending = null;
    fitTo(c, 0.9);
    setMarked(slug);
    host().window.clearTimeout(timer);
    timer = host().window.setTimeout(() => setMarked(null), 1600);
  };
  props.ref?.({ locate });
  onCleanup(() => host().window.clearTimeout(timer));

  onMount(() => {
    const measure = () => setSize({ w: box.clientWidth, h: box.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    // Scroll pans; pinch (ctrlKey on trackpads) and ctrl/cmd+scroll zoom.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => {
      ro.disconnect();
      box.removeEventListener("wheel", onWheel);
    });
  });
  // Fit once there is something to fit and a box to fit it in.
  let fitted = false;
  createEffect(
    on([layout, size], ([l, s]) => {
      if (fitted || !s.w || !l.clusters.length) return;
      fitted = true;
      openReadable();
      if (pending) locate(pending);
    }),
  );

  // Drag on the background pans; a drag that starts on a tile still pans once
  // it moves, and only a still press opens the tile.
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  // Two fingers pinch: the distance between them scales the canvas about
  // their midpoint, and the midpoint moving pans it.
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; mx: number; my: number } | null = null;
  const pinchOf = () => {
    const [a, b] = [...touches.values()];
    const r = box.getBoundingClientRect();
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mx: (a.x + b.x) / 2 - r.left,
      my: (a.y + b.y) / 2 - r.top,
    };
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        pinch = pinchOf();
        drag = null;
        lastMoved = true;
        return;
      }
    }
    const v = view();
    drag = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const next = pinchOf();
      const k = next.d / pinch.d;
      setView((v) => {
        const scale = clamp(v.scale * k);
        const f = scale / v.scale;
        return {
          scale,
          x: next.mx - (pinch!.mx - v.x) * f,
          y: next.my - (pinch!.my - v.y) * f,
        };
      });
      pinch = next;
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) box.setPointerCapture(e.pointerId);
    drag.moved = true;
    setView((v) => ({ ...v, x: drag!.vx + dx, y: drag!.vy + dy }));
  };
  const onUp = () => {
    const moved = drag?.moved ?? false;
    drag = null;
    return moved;
  };
  // A click that ended a pan is not a click.
  let lastMoved = false;
  const pointerUp = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (pinch) {
      if (touches.size < 2) pinch = null;
      drag = null;
      return;
    }
    lastMoved = onUp();
  };
  const open = (slug: string, at?: { state: string | null; variant: string }) => {
    if (lastMoved) return;
    navigate(mockPath(props.project, slug, at));
  };

  const pictures = createMemo(() => {
    const v = view();
    const s = size();
    if (v.scale < PICTURE_MIN_SCALE) return new Set<string>();
    return tilesToRender(layout().tiles, { ...v, ...s }, PICTURE_CAP);
  });
  const toggleStack = (key: string) => {
    if (lastMoved) return;
    const next = new Set(expanded());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };
  const src = (node: TreeNode, v: TreeVariant) =>
    v.surface < 0
      ? ""
      : surfaceUrl(v.postId, v.surface, { version: v.version, mode: theme(), e: v.embedsKey });

  return (
    <div
      class="pcanvas"
      ref={(el) => (box = el)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      <div
        class="pc-world"
        style={{
          transform: `translate(${view().x}px, ${view().y}px) scale(${view().scale})`,
        }}
      >
        <svg
          class="pc-edges"
          width={Math.max(1, layout().w)}
          height={Math.max(1, layout().h)}
          aria-hidden="true"
        >
          <For each={layout().edges}>
            {(e) => {
              const mid = (e.y1 + e.y2) / 2;
              return (
                <path
                  classList={{ on: marked() === e.from || marked() === e.to }}
                  d={`M${e.x1},${e.y1} C${e.x1},${mid} ${e.x2},${mid} ${e.x2},${e.y2}`}
                />
              );
            }}
          </For>
        </svg>
        <For each={layout().clusters}>
          {(c) => (
            <section
              class="pc-cluster"
              classList={{ marked: marked() === c.node.slug, page: c.node.kind === "page" }}
              data-cluster={c.node.slug}
              style={{
                left: `${c.x}px`,
                top: `${c.y}px`,
                width: `${c.w}px`,
                height: `${c.h}px`,
              }}
            >
              <header class="pc-head" style={{ height: `${CLUSTER_HEAD}px` }}>
                <button type="button" class="pc-title" onClick={() => open(c.node.slug)}>
                  {c.node.title}
                </button>
                <span class="pc-kind">{c.node.kind}</span>
                <Show when={c.node.open > 0}>
                  <span class="home-chip">
                    <i class="dot" />
                    {`${c.node.open} open`}
                  </span>
                </Show>
                <Show when={c.node.usedIn.length}>
                  <span class="pc-used" title={c.node.usedIn.join(", ")}>
                    {`in ${c.node.usedIn.length}`}
                  </span>
                </Show>
              </header>
              <Show when={c.node.states.length > 1}>
                <For each={c.rows}>
                  {(r) => (
                    <span class="pc-state" style={{ top: `${r.y - c.y - 20}px` }}>
                      {r.state}
                    </span>
                  )}
                </For>
              </Show>
            </section>
          )}
        </For>
        <For each={layout().tiles}>
          {(t) => {
            const node = () => bySlug().get(t.slug)!;
            return (
              <button
                type="button"
                class="pc-tile"
                classList={{
                  "is-main": t.role === "main",
                  archived: t.role === "archived",
                  accepted: t.variant.status === "accepted",
                }}
                data-post={t.variant.postId}
                data-variant={t.variant.variant}
                style={{
                  left: `${t.x}px`,
                  top: `${t.y}px`,
                  width: `${t.w}px`,
                  height: `${t.h}px`,
                }}
                title={[
                  t.variant.variant,
                  t.variant.status,
                  t.variant.forkedFrom &&
                    `from ${t.variant.forkedFrom.variant} v${t.variant.forkedFrom.version}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onClick={() => open(t.slug, { state: t.variant.state, variant: t.variant.variant })}
              >
                <Show
                  when={pictures().has(t.variant.postId) && src(node(), t.variant)}
                  fallback={<span class="pc-card">{t.variant.variant}</span>}
                >
                  {(s) => (
                    <Thumb
                      src={s()}
                      width={designWidth(node())}
                      knobs={node().settled}
                      title={`${node().title} · ${t.variant.variant}`}
                    />
                  )}
                </Show>
                <span class="pc-label">
                  {t.variant.variant}
                  <Show when={t.variant.starred}>
                    <span class="pc-star" aria-label="starred">
                      ★
                    </span>
                  </Show>
                  <Show when={t.variant.status === "accepted"}>
                    <span class="vok" aria-label="accepted">
                      ✓
                    </span>
                  </Show>
                </span>
              </button>
            );
          }}
        </For>
        <For each={layout().stacks}>
          {(s) => (
            <button
              type="button"
              class="pc-stack"
              classList={{ open: expanded().has(stackKey(s.slug, s.state)) }}
              aria-expanded={expanded().has(stackKey(s.slug, s.state))}
              aria-label={`${s.count} archived`}
              style={{
                left: `${s.x}px`,
                top: `${s.y}px`,
                width: `${s.w}px`,
                height: `${s.h}px`,
              }}
              onClick={() => toggleStack(stackKey(s.slug, s.state))}
            >
              <span class="pc-stack-cards" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span class="pc-stack-n">
                {expanded().has(stackKey(s.slug, s.state)) ? "fold" : `+${s.count} archived`}
              </span>
            </button>
          )}
        </For>
      </div>
      <div class="pc-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomAt(1 / 1.25, size().w / 2, size().h / 2)}
        >
          −
        </button>
        <span class="pc-pct">{`${Math.round(view().scale * 100)}%`}</span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomAt(1.25, size().w / 2, size().h / 2)}
        >
          +
        </button>
        <button type="button" onClick={fitAll}>
          Fit all
        </button>
      </div>
      <Show
        when={
          live().length &&
          (layout().w * view().scale > size().w || layout().h * view().scale > size().h)
        }
      >
        <div
          class="pc-mini"
          style={{ width: `${MINI_W}px`, height: `${MINI_H}px` }}
          role="img"
          aria-label="Minimap: where you are on the canvas"
          onPointerDown={miniJump}
        >
          <For each={mini().boxes}>
            {(b) => (
              <i
                style={{
                  left: `${b.x}px`,
                  top: `${b.y}px`,
                  width: `${b.w}px`,
                  height: `${b.h}px`,
                }}
              />
            )}
          </For>
          <b
            style={{
              left: `${mini().vp.x}px`,
              top: `${mini().vp.y}px`,
              width: `${mini().vp.w}px`,
              height: `${mini().vp.h}px`,
            }}
          />
        </div>
      </Show>
      <Show when={!live().length}>
        <p class="pc-empty">Nothing on the canvas yet.</p>
      </Show>
    </div>
  );
}
