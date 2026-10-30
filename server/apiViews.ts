// Response shapes shared by every tier (REST, both MCP transports, the CLI), so
// one mock reads the same however an agent asks for it.

import { slotKnobs, slotsInSurfaces } from "./fills.ts";
import { mergeParts, type PartInfo, partsInSurfaces } from "./parts.ts";
import {
  draftedCount,
  type Embed,
  inUseVersion,
  isSandboxedSurfaceKind,
  isLive,
  type KnobValue,
  type Mock,
  momentsOf,
  openCount,
  type Post,
  type PostVersion,
  type Session,
  SURFACE_CONTENT_FIELDS,
  type Surface,
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

// One past version without its bodies: enough to list versions or pick one to
// fetch, at a bounded cost.
export const historyMetaView = (version: PostVersion) => ({
  version: version.version,
  title: version.title,
  at: version.at,
  ...(version.from === undefined ? {} : { from: version.from }),
  ...(version.prompt ? { prompt: version.prompt } : {}),
  ...(version.author === undefined ? {} : { author: version.author }),
  surfaceKinds: version.surfaces.map((s) => s.kind),
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
  // A part with fills is a select knob on its part (fills.ts); declared knobs win.
  ...(slotsInSurfaces(post.surfaces).length || post.knobs
    ? { knobs: { ...slotKnobs(slotsInSurfaces(post.surfaces)), ...post.knobs } }
    : {}),
  ...(slotsInSurfaces(post.surfaces).length ? { fills: slotsInSurfaces(post.surfaces) } : {}),
  ...(post.note ? { note: post.note } : {}),
  // Embedded components as they render now (server/embeds.ts); `publishedWith`
  // is what this version rendered with when it was published.
  ...(opts.embeds?.get(post.id)
    ? { embeds: opts.embeds.get(post.id)!.list, embedsKey: opts.embeds.get(post.id)!.key }
    : {}),
  ...(post.embeds.length ? { publishedWith: post.embeds } : {}),
  ...(post.forkedFrom ? { forkedFrom: post.forkedFrom } : {}),
  ...(post.starred ? { starred: true } : {}),
  ...(post.acceptedVersion === undefined ? {} : { inUseVersion: post.acceptedVersion }),
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
          }),
          ...[...post.history].sort((a, b) => b.version - a.version).map(historyMetaView),
        ].map((row) =>
          post.hiddenVersions?.includes(row.version) ? { ...row, hidden: true as const } : row,
        ),
      }
    : {}),
});

const stateOrder = (mock: Mock) => (mock.states.length ? mock.states : [null]);

// What the user put in use, per state, in the mock's order; a state with
// nothing accepted is absent. Export and embeds resolve to exactly these.
export const inUseByState = (mock: Mock, posts: Post[]) =>
  stateOrder(mock).flatMap((state) => {
    const p = posts.find((x) => x.state === state && x.status === "accepted");
    return p ? [{ state, variant: p.variant, version: inUseVersion(p) }] : [];
  });

export interface StateParts {
  state: string | null;
  parts: PartInfo[];
}

// The parts the agent marked, per state, across the variants still in play.
export function partsByState(mock: Mock, posts: Post[]): StateParts[] {
  return stateOrder(mock).map((state) => ({
    state,
    parts: mergeParts(
      posts
        .filter((p) => p.state === state && isLive(p.status))
        .map((p) => partsInSurfaces(p.surfaces)),
    ),
  }));
}

// Where a mock sits in the product and the code that implements it, only once
// declared, so the views of a project that names neither cost nothing.
export const placeOf = (
  mock: Pick<Mock, "area" | "source">,
): { area?: string; source?: string } => ({
  ...(mock.area ? { area: mock.area } : {}),
  ...(mock.source ? { source: mock.source } : {}),
});

// What Home shows for a mock: the first state's chosen (else first) variant.
function thumbnail(mock: Mock, posts: Post[]) {
  const first = stateOrder(mock)[0];
  const inState = posts.filter((p) => p.state === first);
  const pick =
    inState.find((p) => p.status === "accepted") ??
    inState.find((p) => p.status === "open") ??
    inState[0] ??
    posts[0];
  if (!pick) return null;
  const surface = pick.surfaces.findIndex((s) => isSandboxedSurfaceKind(s.kind));
  return { postId: pick.id, surface: Math.max(surface, 0), version: inUseVersion(pick) };
}

