// The steps around the screen on stage: the declared flow it is a step of
// (the one the user came through, else the first that has it) or, in none,
// the mock's own states. A step may be another mock's state: going there opens
// that mock with the flow kept in the route, and this screen is written into
// the current history entry first, so Back returns to it.

import { createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import type { FlowStep } from "../../server/types.ts";
import { api, subscribe, surfaceUrl } from "./api.ts";
import { host } from "./host.ts";
import { flowFor, gotoTarget, screenPicture } from "./logic.ts";
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
    () => api.flowOutline(project).catch(() => null),
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

  const nodes = createMemo(() => new Map((data()?.mocks ?? []).map((n) => [n.slug, n])));
  const here = (): FlowStep => ({ mock: slug, state: s.activeState() });
  // A state the flow skips, reached from its list, stays inside the flow: leaving it
  // there would take the way back with it.
  type Flow = NonNullable<ReturnType<typeof flowOf>>;
  const flowOf = () => flowFor(data()?.flows ?? [], here(), cameThrough);
  const flow = createMemo<Flow | null>((was) => {
    const flows = data()?.flows ?? [];
    return (
      flowOf() ??
      flows.find((f) => f.name === was?.name && f.steps.some((x) => x.mock === slug)) ??
      null
    );
  }, null);
  // Only a step in another mock takes its picture from the tree.
  const [tree] = createResource(
    () => (flow()?.steps.some((x) => x.mock !== slug) ? rev() + 1 : null),
    () => api.tree(project).catch(() => null),
  );
  const pictured = createMemo(() => new Map((tree()?.tree ?? []).map((n) => [n.slug, n])));
  // A state with everything archived leaves the row while it is off stage; a
  // declared flow keeps every step the agent named.
  const emptied = createMemo(() => {
    if (flow()) return [];
    return s.states().filter((st) => st !== s.activeState() && s.emptiedState(st));
  });
  // This mock's states the flow doesn't walk through, listed after it.
  const outside = createMemo<FlowStep[]>(() => {
    const f = flow();
    if (!f) return [];
    return s
      .states()
      .filter(
        (state) =>
          !f.steps.some((x) => x.mock === slug && x.state === state) &&
          (state === s.activeState() || !s.emptiedState(state)),
      )
      .map((state) => ({ mock: slug, state }));
  });
  const steps = createMemo<FlowStep[]>(
    () =>
      flow()?.steps ??
      s
        .states()
        .filter((st) => !emptied().includes(st))
        .map((state) => ({ mock: slug, state })),
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
    const w = host().window;
    const here = new URLSearchParams(w.location.search);
    if (via) here.set("flow", via);
    w.history.replaceState(w.history.state, "", `${w.location.pathname}?${here}`);
    carryTry = s.trying();
    // Walking a flow keeps the view it is walked in.
    navigate(mockPath(project, to.mock, { state: to.state, variant: null }, via, here.get("view")));
  }
  const step = (by: 1 | -1) => {
    const to = near(by);
    if (to) go(to);
  };

  // A design's data-goto, reported by the frame on stage while Try is on: it
  // only ever names a state of this project, looked up here, never a URL.
  function follow(raw: string) {
    const statesOf = (m: string) => (m === slug ? s.states() : nodes().get(m)?.states);
    const to = gotoTarget(raw, steps(), at(), statesOf);
    if (to) go(to);
    else if (raw.trim() === "next") s.setToast({ text: "End of this flow" });
    else if (raw.trim() === "prev") s.setToast({ text: "Start of this flow" });
    else s.setToast({ text: `No state "${raw.slice(0, 60)}" in ${project}` });
  }

  // A step's design in use (else its newest live one), as a picture.
  function picture(x: FlowStep): string | null {
    if (x.mock === slug) {
      const v = s.variantFor(x.state, false);
      const i = v?.surfaces.findIndex((y) => y.kind === "html") ?? -1;
      return v && i >= 0
        ? surfaceUrl(v.postId, i, {
            version: s.frameVersionOf(v),
            mode: theme(),
            e: v.embedsKey,
            w: v.rewrites,
          })
        : null;
    }
    const node = pictured().get(x.mock);
    const pic = node && screenPicture(node, x.state);
    return pic
      ? surfaceUrl(pic.postId, pic.surface, {
          version: pic.version,
          mode: theme(),
          e: pic.embedsKey,
          w: pic.rewrites,
        })
      : null;
  }

  // Whether the agent still waits on a step; known only for this mock's own steps.
  const owes = (x: FlowStep) => x.mock === slug && s.askedIn(x.state) > 0;
  // Declared, with nothing drawn there yet. Another mock's says so once the tree is in.
  const planned = (x: FlowStep) =>
    x.mock === slug
      ? !s.variants().some((v) => v.state === x.state)
      : !!pictured().get(x.mock)?.planned;

  return {
    flow,
    steps,
    outside,
    emptied,
    here,
    at,
    near,
    name,
    label,
    go,
    step,
    follow,
    picture,
    owes,
    planned,
  };
}
