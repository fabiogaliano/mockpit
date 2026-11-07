// Response shapes shared by every tier (REST, both MCP transports, the CLI), so
// one design reads the same however an agent asks for it.

import { isShared } from "./library.ts";
import { slotKnobs, slotsInSurfaces } from "./swaps.ts";
import type { Mode } from "./themes.ts";
import { mergeParts, type PartInfo, partsInSurfaces } from "./parts.ts";
import { isKeptAlternative, keptAlternatives } from "./standings.ts";
import { withAddedAnswers } from "./alternativeQuestion.ts";
import type { DecisionLine } from "./decisionList.ts";
import { purposeLine, specView } from "./spec.ts";
import {
  type BuiltFrom,
  readyFields,
  readyNewer,
  readyVersion,
  shipped,
  shownVersion,
} from "./ready.ts";
import {
  changedTo,
  draftedCount,
  type Described,
  type Instance,
  type FlowStep,
  inUseVersion,
  isPlanned,
  isSandboxedSurfaceKind,
  isLive,
  type KnobValue,
  type Design,
  openCount,
  type Post,
  type PostHead,
  type PostVersion,
  recommendedAlternative,
  type Session,
  SURFACE_CONTENT_FIELDS,
  type Surface,
  type SurfaceHead,
  alternativeStatus,
} from "./types.ts";

export const surfaceRef = (surface: Pick<Surface, "id" | "kind">, index: number) => ({
  id: surface.id,
  kind: surface.kind,
  index,
});

export const fullSurfaceView = (surface: Surface, index: number) => ({ ...surface, index });

// A sandboxed surface renders as an opaque-origin iframe pointed at
// /s/:id?surface=N, which fetches the body itself — so a read that is not asking
// for bodies drops just the content field. Native kinds (image/json) render from
// inline data, so they keep everything.
export const hydratedSurfaceView = (surface: Surface, index: number) => {
  const field = isSandboxedSurfaceKind(surface.kind)
    ? SURFACE_CONTENT_FIELDS[surface.kind]
    : undefined;
  if (!field) return fullSurfaceView(surface, index);
  // Surface is a union of interfaces, so the content key can't be dropped through
  // the union type. Widen to a bag, delete the one key; the value is only serialized.
  const view = { ...surface, index } as unknown as Record<string, unknown>;
  delete view[field];
  return view;
};

// A still mockpit took shows the page in the mode it was taken in. In the other mode it
// would be the one picture in the wrong colours among live pages, so it is left out and the
// page runs as it did before posters. Applied to posts before any view reads them, so every
// view agrees. Posts come from the store's cache: copied where changed, never written to.
// The same goes for a still taken under another revision of the project's system.
const otherMode = (s: { kind: string }, mode: Mode, rev: number | undefined) => {
  const { posterMode: taken, posterSystem: under } = s as {
    posterMode?: Mode;
    posterSystem?: number;
  };
  if (s.kind !== "html" || taken === undefined) return false;
  if (taken !== mode) return true;
  if (rev === undefined) return false;
  return under === undefined ? rev > 1 : under !== rev;
};
const surfacesFor = <S extends { kind: string }>(
  surfaces: S[],
  mode: Mode,
  rev: number | undefined,
): S[] =>
  surfaces.some((s) => otherMode(s, mode, rev))
    ? surfaces.map((s) => {
        if (!otherMode(s, mode, rev)) return s;
        const {
          poster: _poster,
          posterMode: _mode,
          posterSystem: _system,
          ...rest
        } = s as S & {
          poster?: string;
          posterMode?: Mode;
          posterSystem?: number;
        };
        return rest as unknown as S;
      })
    : surfaces;
export const postersFor = <
  S extends { kind: string },
  P extends { surfaces: S[]; history: { surfaces: S[] }[] },