// A mock's situations, only once it has any, so the views of mocks without
// them are unchanged.
const situationsOf = (mock: Mock) =>
  Object.keys(mock.situations).length ? { situations: mock.situations } : {};

export const mockSummaryView = (mock: Mock, posts: Post[]) => {
  const drafted = draftedCount(mock, posts);
  return {
    id: mock.id,
    project: mock.project,
    slug: mock.slug,
    title: mock.title,
    kind: mock.kind,
    ...placeOf(mock),
    states: mock.states,
    ...situationsOf(mock),
    stateCount: Math.max(momentsOf(mock.states, mock.situations).length, 1),
    variants: posts.length,
    open: openCount(mock, posts),
    // Only once the user has started one, so a list with no drafts costs nothing.
    ...(drafted === null ? {} : { drafted }),
    sessionId: mock.sessionId,
    closedAt: mock.closedAt,
    createdAt: mock.createdAt,
    updatedAt: mock.updatedAt,
    thumbnail: thumbnail(mock, posts),
  };
};

// One mock as anyone outside the viewer's own draft sees it: the draft is the
// user's unsent work and never leaves through this view.
export const mockDetailView = (
  mock: Mock,
  posts: Post[],
  opts: VariantViewOptions & { settled?: Record<string, KnobValue> } = {},
) => ({
  id: mock.id,
  project: mock.project,
  slug: mock.slug,
  title: mock.title,
  kind: mock.kind,
  ...placeOf(mock),
  states: mock.states,
  ...situationsOf(mock),
  asks: mock.asks,
  open: openCount(mock, posts),
  knobs: mock.knobs,
  widths: mock.widths,
  sessionId: mock.sessionId,
  closedAt: mock.closedAt,
  createdAt: mock.createdAt,
  updatedAt: mock.updatedAt,
  variants: posts.map((p) => variantView(p, opts)),
  inUse: inUseByState(mock, posts),
  parts: partsByState(mock, posts),
  // Every knob value the user has sent (answers' sets and tuning, later replies
  // winning), never drafts. Later questions render on top of it.
  settled: opts.settled ?? {},
});

export const sessionRowView = (session: Session, postCount: number) => ({
  ...session,
  postCount,
});

// One mock as a node of the project tree (GET /api/projects/:name/tree): its
// variants per state with status and lineage, and the mocks it embeds (`embeds`);
// `embeddedIn` is filled in once every node is known.
export const treeNodeView = (
  mock: Mock,
  posts: Post[],
  extra: {
    settled: Record<string, KnobValue>;
    embeds: string[];
    embedViews: Map<string, EmbedView>;
  },
) => ({
  id: mock.id,
  slug: mock.slug,
  title: mock.title,
  kind: mock.kind,
  ...placeOf(mock),
  open: openCount(mock, posts),
  // Home shows a mock's states, never their situations.
  states: mock.states.length ? momentsOf(mock.states, mock.situations) : [null],
  widths: mock.widths,
  createdAt: mock.createdAt,
  updatedAt: mock.updatedAt,
  closedAt: mock.closedAt,
  settled: extra.settled,
  embeds: extra.embeds,
  embeddedIn: [] as string[],
  inUse: inUseByState(mock, posts),
  variants: posts.map((p) => ({
    postId: p.id,
    state: p.state,
    variant: p.variant,
    status: variantStatus(p.status),
    version: p.version,
    updatedAt: p.updatedAt,
    surface: p.surfaces.findIndex((x) => isSandboxedSurfaceKind(x.kind)),
    ...(p.note ? { note: p.note } : {}),
    ...(p.forkedFrom ? { forkedFrom: p.forkedFrom } : {}),
    ...(p.starred ? { starred: true } : {}),
    ...(p.acceptedVersion === undefined ? {} : { inUseVersion: p.acceptedVersion }),
    ...(extra.embedViews.get(p.id) ? { embedsKey: extra.embedViews.get(p.id)!.key } : {}),
  })),
});
