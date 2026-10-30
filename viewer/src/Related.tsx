// Related: what sits around this mock in the project, as compact rows that
// move sideways to it. Appears in (the pages that embed it), Built from (what
// it embeds), Flows (each flow it is a step of, with the step). Closed until the
// top bar's toggle opens it; open or closed is remembered per browser. It
// overlays the canvas from the left edge, a sheet from the bottom on a phone.

import { createMemo, createResource, createSignal, For, type JSX, Show } from "solid-js";
import { api, type FlowView, surfaceUrl, type TreeNode } from "./api.ts";
import { host } from "./host.ts";
import { Icon } from "./icons.tsx";
import { designWidth, screenPicture } from "./logic.ts";
import { linkClick, mockPath } from "./route.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";
import { canvasTop, phoneLayout } from "./viewport.ts";

const KEY = "mockpit:related";

export interface RelatedState {
  open: () => boolean;
  setOpen: (on: boolean) => void;
  tree: () => { tree: TreeNode[]; flows: FlowView[] } | undefined;
}

// One per mock screen. The tree is fetched again whenever the mock changes, so
// a new embed or flow step shows.
export function createRelated(project: () => string, mockKey: () => string | null): RelatedState {
  // A phone opens it only on purpose: a sheet over the design is not a default.
  const [open, setOpenSignal] = createSignal(
    !phoneLayout() && host().storage?.getItem(KEY) === "1",
  );
  const setOpen = (on: boolean) => {
    setOpenSignal(on);
    try {
      if (!phoneLayout()) host().storage?.setItem(KEY, on ? "1" : "0");
    } catch {
      // Storage refused: it is just not remembered.
    }
  };
  const [tree] = createResource(
    () => {
      const k = mockKey();
      return k === null ? null : `${project()}\u0000${k}`;
    },
    () => api.tree(project()),
  );
  return { open, setOpen, tree };
}

interface FlowRow {
  flow: string;
  step: number;
  of: number;
  state: string | null;
}

function nodePicture(node: TreeNode, state: string | null): string | null {
  const pic = screenPicture(node, state ?? node.inUse[0]?.state ?? node.states[0] ?? null);
  return pic
    ? surfaceUrl(pic.postId, pic.surface, { version: pic.version, mode: theme(), e: pic.embedsKey })
    : null;
}

export function relatedOf(r: RelatedState, slug: string) {
  const bySlug = createMemo(() => new Map((r.tree()?.tree ?? []).map((n) => [n.slug, n])));
  const me = () => bySlug().get(slug);
  const usedIn = () => (me()?.usedIn ?? []).flatMap((s) => bySlug().get(s) ?? []);
  const uses = () => (me()?.uses ?? []).flatMap((s) => bySlug().get(s) ?? []);
  const flows = createMemo<FlowRow[]>(() =>
    (r.tree()?.flows ?? []).flatMap((f) =>
      f.steps.flatMap((x, i) =>
        x.mock === slug ? [{ flow: f.name, step: i + 1, of: f.steps.length, state: x.state }] : [],
      ),
    ),
  );
  // Nothing around it: the toggle hides.
  const any = () => usedIn().length + uses().length + flows().length > 0;
  return { me, usedIn, uses, flows, any };
}

export function Related(props: {
  r: RelatedState;
  project: string;
  slug: string;
  rel: ReturnType<typeof relatedOf>;
}) {
  const rel = props.rel;
  const go = (path: string) => (e: MouseEvent) => {
    if (phoneLayout()) props.r.setOpen(false);
    linkClick(e, path);
  };
  const row = (
    n: TreeNode,
    state: string | null,
    path: string,
    meta: JSX.Element,
    title: string = n.title,
  ) => (
    <a class="rel-row" href={path} onClick={go(path)} data-mock={n.slug}>
      <span class="rel-pic" classList={{ wide: n.kind === "component" || designWidth(n) >= 700 }}>
        <Show when={nodePicture(n, state)}>
          {(u) => <Thumb src={u()} width={designWidth(n)} class="rel-thumb" fit whole />}
        </Show>
      </span>
      <span class="rel-text">
        <span class="nm">{title}</span>
        <span class="sm">{meta}</span>
      </span>
    </a>
  );
  const section = (title: string, body: () => JSX.Element, count: () => number) => (
    <Show when={count()}>
      <section>
        <h3>{title}</h3>
        {body()}
      </section>
    </Show>
  );
  const states = (n: TreeNode) =>
    n.states.length > 1 || n.states[0] !== null
      ? `${n.states.length} ${n.states.length === 1 ? "state" : "states"}`
      : n.kind === "component"
        ? "component"
        : "";
  return (
    <aside
      class="related"
      classList={{ open: props.r.open() }}
      style={phoneLayout() ? {} : { top: `${canvasTop()}px` }}
      aria-label="Related"
      aria-hidden={!props.r.open()}
      inert={!props.r.open() || undefined}
    >
      <Show when={phoneLayout()}>
        <div class="dhead">
          <h2>Related</h2>
          <button
            type="button"
            class="ib"
            aria-label="Close"
            onClick={() => props.r.setOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
      </Show>
      {section(
        "Appears in",
        () => (
          <For each={rel.usedIn()}>
            {(n) => row(n, null, mockPath(props.project, n.slug), states(n))}
          </For>
        ),
        () => rel.usedIn().length,
      )}
      {section(
        "Built from",
        () => (
          <For each={rel.uses()}>
            {(n) => row(n, null, mockPath(props.project, n.slug), states(n))}
          </For>
        ),
        () => rel.uses().length,
      )}
      {section(
        "Flows",
        () => (
          <For each={rel.flows()}>
            {(f) => (
              <Show when={rel.me()}>
                {(n) =>
                  row(
                    n(),
                    f.state,
                    mockPath(
                      props.project,
                      props.slug,
                      f.state === null ? null : { state: f.state, variant: null },
                      f.flow,
                    ),
                    f.state === null
                      ? `step ${f.step} of ${f.of}`
                      : `step ${f.step} of ${f.of} · ${f.state}`,
                    f.flow,
                  )
                }
              </Show>
            )}
          </For>
        ),
        () => rel.flows().length,
      )}
    </aside>
  );
}