>(
  posts: P[],
  mode: Mode,
  // The project system's revision; undefined across projects, where it isn't one.
  rev?: number,
): P[] =>
  posts.map((p) => {
    const surfaces = surfacesFor(p.surfaces, mode, rev);
    const history = p.history.map((h) => {
      const own = surfacesFor(h.surfaces, mode, rev);
      return own === h.surfaces ? h : { ...h, surfaces: own };
    });
    return surfaces === p.surfaces && history.every((h, i) => h === p.history[i])
      ? p
      : { ...p, surfaces, history };
  });

// The still overviews show for a version: its html page's poster.
const pagePoster = (surfaces: SurfaceHead[]) => surfaces.find((s) => s.kind === "html")?.poster;
const posterOf = (surfaces: SurfaceHead[]) => {
  const poster = pagePoster(surfaces);
  return poster ? { poster } : {};
};

// The poster of one version of an alternative: what Home shows for it.
const posterAt = (post: PostHead, version: number) =>
  pagePoster(
    (version === post.version
      ? post.surfaces
      : post.history.find((h) => h.version === version)?.surfaces) ?? [],
  );

// The in-use version's poster, when Home shows an older version than the
// newest.
const inUsePoster = (p: PostHead) => {
  if (p.acceptedVersion === undefined || p.acceptedVersion === p.version) return {};
  const poster = posterAt(p, p.acceptedVersion);
  return poster ? { inUsePoster: poster } : {};
};

// The version Home shows when nothing is in use and the newest was hidden, or a
// product design went back to the version marked Ready.
const coverVersion = (
  p: PostHead,
  design: Pick<Design, "kind" | "ready">,
): { coverVersion?: number; coverPoster?: string } => {
  const at = shownVersion(design, p);
  if (p.status === "accepted" || at === p.version) return {};
  const poster = posterAt(p, at);
  return { coverVersion: at, ...(poster ? { coverPoster: poster } : {}) };
};

