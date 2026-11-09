// One page of the Board: an area of the project laid out as a designer's file is. A flow
// is a section of steps across, each with the states of its screen that no flow names
// stacked under it; a screen's other states are a section of their own; then the
// components the page's screens are built from, then what is planned and not drawn.
// Built from the same designs `read --area` reads, plus each frame's poster and the
// page's coverage map (coverage.ts), so the viewer draws a page from one call and never
// runs a page to show it. The missing frames are the map's Missing cells.

import { offShelf } from "./apiViews.ts";
import { coverageOf, outlinable, pageReady } from "./coverage.ts";
import { readyWord, isChanged, shipped, shownVersion } from "./ready.ts";
import { isProduct } from "./spec.ts";
import {
  type Design,
  type FlowStep,
  isLive,
  isPlanned,
  openAsks,
  type PostHead,
  recommendedAlternative,
} from "./types.ts";

export interface BoardFrame {
  slug: string;
  state: string | null;
  // What the frame is called above it: the state, or the design's title where the frame
  // stands for the whole design (a component, a planned screen).
  name: string;
  // The design's first width; null when it declares none.
  width: number | null;
  poster?: string;
  // The alternative it shows and at which version, so the viewer can tell what changed
  // since this browser last had it on screen (seen.ts).
  post?: string;
  version?: number;
  // Declared, with nothing drawn in it yet.
  planned?: true;
}

export type BoardSection =
  | {
      kind: "flow";
      id: string;
      name: string;
      status?: string;
      steps: { frame: BoardFrame; below: BoardFrame[] }[];
    }
  | {
      kind: "screen";
      id: string;
      slug: string;
      // Some of its states are steps of a flow on the page, so this is the rest.
      inFlow: boolean;
      frames: BoardFrame[];
    }
  | { kind: "components"; id: string; frames: BoardFrame[] }
  | { kind: "planned"; id: string; frames: BoardFrame[] };

export interface BoardDesign {
  title: string;
  kind: Design["kind"];
  area: string | null;
  status?: string;
  open: number;
  ideas: number;
  states: string[];
}

export interface BoardQuestion {
  slug: string;
  title: string;
  kind: Design["kind"];
  id: string;
  text: string;
  state: string | null;
}

export interface BoardInput {
  project: string;
  // The page: an area's name, or null for the screens no area claims.
  area: string | null;
  areas: { name: string; description: string; alphabetical?: true }[];
  designs: Design[];
  heads: Map<string, PostHead[]>;
  flows: { name: string; status?: string; steps: (FlowStep & { planned?: true })[] }[];
  // By slug: the components each screen's shown versions include, nested ones too.
  builtFrom: Map<string, string[]>;
}

// The version a state shows: what's in use, else what the agent recommends, else the
// first drawn, at the version a product design shows (Ready's, after a stay), with its
// poster. The Board's still for it, the same choice the Library's covers make. A state
// whose alternatives were all archived shows none: it is drawn no more.
function shownOf(
  design: Design,
  posts: PostHead[],
  state: string | null,
): { post: string; version: number; poster?: string } | undefined {
  const live = posts.filter((p) => p.state === state && isLive(p.status));
  const used = live.find((p) => p.status === "accepted");
  const rec = recommendedAlternative(design.asks, state);
  const p = used ?? live.find((x) => x.alternative === rec) ?? live[0];
  if (!p) return undefined;
  const at = used?.acceptedVersion ?? shownVersion(design, p);
  const surfaces =
    at === p.version ? p.surfaces : (p.history.find((h) => h.version === at)?.surfaces ?? []);
  const poster = surfaces.find((s) => s.kind === "html")?.poster;
  return { post: p.id, version: at, ...(poster ? { poster } : {}) };
}

