// Project › item › variant › version state: the data layer the reshaped viewer
// renders from. Types are declared here rather than imported from
// `server/types.ts` so the viewer reads the wire defensively — an older server
// (or one mid-migration) simply omits fields, and the screens degrade instead of
// throwing.
import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { api, layoutMode } from "./api.ts";
import { host, type Route } from "./host.ts";
import { isConnectRoute, onFeedEvent } from "./state.ts";

export type ItemKind = "component" | "page";
export type PostStatus = "open" | "accepted" | "archived";

export interface Ask {
  text: string;
  at: string;
}

export interface Slot {
  slug: string;
  variant: string;
  version: number;
}

export interface ProjectSummary {
  name: string;
  items: number;
  waiting: number;
  lastActiveAt: string;
  sessions: number;
  agent?: string | null;
}

export interface VersionMeta {
  version: number;
  // The server names this `at`; `createdAt` is accepted too so an older
  // response still dates the row.
  at?: string;
  createdAt?: string;
  title?: string;
  from?: number;
  prompt?: string;
  author?: string;
}

export const versionAt = (entry: VersionMeta): string | undefined => entry.at ?? entry.createdAt;

export interface VariantSummary {
  postId: string;
  variant: string;
  version: number;
  status: PostStatus;
  ask: Ask | null;
  updatedAt: string;
}

export interface ViewerSurfaceRef {
  kind: string;
  index?: number;
  [key: string]: unknown;
}

export interface VariantDetail extends VariantSummary {
  title?: string;
  sessionId?: string;
  surfaces?: ViewerSurfaceRef[];
  history?: VersionMeta[];
  slots?: Slot[];
}

export interface ItemSummary {
  project: string;
  slug: string;
  kind: ItemKind;
  title: string;
  variants: VariantSummary[];
  waiting: boolean;
  updatedAt: string;
}

export interface ItemDetail extends ItemSummary {
  variants: VariantDetail[];
}

export interface Anchor {
  ref: string;
  shape: "pin" | "rect" | "circle";
  box: number[];
  surfaceIndex: number;
  postVersion: number;
  path?: string;
  text?: string;
  viewport?: number;
}

export interface ItemComment {
  id: string;
  seq: number;
  sessionId: string;
  postId: string | null;
  author: string;
  text: string;
  createdAt: string;
  kind?: string;
  anchors?: Anchor[];
  draft?: boolean;
  seen?: boolean;
  postVersion?: number | null;
  viewport?: number | null;
  pending?: boolean;
}

// --- stores ---------------------------------------------------------------

const [projectsStore, setProjects] = createStore<ProjectSummary[]>([]);
export const projects = projectsStore;
const [itemsStore, setItems] = createStore<ItemSummary[]>([]);
export const items = itemsStore;

const [itemState, setItemState] = createSignal<ItemDetail | null>(null);
export const item = itemState;

const [projectState, setProjectState] = createSignal<string | null>(null);
export const currentProject = projectState;
const [slugState, setSlugState] = createSignal<string | null>(null);
export const currentSlug = slugState;
const [variantState, setVariantState] = createSignal<string | null>(null);
export const currentVariant = variantState;
// The version being BROWSED. null means "the variant's current version".
const [viewVersionState, setViewVersionState] = createSignal<number | null>(null);
export const viewVersion = viewVersionState;

const [projectsLoadedState, setProjectsLoaded] = createSignal(false);
export const projectsLoaded = projectsLoadedState;
const [itemsLoadingState, setItemsLoading] = createSignal(false);
export const itemsLoading = itemsLoadingState;
const [itemLoadingState, setItemLoading] = createSignal(false);
export const itemLoading = itemLoadingState;
// Set when a read fails: drives the "Can't reach mockpit" banner. The last
// successfully loaded data stays on screen behind it.
const [offlineState, setOffline] = createSignal(false);
export const offline = offlineState;

const [commentsState, setComments] = createSignal<ItemComment[]>([]);
export const itemComments = commentsState;

// --- derived --------------------------------------------------------------

export function visibleVariants(detail: ItemDetail | null): VariantDetail[] {
  return (detail?.variants ?? []).filter((v) => v.status !== "archived");
}

export function archivedVariants(detail: ItemDetail | null): VariantDetail[] {
  return (detail?.variants ?? []).filter((v) => v.status === "archived");
}