// A page that draws on a canvas may hold a WebGL context, of which a browser
// keeps about 16 and drops the oldest past that, so overviews ration these
// frames and no others. Three.js and the like make their canvas from script.
// Asked once per version: a read lists every version, with bodies up to 1 MB.
const CANVAS_PAGE = /<canvas[\s>]|webgl|three(?:\.module|\.min|\.js|@)|['"]three['"]|pixi|babylon/i;
const canvasPages = new WeakMap<Surface[], boolean>();
const drawsOnCanvas = (surfaces: Surface[]): boolean => {
  let hit = canvasPages.get(surfaces);
  if (hit === undefined) {
    hit = surfaces.some((s) => s.kind === "html" && CANVAS_PAGE.test(s.html));
    canvasPages.set(surfaces, hit);
  }
  return hit;
};

// One past version without its bodies: enough to list versions or pick one to
// fetch, at a bounded cost.
export const historyMetaView = (version: PostVersion) => ({
  version: version.version,
  title: version.title,
  at: version.at,
  ...(version.from === undefined ? {} : { from: version.from }),
  ...(version.prompt ? { prompt: version.prompt } : {}),
  ...(version.author === undefined ? {} : { author: version.author }),
  ...(version.amendedAt ? { amendedAt: version.amendedAt } : {}),
  surfaceKinds: version.surfaces.map((s) => s.kind),
  ...posterOf(version.surfaces),
  ...(drawsOnCanvas(version.surfaces) ? { canvas: true } : {}),
});

export interface AlternativeViewOptions {
  // Full surface bodies instead of refs (agent reads opt in; the viewer frames them).
  body?: boolean;
  // Version rows, newest first, current version included.
  history?: boolean;
  // What each post's instances resolve to now, by post id.
  instances?: Map<string, InstanceView>;
  // The alternatives some question keeps (standings.ts keptAlternatives).
  kept?: Set<string>;
  // Whose alternatives: a product design's say where its Ready mark stands.
  design?: Pick<Design, "kind" | "ready">;
}

// An alternative's instances as they render now (nested ones included): each with the
// component's latest version and every version it has, for peeking back; and
// the key that changes whenever any of them does.
export interface InstanceView {
  key: string;
  list: (Instance & { latest: number; versions: number[] })[];
}

// Where an alternative stands against what was chosen. An idea's: a newer version than the
// one in use (`changedTo`). A product design's, once marked Ready: the version the mark
// recorded (`readyVersion`), a newer one (`changedTo`), and the one shown when the user
// went back to the marked one (`shownVersion`).
function versionMarks(
  post: Pick<
    Post,
    | "state"
    | "alternative"
    | "status"
    | "version"
    | "acceptedVersion"
    | "hiddenVersions"
    | "stayedVersion"
  > & {
    history: { version: number }[];
  },
  design: Pick<Design, "kind" | "ready"> | undefined,
): { changedTo?: number; readyVersion?: number; shownVersion?: number } {
  if (!design || design.kind === "idea") {
    const to = changedTo(post);
    return to === undefined ? {} : { changedTo: to };
  }
  const marked = readyVersion(design, post);
  if (marked === undefined) return {};
  const to = readyNewer(design, post);
  const shown = shownVersion(design, post);
  return {
    readyVersion: marked,
    ...(to === undefined ? {} : { changedTo: to }),
    ...(shown === marked && shown !== post.version ? { shownVersion: shown } : {}),
  };
}

export const alternativeView = (post: Post, opts: AlternativeViewOptions = {}) => ({
  postId: post.id,
  state: post.state,
  alternative: post.alternative,
  status: alternativeStatus(post.status),
  version: post.version,
  title: post.title,
  sessionId: post.sessionId,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  ...(post.from === undefined ? {} : { from: post.from }),
  ...(post.prompt ? { prompt: post.prompt } : {}),
  ...(post.author === undefined ? {} : { author: post.author }),
  ...(post.amendedAt ? { amendedAt: post.amendedAt } : {}),
  // Frame URLs carry it (`w`): an amended version keeps its number.
  ...(post.rewrites ? { rewrites: post.rewrites } : {}),
  // A part with swaps is a select knob on its part (swaps.ts); declared knobs win.
  ...(slotsInSurfaces(post.surfaces).length || post.knobs
    ? { knobs: { ...slotKnobs(slotsInSurfaces(post.surfaces)), ...post.knobs } }
    : {}),
  ...(slotsInSurfaces(post.surfaces).length ? { swaps: slotsInSurfaces(post.surfaces) } : {}),
  ...(post.description ? { description: post.description } : {}),
  // Included components as they render now (server/instances.ts); `publishedWith`
  // is what this version rendered with when it was published.
  ...(opts.instances?.get(post.id)
    ? {
        instances: opts.instances.get(post.id)!.list,
        instancesKey: opts.instances.get(post.id)!.key,
      }
    : {}),
  ...(post.instances.length ? { publishedWith: post.instances } : {}),
  ...(post.forkedFrom ? { forkedFrom: post.forkedFrom } : {}),
  ...(post.copiedFrom ? { copiedFrom: post.copiedFrom } : {}),
  ...(opts.kept && isKeptAlternative(opts.kept, post) ? { kept: true } : {}),
  ...(post.acceptedVersion === undefined ? {} : { inUseVersion: post.acceptedVersion }),
  ...versionMarks(post, opts.design),
  ...(post.archiveReason ? { archiveReason: post.archiveReason } : {}),
  // The part names this alternative's own markup marks, so the viewer can tell
  // which alternatives render a part (Borrow) without the html bodies.
  parts: partsInSurfaces(post.surfaces).map((p) => p.name),
  surfaces: post.surfaces.map(opts.body ? fullSurfaceView : hydratedSurfaceView),
  ...(opts.history
    ? {
        history: [
          historyMetaView({
            version: post.version,
            title: post.title,
            surfaces: post.surfaces,
            at: post.updatedAt,
            ...(post.from === undefined ? {} : { from: post.from }),
            ...(post.prompt === undefined ? {} : { prompt: post.prompt }),
            ...(post.author === undefined ? {} : { author: post.author }),
            ...(post.amendedAt ? { amendedAt: post.amendedAt } : {}),
          }),
          ...[...post.history].sort((a, b) => b.version - a.version).map(historyMetaView),
        ].map((row) =>
          post.hiddenVersions?.includes(row.version) ? { ...row, hidden: true as const } : row,
        ),
      }
    : {}),
});

const stateOrder = (design: Design) => (design.states.length ? design.states : [null]);

// What the user put in use, per state, in the design's order; a state with
// nothing accepted is absent. Export and instances resolve to exactly these.
export const inUseByState = (design: Design, posts: PostHead[]) =>
  stateOrder(design).flatMap((state) => {
    const p = posts.find((x) => x.state === state && x.status === "accepted");
    return p ? [{ state, alternative: p.alternative, version: inUseVersion(p) }] : [];
  });

export interface StateParts {
  state: string | null;
  parts: PartInfo[];
}

// The parts the agent marked, per state, across the alternatives still in play.
export function partsByState(design: Design, posts: Post[]): StateParts[] {
  return stateOrder(design).map((state) => ({
    state,
    parts: mergeParts(
      posts
        .filter((p) => p.state === state && isLive(p.status))
        .map((p) => partsInSurfaces(p.surfaces)),
    ),
  }));
}

// Where a design sits in the product, its library group and the code that implements it, only once
// declared, so the views of a project that names neither cost nothing.
export const placeOf = (
  design: Pick<Design, "kind" | "area" | "group" | "source" | "variants">,
): { area?: string; shared?: true; group?: string; source?: string; variants?: true } => ({
  ...(design.variants ? { variants: true as const } : {}),
  ...(design.area ? { area: design.area } : {}),
  // A component of no area: the library's shared part.
  ...(isShared(design) ? { shared: true as const } : {}),
  ...(design.group ? { group: design.group } : {}),
  ...(design.source ? { source: design.source } : {}),
});

// What a design's first state looks like in a list: what's in use, else what the agent
// recommends, else its first. Same rule as viewer/src/logic.ts screenPicture.
function thumbnail(design: Design, all: PostHead[]) {
  const posts = shipped(design, all);
  const first = stateOrder(design)[0];
  const inState = posts.filter((p) => p.state === first);
  const recommended = recommendedAlternative(design.asks, first);
  const pick =
    inState.find((p) => p.status === "accepted") ??
    inState.find((p) => p.alternative === recommended && isLive(p.status)) ??
    inState.find((p) => p.status === "open") ??
    inState[0] ??
    posts[0];
  if (!pick) return null;
  const surface = pick.surfaces.findIndex((s) => isSandboxedSurfaceKind(s.kind));
  const version = shownVersion(design, pick);
  const poster = posterAt(pick, version);
  return {
    postId: pick.id,
    surface: Math.max(surface, 0),
    version,
    ...(poster ? { poster } : {}),
    ...(pick.rewrites ? { rewrites: pick.rewrites } : {}),
  };
}

// Only a plan says so, so the views of everything drawn are unchanged.
const plannedOf = (design: Design, alternatives: number) =>
  isPlanned(design, alternatives) ? { planned: true as const } : {};

// Anything the user has yet to send. A stored draft can be an emptied one, which
// waits on nobody.
export const draftHolds = (draft: Design["draft"]): boolean =>
  !!draft &&
  (draft.comments.length > 0 ||
    Object.values(draft.answers).some((a) => !Array.isArray(a) || a.length > 0) ||
    [draft.borrowed, draft.tuned, draft.others ?? {}, draft.askComments ?? {}].some(
      (rec) => Object.keys(rec).length > 0,
    ));

export const designSummaryView = (design: Design, posts: PostHead[]) => {
  const drafted = draftedCount(design);
  return {
    id: design.id,
    project: design.project,
    slug: design.slug,
    title: design.title,
    kind: design.kind,
    ...placeOf(design),
    ...plannedOf(design, posts.length),
    // Text comes with a read of the design; a list only says there is some to read.
    ...(design.spec ? { hasSpec: true as const } : {}),
    states: design.states,
    stateCount: Math.max(design.states.length, 1),
    alternatives: posts.length,
    open: openCount(design),
    // Only once the user has started one, so a list with no drafts costs nothing.
    ...(drafted === null ? {} : { drafted }),
    sessionId: design.sessionId,
    archivedAt: design.archivedAt,
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
    thumbnail: thumbnail(design, posts),
  };
};

// One design as anyone outside the viewer's own draft sees it: the draft is the
// user's unsent work and never leaves through this view.
export const designDetailView = (
  design: Design,
  all: Post[],
  opts: AlternativeViewOptions & {
    settled?: Record<string, KnobValue>;
    repliesGoTo?: string;
    // This design's lines of the decision list; absent where the read carries none.
    decisions?: string[];
    // The components it is built from, as their marks stand.
    builtFrom?: BuiltFrom[];
  } = {},
) => {
  const posts = shipped(design, all);
  return detailOf(design, posts, opts);
};

const detailOf = (
  design: Design,
  posts: Post[],
  opts: AlternativeViewOptions & {
    settled?: Record<string, KnobValue>;
    repliesGoTo?: string;
    decisions?: string[];
    builtFrom?: BuiltFrom[];
  },
) => ({
  id: design.id,
  project: design.project,
  slug: design.slug,
  title: design.title,
  kind: design.kind,
  ...placeOf(design),
  ...(design.shortlist ? { shortlist: true } : {}),
  // No agent has written to this shortlist yet: who its replies reach for now.
  ...(opts.repliesGoTo ? { repliesGoTo: opts.repliesGoTo } : {}),
  ...plannedOf(design, posts.length),
  states: design.states,
  ...readyFields(design, posts),
  // Undefined (left out of the JSON) when it includes nothing.
  builtFrom: opts.builtFrom?.length ? opts.builtFrom : undefined,
  ...specView(design.spec, opts.decisions),
  ...(Object.keys(design.stateOutlines).length ? { stateOutlines: design.stateOutlines } : {}),
  ...(design.answerAdditions.length ? { answerAdditions: design.answerAdditions } : {}),
  // With the alternatives each question chooses between added, as the user meets them.
  asks: design.asks.map((a) => withAddedAnswers(a, design, posts)),
  // By question id: the answers the user kept for later and hid, with why.
  ...(Object.keys(design.standings).length ? { standings: design.standings } : {}),
  ...(design.sets.length ? { sets: design.sets } : {}),
  open: openCount(design),
  knobs: design.knobs,
  widths: design.widths,
  sessionId: design.sessionId,
  archivedAt: design.archivedAt,
  ...(design.archiveReason ? { archiveReason: design.archiveReason } : {}),
  createdAt: design.createdAt,
  updatedAt: design.updatedAt,
  alternatives: ((kept) => posts.map((p) => alternativeView(p, { ...opts, kept, design })))(
    keptAlternatives(design, posts),
  ),
  inUse: inUseByState(design, posts),
  parts: partsByState(design, posts),
  // Every knob value the user has sent (answers' sets and tuning, later replies
  // winning), never drafts. Later questions render on top of it.
  settled: opts.settled ?? {},
});

export const sessionRowView = (session: Session, postCount: number) => ({
  ...session,
  postCount,
});

// One design as a node of the project tree (GET /api/projects/:name/tree): its
// alternatives per state with status and lineage, and the designs it includes (`instances`);
// `instanceIn` is filled in once every node is known.
// When it left the shelf: archived by hand, or with the last of its alternatives archived.
// Designs archived before the date was kept fall back on the design's last change.
function leftOf(design: Design, posts: PostHead[]): { leftAt?: string } {
  if (design.archivedAt) return { leftAt: design.archivedAt };
  if (!posts.length || posts.some((p) => isLive(p.status))) return {};
  const last = posts.reduce((t, p) => (p.archivedAt && p.archivedAt > t ? p.archivedAt : t), "");
  return { leftAt: last || design.updatedAt };
}

export const treeNodeView = (
  design: Design,
  all: PostHead[],
  extra: {
    settled: Record<string, KnobValue>;
    instances: string[];
    instanceViews: Map<string, InstanceView>;
    lastReplyAt?: string;
    // About half of a tree's bytes, and no screen of the viewer's reads them from one.
    noDescriptions?: boolean;
    // The viewer's alone: where the last Send stands, and a draft waiting to go.
    lastSend?: { sessionId: string; at: string; delivered: boolean; calledAt?: string };
    drafting?: boolean;
    // The components it is built from, nested ones included, as their marks stand.
    builtFrom?: BuiltFrom[];
  },
) => {
  const posts = shipped(design, all);
  return nodeOf(design, posts, extra);
};

const nodeOf = (design: Design, posts: PostHead[], extra: Parameters<typeof treeNodeView>[2]) => ({
  id: design.id,
  slug: design.slug,
  title: design.title,
  kind: design.kind,
  ...placeOf(design),
  ...(design.shortlist ? { shortlist: true } : {}),
  ...plannedOf(design, posts.length),
  ...readyFields(design, posts),
  builtFrom: extra.builtFrom?.length ? extra.builtFrom : undefined,
  // A component of one area that screens of several areas show, those areas.
  inAreas: undefined as string[] | undefined,
  open: openCount(design),
  // Any question ever asked, answered or not: it tells an idea from a document.
  ...(design.asks.length ? { asked: design.asks.length } : {}),
  // Later than every alternative: the user has spoken and it is the agent's turn.
  ...(extra.lastReplyAt ? { lastReplyAt: extra.lastReplyAt } : {}),
  ...(extra.lastSend ? { lastSend: extra.lastSend } : {}),
  ...(extra.drafting ? { drafting: true } : {}),
  states: stateOrder(design),
  widths: design.widths,
  createdAt: design.createdAt,
  updatedAt: design.updatedAt,
  archivedAt: design.archivedAt,
  ...leftOf(design, posts),
  ...(design.archiveReason ? { archiveReason: design.archiveReason } : {}),
  settled: extra.settled,
  instances: extra.instances,
  instanceIn: [] as string[],
  inUse: inUseByState(design, posts),
  // What the agent recommends where nothing is in use: a cover shows it.
  recommended: stateOrder(design).flatMap((state) => {
    const alternative = recommendedAlternative(design.asks, state);
    return alternative ? [{ state, alternative }] : [];
  }),
  alternatives: posts.map((p) => ({
    postId: p.id,
    state: p.state,
    alternative: p.alternative,
    status: alternativeStatus(p.status),
    version: p.version,
    updatedAt: p.updatedAt,
    ...(p.rewrites ? { rewrites: p.rewrites } : {}),
    surface: p.surfaces.findIndex((x) => isSandboxedSurfaceKind(x.kind)),
    ...posterOf(p.surfaces),
    ...inUsePoster(p),
    ...coverVersion(p, design),
    ...(p.description && !extra.noDescriptions ? { description: p.description } : {}),
    ...(p.forkedFrom ? { forkedFrom: p.forkedFrom } : {}),
    ...(p.acceptedVersion === undefined ? {} : { inUseVersion: p.acceptedVersion }),
    ...versionMarks(p, design),
    ...(p.archiveReason ? { archiveReason: p.archiveReason } : {}),
    ...(extra.instanceViews.get(p.id) ? { instancesKey: extra.instanceViews.get(p.id)!.key } : {}),
  })),
});

// Off the shelf: archived by hand, or drawn with nothing live left and no question
// waiting, Home's rule (`nothingLeft`). A plan has nothing live because nothing is
// drawn yet, which is not the same.
const offShelf = (design: Design, posts: PostHead[]) =>
  !!design.archivedAt ||
  (posts.length > 0 && !posts.some((p) => isLive(p.status)) && openCount(design) === 0);

const productLine = (design: Design, posts: PostHead[], builtFrom: BuiltFrom[]) => ({
  slug: design.slug,
  title: design.title,
  kind: design.kind,
  purpose: purposeLine(design.spec),
  // A design of one unnamed state has that one, null, as a read of it names it.
  states: stateOrder(design),
  ...readyFields(design, posts),
  builtFrom: builtFrom.length ? builtFrom : undefined,
});

// An idea's standing in a word, the same for the agent and the area page.
function ideaStatus(design: Design, posts: PostHead[]): string {
  const open = openCount(design);
  if (open) return `${open} question${open === 1 ? "" : "s"}`;
  if (posts.some((p) => p.status === "accepted")) return "in use";
  return "exploring";
}

// One area of a project, as `read --area` returns it and the viewer's area page draws
// it: what it is for, its screens, flows and components, the shared components beside
// them, what was decided on them, and the ideas waiting in it. Everything settled in
// one place, so an agent reads the area before drawing in it.
export function areaView(input: {
  project: string;
  description: Described | null;
  area: { name: string; description: string };
  designs: Design[];
  heads: Map<string, PostHead[]>;
  flows: { name: string; steps: FlowStep[] }[];
  lines: DecisionLine[];
  // By slug: the components each design is built from, as their marks stand.
  builtFrom: Map<string, BuiltFrom[]>;
}) {
  const live = input.designs.filter((d) => !offShelf(d, input.heads.get(d.id) ?? []));
  const here = live.filter((d) => d.area === input.area.name);
  const screens = here.filter((d) => d.kind === "screen");
  const components = here.filter((d) => d.kind === "component");
  const product = new Set([...screens, ...components].map((d) => d.slug));
  const kindOf = new Map(input.designs.map((d) => [d.slug, d]));
  const line = (d: Design) =>
    productLine(d, input.heads.get(d.id) ?? [], input.builtFrom.get(d.slug) ?? []);
  return {
    project: input.project,
    description: input.description?.text ?? null,
    area: { name: input.area.name, description: input.area.description || null },
    screens: screens.map(line),
    // A flow is in the area when one of its steps is.
    flows: input.flows
      .filter((f) => f.steps.some((x) => kindOf.get(x.design)?.area === input.area.name))
      .map((f) => ({ name: f.name, steps: f.steps })),
    components: components.map(line),
    shared: live
      .filter((d) => d.kind === "component" && !d.area)
      .map((d) => ({
        slug: d.slug,
        title: d.title,
        ...(d.group ? { group: d.group } : {}),
        purpose: purposeLine(d.spec),
      })),
    decisions: input.lines
      .filter((l) => !l.system && product.has(l.design))
      .map((l) => ({
        design: l.design,
        text: l.text,
        ...(l.state ? { state: l.state } : {}),
        ...(l.edited ? { edited: true as const } : {}),
      })),
    ideasWaiting: here
      .filter((d) => d.kind === "idea")
      .map((d) => ({
        slug: d.slug,
        title: d.title,
        status: ideaStatus(d, input.heads.get(d.id) ?? []),
      })),
  };
}

// A variants design's entries all ship, so an agent reads them as variants: the list
// (or its count) and each entry's name take that word, and the list says the rest. The
// viewer reads one shape for every design, with `variants: true` beside its list.
export function agentWords<T extends object>(view: T): T | Record<string, unknown> {
  const v = view as Record<string, unknown>;
  if (v.variants !== true) return view;
  const { alternatives, variants: _, ...rest } = v;
  const named = (e: unknown): unknown => {
    if (!e || typeof e !== "object") return e;
    const { alternative, forkedFrom, ...r } = e as Record<string, unknown>;
    const fork = forkedFrom as { alternative?: string; version: number } | undefined;
    return {
      ...r,
      ...(alternative === undefined ? {} : { variant: alternative }),
      ...(fork ? { forkedFrom: { variant: fork.alternative, version: fork.version } } : {}),
    };
  };
  return {
    ...rest,
    variants: Array.isArray(alternatives) ? alternatives.map(named) : alternatives,
  };
}
