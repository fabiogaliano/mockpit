// The stage's head: what is on stage (state, version), the variant switch, and
// the stage tools (device width, Mark, Inspect and its zoom).

import { createEffect, For, on, onCleanup, onMount, Show } from "solid-js";
import { readonly } from "./host.ts";
import { DEVICE_WIDTHS, type Zoom } from "./logic.ts";
import { ReactionBar } from "./Reactions.tsx";
import { mockPath, navigate } from "./route.ts";
import type { MockScreenState } from "./state.ts";

export function StageHead(props: {
  s: MockScreenState;
  anchor: (el: HTMLElement) => void;
  onHeight: (h: number) => void;
  zoom: Zoom;
  scale: number;
  setZoom: (z: Zoom) => void;
}) {
  const s = props.s;
  const v = () => s.activeVariant();
  // A dropped variant leaves the switcher unless it is the one on stage.
  const siblings = () =>
    s
      .variants()
      .filter((x) => x.state === s.activeState() && (x.status !== "dropped" || x === v()));
  // One entry per embedded component, the first occurrence's.
  const components = () => {
    const seen = new Set<string>();
    return (v()?.embeds ?? []).filter((e) => !seen.has(e.slug) && !!seen.add(e.slug));
  };
  const peek = (slug: string, version: number, latest: number) =>
    s.setEmbedPeek((p) => {
      const next = { ...p };
      if (version === latest) delete next[slug];
      else next[slug] = version;
      return next;
    });
  const dropped = () =>
    s.variants().filter((x) => x.state === s.activeState() && x.status === "dropped");
  const pct = () => Math.round(props.scale * 100);
  let head!: HTMLDivElement;
  let inspectBtn: HTMLButtonElement | undefined;
  let doneBtn: HTMLButtonElement | undefined;
  // Inspect hides the button that opened it; focus follows to Done and back,
  // so a keyboard user never lands on the page body.
  createEffect(
    on(
      () => s.inspect(),
      (open) => queueMicrotask(() => (open ? doneBtn : inspectBtn)?.focus()),
      { defer: true },
    ),
  );
  onMount(() => {
    // The head wraps onto more rows on a narrow stage; the stage fits under it.
    const ro = new ResizeObserver(() => props.onHeight(head.offsetHeight));
    ro.observe(head);
    props.onHeight(head.offsetHeight);
    onCleanup(() => ro.disconnect());
  });
  return (
    <div class="stage-head" ref={(el) => (head = el)}>
      <div class="stage-id">
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
        <Show when={!readonly() && v()}>
          {(variant) => (
            <button
              type="button"
              class="starbtn"
              classList={{ on: !!variant().starred }}
              aria-pressed={!!variant().starred}
              aria-label={
                variant().starred ? `Unstar ${variant().variant}` : `Star ${variant().variant}`
              }
              title="Star: a favourite to come back to. It decides nothing."
              onClick={() => void s.starVariant(variant(), !variant().starred)}
            >
              {variant().starred ? "★" : "☆"}
            </button>
          )}
        </Show>
      </div>
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
                  title={
                    [
                      x.forkedFrom && `from ${x.forkedFrom.variant} v${x.forkedFrom.version}`,
                      x.status === "archived" && "archived",
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
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
      <Show when={dropped().length && !readonly()}>
        <details class="dropped-fold">
          <summary>{`Dropped (${dropped().length})`}</summary>
          <For each={dropped()}>
            {(x) => (
              <span class="dropped-row">
                {x.variant}
                <button
                  type="button"
                  class="vrestore"
                  aria-label={`Restore ${x.variant}`}
                  onClick={() => void s.restoreVariant(x.variant, [x.state])}
                >
                  restore
                </button>
              </span>
            )}
          </For>
        </details>
      </Show>
      <Show when={components().length}>
        <div class="embeds-row" role="group" aria-label="Components">
          <For each={components()}>
            {(e) => (
              <span class="embed-pick">
                <a
                  href={mockPath(s.mock()?.project ?? "", e.slug)}
                  onClick={(ev) => {
                    ev.preventDefault();
                    navigate(mockPath(s.mock()?.project ?? "", e.slug));
                  }}
                >
                  {e.slug}
                </a>
                <Show
                  when={!e.pinned}
                  fallback={<span class="embed-pinned">{`pinned v${e.version}`}</span>}
                >
                  <select
                    aria-label={`${e.slug} version`}
                    value={s.embedPeek()[e.slug] ?? e.latest}
                    onChange={(ev) => peek(e.slug, Number(ev.currentTarget.value), e.latest)}
                  >
                    <For each={e.versions}>
                      {(n) => (
                        <option value={n}>{n === e.latest ? `v${n} latest` : `v${n}`}</option>
                      )}
                    </For>
                  </select>
                </Show>
              </span>
            )}
          </For>
        </div>
      </Show>
      {/* With one variant, Accept / Revise / Drop already say this. */}
      <Show when={!readonly() && siblings().length > 1 && v()}>
        {(variant) => (
          <ReactionBar
            s={s}
            part={null}
            about={`variant ${variant().variant}`}
            name={variant().variant}
            class="variant-reactions"
          />
        )}
      </Show>
      <div class="sr-only" role="status">
        {s.reactStatus()}
      </div>
      <div class="stage-tools">
        <label class="widthpick" title="The width the design renders at">
          <span class="sr-only">Width</span>
          <select value={s.frameW()} onChange={(e) => s.setFrameW(Number(e.currentTarget.value))}>
            <For each={DEVICE_WIDTHS}>
              {(d) => <option value={d.w}>{`${d.label} ${d.w}`}</option>}
            </For>
          </select>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M6 9.5L12 15.5L18 9.5" />
          </svg>
        </label>
        {/* Whether the design is seen at true size or shrunk to fit the screen. */}
        <span
          class="zoomval"
          classList={{ shrunk: pct() < 100 }}
          title={pct() === 100 ? "True size" : pct() < 100 ? "Shrunk to fit" : "Zoomed in"}
        >
          {`${pct()}%`}
        </span>
        <Show when={!readonly()}>
          <button
            type="button"
            class="markbtn"
            classList={{ on: s.marking() }}
            aria-pressed={s.marking()}
            title="Mark: tap the stage to leave a comment there"
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
            <span class="tool-label">Mark</span>
          </button>
        </Show>
        <Show
          when={s.inspect()}
          fallback={
            <button
              type="button"
              class="inspectbtn"
              ref={(el) => (inspectBtn = el)}
              title="Inspect: the stage alone, full screen, to zoom and pan"
              onClick={() => s.setInspect(true)}
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
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
              <span class="tool-label">Inspect</span>
            </button>
          }
        >
          <div class="zoomseg" role="group" aria-label="Zoom">
            <button
              type="button"
              aria-pressed={props.zoom === "fit"}
              classList={{ on: props.zoom === "fit" }}
              onClick={() => props.setZoom("fit")}
            >
              Fit
            </button>
            <button
              type="button"
              aria-pressed={props.zoom === 1}
              classList={{ on: props.zoom === 1 }}
              onClick={() => props.setZoom(1)}
            >
              100%
            </button>
          </div>
          <button
            type="button"
            class="donebtn"
            ref={(el) => (doneBtn = el)}
            onClick={() => s.setInspect(false)}
          >
            Done
          </button>
        </Show>
      </div>
    </div>
  );
}
