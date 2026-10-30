// About: what sits around this mock, opened from its own name in the path.
// Appears in (the mocks that embed it), Built from (what it embeds), Flows
// (each flow it is a step of), its other states and where its code lives.
// Asking the name is the gesture, so no icon has to explain it; a bottom sheet
// on a phone.

import { createMemo, createResource, For, type JSX, Show } from "solid-js";
import { api, type FlowView, surfaceUrl, type TreeNode } from "./api.ts";
import { designWidth, screenPicture } from "./logic.ts";
import { linkClick, mockPath } from "./route.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";
import { Thumb } from "./Thumb.tsx";

export interface AboutState {
  tree: () => { tree: TreeNode[]; flows: FlowView[] } | undefined;
}

// One per mock screen. The tree is fetched again whenever the mock changes, so
// a new embed or flow step shows.
export function createAbout(project: () => string, mockKey: () => string | null): AboutState {
  const [tree] = createResource(
    () => {
      const k = mockKey();
      return k === null ? null : `${project()}\u0000${k}`;
    },
    () => api.tree(project()),
  );
  return { tree };
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

export function aboutOf(r: AboutState, slug: string) {
  const bySlug = createMemo(() => new Map((r.tree()?.tree ?? []).map((n) => [n.slug, n])));
  const me = () => bySlug().get(slug);
  const embeddedIn = () => (me()?.embeddedIn ?? []).flatMap((s) => bySlug().get(s) ?? []);
  const embeds = () => (me()?.embeds ?? []).flatMap((s) => bySlug().get(s) ?? []);
  const flows = createMemo<FlowRow[]>(() =>
    (r.tree()?.flows ?? []).flatMap((f) =>
      f.steps.flatMap((x, i) =>
        x.mock === slug ? [{ flow: f.name, step: i + 1, of: f.steps.length, state: x.state }] : [],
      ),
    ),
  );
  const loaded = () => r.tree() !== undefined;
  return { me, embeddedIn, embeds, flows, loaded };
}

export function About(props: {
  s: MockScreenState;
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
  const others = () => s.states().filter((st) => st !== s.activeState());
  const empty = () =>
    rel.loaded() &&
    !rel.embeddedIn().length &&
    !rel.embeds().length &&
    !rel.flows().length &&
    !others().length &&
    !s.mock()?.source;
  return (
    <div
      class="about"
      classList={{ open: props.open }}
      role="dialog"
      aria-label={s.mock()?.title ?? props.slug}
      aria-hidden={!props.open}
      inert={!props.open || undefined}
      ref={props.ref}
    >
      {section(
        "Appears in",
        () => (
          <For each={rel.embeddedIn()}>
            {(n) => row(n, null, mockPath(props.project, n.slug), states(n))}
          </For>
        ),
        () => rel.embeddedIn().length,
      )}
      {section(
        "Built from",
        () => (
          <For each={rel.embeds()}>
            {(n) => row(n, null, mockPath(props.project, n.slug), states(n))}
          </For>
        ),
        () => rel.embeds().length,
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
      {section(
        "Other states",
        () => (
          <For each={others()}>
            {(st) => (
              <button
                type="button"
                class="rel-row"
                onClick={() => {
                  s.showState(st);
                  props.onClose();
                }}
              >
                <span class="rel-text">
                  <span class="nm">{st}</span>
                </span>
              </button>
            )}
          </For>
        ),
        () => others().length,
      )}
      <Show when={s.mock()?.source}>
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
