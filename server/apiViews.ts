// Response shapes shared by every tier (REST, both MCP transports, the CLI), so
// one mock reads the same however an agent asks for it.

import { slotKnobs, slotsInSurfaces } from "./fills.ts";
import { mergeParts, type PartInfo, partsInSurfaces } from "./parts.ts";
import {
  isSandboxedSurfaceKind,
  draftedCount,
  isLive,
  type KnobValue,
  type Mock,
  openCount,
  type Post,
  type PostVersion,
  type Session,
  SURFACE_CONTENT_FIELDS,
  type Surface,
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
}

export const variantView = (post: Post, opts: VariantViewOptions = {}) => ({
  postId: post.id,
  state: post.state,
  variant: post.variant,
  status: post.status,
  version: post.version,
  title: post.title,
  sessionId: post.sessionId,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  ...(post.from === undefined ? {} : { from: post.from }),
  ...(post.prompt ? { prompt: post.prompt } : {}),
  ...(post.author === undefined ? {} : { author: post.author }),
  // A slot is a select knob on its part (fills.ts); declared knobs win.
  ...(slotsInSurfaces(post.surfaces).length || post.knobs
    ? { knobs: { ...slotKnobs(slotsInSurfaces(post.surfaces)), ...post.knobs } }
    : {}),
  ...(slotsInSurfaces(post.surfaces).length ? { slots: slotsInSurfaces(post.surfaces) } : {}),
  ...(post.note ? { note: post.note } : {}),
  // Component mocks embedded in a page (server/embeds.ts).
  ...(post.embeds.length ? { embeds: post.embeds } : {}),
  // The part names this variant's own markup marks, so the viewer can tell
  // which looks render a part (Mix) without the html bodies.
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
        ],
      }
    : {}),
});

const stateOrder = (mock: Mock) => (mock.states.length ? mock.states : [null]);

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
  return { postId: pick.id, surface: Math.max(surface, 0), version: pick.version };
}

export const mockSummaryView = (mock: Mock, posts: Post[]) => {
  const drafted = draftedCount(mock, posts);
  return {
    id: mock.id,
    project: mock.project,
    slug: mock.slug,
    title: mock.title,
    kind: mock.kind,
    states: mock.states,
    stateCount: Math.max(mock.states.length, 1),
    variants: posts.length,
    open: openCount(mock, posts),
    // Only once the user has started one, so a list with no drafts costs nothing.
    ...(drafted === null ? {} : { drafted }),
    sessionId: mock.sessionId,
    resolvedAt: mock.resolvedAt,
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
  states: mock.states,
  asks: mock.asks,
  open: openCount(mock, posts),
  knobs: mock.knobs,
  widths: mock.widths,
  sessionId: mock.sessionId,
  resolvedAt: mock.resolvedAt,
  createdAt: mock.createdAt,
  updatedAt: mock.updatedAt,
  variants: posts.map((p) => variantView(p, opts)),
  parts: partsByState(mock, posts),
  // Every knob value the user has sent (answers' sets and tuning, later replies
  // winning), never drafts. Later questions render on top of it.
  settled: opts.settled ?? {},
});

export const sessionRowView = (session: Session, postCount: number) => ({
  ...session,
  postCount,
});
