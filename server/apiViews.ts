// Response shapes shared by every tier (REST, both MCP transports, the CLI), so
// one design reads the same however an agent asks for it.

import { slotKnobs, slotsInSurfaces } from "./fills.ts";
import type { Mode } from "./themes.ts";
import { mergeParts, type PartInfo, partsInSurfaces } from "./parts.ts";
import {
  changedTo,
  currentVersion,
  draftedCount,
  type Embed,
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
  recommendedVariant,
  type Session,
  SURFACE_CONTENT_FIELDS,
  type Surface,
  type SurfaceHead,
  variantStatus,
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
const otherMode = (s: { kind: string }, mode: Mode) => {
  const taken = (s as { posterMode?: Mode }).posterMode;
  return s.kind === "html" && taken !== undefined && taken !== mode;
};
const surfacesFor = <S extends { kind: string }>(surfaces: S[], mode: Mode): S[] =>
  surfaces.some((s) => otherMode(s, mode))
    ? surfaces.map((s) => {
        if (!otherMode(s, mode)) return s;
        const {
          poster: _poster,
          posterMode: _mode,
          ...rest
        } = s as S & {
          poster?: string;
          posterMode?: Mode;
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
): P[] =>
  posts.map((p) => {
    const surfaces = surfacesFor(p.surfaces, mode);
    const history = p.history.map((h) => {
      const own = surfacesFor(h.surfaces, mode);
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

// The poster of one version of a variant: what Home shows for it.
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

// The version Home shows when nothing is in use and the newest was hidden.
const coverVersion = (p: PostHead): { coverVersion?: number; coverPoster?: string } => {
  const at = currentVersion(p);
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

export interface VariantViewOptions {
  // Full surface bodies instead of refs (agent reads opt in; the viewer frames them).
  body?: boolean;
  // Version rows, newest first, current version included.
  history?: boolean;
  // What each post's embeds resolve to now, by post id.
  embeds?: Map<string, EmbedView>;
}

// A variant's embeds as they render now (nested ones included): each with the
// component's latest version and every version it has, for peeking back; and
// the key that changes whenever any of them does.
export interface EmbedView {
  key: string;
  list: (Embed & { latest: number; versions: number[] })[];
}

export const variantView = (post: Post, opts: VariantViewOptions = {}) => ({
  postId: post.id,
  state: post.state,
  variant: post.variant,
  status: variantStatus(post.status),
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
  // A part with fills is a select knob on its part (fills.ts); declared knobs win.
  ...(slotsInSurfaces(post.surfaces).length || post.knobs
    ? { knobs: { ...slotKnobs(slotsInSurfaces(post.surfaces)), ...post.knobs } }
    : {}),
  ...(slotsInSurfaces(post.surfaces).length ? { fills: slotsInSurfaces(post.surfaces) } : {}),
  ...(post.description ? { description: post.description } : {}),
  // Embedded components as they render now (server/embeds.ts); `publishedWith`
  // is what this version rendered with when it was published.
  ...(opts.embeds?.get(post.id)
    ? { embeds: opts.embeds.get(post.id)!.list, embedsKey: opts.embeds.get(post.id)!.key }
    : {}),
  ...(post.embeds.length ? { publishedWith: post.embeds } : {}),
  ...(post.forkedFrom ? { forkedFrom: post.forkedFrom } : {}),
  ...(post.copiedFrom ? { copiedFrom: post.copiedFrom } : {}),
  ...(post.starred ? { starred: true } : {}),
  ...(post.acceptedVersion === undefined ? {} : { inUseVersion: post.acceptedVersion }),
  ...(changedTo(post) === undefined ? {} : { changedTo: changedTo(post) }),
  ...(post.archiveReason ? { archiveReason: post.archiveReason } : {}),
  // The part names this variant's own markup marks, so the viewer can tell
  // which variants render a part (Borrow) without the html bodies.
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
// nothing accepted is absent. Export and embeds resolve to exactly these.
export const inUseByState = (design: Design, posts: PostHead[]) =>
  stateOrder(design).flatMap((state) => {
    const p = posts.find((x) => x.state === state && x.status === "accepted");
    return p ? [{ state, variant: p.variant, version: inUseVersion(p) }] : [];
  });

export interface StateParts {
  state: string | null;
  parts: PartInfo[];
}

// The parts the agent marked, per state, across the variants still in play.
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

// Where a design sits in the product and the code that implements it, only once
// declared, so the views of a project that names neither cost nothing.
export const placeOf = (
  design: Pick<Design, "area" | "source">,
): { area?: string; source?: string } => ({
  ...(design.area ? { area: design.area } : {}),
  ...(design.source ? { source: design.source } : {}),
});

// What a design's first state looks like in a list: what's in use, else what the agent
// recommends, else its first. Same rule as viewer/src/logic.ts screenPicture.
function thumbnail(design: Design, posts: PostHead[]) {
  const first = stateOrder(design)[0];
  const inState = posts.filter((p) => p.state === first);
  const recommended = recommendedVariant(design.asks, first);
  const pick =
    inState.find((p) => p.status === "accepted") ??
    inState.find((p) => p.variant === recommended && isLive(p.status)) ??
    inState.find((p) => p.status === "open") ??
    inState[0] ??
    posts[0];
  if (!pick) return null;
  const surface = pick.surfaces.findIndex((s) => isSandboxedSurfaceKind(s.kind));
  const version = currentVersion(pick);
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
const plannedOf = (design: Design, variants: number) =>
  isPlanned(design, variants) ? { planned: true as const } : {};

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
    ...(design.notes ? { hasNotes: true as const } : {}),
    states: design.states,
    stateCount: Math.max(design.states.length, 1),
    variants: posts.length,
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
  posts: Post[],
  opts: VariantViewOptions & { settled?: Record<string, KnobValue>; repliesGoTo?: string } = {},
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
  ...(design.notes ? { notes: design.notes } : {}),
  ...(Object.keys(design.stateOutlines).length ? { stateOutlines: design.stateOutlines } : {}),
  ...(design.answerAdditions.length ? { answerAdditions: design.answerAdditions } : {}),
  asks: design.asks,
  open: openCount(design),
  knobs: design.knobs,
  widths: design.widths,
  sessionId: design.sessionId,
  archivedAt: design.archivedAt,
  ...(design.archiveReason ? { archiveReason: design.archiveReason } : {}),
  createdAt: design.createdAt,
  updatedAt: design.updatedAt,
  variants: posts.map((p) => variantView(p, opts)),
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
// variants per state with status and lineage, and the designs it embeds (`embeds`);
// `embeddedIn` is filled in once every node is known.
// When it left the shelf: archived by hand, or with the last of its variants archived.
// Designs archived before the date was kept fall back on the design's last change.
function leftOf(design: Design, posts: PostHead[]): { leftAt?: string } {
  if (design.archivedAt) return { leftAt: design.archivedAt };
  if (!posts.length || posts.some((p) => isLive(p.status))) return {};
  const last = posts.reduce((t, p) => (p.archivedAt && p.archivedAt > t ? p.archivedAt : t), "");
  return { leftAt: last || design.updatedAt };
}

export const treeNodeView = (
  design: Design,
  posts: PostHead[],
  extra: {
    settled: Record<string, KnobValue>;
    embeds: string[];
    embedViews: Map<string, EmbedView>;
    lastReplyAt?: string;
    // About half of a tree's bytes, and no screen of the viewer's reads them from one.
    noDescriptions?: boolean;
    // The viewer's alone: where the last Send stands, and a draft waiting to go.
    lastSend?: { sessionId: string; at: string; delivered: boolean; calledAt?: string };
    drafting?: boolean;
  },
) => ({
  id: design.id,
  slug: design.slug,
  title: design.title,
  kind: design.kind,
  ...placeOf(design),
  ...(design.shortlist ? { shortlist: true } : {}),
  ...plannedOf(design, posts.length),
  open: openCount(design),
  // Any question ever asked, answered or not: it tells an idea from a document.
  ...(design.asks.length ? { asked: design.asks.length } : {}),
  // Later than every variant: the user has spoken and it is the agent's turn.
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
  embeds: extra.embeds,
  embeddedIn: [] as string[],
  inUse: inUseByState(design, posts),
  // What the agent recommends where nothing is in use: a cover shows it.
  recommended: stateOrder(design).flatMap((state) => {
    const variant = recommendedVariant(design.asks, state);
    return variant ? [{ state, variant }] : [];
  }),
  variants: posts.map((p) => ({
    postId: p.id,
    state: p.state,
    variant: p.variant,
    status: variantStatus(p.status),
    version: p.version,
    updatedAt: p.updatedAt,
    ...(p.rewrites ? { rewrites: p.rewrites } : {}),
    surface: p.surfaces.findIndex((x) => isSandboxedSurfaceKind(x.kind)),
    ...posterOf(p.surfaces),
    ...inUsePoster(p),
    ...coverVersion(p),
    ...(p.description && !extra.noDescriptions ? { description: p.description } : {}),
    ...(p.forkedFrom ? { forkedFrom: p.forkedFrom } : {}),
    ...(p.starred ? { starred: true } : {}),
    ...(p.acceptedVersion === undefined ? {} : { inUseVersion: p.acceptedVersion }),
    ...(changedTo(p) === undefined ? {} : { changedTo: changedTo(p) }),
    ...(p.archiveReason ? { archiveReason: p.archiveReason } : {}),
    ...(extra.embedViews.get(p.id) ? { embedsKey: extra.embedViews.get(p.id)!.key } : {}),
  })),
});
