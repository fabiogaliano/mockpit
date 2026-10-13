// The stage's head: what is on stage (state, version), the variant switch, and
// the stage tools (device width, Mark, Inspect and its zoom).

import { createEffect, For, on, onCleanup, onMount, Show } from "solid-js";
import { readonly } from "./host.ts";
import { DEVICE_WIDTHS } from "./logic.ts";
import type { MockScreenState } from "./state.ts";

export function StageHead(props: {
  s: MockScreenState;
  anchor: (el: HTMLElement) => void;
  onHeight: (h: number) => void;
  zoom: "fit" | number;
  scale: number;
  setZoom: (z: "fit" | number) => void;
}) {
  const s = props.s;
  const v = () => s.activeVariant();
  const siblings = () => s.variants().filter((x) => x.state === s.activeState());
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
          {/* Fit and 100% name themselves; a pinched scale needs its number. */}
          <Show when={typeof props.zoom === "number" && props.zoom !== 1}>
            <span class="zoomval">{`${Math.round(props.scale * 100)}%`}</span>
          </Show>
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
