// The steps around the screen on stage: the declared flow it is a step of
// (the one the user came through, else the first that has it) or, in none,
// the mock's own states. A step may be another mock's state: going there opens
// that mock with the flow kept in the route, and this screen is written into
// the current history entry first, so Back returns to it.

import { createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import type { FlowStep } from "../../server/types.ts";
import { api, subscribe, surfaceUrl, type TreeNode } from "./api.ts";
import { host } from "./host.ts";
import { flowFor, gotoTarget } from "./logic.ts";
import { mockPath, navigate } from "./route.ts";
import type { MockScreenState } from "./state.ts";
import { theme } from "./theme.ts";

// Try stays on across a step into another mock, which mounts a fresh screen.
let carryTry = false;

export type FlowNav = ReturnType<typeof createFlowNav>;

export function createFlowNav(
  s: MockScreenState,
  project: string,
  slug: string,
  cameThrough: string | null,
) {
  const [rev, setRev] = createSignal(0);
  const [data] = createResource(
    () => rev() + 1,
    () => api.tree(project).catch(() => null),
  );
  onMount(() => {
    if (carryTry) s.setTool("try");
    carryTry = false;
    let timer = 0;
    const stop = subscribe((e) => {
      if (e.type !== "mock-created" && e.type !== "mock-updated" && e.type !== "mock-deleted")
        return;
      if (e.project !== project) return;
      host().window.clearTimeout(timer);
      timer = host().window.setTimeout(() => setRev(rev() + 1), 300);
    });
    onCleanup(() => {
      stop();
      host().window.clearTimeout(timer);
    });
  });

  const nodes = createMemo(() => new Map((data()?.tree ?? []).map((n) => [n.slug, n])));
  const here = (): FlowStep => ({ mock: slug, state: s.activeState() });
  const flow = createMemo(() => flowFor(data()?.flows ?? [], here(), cameThrough));
  const steps = createMemo<FlowStep[]>(
    () => flow()?.steps ?? s.states().map((state) => ({ mock: slug, state })),
  );
  const at = createMemo(() =>
    steps().findIndex((x) => x.mock === slug && x.state === s.activeState()),
  );
  const near = (by: number): FlowStep | undefined => {
    const i = at();
    return i < 0 ? undefined : steps()[i + by];
  };
  const name = () => flow()?.name ?? s.mock()?.title ?? slug;
  const label = (x: FlowStep) =>
    x.state ?? (x.mock === slug ? s.mock()?.title : nodes().get(x.mock)?.title) ?? x.mock;

  function go(to: FlowStep) {
    if (to.mock === slug) {
      if (to.state !== s.activeState()) s.showState(to.state);
      return;
    }
    const via = flow()?.name ?? null;
    const h = host().history;
    h.replaceState(
      h.state,
      "",
      mockPath(project, slug, { state: s.activeState(), variant: null }, via),
    );
    carryTry = s.trying();
    navigate(mockPath(project, to.mock, { state: to.state, variant: null }, via));
  }
  const step = (by: 1 | -1) => {
    const to = near(by);
    if (to) go(to);
  };

  // A design's data-goto, reported by the frame on stage while Try is on: it
  // only ever names a screen of this project, looked up here, never a URL.
  function follow(raw: string) {
    const statesOf = (m: string) => (m === slug ? s.states() : nodes().get(m)?.states);
    const to = gotoTarget(raw, steps(), at(), statesOf);
    if (to) go(to);
    else if (raw.trim() === "next") s.setToast({ text: "End of this flow" });
    else if (raw.trim() === "prev") s.setToast({ text: "Start of this flow" });
    else s.setToast({ text: `No screen "${raw.slice(0, 60)}" in ${project}` });
  }

  // A step's design in use (else its first live one), as a picture.
  function picture(x: FlowStep): string | null {
    if (x.mock === slug) {
      const v = s.variantFor(x.state, false);
      const i = v?.surfaces.findIndex((y) => y.kind === "html") ?? -1;
      return v && i >= 0
        ? surfaceUrl(v.postId, i, { version: s.frameVersionOf(v), mode: theme(), e: v.embedsKey })
        : null;
    }
    const node: TreeNode | undefined = nodes().get(x.mock);
    if (!node) return null;
    const use = node.inUse.find((u) => u.state === x.state);
    const inState = node.variants.filter((v) => v.state === x.state);
    const v =
      (use && inState.find((y) => y.variant === use.variant)) ??
      inState.find((y) => y.status === "accepted" || y.status === "open") ??
      inState[0];
    if (!v || v.surface < 0) return null;
    const version = use && use.variant === v.variant ? use.version : v.version;
    return surfaceUrl(v.postId, v.surface, { version, mode: theme(), e: v.embedsKey });
  }

  // Whether a step still owes answers; known only for this mock's own steps.
  const owes = (x: FlowStep) => x.mock === slug && s.owedIn(x.state) > 0;

  return { flow, steps, at, near, name, label, go, step, follow, picture, owes };
}