export function selectedVariant(): VariantDetail | null {
  const detail = itemState();
  if (!detail || detail.variants.length === 0) return null;
  const name = variantState();
  const byName = name ? detail.variants.find((v) => v.variant === name) : undefined;
  if (byName) return byName;
  // No variant in the route: open the one the agent is waiting on, else the most
  // recently published — never an arbitrary first row.
  const open = visibleVariants(detail);
  const asked = open.find((v) => v.ask);
  const recent = [...open].sort((a, b) =>
    String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
  )[0];
  return asked ?? recent ?? detail.variants[0];
}

// The version on the stage: the browsed one when it exists in history, else the
// variant's current version.
export function stageVersion(): number {
  const variant = selectedVariant();
  if (!variant) return 1;
  const browsed = viewVersionState();
  if (browsed && browsed >= 1 && browsed <= variant.version) return browsed;
  return variant.version;
}

export function historyEntries(variant: VariantDetail | null): VersionMeta[] {
  if (!variant) return [];
  const rows = [...(variant.history ?? [])];
  if (!rows.some((r) => r.version === variant.version)) {
    rows.push({ version: variant.version, at: variant.updatedAt });
  }
  return rows.sort((a, b) => b.version - a.version);
}

// --- fetching -------------------------------------------------------------

async function read<T>(path: string): Promise<T | null> {
  try {
    const value = await api<T>(path);
    setOffline(false);
    return value;
  } catch {
    setOffline(true);
    return null;
  }
}

export async function refreshProjects(): Promise<void> {
  const rows = await read<ProjectSummary[]>("/api/projects");
  if (rows) setProjects(reconcile(rows, { key: "name" }));
  setProjectsLoaded(true);
}

export async function refreshItems(project: string): Promise<void> {
  setItemsLoading(itemsStore.length === 0);
  const rows = await read<ItemSummary[]>(`/api/projects/${encodeURIComponent(project)}/items`);
  if (rows && projectState() === project) setItems(reconcile(rows, { key: "slug" }));
  setItemsLoading(false);
}

export async function refreshItem(project: string, slug: string): Promise<void> {
  setItemLoading(itemState()?.slug !== slug);
  const detail = await read<ItemDetail>(
    `/api/projects/${encodeURIComponent(project)}/items/${encodeURIComponent(slug)}`,
  );
  setItemLoading(false);
  if (!detail || projectState() !== project || slugState() !== slug) return;
  setItemState(detail);
  const variant = selectedVariant();
  if (variant) await refreshComments(variant.postId);
}

export async function refreshComments(postId: string): Promise<void> {
  // `surface` is the legacy wire key for a post id; viewer reads carry drafts
  // and the per-comment `seen` flag.
  const res = await read<{ comments: ItemComment[] }>(
    `/api/comments?surface=${encodeURIComponent(postId)}&includeDrafts=1`,
  );
  if (!res) return;
  const current = selectedVariant();
  if (current && current.postId !== postId) return;
  setComments(res.comments ?? []);
}

// --- navigation -----------------------------------------------------------

export function openProjects(): void {
  host().router.navigate({ project: null, slug: null });
}

export function openProject(name: string): void {
  host().router.navigate({ project: name });
}

export function openItem(project: string, slug: string, variant?: string | null): void {
  host().router.navigate({ project, slug, variant: variant ?? null });
}

export function selectVariant(variant: string): void {
  const project = projectState();
  const slug = slugState();
  if (!project || !slug) return;
  host().router.navigate({ project, slug, variant }, { replace: true });
}

export function browseVersion(version: number | null): void {
  const project = projectState();
  const slug = slugState();
  if (!project || !slug) return;
  host().router.navigate({ project, slug, variant: variantState(), version }, { replace: true });
}

// --- writes ---------------------------------------------------------------

export type DecisionKind = "accept" | "revise" | "drop";

export async function decide(
  postId: string,
  kind: DecisionKind,
  text?: string,
): Promise<string | null> {
  try {
    await api(`/api/posts/${encodeURIComponent(postId)}/decision`, {
      method: "POST",
      body: JSON.stringify({ kind, ...(text ? { text } : {}) }),
    });
    await reloadCurrent();
    return null;
  } catch (err) {
    return err instanceof Error && err.message ? err.message : "network error";
  }
}

export async function restoreVariant(postId: string): Promise<string | null> {
  try {
    await api(`/api/posts/${encodeURIComponent(postId)}/restore`, { method: "POST" });
    await reloadCurrent();
    return null;
  } catch (err) {
    return err instanceof Error && err.message ? err.message : "network error";
  }
}

export interface CommentDraft {
  postId: string;
  text: string;
  anchors: Anchor[];
  postVersion: number;
  viewport: number;
  draft?: boolean;
}

