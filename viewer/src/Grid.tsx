// A set read whole: states one way, variants the other, one tile per render, with what
// isn't drawn left visibly missing. Offered wherever names repeat across states, and how
// a component's forms are compared, with where the component is used above it. A tile is
// a picture that opens that render on Stage. The pictures obey Studio's limit: a poster
// costs nothing, and of the pages near the screen only a budget are live at once, the
// one pointed at first, the rest waiting blank.

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { isLive } from "../../server/types.ts";
import { type AboutState, aboutOf } from "./About.tsx";
import { assetUrl, type VariantView } from "./api.ts";
import { Icon } from "./icons.tsx";
import {
  CANVAS_MAX,
  gridAxes,
  type VersionRef,
  type VersionStep,
  variantName,
  versionSteps,
  wallCard,
} from "./logic.ts";
import { linkClick, designPath } from "./route.ts";
import type { DesignScreenState } from "./state.ts";
import { pictureOf } from "./Studio.tsx";
import { Thumb } from "./Thumb.tsx";

type Cell = { v: VariantView; step: VersionStep | undefined };

const keyOf = (state: string | null, variant: string) => JSON.stringify([state, variant]);

export function Grid(props: {
  s: DesignScreenState;
  about: AboutState;
  project: string;
  slug: string;
  // On a component this stands in for Studio, whose tools are one step on from here.
  onColumns?: () => void;
  onOpen: (state: string | null, ref: VersionRef) => void;
}) {
  const s = props.s;
  const axes = createMemo(() => gridAxes(s.states(), s.variants()));
  const flat = () => axes().cols.length === 1;
  const size = () => wallCard(s.frameW());

  // What stands for a render: the version in use, else its newest that isn't hidden.
  const cells = createMemo(() => {
    const out = new Map<string, Cell>();
    for (const state of s.states()) {
      const steps = versionSteps(s.variants(), state);
      for (const v of s.variants()) {
        if (v.state !== state) continue;
        const own = steps.filter((x) => x.variant === v.variant);
        const used = s.design()?.inUse.find((u) => u.state === state && u.variant === v.variant);
        const step =
          own.find((x) => x.version === used?.version) ??
          [...own].reverse().find((x) => !x.hidden) ??
          own.at(-1);
        out.set(keyOf(state, v.variant), { v, step });
      }
    }
    return out;
  });

  // Reading order decides who is live when the budget runs out, so it is the top left
  // of what's on screen that shows, not whichever scrolled in first.
  const order = createMemo(() => {
    const out = new Map<string, number>();
    for (const variant of axes().rows) {
      for (const state of axes().cols) out.set(keyOf(state, variant), out.size);
    }
    return out;
  });
  const [near, setNear] = createSignal<string[]>([]);
  const [pointed, setPointed] = createSignal<string | null>(null);
  const live = createMemo(() => {
    const rank = (k: string) => (k === pointed() ? -1 : (order().get(k) ?? Infinity));
    return new Set([...near()].sort((a, b) => rank(a) - rank(b)).slice(0, CANVAS_MAX));
  });
  let scroller: HTMLDivElement | undefined;
  let seen: IntersectionObserver | undefined;
  onMount(() => {
    props.about.wake();
    seen = new IntersectionObserver(
      (entries) =>
        setNear((was) => {
          let next = was;
          for (const e of entries) {
            const k = (e.target as HTMLElement).dataset.tile as string;
            next = e.isIntersecting
              ? next.includes(k)
                ? next
                : [...next, k]
              : next.filter((x) => x !== k);
          }
          return next;
        }),
      { root: scroller ?? null, rootMargin: "200px" },
    );
    for (const el of scroller?.querySelectorAll<HTMLElement>("[data-tile]") ?? []) {
      seen.observe(el);
    }
  });
  onCleanup(() => seen?.disconnect());
  const watch = (el: HTMLElement, key: string) => {
    queueMicrotask(() => seen?.observe(el));
    onCleanup(() => {
      seen?.unobserve(el);
      setNear((was) => was.filter((x) => x !== key));
    });
  };

  const rel = aboutOf(props.about, props.slug);
  const isComponent = () => s.design()?.kind === "component";
  const count = () => {
    const forms = `${axes().rows.length} ${isComponent() ? "forms" : "variants"}`;
    return flat() ? forms : `${forms}, ${axes().cols.length} states`;
  };

  const tile = (state: string | null, variant: string) => (
    <Tile
      s={s}
      state={state}
      variant={variant}
      caption={flat()}
      cell={cells().get(keyOf(state, variant))}
      live={live().has(keyOf(state, variant))}
      watch={(el) => watch(el, keyOf(state, variant))}
      onPoint={() => setPointed(keyOf(state, variant))}
      onOpen={(ref) => props.onOpen(state, ref)}
    />
  );

  return (
    <div
      class="gridview"
      ref={(el) => (scroller = el)}
      style={{
        "--gv-cell": `${size().min}px`,
        "--gv-art": size().art,
        "--gv-cols": axes().cols.length,
      }}
    >
      <div class="gv-head">
        <span class="gv-count">{count()}</span>
        <Show when={rel.embeddedIn().length}>
          <span class="gv-used">
            <span>Appears in</span>
            <For each={rel.embeddedIn()}>
              {(n) => (
                <a
                  href={designPath(props.project, n.slug)}
                  onClick={(e) => linkClick(e, designPath(props.project, n.slug))}
                >
                  {n.title}
                </a>
              )}
            </For>
          </span>
        </Show>
        <Show when={isComponent() && rel.loaded() && !rel.embeddedIn().length}>
          <span class="gv-used">Not used in a design yet</span>
        </Show>
        <span class="grow" />
        <Show when={props.onColumns}>
          <button type="button" class="btn gv-cols-btn" onClick={() => props.onColumns?.()}>
            <Icon name="grid" />
            Columns
          </button>
        </Show>
      </div>
      <Show
        when={!flat()}
        fallback={
          <For each={axes().cols}>
            {(state) => (
              <div class="gv-flat">
                <For each={axes().rows}>{(variant) => tile(state, variant)}</For>
              </div>
            )}
          </For>
        }
      >
        <div class="gv-table" role="table" aria-label={count()}>
          <span class="gv-corner" />
          <For each={axes().cols}>
            {(state) => (
              <span class="gv-col" role="columnheader" title={state ?? undefined}>
                {state}
              </span>
            )}
          </For>
          <For each={axes().rows}>
            {(variant) => (
              <>
                <span class="gv-row" role="rowheader" title={variant}>
                  {variantName(variant)}
                </span>
                <For each={axes().cols}>{(state) => tile(state, variant)}</For>
              </>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function Tile(props: {
  s: DesignScreenState;
  state: string | null;
  variant: string;
  caption: boolean;
  cell: Cell | undefined;
  live: boolean;
  watch: (el: HTMLElement) => void;
  onPoint: () => void;
  onOpen: (ref: VersionRef) => void;
}) {
  const s = props.s;
  const name = () =>
    `${variantName(props.variant)}${props.state === null ? "" : `, ${props.state}`}`;
  const step = () => (props.cell && isLive(props.cell.v.status) ? props.cell.step : undefined);
  const used = () => {
    const st = step();
    return (
      !!st &&
      s
        .design()
        ?.inUse.some(
          (u) => u.state === props.state && u.variant === st.variant && u.version === st.version,
        )
    );
  };
  const caption = () => (
    <Show when={props.caption}>
      <span class="gv-cap" title={props.variant}>
        {variantName(props.variant)}
      </span>
    </Show>
  );
  return (
    <div class="gv-cell" role="cell">
      <Show
        when={step()}
        fallback={<span class="gv-tile gv-missing">{props.cell ? "Archived" : "Not drawn"}</span>}
      >
        {(st) => (
          <button
            type="button"
            class="gv-tile"
            aria-label={`Open ${name()}${used() ? ", in use" : ""}`}
            title={props.cell?.v.description ?? name()}
            onClick={() => props.onOpen({ variant: st().variant, version: st().version })}
            onPointerEnter={props.onPoint}
            onFocus={props.onPoint}
          >
            <Show
              when={st().poster}
              fallback={
                <span
                  class="gv-art"
                  data-tile={JSON.stringify([props.state, props.variant])}
                  ref={props.watch}
                >
                  <Show when={props.live && pictureOf(st())}>
                    {(u) => <Thumb src={u()} width={s.frameW()} fit whole />}
                  </Show>
                </span>
              }
            >
              {(p) => (
                <span class="gv-art">
                  <img src={assetUrl(p())} alt="" loading="lazy" decoding="async" />
                </span>
              )}
            </Show>
            <Show when={used()}>
              <span class="mk cur" aria-hidden="true">
                <Icon name="check" />
              </span>
            </Show>
          </button>
        )}
      </Show>
      {caption()}
    </div>
  );
}
