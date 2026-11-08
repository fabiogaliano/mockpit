// About: what sits around this design, opened from the info button beside its name.
// A component's place in the library (shared and its group, or its area), Appears in
// (the designs that include it), Instances (what it includes), Flows (each flow it is a
// step of) and where its code lives. Its states are the tabs' job. A bottom sheet on a
// phone.

import { createMemo, createResource, createSignal, For, type JSX, Show } from "solid-js";
import { api, type FlowView, surfaceUrl, type TreeNode } from "./api.ts";
import { inAreasLine } from "../../server/library.ts";
import { designWidth, screenPicture } from "./logic.ts";
import { linkClick, designPath } from "./route.ts";
import type { DesignScreenState } from "./state.ts";
import { readonly } from "./host.ts";
import { frameMode } from "./systemRev.ts";
import { Thumb } from "./Thumb.tsx";

export interface AboutState {
  tree: () => { tree: TreeNode[]; flows: FlowView[] } | undefined;
  wake: () => void;
  refetch: () => void;
}

// One per design screen. The tree is fetched again whenever the design changes, so
// a new instance or flow step shows.
export function createAbout(project: () => string, designKey: () => string | null): AboutState {
  // Not before it is first opened: most visits to a design never do.
  const [woken, setWoken] = createSignal(false);
  const [tree, { refetch }] = createResource(
    () => {
      const k = designKey();
      return k === null || !woken() ? null : `${project()}\u0000${k}`;
    },
    () => api.tree(project()),
  );
  return { tree, wake: () => setWoken(true), refetch: () => void refetch() };
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
    ? surfaceUrl(pic.postId, pic.surface, {
        version: pic.version,
        mode: frameMode(),
        e: pic.instancesKey,
        w: pic.rewrites,
      })
    : null;
}

export function aboutOf(r: AboutState, slug: string) {
  const bySlug = createMemo(() => new Map((r.tree()?.tree ?? []).map((n) => [n.slug, n])));
  const me = () => bySlug().get(slug);
  const instanceIn = () => (me()?.instanceIn ?? []).flatMap((s) => bySlug().get(s) ?? []);
  const instances = () => (me()?.instances ?? []).flatMap((s) => bySlug().get(s) ?? []);
  const flows = createMemo<FlowRow[]>(() =>
    (r.tree()?.flows ?? []).flatMap((f) =>
      f.steps.flatMap((x, i) =>
        x.design === slug
          ? [{ flow: f.name, step: i + 1, of: f.steps.length, state: x.state }]
          : [],
      ),
    ),
  );
  const loaded = () => r.tree() !== undefined;
  return { me, instanceIn, instances, flows, loaded };
}

export function About(props: {
  s: DesignScreenState;
  r: AboutState;
  project: string;
  slug: string;
  open: boolean;
  onClose: () => void;
  ref: (el: HTMLElement) => void;
}) {
  const s = props.s;
  const rel = aboutOf(props.r, props.slug);
  const go = (path: string) => (e: MouseEvent) => {
    props.onClose();
    linkClick(e, path);
  };
  const row = (
    n: TreeNode,
    state: string | null,
    path: string,
    meta: JSX.Element,
    title: string = n.title,
  ) => (
    <a class="rel-row" href={path} onClick={go(path)} data-design={n.slug}>
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
  // "Shared · Cards", "Shared", or the area it belongs to.
  const shelf = () => {
    const n = rel.me();
    if (n?.kind !== "component") return null;
    if (n.area) return n.area;
    return n.group ? `Shared · ${n.group}` : "Shared";
  };
  const [moving, setMoving] = createSignal(false);
  const [moveError, setMoveError] = createSignal<string | null>(null);
  // Offered, never done by itself: the user's click is the move, as from Home's ⋯ menu.
  async function makeShared(id: string) {
    setMoving(true);
    setMoveError(null);
    try {
      await api.editDesign(id, { area: null });
      props.r.refetch();
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving(false);
    }
  }
  const empty = () =>
    rel.loaded() &&
    !shelf() &&
    !rel.instanceIn().length &&
    !rel.instances().length &&
    !rel.flows().length &&
    !s.design()?.source;
  return (
    <div
      class="about"
      classList={{ open: props.open }}
      role="dialog"
      aria-label={s.design()?.title ?? props.slug}
      aria-hidden={!props.open}
      inert={!props.open || undefined}
      ref={props.ref}
    >
      <Show when={shelf()}>
        {(where) => (
          <section class="about-library">
            <h3>Library</h3>
            <p class="about-shelf">{where()}</p>
            <Show when={rel.me()?.inAreas}>
              {(areas) => (
                <div class="about-note">
                  <p>{`${inAreasLine(rel.me()?.title ?? props.slug, areas())}; make it shared.`}</p>
                  <Show when={!readonly()}>
                    <button
                      type="button"
                      class="btn"
                      disabled={moving()}
                      onClick={() => void makeShared(rel.me()!.id)}
                    >
                      Make it shared
                    </button>
                  </Show>
                  <Show when={moveError()}>
                    {(msg) => (
                      <p class="about-err" role="alert">
                        {msg()}
                      </p>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </section>
        )}
      </Show>
      {section(
        "Appears in",
        () => (
          <For each={rel.instanceIn()}>
            {(n) => row(n, null, designPath(props.project, n.slug), states(n))}
          </For>
        ),
        () => rel.instanceIn().length,
      )}
      {section(
        "Instances",
        () => (
          <For each={rel.instances()}>
            {(n) => row(n, null, designPath(props.project, n.slug), states(n))}
          </For>
        ),
        () => rel.instances().length,
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
                    designPath(
                      props.project,
                      props.slug,
                      f.state === null ? null : { state: f.state, alternative: null },
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
      <Show when={s.design()?.source}>
        {(src) => (
          <section>
            <h3>Code</h3>
            <p class="about-src">{src()}</p>
          </section>
        )}
      </Show>
      <Show when={empty()}>
        <p class="about-none">Nothing around it yet.</p>
      </Show>
    </div>
  );
}