// Optimistic echo, then the real row — a user comment must never disappear on a
// slow network. Returns an error message, or null on success.
let localSeq = 0;
export async function postComment(input: CommentDraft): Promise<string | null> {
  const local: ItemComment = {
    id: `local-${++localSeq}`,
    seq: 0,
    sessionId: "",
    postId: input.postId,
    author: "user",
    text: input.text,
    createdAt: new Date().toISOString(),
    kind: "comment",
    anchors: input.anchors,
    draft: !!input.draft,
    seen: false,
    postVersion: input.postVersion,
    viewport: input.viewport,
    pending: true,
  };
  setComments((prev) => [...prev, local]);
  try {
    const created = await api<ItemComment>("/api/comments", {
      method: "POST",
      body: JSON.stringify({
        surface: input.postId,
        text: input.text,
        author: "user",
        kind: "comment",
        anchors: input.anchors,
        draft: !!input.draft,
        postVersion: input.postVersion,
        viewport: input.viewport,
      }),
    });
    setComments((prev) => prev.map((c) => (c.id === local.id ? { ...created } : c)));
    return null;
  } catch (err) {
    setComments((prev) => prev.filter((c) => c.id !== local.id));
    return err instanceof Error && err.message ? err.message : "network error";
  }
}

export async function reloadCurrent(): Promise<void> {
  if (streamMode()) {
    await loadStreamRoute(host().router.get());
    return;
  }
  const project = projectState();
  const slug = slugState();
  if (project) await refreshItems(project);
  if (project && slug) await refreshItem(project, slug);
  await refreshProjects();
}

// --- routing --------------------------------------------------------------

// A post as the detail route returns it — the only read a session-scoped
// public workspace exposes, so stream mode builds the item screen out of these.
interface PostDetail {
  id: string;
  sessionId: string;
  title?: string;
  project?: string;
  slug?: string;
  kind?: ItemKind;
  variant?: string;
  status?: PostStatus;
  ask?: Ask | null;
  slots?: Slot[];
  surfaces?: ViewerSurfaceRef[];
  history?: VersionMeta[];
  version: number;
  updatedAt: string;
}

// Deprecated `layout: "stream"` (and the self-hosted session-scoped public-read
// link it maps to): one item, no navigation columns, resolved from the route's
// session/post instead of /api/projects — which that workspace does not expose.
export function streamMode(): boolean {
  return layoutMode() === "stream";
}

function variantFromPost(post: PostDetail): VariantDetail {
  return {
    postId: post.id,
    variant: post.variant ?? "default",
    version: post.version,
    status: post.status ?? "open",
    ask: post.ask ?? null,
    updatedAt: post.updatedAt,
    title: post.title,
    sessionId: post.sessionId,
    surfaces: post.surfaces,
    history: post.history,
    slots: post.slots,
  };
}

function itemFromPosts(posts: PostDetail[], pick: PostDetail): ItemDetail {
  const variants = posts.map(variantFromPost);
  return {
    project: pick.project ?? "",
    slug: pick.slug ?? pick.id,
    kind: pick.kind ?? "component",
    title: pick.title ?? pick.slug ?? "",
    variants,
    waiting: variants.some((v) => !!v.ask),
    updatedAt: pick.updatedAt,
  };
}

const identity = (post: PostDetail) => `${post.project ?? ""}/${post.slug ?? post.id}`;
// A session's posts are few (one agent conversation), and only the ones sharing
// the focused item's identity end up on screen — but the slug lives in the
// detail, so they are read before they can be grouped. Bound it anyway.
const STREAM_POST_LIMIT = 24;

async function loadStreamRoute(route: Route): Promise<void> {
  const focus = route.surfaceId
    ? await read<PostDetail>(`/api/posts/${encodeURIComponent(route.surfaceId)}`)
    : null;
  const sessionId = route.sessionId ?? focus?.sessionId ?? null;
  let posts: PostDetail[] = focus ? [focus] : [];
  if (sessionId) {
    const rows = await read<{ id: string }[]>(
      `/api/sessions/${encodeURIComponent(sessionId)}/posts`,
    );
    if (rows) {
      const details = await Promise.all(
        rows.slice(-STREAM_POST_LIMIT).map((row) => read<PostDetail>(`/api/posts/${row.id}`)),
      );
      posts = details.filter((d): d is PostDetail => !!d);
    }
  }
  if (posts.length === 0) return;
  const pick =
    (focus && posts.find((p) => p.id === focus.id)) ??
    [...posts].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  const group = posts.filter((p) => identity(p) === identity(pick));
  setProjectState(pick.project ?? null);
  setSlugState(pick.slug ?? pick.id);
  setVariantState(route.variant ?? pick.variant ?? null);
  setViewVersionState(route.version ?? null);
  setItemState(itemFromPosts(group, pick));
  // Nothing will ever load the projects list here, so mark it settled rather
  // than leaving the screen on its skeleton forever.
  setProjectsLoaded(true);
  const variant = selectedVariant();
  if (variant) await refreshComments(variant.postId);
}