// The project's pages in its order (`edit --areas`), then the rest alphabetical, each with
// how many of its designs are Ready. A page is an area with a screen or component on it.
export function boardPages(input: Pick<BoardInput, "areas" | "designs" | "heads">) {
  const shelved = input.designs.filter((d) => !offShelf(d, input.heads.get(d.id) ?? []));
  const live = shelved.filter(isProduct);
  const named = new Set(live.flatMap((d) => (d.area ? [d.area] : [])));
  const order = input.areas.filter((a) => !a.alphabetical).map((a) => a.name);
  const rank = new Map(order.map((a, i) => [a, i]));
  const pages = [...named].sort(
    (a, b) =>
      (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) ||
      (rank.has(a) ? 0 : a.localeCompare(b)),
  );
  const described = new Map(input.areas.map((a) => [a.name, a.description]));
  return {
    pages: pages.map((name) => ({
      name,
      ...(described.get(name) ? { description: described.get(name)! } : {}),
      ...pageReady({ area: name, live: shelved, heads: input.heads }),
    })),
    // Screens with no area: a page of their own, after the named ones.
    unsorted: live.some((d) => d.kind === "screen" && !d.area)
      ? pageReady({ area: null, live: shelved, heads: input.heads })
      : null,
  };
}

// The page a design is drawn on, or undefined when it has none: an idea, a document, a
// shared component (the Library's), or anything archived.
export function pageOf(design: Design, posts: PostHead[]): string | null | undefined {
  if (!isProduct(design) || offShelf(design, posts)) return undefined;
  if (design.area) return design.area;
  return design.kind === "screen" ? null : undefined;
}