// Resolve a legacy `/session/:id[/p/:postId]` link onto the item screen by
// reading the post's project + slug. Falls back to the projects view when the
// post (or session) no longer exists.
export async function resolveSessionRoute(route: Route): Promise<void> {
  if (streamMode()) {
    await loadStreamRoute(route);
    return;
  }
  // The session post LIST rows are the legacy shape (no project/slug), so the
  // item coordinates always come from a detail read.
  let postId = route.surfaceId ?? null;
  if (!postId && route.sessionId) {
    const rows = await read<{ id: string }[]>(
      `/api/sessions/${encodeURIComponent(route.sessionId)}/posts`,
    );
    postId = rows && rows.length > 0 ? rows[rows.length - 1].id : null;
  }
  const post = postId ? await read<PostDetail>(`/api/posts/${encodeURIComponent(postId)}`) : null;
  if (post?.project && post.slug) {
    host().router.navigate(
      { project: post.project, slug: post.slug, variant: post.variant ?? null },
      { replace: true },
    );
    return;
  }
  await autoOpenProject({ replace: true });
}

// `/` opens the most recent project — the workspace's live edge, so the viewer
// never lands on a chooser when there is an obvious answer.
async function autoOpenProject(opts?: { replace?: boolean }): Promise<void> {
  // /connect is a page of its own — never pull the user off it into a project.
  if (isConnectRoute()) return;
  // The host owns its own project-less landing: stay on the projects list.
  if (host().homeView) {
    if (!projectsLoadedState()) await refreshProjects();
    return;
  }
  if (!projectsLoadedState()) await refreshProjects();
  const recent = [...projectsStore].sort((a, b) =>
    String(b.lastActiveAt ?? "").localeCompare(String(a.lastActiveAt ?? "")),
  )[0];
  if (recent) host().router.navigate({ project: recent.name }, { replace: opts?.replace });
}

export async function applyProjectRoute(route: Route): Promise<void> {
  if (streamMode()) {
    await loadStreamRoute(route);
    return;
  }
  if (route.sessionId || (route.surfaceId && !route.project)) return; // handled elsewhere
  const project = route.project ?? null;
  const slug = route.slug ?? null;
  const sameItem = project === projectState() && slug === slugState();
  const sameVariant = sameItem && (route.variant ?? null) === variantState();
  setProjectState(project);
  setSlugState(slug);
  setVariantState(route.variant ?? null);
  setViewVersionState(route.version ?? null);
  if (!sameItem) {
    if (!slug) setItemState(null);
    setComments([]);
  }
  // Browsing history only changes which version the stage renders — no refetch.
  if (sameVariant && project && slug && itemState()) return;
  if (!projectsLoadedState()) await refreshProjects();
  if (!project) {
    await autoOpenProject({ replace: true });
    return;
  }
  await refreshItems(project);
  if (slug) await refreshItem(project, slug);
}

export async function bootstrapProjects(): Promise<void> {
  const route = host().router.get();
  if (streamMode()) {
    await loadStreamRoute(route);
    return;
  }
  if (route.sessionId || (route.surfaceId && !route.project)) {
    await resolveSessionRoute(route);
    return;
  }
  await applyProjectRoute(route);
}

// Live updates: refetch the current list/item rather than rebuilding cards, so
// the stage iframes stay mounted (and lazily sized) across an agent's publish.
let pending: ReturnType<typeof setTimeout> | undefined;
onFeedEvent((event) => {
  if (event.type === "theme-changed") return;
  if (pending !== undefined) return;
  pending = setTimeout(() => {
    pending = undefined;
    void reloadCurrent();
    const variant = selectedVariant();
    if (variant) void refreshComments(variant.postId);
  }, 120);
});

// Retry loop for the offline banner: the copy promises a retry every 4s, so do
// exactly that until a read succeeds.
export function retryNow(): void {
  void reloadCurrent();
}

let retryTimer: ReturnType<typeof setInterval> | undefined;
export function startOfflineRetry(): () => void {
  retryTimer = setInterval(() => {
    if (offlineState()) retryNow();
  }, 4000);
  return () => clearInterval(retryTimer);
}