export function boardView(input: BoardInput) {
  const posts = (d: Design) => shipped(d, input.heads.get(d.id) ?? []);
  const live = input.designs.filter((d) => !offShelf(d, input.heads.get(d.id) ?? []));
  const bySlug = new Map(live.map((d) => [d.slug, d]));
  const here = live.filter(
    (d) =>
      isProduct(d) &&
      (input.area === null ? !d.area && d.kind === "screen" : d.area === input.area),
  );
  const screens = here.filter((d) => d.kind === "screen" && posts(d).length > 0);
  const states = (d: Design) => (d.states.length ? d.states : [null]);
  const drawn = (d: Design, state: string | null) =>
    posts(d).some((p) => p.state === state && isLive(p.status));
  const frame = (d: Design, state: string | null, name?: string): BoardFrame => {
    return {
      slug: d.slug,
      state,
      name: name ?? state ?? d.title,
      width: d.widths[0] ?? null,
      ...shownOf(d, posts(d), state),
      ...(drawn(d, state) ? {} : { planned: true as const }),
    };
  };

  // Every state some flow names, project-wide: those are steps, never stacked or loose.
  const inAnyFlow = new Set(
    input.flows.flatMap((f) => f.steps.map((x) => JSON.stringify([x.design, x.state]))),
  );
  const isStep = (slug: string, state: string | null) =>
    inAnyFlow.has(JSON.stringify([slug, state]));
  // A screen's states that no flow names stack under the step of that screen they follow
  // in its own order, in the first flow with a step of it, so the same state never sits
  // under two flows. Those before every step stay with the screen's loose states.
  const stacked = new Map<string, string | null>();
  const under = new Map<string, (string | null)[]>();
  const key = (flow: string, i: number) => JSON.stringify([flow, i]);
  for (const f of input.flows) {
    for (const slug of new Set(f.steps.map((x) => x.design))) {
      const d = bySlug.get(slug);
      if (!d || d.kind !== "screen") continue;
      const order = states(d);
      let at: number | null = null;
      for (const state of order) {
        const i = f.steps.findIndex((x) => x.design === slug && x.state === state);
        if (i >= 0) {
          at = i;
          continue;
        }
        const id = JSON.stringify([slug, state]);
        if (at === null || isStep(slug, state) || stacked.has(id)) continue;
        stacked.set(id, f.name);
        under.set(key(f.name, at), [...(under.get(key(f.name, at)) ?? []), state]);
      }
    }
  }

  const sections: BoardSection[] = [];
  // A flow is on the page when one of its steps is.
  const hereSlugs = new Set(here.map((d) => d.slug));
  for (const f of input.flows) {
    if (!f.steps.some((x) => hereSlugs.has(x.design))) continue;
    const steps = f.steps.flatMap((x, i) => {
      const d = bySlug.get(x.design);
      if (!d) return [];
      return [
        {
          frame: frame(d, x.state),
          below: (under.get(key(f.name, i)) ?? []).map((s) => frame(d, s)),
        },
      ];
    });
    if (steps.length)
      sections.push({
        kind: "flow",
        id: `flow:${f.name}`,
        name: f.name,
        ...(f.status ? { status: f.status } : {}),
        steps,
      });
  }
  for (const d of screens) {
    const loose = states(d).filter(
      (s) => !isStep(d.slug, s) && !stacked.has(JSON.stringify([d.slug, s])),
    );
    const inFlow = states(d).some((s) => isStep(d.slug, s));
    // Its suggested states are drawn here as missing, so a screen whose states are all
    // in flows still has a section when it may be owed some; the viewer draws them from
    // the coverage's Missing cells.
    if (!loose.length && !outlinable(d, posts(d))) continue;
    sections.push({
      kind: "screen",
      id: `screen:${d.slug}`,
      slug: d.slug,
      inFlow,
      frames: loose.map((s) => frame(d, s)),
    });
  }

  // The components here and those the page's screens are built from, as the screens list
  // them, then the area's own that no screen shows.
  const used: string[] = [];
  for (const d of screens) for (const s of input.builtFrom.get(d.slug) ?? []) used.push(s);
  for (const d of here) if (d.kind === "component" && posts(d).length) used.push(d.slug);
  const components = [...new Set(used)]
    .map((s) => bySlug.get(s))
    .filter((d): d is Design => !!d && d.kind === "component" && posts(d).length > 0);
  if (components.length)
    sections.push({
      kind: "components",
      id: "components",
      frames: components.map((d) => frame(d, states(d)[0], d.title)),
    });

  // A planned state a flow names is drawn at its step, not again here.
  const plannedFrames = here
    .filter((d) => isPlanned(d, posts(d).length))
    .flatMap((d) =>
      states(d)
        .filter((s) => !isStep(d.slug, s))
        .map((s) => frame(d, s, s === null ? d.title : `${d.title} · ${s}`)),
    );
  if (plannedFrames.length)
    sections.push({ kind: "planned", id: "planned", frames: plannedFrames });

  // Every design a frame names, with what its section header says.
  const named = new Set(
    sections.flatMap((s) =>
      s.kind === "flow"
        ? s.steps.flatMap((x) => [x.frame.slug, ...x.below.map((b) => b.slug)])
        : s.kind === "screen"
          ? [s.slug]
          : s.frames.map((f) => f.slug),
    ),
  );
  const designs: Record<string, BoardDesign> = {};
  for (const slug of named) {
    const d = bySlug.get(slug)!;
    const ps = posts(d);
    designs[slug] = {
      title: d.title,
      kind: d.kind,
      area: d.area ?? null,
      ...(isProduct(d) ? { status: readyWord(d, isChanged(d, ps)) } : {}),
      open: openAsks(d).length,
      ideas: live.filter((x) => x.kind === "idea" && x.for === d.id).length,
      states: d.states,
    };
  }

  // Needs you: every open question in the project, by design, newest work first.
  const questions: BoardQuestion[] = live
    .filter((d) => openAsks(d).length > 0)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .flatMap((d) =>
      openAsks(d).map((a) => ({
        slug: d.slug,
        title: d.title,
        kind: d.kind,
        id: a.id,
        text: a.text,
        state: a.state ?? null,
      })),
    );

  const area = input.area === null ? null : input.areas.find((a) => a.name === input.area);
  return {
    project: input.project,
    area: input.area,
    description: area?.description || null,
    ...boardPages(input),
    sections,
    designs,
    coverage: coverageOf({ area: input.area, live, heads: input.heads, flows: input.flows }),
    questions,
  };
}
