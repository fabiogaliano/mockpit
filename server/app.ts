import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { decodeBase64 } from "./base64.ts";
import {
  postDetailView,
  postWriteView,
  recentPostRowView,
  sessionPostHydratedView,
  sessionPostListRowView,
  sessionRowView,
  viewerPostView,
} from "./apiViews.ts";
import { EventBus, type FeedEvent } from "./events.ts";
import { buildFeedbackBatches, type FeedbackBatch } from "./feedbackBatch.ts";
import { kitSummaries } from "./kits.ts";
import {
  addHook,
  addSubscription,
  type Hook,
  type HookEvent,
  isPushSubscription,
  listHooks,
  type NotifyPayload,
  notify,
  removeHook,
  vapidKeys,
} from "./push.ts";
import { expandSlots, parseSlotTags } from "./slots.ts";
import { registerMcp } from "./mcpHttp.ts";
import { postToMarkdown } from "./postMarkdown.ts";
import {
  escapeHtml,
  renderHtmlPage,
  renderMermaidPage,
  renderSandboxedPart,
  STATIC_ASSET_PREFIX,
  staticAsset,
} from "./surfacePage.ts";
import { DEFAULT_THEME_ID, type Mode, themeById, themeOptions } from "./themes.ts";
import {
  type Anchor,
  type Asset,
  type AssetKind,
  type CodeSurface,
  type Comment,
  type CommentAnchor,
  type CommentKind,
  DEFAULT_PROJECT,
  DEFAULT_VARIANT,
  type DesignSettings,
  type DiffSurface,
  htmlSurface,
  isSandboxedSurfaceKind,
  type ItemKind,
  newId,
  projectFromCwd,
  reservedAgent,
  type MarkdownSurface,
  MAX_ASSET_BYTES,
  type Slot,
  slugify,
  surfacesByteLength,
  type Session,
  type Store,
  type Post,
  type Surface,
  SURFACE_CONTENT_FIELDS,
  type TerminalSurface,
  type TraceStep,
} from "./types.ts";
import { type SurfaceValidationFailure, validateSurfaces } from "./postSurfaces.ts";
import {
  findWelcomePost,
  WELCOME_POST_TITLE,
  WELCOME_SESSION_TITLE,
  welcomeSurfaces,
} from "./welcomePost.ts";

export type { FeedEvent } from "./events.ts";
// `Feedback` is the agent-facing feedback unit; it is now the per-post batch
// (feedbackBatch.ts). The export name is unchanged so embedders and the MCP
// tier keep compiling against one name.
export type { FeedbackBatch as Feedback } from "./feedbackBatch.ts";

const MAX_SURFACE_BYTES = 2 * 1024 * 1024;
const MAX_WAIT_SECONDS = 300;
// Hard ceiling on any request body, applied globally. Every write endpoint
// reads its body with an unbounded `c.req.json()` (and /mcp likewise), so
// without this a single oversize POST is an out-of-memory flood — and the local
// default ships with no auth token, so those endpoints are reachable
// unauthenticated. Sized to clear the largest legitimate body — a base64 asset
// uploaded over MCP, ~4/3 of the 5 MiB asset cap — while still bounding a flood.
// The /api/assets route's own 5 MiB streaming cap is stricter and still applies.
const MAX_BODY_BYTES = 16 * 1024 * 1024;
// Bound the session trace: each step's detail is truncated and the per-session
// list rolls, so memory stays flat no matter how long the agent runs.
const MAX_TRACE_STEPS = 2000;
const MAX_STEP_DETAIL = 4000;
const MAX_STEP_LABEL = 500;
// A comment's text and a surface's title both ride the feedback channel back to
// the agent (feedbackView below), re-sent on every poll — so cap them at the
// edge to keep one oversize value from bloating the agent's context forever.
const MAX_COMMENT_TEXT = 8000;
const MAX_TITLE = 500;

const surfaceValidationErrorBody = (failure: SurfaceValidationFailure) => ({
  error: failure.error,
  code: failure.code,
  issues: failure.issues,
});
// Ceiling on concurrently-held SSE + long-poll connections. Both are GETs that
// pin a connection open (the event stream indefinitely, /api/comments?wait up
// to MAX_WAIT_SECONDS); on a publicRead workspace they're reachable unauthenticated,
// so without a cap a flood exhausts sockets. One app instance is one workspace
// (a single Durable Object), and one workspace is one user — so legitimate
// concurrent holds are small but not tiny: each open viewer tab holds one SSE,
// and each active agent holds a long-poll (and possibly its own SSE). A
// multi-agent session with 5 agents plus a few viewer tabs can legitimately
// reach ~15. 32 clears that with headroom while still bounding a flood on a
// no-token local workspace — and a real flood is orders of magnitude bigger, so
// rejecting at 32 vs 16 makes no difference to flood protection, only to
// legitimate use. Configurable so deployments can tune it and tests can
// exercise the cap cheaply.
const DEFAULT_MAX_HOLD_CONNECTIONS = 32;

// Asset serving policy: only raster images are served inline; everything else
// (incl. svg, json, text, the octet-stream catch-all) is an attachment, so a
// top-level open of /a/:id can never execute an uploaded document as a live
// same-origin script. <img>/fetch ignore Content-Disposition, so embedding and
// inline trace rendering keep working regardless.
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const ATTACH_SAFE_TYPES = new Set([
  "image/svg+xml",
  "application/json",
  "application/x-ndjson",
  "text/plain",
  "text/csv",
]);

function assetServeHeaders(asset: Asset): { contentType: string; disposition: string } {
  if (INLINE_IMAGE_TYPES.has(asset.contentType)) {
    return { contentType: asset.contentType, disposition: "inline" };
  }
  const contentType = ATTACH_SAFE_TYPES.has(asset.contentType)
    ? asset.contentType
    : "application/octet-stream";
  const name = (asset.filename || asset.id).replace(/[^\w.-]/g, "_");
  return { contentType, disposition: `attachment; filename="${name}"` };
}

// Pick an AssetKind when the caller didn't specify one.
function inferAssetKind(contentType: string): AssetKind {
  return contentType.startsWith("image/") ? "image" : "file";
}

const isAssetKind = (v: unknown): v is AssetKind => v === "image" || v === "trace" || v === "file";

// base64 -> bytes, runtime-agnostic (atob is a global in Node and Workers).
// Docs and onboarding snippets are written against the local default; serve
// them with the real origin so a deployed instance shows copy-pasteable URLs.
const LOCAL_ORIGIN = "http://localhost:8228";

export type AuthenticateHook = (
  request: Request,
) => boolean | Response | Promise<boolean | Response>;

export type BasePathHook = string | ((request: Request) => string | null | undefined);
export type PublicReadMode = "session" | "full";

export interface AppOptions {
  store: Store;
  viewerHtml: string;
  guideMarkdown: string;
  setupText: string;
  agentHowtoText?: string;
  // When set (cloud deployments), this hook authorizes requests before any
  // app route runs. Return true to allow, false to use the default 401, or a
  // Response for custom denials. This is intentionally lower-level than
  // authToken so hosts can validate edge-signed assertions without teaching
  // sideshow about their session/token systems.
  authenticate?: AuthenticateHook;
  // When set (self-hosted Worker deployments), every route except /guide,
  // /setup, and /agent-howto requires it: Authorization bearer, ?key= query,
  // or the cookie it sets. Preserved for backwards compatibility.
  authToken?: string;
  // Public path prefix for deployments mounted below an origin root, e.g.
  // /u/:account in a hosted multi-tenant wrapper. The core still receives
  // stripped routes like /api/sessions and /s/:id?part=0; this prefix is only
  // used when the server/viewer generate browser-visible URLs.
  basePath?: BasePathHook;
  // When set, unauthenticated GET routes can be read without bypassing the
  // write token. "session" exposes only session-scoped reads; "full" exposes
  // every GET route.
  publicRead?: PublicReadMode;
  // Whether this deployment can render a post's first surface as a PNG (the
  // /s/:id.png route). That route lives in the Cloudflare Worker entry and needs
  // the Browser Rendering binding; the plain Node server can't drive a headless
  // browser, so it leaves this false. Surfaced to the viewer
  // (window.__SIDESHOW_SCREENSHOTS__) so the screenshot action knows whether to
  // enable itself.
  screenshots?: boolean;
  // Update notice: the running version and the upgrade hint that fits this
  // deployment (npm install vs redeploy). Without `version`, /api/version
  // reports nothing and the viewer shows no notice.
  version?: string;
  upgradeCommand?: string;
  // Test seam: replaces the npm-registry/GitHub lookup for the latest release.
  fetchLatestRelease?: () => Promise<LatestRelease | null>;
  // Optional live-feed tap for hosts that provide their own transport (for
  // example, a Cloudflare Durable Object WebSocket-hibernation wrapper). Receives
  // every event; transport-specific session filtering stays with the host.
  onEvent?: (event: FeedEvent) => void;
  // Max concurrently-held SSE (`/api/events`) + long-poll (`/api/comments?wait`)
  // connections before new ones are rejected with 503. Bounds a connection flood
  // on publicRead workspaces; defaults to DEFAULT_MAX_HOLD_CONNECTIONS.
  maxHoldConnections?: number;
}

export interface LatestRelease {
  version: string;
  notes?: string;
}

// Newer-than for plain x.y.z strings; prerelease suffixes compare as their
// base version, and garbage compares as "not newer".
function versionGt(a: string, b: string): boolean {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// Latest published version from npm, release notes from the matching GitHub
// release. Notes are garnish: if GitHub is unreachable the version alone
// still makes a usable notice.
async function fetchLatestFromRegistry(): Promise<LatestRelease | null> {
  const res = await fetch("https://registry.npmjs.org/sideshow/latest");
  if (!res.ok) return null;
  const pkg = (await res.json()) as { version?: string };
  if (typeof pkg.version !== "string") return null;
  let notes: string | undefined;
  try {
    const gh = await fetch(
      `https://api.github.com/repos/modem-dev/sideshow/releases/tags/v${pkg.version}`,
      { headers: { "user-agent": "sideshow", accept: "application/vnd.github+json" } },
    );
    if (gh.ok) {
      const rel = (await gh.json()) as { body?: string };
      if (typeof rel.body === "string") notes = rel.body;
    }
  } catch {
    // ignore — see above
  }
  return { version: pkg.version, notes };
}

const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;

function parseRecentLimit(raw: string | undefined): number {
  const parsed = Number(raw ?? "20");
  const limit = Number.isFinite(parsed) && parsed !== 0 ? Math.trunc(parsed) : 20;
  return Math.min(Math.max(limit, 1), 100);
}

function isPublicReadAllowed(path: string, mode: PublicReadMode): boolean {
  if (mode === "full") return true;
  if (path.startsWith("/session/")) return true;
  if (path.startsWith("/s/")) return true;
  if (path.startsWith("/p/")) return true;
  if (path.startsWith("/a/")) return true;
  if (path.startsWith("/api/sessions/")) return true;
  // /api/surfaces/recent is the cross-session feed source — gate it like
  // /api/sessions (NOT public on a session-scoped workspace), not like the
  // per-surface /api/surfaces/:id reads below.
  if (path === "/api/surfaces/recent") return false;
  if (path === "/api/posts/recent") return false;
  // Project/item reads are addressed by NAME, not by an unguessable id, so they
  // are not capabilities the way /api/posts/:id is: exposing them on a
  // session-scoped public workspace would let anyone enumerate the whole
  // workspace from a single shared session link. Same call as the recent feed
  // above. `publicRead: "full"` already returned true before reaching here.
  if (path.startsWith("/api/projects")) return false;
  if (path.startsWith("/api/surfaces/")) return true;
  if (path.startsWith("/api/posts/")) return true;
  if (path.startsWith("/api/snippets/")) return true;
  if (path === "/api/comments") return true;
  if (path === "/api/events") return true;
  if (path === "/api/theme") return true;
  if (path === "/api/version") return true;
  if (path === "/api/kits") return true;
  return false;
}

export interface CommentWait {
  sessionId?: string;
  surfaceId?: string;
  author?: string;
  afterSeq?: number;
  waitSeconds: number;
  // Viewer reads only: the operator's own unsent drafts belong in the card's
  // thread. Agent-facing reads leave this off and never see them.
  includeDrafts?: boolean;
}

export function createApp({
  store,
  viewerHtml,
  guideMarkdown,
  setupText,
  agentHowtoText = setupText,
  authenticate,
  authToken,
  basePath,
  publicRead,
  screenshots,
  version,
  upgradeCommand,
  fetchLatestRelease,
  onEvent,
  maxHoldConnections = DEFAULT_MAX_HOLD_CONNECTIONS,
}: AppOptions) {
  const app = new Hono();
  // `?key=` bootstraps cookie auth, so never let a board URL disclose that
  // credential to another origin through an outbound Referer header. Set this
  // before auth so denied and public routes carry the same policy.
  // The origin of the most recent request. A surface document bakes its origin
  // in (CSP, <base>, asset URLs), so the publish-time pre-warm needs one — and a
  // write arrives over the same origin the viewer is about to read from. It is
  // only ever a cache-key input: an origin that turns out to be wrong wastes a
  // warm entry, it can never be served to the wrong caller (renderKey includes it).
  let lastOrigin: string | null = null;
  app.use("*", (c, next) => {
    lastOrigin = new URL(c.req.url).origin;
    c.header("Referrer-Policy", "no-referrer");
    return next();
  });
  const bus = new EventBus();
  if (onEvent) {
    bus.subscribe((event) => {
      try {
        onEvent(event);
      } catch (err) {
        console.warn("[sideshow] onEvent listener failed", err);
      }
    });
  }

  // Live count of held SSE + long-poll connections, gated by maxHoldConnections.
  // Each holder increments on entry and releases exactly once via a guarded
  // release() wired to every exit (stream abort, request abort, normal return).
  let holdConnections = 0;
  const acquireHold = (): boolean => {
    if (holdConnections >= maxHoldConnections) return false;
    holdConnections++;
    return true;
  };
  const makeRelease = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holdConnections--;
    };
  };

  // Rendered-document cache for /s/:id rich surfaces. Rendering a markdown/code/
  // diff surface runs shiki / @pierre-diffs SSR, which is non-trivial (a big diff
  // is tens of ms + tens of KB), so memoize the finished document string. The
  // key pins everything the output depends on — post id, surface index, the
  // RESOLVED version number, theme, mode — and a version's content is immutable,
  // so a hit is always correct (a post edit bumps the version → a new key).
  // Bounded by BYTES and LRU-evicted: a dropped entry costs a re-render, never
  // correctness. Bounding the entry COUNT was the wrong axis — a document can
  // weigh anything from 2 KB to ~900 KB, so 512 entries could mean 450 MB in an
  // isolate with a 128 MB budget. The DurableObject is single-instance per
  // workspace, so this in-memory cache is authoritative; a multi-instance deploy
  // could back it with KV/Cache API behind the same key without changing callers.
  const MAX_RENDER_CACHE_BYTES = 32 * 1024 * 1024;
  const renderCache = new Map<string, string>();
  let renderCacheBytes = 0;
  // UTF-16 code units × 2 is the retained JS string size, which is what this
  // bound is protecting — not the transferred UTF-8 length.
  const docBytes = (doc: string) => doc.length * 2;
  const dropCacheEntry = (key: string) => {
    const doc = renderCache.get(key);
    if (doc === undefined) return;
    renderCacheBytes -= docBytes(doc);
    renderCache.delete(key);
  };
  const clearRenderCache = () => {
    renderCache.clear();
    renderCacheBytes = 0;
  };
  // The response headers every surface document carries, on the cache-first
  // path and the render path alike.
  //
  // The `sandbox` CSP sandboxes the document however it is loaded. The viewer
  // embeds it in an iframe whose `sandbox="allow-scripts"` attribute gives it an
  // opaque origin, but the document is served from the workspace's own origin —
  // so a TOP-LEVEL load (a user opening /s/:id in a new tab, an agent-shared
  // link) would otherwise run the agent's script in the workspace origin, where
  // it could reach same-origin storage or window.open('/') the real viewer. A
  // `sandbox` CSP can only be set as a response header (not the meta tag the
  // page carries), and it forces the same opaque-origin sandbox on a direct
  // navigation: allow-scripts so the bridge still runs, but no allow-same-origin,
  // so agent code can never touch the workspace origin. Mirrors the iframe's
  // sandbox flags.
  //
  // Version-pinned + themed requests (what the viewer always sends) are
  // immutable, so they allow long-lived shared caching; an unpinned direct load
  // is not.
  function surfaceDocHeaders(c: Context, immutable: boolean): void {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", "sandbox allow-scripts");
    c.header(
      "Cache-Control",
      immutable ? "public, max-age=31536000, immutable" : "private, no-cache",
    );
  }

  function renderCacheHit(key: string): string | undefined {
    const hit = renderCache.get(key);
    if (hit === undefined) return undefined;
    // refresh LRU recency
    renderCache.delete(key);
    renderCache.set(key, hit);
    return hit;
  }
  async function cachedRender(key: string, build: () => Promise<string> | string): Promise<string> {
    const hit = renderCacheHit(key);
    if (hit !== undefined) return hit;
    const doc = await build();
    renderCache.set(key, doc);
    renderCacheBytes += docBytes(doc);
    while (renderCacheBytes > MAX_RENDER_CACHE_BYTES && renderCache.size > 1) {
      const oldest = renderCache.keys().next().value;
      if (oldest === undefined) break;
      dropCacheEntry(oldest);
    }
    return doc;
  }

  // Last-resort safety net: any handler that throws (rather than returning a
  // status) becomes a clean JSON 500 instead of leaking a stack or a bare crash.
  // Validation rejects bad input with 4xx before this, so reaching here means an
  // unexpected bug — log it so it isn't swallowed silently.
  app.onError((err, c) => {
    console.error("sideshow: unhandled error", err);
    return c.json({ error: "internal error" }, 500);
  });

  const normalizeBasePath = (value: string | null | undefined): string => {
    if (!value || value === "/") return "";
    const withLeading = value.startsWith("/") ? value : `/${value}`;
    let end = withLeading.length;
    while (end > 0 && withLeading.charCodeAt(end - 1) === 47) end--;
    return withLeading.slice(0, end);
  };
  const requestBasePath = (request: Request): string =>
    normalizeBasePath(typeof basePath === "function" ? basePath(request) : basePath);

  // Cached, fail-silent update lookup: being offline or rate-limited must
  // cost nothing but the absence of the notice. Failures are cached too, so
  // a dead network doesn't retry on every viewer load.
  let updateCache: { at: number; value: LatestRelease | null } | null = null;
  async function latestRelease(): Promise<LatestRelease | null> {
    if (updateCache && Date.now() - updateCache.at < UPDATE_CHECK_TTL_MS) return updateCache.value;
    const value = await (fetchLatestRelease ?? fetchLatestFromRegistry)().catch(() => null);
    updateCache = { at: Date.now(), value };
    return value;
  }

  // --- shared flows (used by both the REST API and the MCP endpoint) ---

  // User comments the agent has not seen yet ride along on its next write, so
  // agents hear feedback without blocking on the long-poll. The cursor also
  // advances past the agent's own comments to keep reads cheap.
  async function collectFeedback(sessionId: string): Promise<FeedbackBatch[] | undefined> {
    const session = await store.getSession(sessionId);
    if (!session) return undefined;
    const fresh = await store.listComments({ sessionId, afterSeq: session.agentSeq });
    if (fresh.length === 0) return undefined;
    await store.markAgentSeen(sessionId, fresh[fresh.length - 1].seq);
    const feedback = fresh.filter((cm) => cm.author === "user");
    return feedback.length > 0 ? await batchFeedback(feedback) : undefined;
  }

  // The per-post grouping every agent-facing channel returns (resolves each
  // batch's post and, for an accept, the sibling variants it archived).
  const batchFeedback = (comments: Comment[]) => buildFeedbackBatches(store, comments);

  // Per-comment delivery state for the viewer: `seen` once the session's
  // agentSeq has passed the comment. Computed, never stored.
  async function withSeen(comments: Comment[]): Promise<(Comment & { seen: boolean })[]> {
    const cursors = new Map<string, number>();
    for (const c of comments) {
      if (!cursors.has(c.sessionId)) {
        cursors.set(c.sessionId, (await store.getSession(c.sessionId))?.agentSeq ?? 0);
      }
    }
    // A draft was never delivered, whatever its seq — it is written below the
    // cursor and only crosses it when Revise releases it with a fresh one.
    return comments.map((c) => ({
      ...c,
      seen: !c.draft && c.seq <= (cursors.get(c.sessionId) ?? 0),
    }));
  }

  // The item fields every post response carries alongside the legacy shape.
  const itemFields = (post: Post) => ({
    project: post.project,
    slug: post.slug,
    kind: post.kind,
    variant: post.variant,
    status: post.status,
    ask: post.ask,
    slots: post.slots,
    ...(post.from === undefined ? {} : { from: post.from }),
    ...(post.prompt === undefined ? {} : { prompt: post.prompt }),
  });

  // A project's imported design system (settings key `design:<project>`), or
  // null when `sideshow init` has never run for it.
  async function designFor(project: string): Promise<DesignSettings | null> {
    const raw = await store.getSetting(`design:${project}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DesignSettings;
    } catch {
      return null;
    }
  }

  // Push + webhooks. Detached on purpose: a dead push endpoint must never fail
  // (or slow) the write that triggered it.
  function fireNotify(payload: NotifyPayload): void {
    void notify(store, payload).catch((err) => console.warn("[sideshow] notify failed", err));
  }

  const postUrl = (request: Request, post: Post) =>
    `${new URL(request.url).origin}${requestBasePath(request)}/project/${encodeURIComponent(
      post.project,
    )}/${encodeURIComponent(post.slug)}?variant=${encodeURIComponent(post.variant)}`;

  // Find a surface's index by id (first match) or 0-based numeric index.
  function findSurfaceIndex(surfaces: Surface[], target: string): number {
    const byId = surfaces.findIndex((s) => s.id === target);
    if (byId >= 0) return byId;
    const idx = Number(target);
    if (Number.isInteger(idx) && idx >= 0 && idx < surfaces.length) return idx;
    return -1;
  }

  // Slot a content string into a surface's content field, preserving kind and
  // extra fields. Returns null if the kind has no content field or JSON parse
  // fails. The caller handles error reporting.
  function applyContent(surface: Surface, content: string, kits?: unknown): Surface | null {
    const field = SURFACE_CONTENT_FIELDS[surface.kind];
    if (!field) return null;
    let value: unknown = content;
    if (surface.kind === "json") {
      try {
        value = JSON.parse(content);
      } catch {
        return null;
      }
    }
    if (surface.kind === "html") {
      return {
        ...surface,
        html: value as string,
        ...(kits !== undefined && { kits: Array.isArray(kits) ? kits : undefined }),
      };
    }
    return { ...surface, [field]: value } as Surface;
  }

  async function publishPostFlow(input: {
    surfaces: Surface[];
    title?: string;
    session?: string;
    sessionTitle?: string;
    agent?: string;
    cwd?: string;
    project?: string;
    slug?: string;
    kind?: ItemKind;
    variant?: string;
    from?: number;
    prompt?: string;
    slots?: Slot[];
    author?: string;
    request?: Request;
  }): Promise<
    { post: Post; userFeedback?: FeedbackBatch[] } | { error: string; status: 400 | 404 | 413 }
  > {
    if (input.surfaces.length === 0) {
      return { error: "a post needs at least one surface", status: 400 };
    }
    if (surfacesByteLength(input.surfaces) > MAX_SURFACE_BYTES) {
      return { error: `surface exceeds ${MAX_SURFACE_BYTES} bytes`, status: 413 };
    }
    let sessionId = input.session;
    let session = sessionId ? await store.getSession(sessionId) : null;
    if (sessionId && !session) {
      return { error: `session "${sessionId}" not found`, status: 404 };
    }
    if (!sessionId) {
      // sessionTitle applies only here — an existing session keeps its title,
      // which the user may have set by renaming it in the viewer.
      session = await store.createSession({
        agent: input.agent ?? "agent",
        title: input.sessionTitle?.slice(0, MAX_TITLE),
        cwd: input.cwd,
        project: resolveProject(input.project, input.cwd),
      });
      bus.broadcast({ type: "session-created", id: session.id });

      sessionId = session.id;
    }
    const project =
      input.project?.trim() || session?.project || projectFromCwd(session?.cwd) || DEFAULT_PROJECT;
    const variant = input.variant?.trim() || DEFAULT_VARIANT;
    const title = input.title?.slice(0, MAX_TITLE);
    // Publishing the same (project, slug, variant) twice is a new VERSION of
    // that variant, not a second item — the agent addresses items by name
    // across sessions, so it must not have to remember post ids. Only an
    // EXPLICIT slug addresses an item that way: a publish that names no item
    // (the legacy snippet flow) always creates a new one, so two untitled
    // cards can never collapse into one item's history.
    const addressed = input.slug?.trim();
    const slug = addressed
      ? slugify(addressed)
      : await freeSlug(project, slugify(title || "Untitled"), variant);
    const existing = addressed ? await store.findVariant(project, slug, variant) : null;
    const slots = input.kind === "page" ? await pageSlots(project, input.surfaces) : input.slots;
    if (existing) {
      const revised = await revisePost(existing.id, {
        surfaces: input.surfaces,
        title,
        from: input.from,
        prompt: input.prompt,
        author: input.author,
        slots,
      });
      if ("error" in revised) return revised;
      if (input.prompt && input.request) {
        fireNotify({
          event: "publish",
          project: revised.post.project,
          slug: revised.post.slug,
          variant: revised.post.variant,
          version: revised.post.version,
          text: input.prompt,
          url: postUrl(input.request, revised.post),
        });
      }
      return revised;
    }
    const post = await store.createPost({
      sessionId,
      surfaces: input.surfaces,
      title,
      project,
      slug,
      kind: input.kind,
      variant,
      from: input.from,
      prompt: input.prompt,
      slots,
      author: input.author,
    });
    if (!post) return { error: "session not found", status: 404 };
    bus.broadcast({ type: "post-created", id: post.id, sessionId, version: 1 });
    warmPost(post);
    return { post, userFeedback: await collectFeedback(sessionId) };
  }

  // A slug for an item nobody named. The title's kebab-case is used as-is when
  // it is free; otherwise a short random suffix keeps item identity unique
  // inside the project without scanning every post.
  async function freeSlug(project: string, base: string, variant: string): Promise<string> {
    if (!(await store.findVariant(project, base, variant))) return base;
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = `${base}-${newId()
        .slice(0, 4)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "0")}`;
      if (!(await store.findVariant(project, slug, variant))) return slug;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  // Project resolution for a session: explicit wins, then the cwd's basename,
  // then the single-workspace fallback.
  const resolveProject = (project?: string, cwd?: string | null): string =>
    project?.trim() || projectFromCwd(cwd) || DEFAULT_PROJECT;

  // A page's slot list, with each missing version pinned to the referenced
  // component's current one (snapshot semantics).
  async function pageSlots(project: string, surfaces: Surface[]): Promise<Slot[]> {
    const html = surfaces.find((s) => s.kind === "html");
    if (!html || html.kind !== "html") return [];
    const slots: Slot[] = [];
    for (const tag of parseSlotTags(html.html)) {
      let version = tag.version;
      if (version == null) {
        version = (await store.findVariant(project, tag.slug, tag.variant))?.version ?? null;
      }
      if (version != null) slots.push({ slug: tag.slug, variant: tag.variant, version });
    }
    return slots;
  }

  // Store an uploaded blob. Like publishPostFlow, an explicit session is
  // validated and a missing one is auto-created so an upload can precede the
  // first publish. The asset's data is dropped from the result (it's bytes).
  async function uploadAsset(input: {
    data: Uint8Array;
    contentType: string;
    filename?: string;
    kind?: AssetKind;
    session?: string;
    agent?: string;
  }): Promise<{ asset: Omit<Asset, "data"> } | { error: string; status: 400 | 404 | 413 }> {
    if (input.data.byteLength === 0) return { error: "empty upload", status: 400 };
    if (input.data.byteLength > MAX_ASSET_BYTES) {
      return { error: `asset exceeds ${MAX_ASSET_BYTES} bytes`, status: 413 };
    }
    let sessionId = input.session;
    if (sessionId && !(await store.getSession(sessionId))) {
      return { error: `session "${sessionId}" not found`, status: 404 };
    }
    if (!sessionId) {
      const session = await store.createSession({ agent: input.agent ?? "agent" });
      bus.broadcast({ type: "session-created", id: session.id });
      sessionId = session.id;
    }
    const asset = await store.putAsset({
      sessionId,
      kind: input.kind ?? inferAssetKind(input.contentType),
      contentType: input.contentType || "application/octet-stream",
      filename: input.filename,
      data: input.data,
    });
    if (!asset) return { error: "session not found", status: 404 };
    const { data: _data, ...meta } = asset;
    return { asset: meta };
  }

  async function revisePost(
    id: string,
    patch: {
      surfaces?: Surface[];
      title?: string;
      from?: number;
      prompt?: string;
      author?: string;
      slots?: Slot[];
    },
  ): Promise<
    { post: Post; userFeedback?: FeedbackBatch[] } | { error: string; status: 400 | 404 | 413 }
  > {
    if (patch.surfaces) {
      if (patch.surfaces.length === 0) {
        return { error: "a post needs at least one surface", status: 400 };
      }
      if (surfacesByteLength(patch.surfaces) > MAX_SURFACE_BYTES) {
        return { error: `surface exceeds ${MAX_SURFACE_BYTES} bytes`, status: 413 };
      }
    }
    if (patch.title !== undefined) patch.title = patch.title.slice(0, MAX_TITLE);
    const post = await store.updatePost(id, {
      surfaces: patch.surfaces,
      title: patch.title,
      from: patch.from,
      prompt: patch.prompt,
      author: patch.author,
      slots: patch.slots,
    });
    if (!post) return { error: "post not found", status: 404 };
    bus.broadcast({
      type: "post-updated",
      id: post.id,
      sessionId: post.sessionId,
      version: post.version,
    });
    warmPost(post);
    return { post, userFeedback: await collectFeedback(post.sessionId) };
  }

  // --- per-surface flow functions (append / replace / remove / reorder) ---
  // Each reads the existing post, mutates the surfaces array, and writes it
  // back via revisePost so version/history/SSE stay consistent. Untouched
  // surfaces keep their ids (normalizeSurfaceIds preserves existing ids).

  async function appendPostSurface(
    id: string,
    surface: Surface,
    pos?: { before?: string; after?: string },
  ): Promise<
    { post: Post; userFeedback?: FeedbackBatch[] } | { error: string; status: 400 | 404 | 413 }
  > {
    const existing = await store.getPost(id);
    if (!existing) return { error: "post not found", status: 404 };
    let insertAt = existing.surfaces.length;
    if (pos?.before !== undefined) {
      const i = findSurfaceIndex(existing.surfaces, pos.before);
      if (i < 0) return { error: `surface "${pos.before}" not found`, status: 404 };
      insertAt = i;
    } else if (pos?.after !== undefined) {
      const i = findSurfaceIndex(existing.surfaces, pos.after);
      if (i < 0) return { error: `surface "${pos.after}" not found`, status: 404 };
      insertAt = i + 1;
    }
    const surfaces = [...existing.surfaces];
    surfaces.splice(insertAt, 0, surface);
    return revisePost(id, { surfaces });
  }

  async function replacePostSurface(
    id: string,
    target: string,
    replacement: { surface?: Surface; content?: string; kits?: unknown },
  ): Promise<
    { post: Post; userFeedback?: FeedbackBatch[] } | { error: string; status: 400 | 404 | 413 }
  > {
    const existing = await store.getPost(id);
    if (!existing) return { error: "post not found", status: 404 };
    const idx = findSurfaceIndex(existing.surfaces, target);
    if (idx < 0) return { error: `surface "${target}" not found`, status: 404 };
    let updated: Surface;
    if (replacement.surface !== undefined) {
      // Full replacement — preserve the old surface's id so the viewer can
      // key by stable identity across edits. If kits were supplied and the
      // replacement is an html surface, apply them (matches content-only).
      updated = { ...replacement.surface, id: existing.surfaces[idx].id };
      if (replacement.kits !== undefined && updated.kind === "html") {
        updated = {
          ...updated,
          kits: Array.isArray(replacement.kits) ? replacement.kits : undefined,
        };
      }
    } else if (replacement.content !== undefined) {
      // Content-only — slot the string into the existing surface's field.
      const result = applyContent(existing.surfaces[idx], replacement.content, replacement.kits);
      if (!result) {
        return {
          error: `content update not supported for ${existing.surfaces[idx].kind} surfaces`,
          status: 400,
        };
      }
      updated = result;
    } else {
      return { error: "provide surface or content", status: 400 };
    }
    const parsed = await validateSurfaces([updated]);
    if (!parsed.ok) return { error: parsed.error, status: 400 };
    // The validator strips the id field (zod schemas don't declare it), so
    // re-apply the target's id after validation to preserve surface identity.
    const surfaces = [...existing.surfaces];
    surfaces[idx] = { ...parsed.surfaces[0], id: existing.surfaces[idx].id };
    return revisePost(id, { surfaces });
  }

  async function removePostSurface(
    id: string,
    target: string,
  ): Promise<
    { post: Post; userFeedback?: FeedbackBatch[] } | { error: string; status: 400 | 404 | 413 }
  > {
    const existing = await store.getPost(id);
    if (!existing) return { error: "post not found", status: 404 };
    const idx = findSurfaceIndex(existing.surfaces, target);
    if (idx < 0) return { error: `surface "${target}" not found`, status: 404 };
    if (existing.surfaces.length === 1) {
      return { error: "a post needs at least one surface", status: 400 };
    }
    const surfaces = existing.surfaces.filter((_, i) => i !== idx);
    return revisePost(id, { surfaces });
  }

  async function reorderPostSurfaces(
    id: string,
    order: (string | number)[],
  ): Promise<
    { post: Post; userFeedback?: FeedbackBatch[] } | { error: string; status: 400 | 404 | 413 }
  > {
    const existing = await store.getPost(id);
    if (!existing) return { error: "post not found", status: 404 };
    if (order.length !== existing.surfaces.length) {
      return { error: "order array length must match surface count", status: 400 };
    }
    // Build the reordered array. Each entry is a surface id or 0-based index.
    const reordered: Surface[] = Array.from({ length: order.length });
    const used = new Set<number>();
    for (const entry of order) {
      const idx = findSurfaceIndex(existing.surfaces, String(entry));
      if (idx < 0) return { error: `surface "${entry}" not found`, status: 404 };
      if (used.has(idx)) return { error: `surface "${entry}" appears twice in order`, status: 400 };
      used.add(idx);
    }
    for (let i = 0; i < order.length; i++) {
      const idx = findSurfaceIndex(existing.surfaces, String(order[i]));
      reordered[i] = existing.surfaces[idx];
    }
    return revisePost(id, { surfaces: reordered });
  }

  function numberInRange(value: unknown, min: number, max: number): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }

  function sanitizeCommentAnchor(raw: unknown, post: Post): CommentAnchor | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const input = raw as Record<string, unknown>;
    const kind = input.kind === "rect" || input.kind === "lineRange" ? input.kind : "point";
    let surfaceIndex = Number(input.surfaceIndex);
    if (
      !Number.isInteger(surfaceIndex) ||
      surfaceIndex < 0 ||
      surfaceIndex >= post.surfaces.length
    ) {
      const surfaceId = typeof input.surfaceId === "string" ? input.surfaceId : undefined;
      surfaceIndex = post.surfaces.findIndex((s) => s.id === surfaceId);
    }
    if (surfaceIndex < 0 || surfaceIndex >= post.surfaces.length) return undefined;
    const surface = post.surfaces[surfaceIndex];
    const base = {
      surfaceIndex,
      ...(surface.id && { surfaceId: surface.id }),
      surfaceKind: surface.kind,
      // The server pins anchors to the current stored version instead of trusting
      // the client-supplied value.
      postVersion: post.version,
    };
    if (kind === "lineRange") {
      const startLine = Number(input.startLine);
      const endLine = Number(input.endLine);
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1) {
        return undefined;
      }
      return {
        kind,
        ...base,
        startLine,
        endLine: Math.max(startLine, endLine),
        ...(typeof input.file === "string" && { file: input.file.slice(0, MAX_TITLE) }),
      };
    }
    const x = numberInRange(input.x, 0, 1);
    const y = numberInRange(input.y, 0, 1);
    if (x == null || y == null) return undefined;
    if (kind === "rect") {
      const w = numberInRange(input.w, 0, 1);
      const h = numberInRange(input.h, 0, 1);
      if (w == null || h == null) return undefined;
      return { kind, ...base, x, y, w, h };
    }
    return { kind: "point", ...base, x, y };
  }

  // Viewport presets the stage lays out at; anything else is dropped rather
  // than echoed back to the agent as a made-up width.
  const VIEWPORTS = new Set([390, 820, 1280]);
  const sanitizeViewport = (raw: unknown): number | null => {
    const n = Number(raw);
    return VIEWPORTS.has(n) ? n : null;
  };

  const sanitizePostVersion = (raw: unknown, post: Post): number => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= post.version ? n : post.version;
  };

  // Markers are DATA: every field is re-derived or range-checked here, so
  // whatever the overlay (or a forged request) sends, the agent only ever
  // receives a bounded shape it can render as text.
  const MAX_ANCHORS = 20;
  const MAX_ANCHOR_TEXT = 200;
  function sanitizeAnchors(raw: unknown, post: Post, viewport: number | null): Anchor[] {
    if (!Array.isArray(raw)) return [];
    const out: Anchor[] = [];
    for (const entry of raw.slice(0, MAX_ANCHORS)) {
      if (!entry || typeof entry !== "object") continue;
      const a = entry as Record<string, unknown>;
      const shape = a.shape === "rect" || a.shape === "circle" ? a.shape : "pin";
      const box = Array.isArray(a.box) ? a.box.map((n) => numberInRange(n, 0, 1)) : [];
      const need = shape === "pin" ? 2 : 4;
      if (box.length < need || box.slice(0, need).some((n) => n == null)) continue;
      let surfaceIndex = Number(a.surfaceIndex);
      if (
        !Number.isInteger(surfaceIndex) ||
        surfaceIndex < 0 ||
        surfaceIndex >= post.surfaces.length
      ) {
        surfaceIndex = 0;
      }
      const ref =
        typeof a.ref === "string" && /^@\d{1,3}$/.test(a.ref) ? a.ref : `@${out.length + 1}`;
      out.push({
        ref,
        shape,
        box: box.slice(0, need) as number[],
        surfaceIndex,
        postVersion: sanitizePostVersion(a.postVersion, post),
        ...(typeof a.path === "string" && { path: a.path.slice(0, MAX_ANCHOR_TEXT) }),
        ...(typeof a.text === "string" && { text: a.text.slice(0, MAX_ANCHOR_TEXT) }),
        ...(viewport === null ? {} : { viewport }),
      });
    }
    return out;
  }

  async function createComment(input: {
    text: string;
    surface?: string;
    // Viewer-originated comments may set "user" or "surface". All agent
    // channels omit this and derive their author from the owning session.
    author?: "user" | "surface";
    anchor?: unknown;
    kind?: CommentKind;
    anchors?: unknown;
    // Only the trusted viewer may hold a comment back as a draft (same
    // origin rule as `author`); agent channels can never write one.
    draft?: boolean;
    viewport?: unknown;
    postVersion?: unknown;
  }): Promise<
    { comment: Comment; userFeedback?: FeedbackBatch[] } | { error: string; status: 400 | 404 }
  > {
    // Comments always attach to a post — a comment with nothing to point at
    // is just a message to the agent, which is what the agent's own prompt is for.
    if (!input.surface) return { error: 'provide a "surface" id', status: 400 };
    const post = await store.getPost(input.surface);
    if (!post) return { error: "post not found", status: 404 };
    const session = await store.getSession(post.sessionId);
    if (!session) return { error: "session not found", status: 404 };
    const author = input.author ?? reservedAgent(session.agent);
    const comment = await store.createComment({
      sessionId: post.sessionId,
      postId: post.id,
      author,
      text: input.text.trim().slice(0, MAX_COMMENT_TEXT),
      anchor: sanitizeCommentAnchor(input.anchor, post),
      kind: input.kind ?? "comment",
      anchors: sanitizeAnchors(input.anchors, post, sanitizeViewport(input.viewport)),
      draft: input.draft === true,
      postVersion: sanitizePostVersion(input.postVersion, post),
      viewport: sanitizeViewport(input.viewport),
    });
    if (!comment) return { error: "session not found", status: 404 };
    bus.broadcast({
      type: "comment-created",
      id: comment.id,
      sessionId: comment.sessionId,
      surfaceId: comment.postId,
      seq: comment.seq,
    });
    // agent replies are writes too — piggyback pending feedback on them, but
    // never on the user's own comments
    const userFeedback = author === "user" ? undefined : await collectFeedback(comment.sessionId);
    return { comment, userFeedback };
  }

  // Long-poll: resolves as soon as a matching comment lands, or at timeout.
  async function waitForComments(
    q: CommentWait,
    signal?: AbortSignal,
  ): Promise<{ comments: Comment[]; lastSeq: number }> {
    // An author=user session wait with no explicit cursor resumes from the
    // session's agentSeq — "where the agent left off" lives server-side so the
    // CLI, both MCP transports, and piggyback share one exactly-once stream.
    let afterSeq = q.afterSeq;
    if (afterSeq === undefined && q.author === "user" && q.sessionId) {
      afterSeq = (await store.getSession(q.sessionId))?.agentSeq;
    }
    const query = {
      sessionId: q.sessionId,
      postId: q.surfaceId,
      afterSeq,
      includeDrafts: q.includeDrafts === true,
    };
    const matches = (list: Comment[]) =>
      q.author ? list.filter((cm) => cm.author === q.author) : list;
    const wait = Math.min(Math.max(q.waitSeconds, 0), MAX_WAIT_SECONDS);

    let all = await store.listComments(query);
    let comments = matches(all);
    if (comments.length === 0 && wait > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, wait * 1000);
        const unsubscribe = bus.subscribe((event) => {
          if (event.type !== "comment-created") return;
          if (q.sessionId && event.sessionId !== q.sessionId) return;
          if (q.surfaceId && event.surfaceId !== q.surfaceId) return;
          done();
        });
        const onAbort = () => done();
        let settled = false;
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) done();
        function done() {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }
      });
      all = await store.listComments(query);
      comments = matches(all);
    }
    // The cursor advances past every comment in the window — not just the
    // filtered ones — so the next call doesn't re-read the agent's own
    // comments. collectFeedback already does this; mirror it here.
    const lastSeq = all.length > 0 ? all[all.length - 1].seq : (afterSeq ?? 0);
    // An author=user query is the agent listening (the viewer never filters by
    // author) — what it receives here should not be re-delivered as piggyback.
    if (q.author === "user" && q.sessionId && all.length > 0) {
      await store.markAgentSeen(q.sessionId, lastSeq);
    }
    return { comments, lastSeq };
  }

  // --- auth ---

  const isAuthenticated = (c: Context): boolean => {
    if (!authToken) return true;
    if (c.req.header("authorization") === `Bearer ${authToken}`) return true;
    if (getCookie(c, "sideshow_key") === authToken) return true;
    return c.req.query("key") === authToken;
  };

  const isUnauthenticatedSessionRead = (c: Context): boolean =>
    publicRead === "session" && !isAuthenticated(c);

  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;

    // Content-hashed static assets (the surface bridge script and the static
    // stylesheets) are served unauthenticated on purpose: they are our own code,
    // carry no workspace data, and the sandboxed frames that load them run at an
    // opaque origin, so their subresource requests carry no SameSite cookie and
    // could not authenticate even on a tokened workspace.
    if (path.startsWith(STATIC_ASSET_PREFIX)) return next();

    if (authenticate) {
      const result = await authenticate(c.req.raw);
      if (result === true) return next();
      if (result instanceof Response) return result;
      if (path.startsWith("/api") || path === "/mcp") {
        return c.json({ error: "unauthorized" }, 401);
      }
      return c.text("unauthorized", 401);
    }

    if (!authToken) return next();
    if (path === "/guide" || path === "/setup" || path === "/agent-howto") return next();
    if (path.startsWith(STATIC_ASSET_PREFIX)) return next();

    const key = c.req.query("key");
    if (key === authToken) {
      setCookie(c, "sideshow_key", authToken, {
        httpOnly: true,
        sameSite: "Lax",
        secure: new URL(c.req.url).protocol === "https:",
        maxAge: 60 * 60 * 24 * 90,
        path: "/",
      });
      return next();
    }
    if (publicRead && c.req.method === "GET" && isPublicReadAllowed(path, publicRead)) {
      return next();
    }
    if (isAuthenticated(c)) return next();
    if (path.startsWith("/api") || path === "/mcp") {
      return c.json({ error: "unauthorized — send Authorization: Bearer <token>" }, 401);
    }
    return c.text("unauthorized — open this page as /?key=<your token>", 401);
  });

  // Cap every request body. Runs after auth, so an unauthenticated request on a
  // token-protected workspace is rejected (401) before its body is ever read; on a
  // no-token workspace it still bounds the body. bodyLimit short-circuits on an
  // oversize Content-Length and otherwise streams-and-aborts at the cap, so a
  // chunked body (no Content-Length) can't slip past either. /api/assets is
  // exempt here because it applies its own, stricter cap (limitAssetBody below).
  const limitBody = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "request body too large" }, 413),
  });
  app.use("*", (c, next) => (c.req.path === "/api/assets" ? next() : limitBody(c, next)));

  // The asset route's own (tighter) body cap. Keeps the asset limit and its
  // wording, and bounds the upload before it is read — bodyLimit refuses an
  // oversize Content-Length outright and aborts a chunked stream at the cap.
  const limitAssetBody = bodyLimit({
    maxSize: MAX_ASSET_BYTES,
    onError: (c) => c.json({ error: `asset exceeds ${MAX_ASSET_BYTES} bytes` }, 413),
  });

  // --- pages and docs ---

  const withOrigin = (text: string, c: { req: { url: string } }) =>
    text.replaceAll(LOCAL_ORIGIN, new URL(c.req.url).origin);

  const injectHead = (text: string, head: string) => {
    const headClose = text.lastIndexOf("</head>");
    return headClose >= 0
      ? `${text.slice(0, headClose)}${head}${text.slice(headClose)}`
      : `${head}${text}`;
  };

  const withDocumentTitle = (text: string, title: string | null | undefined) => {
    if (!title) return text;
    const escaped = escapeHtml(title);
    const titleTag = `<title>${escaped}</title>`;
    const titleStart = text.indexOf("<title>");
    if (titleStart < 0) return injectHead(text, titleTag);
    const titleEnd = text.indexOf("</title>", titleStart + "<title>".length);
    if (titleEnd < 0) return injectHead(text, titleTag);
    return `${text.slice(0, titleStart)}${titleTag}${text.slice(titleEnd + "</title>".length)}`;
  };

  const sessionDocumentTitle = (session: Session | null | undefined) => {
    if (!session) return null;
    const label = session.title || (session.agent ? `${session.agent} session` : null);
    return label ? `${label} · sideshow` : null;
  };

  const withViewerConfig = (
    text: string,
    request: Request,
    isReadonly: boolean,
    pageTitle?: string | null,
  ) => {
    const config = [
      `window.__SIDESHOW_BASE_PATH__=${JSON.stringify(requestBasePath(request))};`,
      pageTitle ? `window.__SIDESHOW_PAGE_TITLE__=${JSON.stringify(pageTitle)};` : "",
      isReadonly ? "window.__SIDESHOW_READONLY__=true;" : "",
      isReadonly && publicRead
        ? `window.__SIDESHOW_PUBLIC_READ__=${JSON.stringify(publicRead)};`
        : "",
      screenshots ? "window.__SIDESHOW_SCREENSHOTS__=true;" : "",
    ].join("");
    return injectHead(text, `<script>${config}</script>`);
  };

  const postPreviewHead = (
    post: Post,
    request: Request,
    themeId: string,
    rendererGeneration: string,
  ) => {
    const origin = new URL(request.url).origin;
    const publicBasePath = requestBasePath(request);
    const canonical = `${origin}${publicBasePath}/p/${post.id}`;
    // Pin every pixel-affecting input in the advertised URL: post revision,
    // workspace theme, deterministic color mode, and app/renderer generation.
    // The Worker validates these before admitting the image to edge cache.
    const imageUrl = new URL(`${origin}${publicBasePath}/p/${post.id}.png`);
    imageUrl.searchParams.set("card", "1");
    imageUrl.searchParams.set("theme", themeId);
    imageUrl.searchParams.set("mode", "dark");
    imageUrl.searchParams.set("v", String(post.version));
    imageUrl.searchParams.set("g", rendererGeneration);
    const image = imageUrl.toString();
    const title = escapeHtml(post.title);
    const description = "A https://sideshow.sh surface";
    return [
      `<link rel="canonical" href="${escapeHtml(canonical)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${title}">`,
      `<meta property="og:description" content="${description}">`,
      `<meta property="og:url" content="${escapeHtml(canonical)}">`,
      `<meta property="og:image" content="${escapeHtml(image)}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${title}">`,
      `<meta name="twitter:description" content="${description}">`,
      `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    ].join("\n");
  };

  const configuredViewerHtml = async (
    c: Context,
    opts: { post?: Post; title?: string | null } = {},
  ) => {
    // The viewer HTML is the trusted app origin — it shares that origin with the
    // authenticated API and the comment→agent channel, so a cross-origin page
    // that frames it could clickjack actions or the prompt-injection channel.
    // Refuse cross-origin framing (same-origin embedding still allowed). This is
    // the trusted shell only; the sandboxed surface documents at /s/:id?part=N
    // are *meant* to be framed and carry their own `sandbox` CSP header instead,
    // so they never pass through here and are unaffected.
    c.header("Content-Security-Policy", "frame-ancestors 'self'");
    const pageTitle = opts.post?.title ?? opts.title;
    const html = withDocumentTitle(
      withViewerConfig(
        withOrigin(viewerHtml, { req: { url: c.req.url } }),
        c.req.raw,
        !!publicRead && !isAuthenticated(c),
        pageTitle,
      ),
      pageTitle,
    );
    if (!opts.post) return html;
    const themeId = (await store.getSetting("theme")) ?? DEFAULT_THEME_ID;
    return injectHead(html, postPreviewHead(opts.post, c.req.raw, themeId, version ?? "dev"));
  };
  app.get("/", async (c) => c.html(await configuredViewerHtml(c)));
  app.get("/connect", async (c) =>
    c.html(await configuredViewerHtml(c, { title: "Connect an agent" })),
  );
  // The reshaped viewer routes. They render the same shell as "/" — the engine
  // reads the project/item out of the URL itself.
  const projectPage = async (c: Context) =>
    c.html(await configuredViewerHtml(c, { title: decodeURIComponent(c.req.param("name") ?? "") }));
  app.get("/project/:name", projectPage);
  app.get("/project/:name/:slug", projectPage);
  app.get("/session/:id", async (c) => {
    const session = await store.getSession(c.req.param("id"));
    if (isUnauthenticatedSessionRead(c) && !session) {
      return c.text("Session not found", 404);
    }
    return c.html(await configuredViewerHtml(c, { title: sessionDocumentTitle(session) }));
  });
  const sessionPostPage = async (c: any) => {
    const session = await store.getSession(c.req.param("id"));
    if (isUnauthenticatedSessionRead(c)) {
      const postId = c.req.param("surfaceId") ?? c.req.param("postId");
      const post = await store.getPost(postId ?? "");
      if (!session || !post || post.sessionId !== session.id) {
        return c.text("Session or post not found", 404);
      }
    }
    return c.html(await configuredViewerHtml(c, { title: sessionDocumentTitle(session) }));
  };
  app.get("/session/:id/s/:surfaceId", sessionPostPage); // legacy alias
  app.get("/session/:id/p/:postId", sessionPostPage);
  // Content-hashed bridge/token assets the surface documents reference, so
  // every surface doesn't re-inline the same ~11 KB. Without this route the
  // in-frame bridge never loads and iframes never report their height.
  app.get("/asset/:file", (c) => {
    const asset = staticAsset(`/asset/${c.req.param("file")}`);
    if (!asset) return c.text("Not found", 404);
    c.header("Content-Type", asset.contentType);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(asset.body);
  });
  app.get("/guide", (c) => c.text(withOrigin(guideMarkdown, c)));
  app.get("/setup", (c) => c.text(withOrigin(setupText, c)));
  // `?brief=1` renders the project-aware short guide (its real palette, kit and
  // icon set) instead of the generic text. The renderer lives in designGuide.ts;
  // if it is unavailable or throws, the full guide is still served — an agent
  // asking for instructions must never get an error page.
  app.get("/agent-howto", async (c) => {
    if (c.req.query("brief") !== "1") return c.text(withOrigin(agentHowtoText, c));
    try {
      const { renderBriefGuide } = await import("./designGuide.ts");
      const project =
        c.req.query("project") ?? (await store.listProjects())[0]?.name ?? DEFAULT_PROJECT;
      return c.text(withOrigin(renderBriefGuide(await designFor(project)), c));
    } catch (err) {
      console.warn("[sideshow] brief guide unavailable", err);
      return c.text(withOrigin(agentHowtoText, c));
    }
  });

  // Opt-in html kits available on this workspace (id, label, summary, classes) —
  // for discovery (`sideshow kits`); the CSS/JS payloads are server-only.
  app.get("/api/kits", (c) => c.json(kitSummaries()));

  // --- theme (one workspace-level setting) ---

  app.get("/api/theme", async (c) => {
    const id = (await store.getSetting("theme")) ?? DEFAULT_THEME_ID;
    return c.json({ id, themes: themeOptions() });
  });

  app.put("/api/theme", async (c) => {
    const body = await c.req.json().catch(() => null);
    const id = body && typeof body.id === "string" ? body.id : null;
    if (!id || !themeOptions().some((t) => t.id === id)) {
      return c.json({ error: "unknown theme id" }, 400);
    }
    await store.setSetting("theme", id);
    bus.broadcast({ type: "theme-changed", id });
    return c.json({ id });
  });

  // --- sessions ---

  app.get("/api/sessions", async (c) => {
    const countsPromise = store.countPostsBySession
      ? store.countPostsBySession()
      : store.listPosts().then((posts) => {
          const counts = new Map<string, number>();
          for (const post of posts) {
            counts.set(post.sessionId, (counts.get(post.sessionId) ?? 0) + 1);
          }
          return counts;
        });
    const [sessions, counts] = await Promise.all([store.listSessions(), countsPromise]);
    return c.json(sessions.map((s) => sessionRowView(s, counts.get(s.id) ?? 0)));
  });

  // --- recent posts (post-grained feed source) ---
  //
  // The N most-recently-updated posts across ALL sessions, newest first — one
  // row per post (post-grained), distinct from the session-grained GET
  // /api/sessions. This is the source a cross-session "latest posts" feed needs
  // (Org Home, a per-workspace Home): each item carries its session id/title +
  // agent for the feed card, canonical surfaces, legacy partKinds, and capped
  // previews.
  //
  // Full previews are bounded by recentPostRowView (large inline text clipped
  // with truncated:true); `?preview=home` returns only one compact preview per
  // post for the self-hosted Home. Same auth as /api/sessions — see
  // isPublicReadAllowed, which intentionally does NOT expose this path on a
  // session-scoped publicRead workspace.
  // `legacy` is set only by the /api/surfaces/recent registration below, which
  // must stay byte-identical; the canonical route drops the duplicate
  // `parts`/`partKinds` aliases of `surfaces`.
  const listRecentPosts =
    (legacy = false) =>
    async (c: any) => {
      const limit = parseRecentLimit(c.req.query("limit"));
      const homePreview = c.req.query("preview") === "home";
      const posts = await store.listRecentPosts(limit);
      // Resolve each post's session once (agent + session title for the feed card).
      const sessions = new Map<string, Session | null>();
      for (const p of posts) {
        if (!sessions.has(p.sessionId))
          sessions.set(p.sessionId, await store.getSession(p.sessionId));
      }
      return c.json(
        posts.map((p) => recentPostRowView(p, sessions.get(p.sessionId), { homePreview, legacy })),
      );
    };
  app.get("/api/surfaces/recent", listRecentPosts(true)); // legacy alias
  app.get("/api/posts/recent", listRecentPosts());

  app.post("/api/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const cwd = typeof body.cwd === "string" ? body.cwd : undefined;
    const session = await store.createSession({
      agent: typeof body.agent === "string" ? body.agent : "agent",
      title: typeof body.title === "string" ? body.title.slice(0, MAX_TITLE) : undefined,
      cwd,
      // Explicit project, else the cwd's basename, else the single-workspace
      // fallback — resolved once here so every post this session publishes
      // lands in the same project.
      project: resolveProject(
        typeof body.project === "string" ? body.project.slice(0, MAX_TITLE) : undefined,
        cwd,
      ),
    });
    bus.broadcast({ type: "session-created", id: session.id });
    return c.json(session, 201);
  });

  app.patch("/api/sessions/:id", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.title !== "string") {
      return c.json({ error: 'body must include "title" string' }, 400);
    }
    const session = await store.renameSession(c.req.param("id"), body.title.slice(0, MAX_TITLE));
    if (!session) return c.json({ error: "session not found" }, 404);
    bus.broadcast({ type: "session-updated", id: session.id });
    return c.json(session);
  });

  app.delete("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await store.removeSession(id))) return c.json({ error: "session not found" }, 404);
    bus.broadcast({ type: "session-deleted", id });
    return c.json({ ok: true });
  });

  // `legacy` keeps the duplicate `parts` alias on the two retired spellings,
  // which stay byte-identical; the canonical route drops it.
  const listSessionPosts =
    (legacy = false) =>
    async (c: any) => {
      const session = await store.getSession(c.req.param("id"));
      if (!session) return c.json({ error: "session not found" }, 404);
      const posts = await store.listPosts(session.id);
      return c.json(
        c.req.query("hydrate") === "1"
          ? posts.map(sessionPostHydratedView)
          : posts.map((p) => sessionPostListRowView(p, legacy)),
      );
    };
  app.get("/api/sessions/:id/surfaces", listSessionPosts(true)); // legacy alias
  app.get("/api/sessions/:id/posts", listSessionPosts());
  app.get("/api/sessions/:id/snippets", listSessionPosts(true)); // legacy alias

  // --- session trace ---

  app.get("/api/sessions/:id/trace", async (c) => {
    const session = await store.getSession(c.req.param("id"));
    if (!session) return c.json({ error: "session not found" }, 404);
    return c.json({ steps: await store.listTrace(session.id) });
  });

  // Ingest a batch of trace steps (the sync sends a windowed slice, or the tail
  // since a cursor). `reset: true` replaces the list, for a full re-sync. Steps
  // are sanitized and the per-session list is capped.
  app.post("/api/sessions/:id/trace", async (c) => {
    const session = await store.getSession(c.req.param("id"));
    if (!session) return c.json({ error: "session not found" }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.steps)) {
      return c.json({ error: 'body must include "steps" array' }, 400);
    }
    const clean: TraceStep[] = [];
    for (const s of body.steps) {
      if (!s || typeof s.label !== "string") continue;
      clean.push({
        label: s.label.slice(0, MAX_STEP_LABEL),
        ...(typeof s.kind === "string" && { kind: s.kind.slice(0, 40) }),
        ...(typeof s.detail === "string" && { detail: s.detail.slice(0, MAX_STEP_DETAIL) }),
        ...(typeof s.ts === "string" && { ts: s.ts }),
      });
    }
    const prior = body.reset === true ? [] : await store.listTrace(session.id);
    const merged = prior.concat(clean);
    // roll the list so a long session keeps only its most recent steps
    const bounded = merged.length > MAX_TRACE_STEPS ? merged.slice(-MAX_TRACE_STEPS) : merged;
    await store.setTrace(session.id, bounded);
    bus.broadcast({ type: "trace-updated", sessionId: session.id, count: bounded.length });
    return c.json({ ok: true, added: clean.length, count: bounded.length });
  });

  // --- posts ---

  // History METADATA only by default (version, title, at, from, prompt, author,
  // surface kinds/count — no bodies): the full shape was ~27k tokens for a
  // 20-version post, on the read agents make most often. `?history=full` opts
  // back in, and the legacy aliases below pass it unconditionally so their
  // responses stay byte-identical.
  const getPost =
    (legacy = false) =>
    async (c: any) => {
      const post = await store.getPost(c.req.param("id"));
      if (!post) return c.json({ error: "post not found" }, 404);
      const history = legacy || c.req.query("history") === "full" ? "full" : "meta";
      return c.json(postDetailView(post, { history }));
    };
  // Viewer-only projection for live create/update refetches. Keep this a
  // canonical post subresource: the legacy detail aliases remain byte-for-byte
  // on the full postDetailView contract above.
  app.get("/api/posts/:id/viewer", async (c) => {
    const post = await store.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "post not found" }, 404);
    return c.json({ ...viewerPostView(post), ...itemFields(post) });
  });
  // The post flattened to portable markdown — what the viewer's share menu
  // copies, and the same text on the CLI/HTTP tiers. Another canonical post
  // subresource, like /viewer above. It has to be served rather than derived in
  // the viewer: the hydrated post the viewer holds omits sandboxed surface
  // bodies (see apiViews.ts), so only the server can see the whole post.
  app.get("/api/posts/:id/markdown", async (c) => {
    const post = await store.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "post not found" }, 404);
    const origin = new URL(c.req.url).origin;
    const base = `${origin}${requestBasePath(c.req.raw)}`;
    const markdown = postToMarkdown(post, { postUrl: `${base}/p/${post.id}`, assetBase: base });
    return c.text(markdown, 200, { "content-type": "text/markdown; charset=utf-8" });
  });
  app.get("/api/surfaces/:id", getPost(true)); // legacy alias
  app.get("/api/posts/:id", getPost());
  app.get("/api/snippets/:id", getPost(true)); // legacy alias

  // Accepts either an existing session id, or agent/cwd fields to
  // auto-create a session — so a bare `curl` one-liner works with no ceremony.
  // New clients send `surfaces`; legacy clients send `parts`. Either works.
  const publishPost = async (c: any) => {
    const body = await c.req.json().catch(() => null);
    const blocks = body?.surfaces ?? body?.parts;
    if (!body || !Array.isArray(blocks)) {
      return c.json({ error: 'body must include a "surfaces" (or legacy "parts") array' }, 400);
    }
    const parsed = await validateSurfaces(blocks);
    if (!parsed.ok) return c.json(surfaceValidationErrorBody(parsed), 400);
    return publish(c, body, parsed.surfaces);
  };
  app.post("/api/posts", publishPost); // canonical
  app.post("/api/surfaces", publishPost);

  // Legacy html-only entry — sugar for a single html surface. An optional `kits`
  // array opts the surface into style/behavior bundles; it's validated (strict)
  // like any html surface so an unknown kit id is a clean 400.
  app.post("/api/snippets", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.html !== "string" || !body.html.trim()) {
      return c.json({ error: 'body must include non-empty "html" string' }, 400);
    }
    const parsed = await validateSurfaces([htmlSurface(body.html, body.kits)]);
    if (!parsed.ok) return c.json(surfaceValidationErrorBody(parsed), 400);
    return publish(c, body, parsed.surfaces);
  });

  // The built-in welcome/test post (server/welcomePost.ts): the same fixed card
  // the MCP send_test_post tool publishes, reachable from the CLI and raw-HTTP
  // tiers (`sideshow test-post`, `curl -X POST .../api/test-post`). The body is
  // optional (`{agent?}` labels a newly created session). Idempotent — if the
  // card is already on the board it is returned (200 + alreadySent) rather than
  // duplicated; a fresh publish is a 201 like any other post.
  app.post("/api/test-post", async (c) => {
    const existing = await findWelcomePost(store);
    if (existing) {
      return c.json({ ...postWriteView(existing), alreadySent: true });
    }
    const body = await c.req.json().catch(() => null);
    const result = await publishPostFlow({
      surfaces: welcomeSurfaces(),
      title: WELCOME_POST_TITLE,
      sessionTitle: WELCOME_SESSION_TITLE,
      agent: typeof body?.agent === "string" ? body.agent : undefined,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(
      {
        ...postWriteView(result.post),
        ...itemFields(result.post),
        ...(result.userFeedback && { userFeedback: result.userFeedback }),
      },
      201,
    );
  });

  async function publish(c: any, body: any, surfaces: Surface[]) {
    const version = Number(body.from);
    const result = await publishPostFlow({
      surfaces,
      title: typeof body.title === "string" ? body.title : undefined,
      session: typeof body.session === "string" ? body.session : undefined,
      sessionTitle: typeof body.sessionTitle === "string" ? body.sessionTitle : undefined,
      agent: typeof body.agent === "string" ? body.agent : undefined,
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      project: typeof body.project === "string" ? body.project.slice(0, MAX_TITLE) : undefined,
      slug: typeof body.slug === "string" ? body.slug.slice(0, MAX_TITLE) : undefined,
      kind: body.kind === "page" ? "page" : body.kind === "component" ? "component" : undefined,
      variant: typeof body.variant === "string" ? body.variant.slice(0, MAX_TITLE) : undefined,
      from: Number.isInteger(version) && version > 0 ? version : undefined,
      prompt: typeof body.prompt === "string" ? body.prompt.slice(0, MAX_COMMENT_TEXT) : undefined,
      slots: sanitizeSlots(body.slots),
      author: typeof body.author === "string" ? body.author.slice(0, MAX_TITLE) : undefined,
      request: c.req.raw,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(
      {
        ...postWriteView(result.post),
        ...itemFields(result.post),
        ...(result.userFeedback && { userFeedback: result.userFeedback }),
      },
      201,
    );
  }

  function sanitizeSlots(raw: unknown): Slot[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const slots: Slot[] = [];
    for (const entry of raw.slice(0, 50)) {
      if (!entry || typeof entry !== "object") continue;
      const s = entry as Record<string, unknown>;
      if (typeof s.slug !== "string" || !s.slug) continue;
      const version = Number(s.version);
      slots.push({
        slug: slugify(s.slug),
        variant: typeof s.variant === "string" && s.variant ? s.variant : DEFAULT_VARIANT,
        version: Number.isInteger(version) && version > 0 ? version : 1,
      });
    }
    return slots;
  }

  const revise = async (c: any) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    // posts: a `surfaces` array (legacy `parts`); snippets: an `html` string.
    // Presence — not nullishness — gates validation, so an explicit
    // `surfaces: null` is a 400 (like POST) rather than a silent title-only update.
    const hasBlocks = body.surfaces !== undefined || body.parts !== undefined;
    const blocks = body.surfaces ?? body.parts;
    let surfaces: Surface[] | undefined;
    if (hasBlocks) {
      if (!Array.isArray(blocks)) {
        return c.json({ error: '"surfaces" (or legacy "parts") must be an array' }, 400);
      }
      const parsed = await validateSurfaces(blocks);
      if (!parsed.ok) return c.json(surfaceValidationErrorBody(parsed), 400);
      surfaces = parsed.surfaces;
    } else if (typeof body.html === "string") {
      const parsed = await validateSurfaces([htmlSurface(body.html, body.kits)]);
      if (!parsed.ok) return c.json(surfaceValidationErrorBody(parsed), 400);
      surfaces = parsed.surfaces;
    }
    const from = Number(body.from);
    const result = await revisePost(c.req.param("id"), {
      surfaces,
      title: typeof body.title === "string" ? body.title : undefined,
      from: Number.isInteger(from) && from > 0 ? from : undefined,
      prompt: typeof body.prompt === "string" ? body.prompt.slice(0, MAX_COMMENT_TEXT) : undefined,
      author: typeof body.author === "string" ? body.author.slice(0, MAX_TITLE) : undefined,
      slots: sanitizeSlots(body.slots),
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({
      ...postWriteView(result.post),
      ...itemFields(result.post),
      ...(result.userFeedback && { userFeedback: result.userFeedback }),
    });
  };
  app.put("/api/surfaces/:id", revise);
  app.put("/api/posts/:id", revise); // canonical alias
  app.put("/api/snippets/:id", revise); // legacy alias

  // Content-only update: accepts raw content and slots it into the existing
  // surface's kind, preserving extra fields (language, cols, layout, etc.).
  // The optional `surface` field (surface id or 0-based index) targets a
  // specific surface in a multi-surface post; without it, the post must have
  // a single surface (back-compat with the original behavior).
  app.patch("/api/posts/:id", async (c: any) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const { content, title, kits, surface } = body;
    if (content === undefined && title === undefined) {
      return c.json({ error: "provide content and/or title" }, 400);
    }
    const existing = await store.getPost(c.req.param("id"));
    if (!existing) return c.json({ error: "post not found" }, 404);
    let surfaces: Surface[] | undefined;
    if (content !== undefined) {
      if (typeof content !== "string") {
        return c.json({ error: '"content" must be a string' }, 400);
      }
      const targetIdx =
        surface !== undefined
          ? findSurfaceIndex(existing.surfaces, String(surface))
          : existing.surfaces.length === 1
            ? 0
            : -1;
      if (targetIdx < 0) {
        if (surface !== undefined) {
          return c.json({ error: `surface "${surface}" not found` }, 404);
        }
        return c.json(
          {
            error:
              'content update requires a "surface" target (id or index) for multi-surface posts',
          },
          400,
        );
      }
      const updated = applyContent(existing.surfaces[targetIdx], content, kits);
      if (!updated) {
        return c.json(
          {
            error: `content update not supported for ${existing.surfaces[targetIdx].kind} surfaces`,
          },
          400,
        );
      }
      const parsed = await validateSurfaces([updated]);
      if (!parsed.ok) return c.json(surfaceValidationErrorBody(parsed), 400);
      surfaces = [...existing.surfaces];
      surfaces[targetIdx] = { ...parsed.surfaces[0], id: existing.surfaces[targetIdx].id };
    }
    const result = await revisePost(c.req.param("id"), {
      surfaces,
      title: typeof title === "string" ? title : undefined,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({
      ...postWriteView(result.post),
      ...itemFields(result.post),
      ...(result.userFeedback && { userFeedback: result.userFeedback }),
    });
  });

  // --- per-surface sub-resource routes ---

  // Append a surface to an existing post. Optional `before`/`after` (surface
  // id or index) controls insert position; default is append at the end.
  app.post("/api/posts/:id/surfaces", async (c: any) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !body.surface) {
      return c.json({ error: 'body must include a "surface" object' }, 400);
    }
    const parsed = await validateSurfaces([body.surface]);
    if (!parsed.ok) return c.json(surfaceValidationErrorBody(parsed), 400);
    const result = await appendPostSurface(c.req.param("id"), parsed.surfaces[0], {
      before: body.before,
      after: body.after,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({
      ...postWriteView(result.post),
      ...itemFields(result.post),
      ...(result.userFeedback && { userFeedback: result.userFeedback }),
    });
  });

  // Replace or content-edit a single surface. `:target` is a surface id or
  // 0-based index. Body: `{surface}` for full replacement, or `{content}` for
  // content-only (preserves kind + extra fields).
  app.patch("/api/posts/:id/surfaces/:target", async (c: any) => {
    const body = await c.req.json().catch(() => null);
    if (!body || (body.surface === undefined && body.content === undefined)) {
      return c.json({ error: 'body must include "surface" or "content"' }, 400);
    }
    let surface: Surface | undefined;
    if (body.surface !== undefined) {
      const parsed = await validateSurfaces([body.surface]);
      if (!parsed.ok) return c.json(surfaceValidationErrorBody(parsed), 400);
      surface = parsed.surfaces[0];
    }
    const result = await replacePostSurface(c.req.param("id"), c.req.param("target"), {
      surface,
      content: body.content,
      kits: body.kits,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({
      ...postWriteView(result.post),
      ...itemFields(result.post),
      ...(result.userFeedback && { userFeedback: result.userFeedback }),
    });
  });

  // Remove a single surface. `:target` is a surface id or 0-based index.
  // Rejects with 400 if it's the last surface (posts need ≥1).
  app.delete("/api/posts/:id/surfaces/:target", async (c: any) => {
    const result = await removePostSurface(c.req.param("id"), c.req.param("target"));
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({
      ...postWriteView(result.post),
      ...itemFields(result.post),
      ...(result.userFeedback && { userFeedback: result.userFeedback }),
    });
  });

  // Reorder surfaces. Body: `{order: [id, ...]}` or `{order: [0, 2, 1]}`.
  app.patch("/api/posts/:id/surfaces", async (c: any) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.order)) {
      return c.json({ error: 'body must include an "order" array' }, 400);
    }
    const result = await reorderPostSurfaces(c.req.param("id"), body.order);
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({
      ...postWriteView(result.post),
      ...itemFields(result.post),
      ...(result.userFeedback && { userFeedback: result.userFeedback }),
    });
  });

  const remove = async (c: any) => {
    const post = await store.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "post not found" }, 404);
    await store.removePost(post.id);
    bus.broadcast({ type: "post-deleted", id: post.id, sessionId: post.sessionId });
    return c.json({ ok: true });
  };
  app.delete("/api/surfaces/:id", remove);
  app.delete("/api/posts/:id", remove); // canonical alias
  app.delete("/api/snippets/:id", remove); // legacy alias

  // --- comments ---

  app.post("/api/comments", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.text !== "string" || !body.text.trim()) {
      return c.json({ error: 'body must include non-empty "text" string' }, 400);
    }
    const surface = typeof body.surface === "string" ? body.surface : body.snippet;
    // The browser sets Fetch Metadata on same-origin requests. Only the trusted
    // viewer may declare the two non-agent labels; CLI, MCP, and raw HTTP calls
    // instead derive their author from the session and cannot mint "user".
    // Sandboxed surfaces have opaque origins, so their postMessage bridge is
    // stamped "surface" by the trusted viewer rather than by contained code.
    const isViewerOrigin = c.req.header("sec-fetch-site") === "same-origin";
    const author =
      isViewerOrigin && (body.author === "user" || body.author === "surface")
        ? body.author
        : undefined;
    const kind: CommentKind | undefined =
      typeof body.kind === "string" &&
      ["comment", "revise", "accept", "drop", "ask", "reply"].includes(body.kind)
        ? (body.kind as CommentKind)
        : undefined;
    const result = await createComment({
      text: body.text,
      surface: typeof surface === "string" ? surface : undefined,
      author,
      anchor: body.anchor,
      kind,
      anchors: body.anchors,
      // Same trust rule as `author`: only the viewer origin may hold a comment
      // back as a draft, so no agent channel can hide feedback from itself.
      draft: isViewerOrigin && body.draft === true,
      postVersion: body.postVersion,
      viewport: body.viewport,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(
      { ...result.comment, ...(result.userFeedback && { userFeedback: result.userFeedback }) },
      201,
    );
  });

  app.delete("/api/comments/:id", async (c) => {
    const comment = await store.removeComment(c.req.param("id"));
    if (!comment) return c.json({ error: "comment not found" }, 404);
    bus.broadcast({ type: "comment-deleted", id: comment.id, sessionId: comment.sessionId });
    return c.json({ ok: true });
  });

  // The viewer's update notice: running version vs latest published release.
  app.get("/api/version", async (c) => {
    if (!version) return c.json({ current: null, latest: null, updateAvailable: false });
    const latest = await latestRelease();
    const updateAvailable = latest !== null && versionGt(latest.version, version);
    return c.json({
      current: version,
      latest: latest?.version ?? null,
      updateAvailable,
      upgradeCommand: updateAvailable ? (upgradeCommand ?? null) : null,
      notes: updateAvailable ? (latest?.notes ?? null) : null,
    });
  });

  // Long-poll friendly: ?wait=N holds the request open up to N seconds until
  // a matching comment arrives. This is how terminal agents block on feedback.
  // A wait counts against the connection cap (it pins a socket just like SSE);
  // an instant ?wait=0 read does not.
  app.get("/api/comments", async (c) => {
    const sessionId = c.req.query("session");
    const surfaceId = c.req.query("surface") ?? c.req.query("snippet");
    if (isUnauthenticatedSessionRead(c)) {
      if (!sessionId && !surfaceId) return c.json({ error: "session or surface required" }, 401);
      if (sessionId && !(await store.getSession(sessionId))) {
        return c.json({ error: "session not found" }, 404);
      }
      if (surfaceId) {
        const post = await store.getPost(surfaceId);
        if (!post || (sessionId && post.sessionId !== sessionId)) {
          return c.json({ error: "post not found" }, 404);
        }
      }
    }
    const waitSeconds = Number(c.req.query("wait") ?? 0) || 0;
    const author = c.req.query("author");
    // An `author=user` read (or any wait) is the agent listening. Everything
    // else is the viewer reading a card's thread: it gets the drafts and the
    // per-comment delivery state, and it is NOT batched.
    const isAgentRead = author === "user" || waitSeconds > 0;
    const query = {
      sessionId,
      surfaceId,
      author,
      afterSeq: c.req.query("after") ? Number(c.req.query("after")) : undefined,
      waitSeconds,
      includeDrafts: !isAgentRead,
    };
    const respond = async (result: { comments: Comment[]; lastSeq: number }) => {
      if (isAgentRead) {
        const feedback = await batchFeedback(result.comments);
        // Legacy fields stay byte-identical; the batch rides alongside under
        // both the wait-side and write-side names.
        return c.json({ ...result, feedback, userFeedback: feedback });
      }
      return c.json({ ...result, comments: await withSeen(result.comments) });
    };
    if (waitSeconds > 0) {
      if (!acquireHold()) return c.json({ error: "too many concurrent connections" }, 503);
      const release = makeRelease();
      // If the client disconnects mid-wait, release the slot promptly.
      c.req.raw.signal.addEventListener("abort", release, { once: true });
      try {
        return await respond(await waitForComments(query, c.req.raw.signal));
      } finally {
        release();
      }
    }
    return respond(await waitForComments(query));
  });

  // Inline each `<sideshow-slot>` with the referenced variant version's first
  // html surface body. The stored `slots` list (resolved at publish) wins over
  // a bare tag, so a page keeps rendering the versions it was composed from.
  async function expandPageHtml(post: Post, html: string): Promise<string> {
    const pinned = new Map(post.slots.map((s) => [`${s.slug}::${s.variant}`, s.version]));
    const bodies = new Map<string, string | null>();
    for (const tag of parseSlotTags(html)) {
      const key = `${tag.slug}::${tag.variant}`;
      const version = tag.version ?? pinned.get(key) ?? null;
      const cacheKey = `${key}::${version}`;
      if (bodies.has(cacheKey)) continue;
      const variant = await store.findVariant(post.project, tag.slug, tag.variant);
      if (!variant) {
        bodies.set(cacheKey, null);
        continue;
      }
      const surfaces =
        version == null || version === variant.version
          ? variant.surfaces
          : (variant.history.find((h) => h.version === version)?.surfaces ?? null);
      const body = surfaces?.find((s) => s.kind === "html");
      bodies.set(cacheKey, body && body.kind === "html" ? body.html : null);
    }
    return expandSlots(html, ({ slug, variant, version }) => {
      const key = `${slug}::${variant}`;
      const pinnedVersion = version ?? pinned.get(key) ?? null;
      return bodies.get(`${key}::${pinnedVersion}`) ?? null;
    });
  }

  // --- demo workspace (reshape) ---
  //
  // Seeds one realistic project so the item screen, variant tabs, version rail,
  // slots, drafts and the waiting state all have something to render. Idempotent:
  // a second call returns the existing project rather than duplicating it.

  const DEMO_PROJECT = "acme/site";

  const demoCard = (name: string, price: string, sub: string, hi: boolean, feats: string[]) =>
    `<div class="tier${hi ? " hi" : ""}"><h4>${name}</h4><div class="price">${price}<span class="per">/mo</span></div><p class="sub">${sub}</p><ul>${feats
      .map((f) => `<li>${f}</li>`)
      .join("")}</ul><button class="btn${hi ? " primary" : ""}">Choose ${name}</button></div>`;

  const DEMO_CSS = `<style>
    :root{color-scheme:light dark}
    body{margin:0;padding:24px;font:14px/1.55 ui-sans-serif,system-ui,sans-serif;color:var(--color-text,#111);background:var(--color-surface,#fff)}
    h1,h4{margin:0}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .tier{border:1px solid var(--color-border,#e4e4e7);border-radius:12px;padding:16px;display:flex;flex-direction:column}
    .tier.hi{border-color:var(--color-info-border,#2563eb);box-shadow:0 0 0 1px var(--color-info-border,#2563eb)}
    .price{font-size:26px;font-weight:650;margin:8px 0 2px}
    .per{font-size:12px;font-weight:400;color:var(--color-muted,#71717a)}
    .sub{color:var(--color-muted,#71717a);font-size:12px;margin:0 0 10px}
    ul{margin:0 0 14px;padding-left:16px;color:var(--color-muted,#71717a);font-size:12px;line-height:1.7}
    .btn{margin-top:auto;padding:8px 12px;border-radius:8px;border:1px solid var(--color-border,#e4e4e7);background:transparent;color:inherit;font:inherit;cursor:pointer}
    .btn.primary{background:var(--color-info-bg,#2563eb);border-color:transparent;color:var(--color-info-text,#fff)}
    .toggle{display:inline-flex;gap:6px;align-items:center;margin-bottom:12px;color:var(--color-muted,#71717a);font-size:12px}
    .row{display:flex;align-items:center;gap:14px;border:1px solid var(--color-border,#e4e4e7);border-radius:10px;padding:12px 14px;margin-bottom:8px}
    .row b{display:block}
    .eyebrow{font-size:11px;color:var(--color-info-text,#2563eb);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px}
    details{border-bottom:1px solid var(--color-border,#e4e4e7);padding:10px 0}
    summary{cursor:pointer;font-weight:600}
  </style>`;

  const demoToggle = `<label class="toggle"><input type="checkbox"> Annual (&minus;20%)</label>`;

  const demoGrid = (toggle: boolean) =>
    `${DEMO_CSS}${toggle ? demoToggle : ""}<div class="grid">${demoCard("Starter", "$0", "For trying things out", false, ["Unlimited posts", "5 agents", "Email support"])}${demoCard("Pro", "$12", "For daily use", true, ["Unlimited posts", "Unlimited agents", "Email support"])}${demoCard("Team", "$40", "For groups", false, ["Unlimited posts", "Unlimited agents", "SSO + priority support"])}</div>`;

  const demoQuiet = `${DEMO_CSS}<div class="grid">${[
    ["Starter", "$0", "Try it"],
    ["Pro", "$12", "Daily use"],
    ["Team", "$40", "Groups"],
  ]
    .map(
      ([n, p, sub]) =>
        `<div class="tier"><h4 style="font-weight:500">${n}</h4><div class="price" style="font-weight:500">${p}</div><p class="sub">${sub}</p><a href="#" style="color:inherit;font-size:12px">Choose &rarr;</a></div>`,
    )
    .join("")}</div>`;

  const demoStacked = (toggle: boolean) =>
    `${DEMO_CSS}${toggle ? demoToggle : ""}${[
      ["Starter", "$0", "Try it, 5 agents"],
      ["Pro", "$12", "Daily use, unlimited agents"],
      ["Team", "$40", "SSO, priority support"],
    ]
      .map(
        ([n, p, sub]) =>
          `<div class="row"><div style="flex:1"><b>${n}</b><span class="sub">${sub}</span></div><div style="font-size:18px;font-weight:600">${p}</div><button class="btn${n === "Pro" ? " primary" : ""}">Choose</button></div>`,
      )
      .join("")}`;

  const demoHero = (long: boolean) =>
    `${DEMO_CSS}<div style="max-width:560px"><div class="eyebrow">New &middot; Teams</div><h1 style="font-size:30px;line-height:1.15;margin:0 0 12px">Ship the design, not the handoff.</h1><p class="sub" style="font-size:14px">Agents publish what they built. You react from your phone.${
      long
        ? " Every post keeps its history, every comment reaches the agent, and nothing gets lost between the chat and the code, ever."
        : " Nothing gets lost between the chat and the code."
    }</p><div style="display:flex;gap:8px"><button class="btn primary">Start free</button><button class="btn">See pricing</button></div></div>`;

  const demoFaq = `${DEMO_CSS}<div>${[
    [
      "Can I cancel any time?",
      "Yes. Cancelling stops the next charge; the workspace stays readable.",
    ],
    ["Does Team include SSO?", "SAML SSO is included on Team."],
    ["What counts as a seat?", "Anyone who can comment. Agents are free."],
  ]
    .map(
      ([q, a], i) =>
        `<details ${i ? "" : "open"}><summary>${q}</summary><p class="sub" style="margin:6px 0 0">${a}</p></details>`,
    )
    .join("")}</div>`;

  const demoCta = (solid: boolean) =>
    `${DEMO_CSS}<div style="display:flex;gap:10px;align-items:center"><button class="btn${solid ? " primary" : ""}">Start free</button><span class="sub">${solid ? "solid" : "ghost"} — 14px/8px, 8px radius</span></div>`;

  const demoPage = `${DEMO_CSS}<main style="display:flex;flex-direction:column;gap:32px">
    <sideshow-slot slug="hero" variant="default"></sideshow-slot>
    <sideshow-slot slug="pricing-card" variant="highlighted"></sideshow-slot>
    <sideshow-slot slug="faq" variant="default"></sideshow-slot>
  </main>`;

  app.post("/api/demo/reshape", async (c) => {
    const existing = await store.listItems(DEMO_PROJECT);
    if (existing.length > 0) {
      return c.json({ project: DEMO_PROJECT, items: existing, alreadySent: true });
    }
    // Two more projects: one with a single item, one a connected session that
    // has published nothing yet (the "waiting for the first publish" state).
    const appSession = await store.createSession({
      agent: "designer",
      title: "Designer — acme/app",
      cwd: "/Users/demo/code/app",
      project: "acme/app",
    });
    const appResult = await publishPostFlow({
      session: appSession.id,
      project: "acme/app",
      surfaces: [htmlSurface(demoHero(false))],
      title: "App hero",
      slug: "app-hero",
      author: "designer",
      prompt: "initial",
    });
    if ("error" in appResult) throw new Error(appResult.error);
    await store.createSession({
      agent: "designer",
      title: "Designer — loom",
      cwd: "/Users/demo/code/loom",
      project: "loom",
    });

    const session = await store.createSession({
      agent: "designer",
      title: "Designer — acme/site",
      cwd: "/Users/demo/code/site",
      project: DEMO_PROJECT,
    });
    bus.broadcast({ type: "session-created", id: session.id });

    const publish = async (input: {
      slug: string;
      title: string;
      variant?: string;
      kind?: ItemKind;
      html: string;
      prompt?: string;
      from?: number;
    }) => {
      const result = await publishPostFlow({
        session: session.id,
        project: DEMO_PROJECT,
        surfaces: [htmlSurface(input.html)],
        title: input.title,
        slug: input.slug,
        variant: input.variant,
        kind: input.kind,
        prompt: input.prompt,
        from: input.from,
        author: "designer",
      });
      if ("error" in result) throw new Error(result.error);
      return result.post;
    };

    await publish({
      slug: "pricing-card",
      title: "Pricing card",
      variant: "quiet",
      html: demoQuiet,
      prompt: "initial exploration",
    });
    await publish({
      slug: "pricing-card",
      title: "Pricing card",
      variant: "stacked",
      html: demoStacked(false),
      prompt: "initial exploration",
    });
    // The highlighted variant carries the real history: v2 added the toggle,
    // v3 branched back from v1 keeping it.
    await publish({
      slug: "pricing-card",
      title: "Pricing card",
      variant: "highlighted",
      html: demoGrid(false),
      prompt: "initial exploration",
    });
    await publish({
      slug: "pricing-card",
      title: "Pricing card",
      variant: "highlighted",
      html: demoStacked(true),
      prompt: "you: add an annual toggle",
      from: 1,
    });
    const pricing = await publish({
      slug: "pricing-card",
      title: "Pricing card",
      variant: "highlighted",
      html: demoGrid(true),
      prompt: "you: prefer the highlighted middle from v1, keep the toggle",
      from: 1,
    });

    await publish({ slug: "hero", title: "Hero", html: demoHero(true), prompt: "initial" });
    await publish({
      slug: "hero",
      title: "Hero",
      html: demoHero(false),
      prompt: "you: too much copy",
      from: 1,
    });
    await publish({ slug: "faq", title: "FAQ accordion", html: demoFaq, prompt: "initial" });
    const page = await publish({
      slug: "pricing-page",
      title: "Pricing page",
      kind: "page",
      html: demoPage,
      prompt: "composed from the picked components",
    });

    // A decided item: one accepted variant, one archived sibling — so the tabs,
    // the ✓ and the "archived (n)" line all have something to render.
    const solid = await publish({
      slug: "cta-button",
      title: "CTA button",
      variant: "solid",
      html: demoCta(true),
      prompt: "initial",
    });
    const ghost = await publish({
      slug: "cta-button",
      title: "CTA button",
      variant: "ghost",
      html: demoCta(false),
      prompt: "initial",
    });
    await store.setPostStatus(solid.id, "accepted");
    await store.setPostStatus(ghost.id, "archived");

    // A comment the agent already picked up, so the thread shows `seen`.
    const delivered = await store.createComment({
      sessionId: session.id,
      postId: pricing.id,
      author: "user",
      text: "Prefer the highlighted middle from v1, keep the annual toggle.",
      kind: "comment",
      postVersion: pricing.version,
      viewport: 1280,
    });
    if (delivered) await store.markAgentSeen(session.id, delivered.seq);

    // One unsent draft with a marker, so the overlay and the "not sent yet"
    // state have something to show.
    const draft = await store.createComment({
      sessionId: session.id,
      postId: pricing.id,
      author: "user",
      text: "Make @1 wider — the middle tier gets cramped at 820.",
      kind: "comment",
      draft: true,
      postVersion: pricing.version,
      viewport: 820,
      anchors: [
        {
          ref: "@1",
          shape: "rect",
          box: [0.34, 0.12, 0.32, 0.7],
          surfaceIndex: 0,
          postVersion: pricing.version,
          path: "div.grid > div.tier.hi",
          text: "Pro",
          viewport: 820,
        },
      ],
    });
    // ...and an ask, so the item shows as waiting on the operator.
    const askText = "Branched v3 from v1 with the toggle. Accept or revise?";
    await store.setPostAsk(pricing.id, { text: askText, at: new Date().toISOString() });
    await createComment({ text: askText, surface: pricing.id, kind: "ask" });
    bus.broadcast({
      type: "post-updated",
      id: pricing.id,
      sessionId: session.id,
      version: pricing.version,
    });

    return c.json(
      {
        project: DEMO_PROJECT,
        sessionId: session.id,
        items: await store.listItems(DEMO_PROJECT),
        pageId: page.id,
        pricingId: pricing.id,
        draftId: draft?.id ?? null,
      },
      201,
    );
  });

  // --- projects, items, variants ---
  //
  // Navigation is project > item > variant > version. These are reads over the
  // same posts the legacy session routes serve; nothing here changes the old
  // shapes.

  app.get("/api/projects", async (c) => c.json(await store.listProjects()));

  app.get("/api/projects/:name/items", async (c) =>
    c.json(await store.listItems(c.req.param("name"))),
  );

  app.get("/api/projects/:name/items/:slug", async (c) => {
    const item = await store.getItem(c.req.param("name"), c.req.param("slug"));
    if (!item) return c.json({ error: "item not found" }, 404);
    return c.json(item);
  });

  // The project's design system, imported by `sideshow init` and injected into
  // every html surface of the project (see renderHtmlPage).
  app.get("/api/projects/:name/design", async (c) => c.json(await designFor(c.req.param("name"))));

  app.put("/api/projects/:name/design", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid JSON body" }, 400);
    const kit = body.kit === "tailwind" || body.kit === "builtin" ? body.kit : "none";
    const design: DesignSettings = {
      detected:
        body.detected && typeof body.detected === "object"
          ? {
              tailwind: body.detected.tailwind === true,
              shadcn: body.detected.shadcn === true,
              cssVars: Number(body.detected.cssVars) || 0,
              fonts: Array.isArray(body.detected.fonts)
                ? body.detected.fonts.filter((f: unknown) => typeof f === "string").slice(0, 20)
                : [],
            }
          : null,
      palette:
        body.palette && typeof body.palette === "object" && body.palette.light && body.palette.dark
          ? body.palette
          : null,
      kit,
      cssVars: typeof body.cssVars === "string" ? body.cssVars.slice(0, 64_000) : "",
      iconsAssetId: typeof body.iconsAssetId === "string" ? body.iconsAssetId : null,
      updatedAt: new Date().toISOString(),
    };
    await store.setSetting(`design:${c.req.param("name")}`, JSON.stringify(design));
    // Every rendered surface bakes the design into its document string, so a
    // design change invalidates them all.
    clearRenderCache();
    bus.broadcast({
      type: "theme-changed",
      id: (await store.getSetting("theme")) ?? DEFAULT_THEME_ID,
    });
    return c.json(design);
  });

  // The accepted html an implementing agent compares its own work against.
  app.get("/api/projects/:name/items/:slug/export", async (c) => {
    const item = await store.getItem(c.req.param("name"), c.req.param("slug"));
    if (!item) return c.json({ error: "item not found" }, 404);
    const wanted = c.req.query("variant");
    const variant =
      (wanted && item.variants.find((v) => v.variant === wanted)) ||
      item.variants.find((v) => v.status === "accepted") ||
      item.variants[0];
    if (!variant) return c.json({ error: "variant not found" }, 404);
    const html = variant.surfaces.find((s) => s.kind === "html");
    const origin = new URL(c.req.url).origin;
    const base = `${origin}${requestBasePath(c.req.raw)}`;
    return c.json({
      project: item.project,
      slug: item.slug,
      variant: variant.variant,
      version: variant.version,
      status: variant.status,
      html: html && html.kind === "html" ? html.html : "",
      prompts: variant.history.map((h) => ({
        version: h.version,
        at: h.at,
        from: h.from ?? null,
        prompt: h.prompt ?? "",
      })),
      screenshotUrl: screenshots ? `${base}/p/${variant.postId}.png?v=${variant.version}` : null,
    });
  });

  // --- ask / decisions ---

  // The agent blocks on the operator: marks the variant waiting and files an
  // agent-authored `ask` comment so the request shows in the card's thread.
  app.post("/api/posts/:id/ask", async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return c.json({ error: 'body must include non-empty "text" string' }, 400);
    const post = await store.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "post not found" }, 404);
    const ask = { text: text.slice(0, MAX_COMMENT_TEXT), at: new Date().toISOString() };
    const updated = await store.setPostAsk(post.id, ask);
    if (!updated) return c.json({ error: "post not found" }, 404);
    await createComment({ text: ask.text, surface: post.id, kind: "ask" });
    bus.broadcast({
      type: "post-updated",
      id: updated.id,
      sessionId: updated.sessionId,
      version: updated.version,
    });
    fireNotify({
      event: "ask",
      project: updated.project,
      slug: updated.slug,
      variant: updated.variant,
      version: updated.version,
      text: ask.text,
      url: postUrl(c.req.raw, updated),
    });
    return c.json({ ...postWriteView(updated), ...itemFields(updated) });
  });

  // Accept / revise / drop. Each is a comment with a kind, so delivery rides
  // the one cursor unchanged — the agent hears the verdict through the same
  // channel as any other feedback.
  app.post("/api/posts/:id/decision", async (c) => {
    const body = await c.req.json().catch(() => null);
    const kind = body?.kind;
    if (kind !== "accept" && kind !== "revise" && kind !== "drop") {
      return c.json({ error: 'kind must be "accept", "revise" or "drop"' }, 400);
    }
    const post = await store.getPost(c.req.param("id"));
    if (!post) return c.json({ error: "post not found" }, 404);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_COMMENT_TEXT) : "";
    if (kind === "accept") {
      await store.setPostStatus(post.id, "accepted");
      const item = await store.getItem(post.project, post.slug);
      for (const sibling of item?.variants ?? []) {
        if (sibling.postId !== post.id) await store.setPostStatus(sibling.postId, "archived");
      }
    } else if (kind === "drop") {
      await store.setPostStatus(post.id, "archived");
    }
    // EVERY decision releases the operator's accumulated drafts, not just
    // Revise. Notes written before an Accept or a Drop are still feedback the
    // agent must hear (why this variant won, what to fix next time) — leaving
    // them as drafts silently loses them, since nothing else ever releases a
    // draft on a decided variant. They get fresh seqs, so the one cursor
    // delivers them exactly once alongside the decision.
    const released: Comment[] = await store.releaseDrafts(post.id);
    await store.setPostAsk(post.id, null);
    const decision = await store.createComment({
      sessionId: post.sessionId,
      postId: post.id,
      author: "user",
      text,
      kind,
      draft: false,
      postVersion: post.version,
    });
    for (const comment of [...released, ...(decision ? [decision] : [])]) {
      bus.broadcast({
        type: "comment-created",
        id: comment.id,
        sessionId: comment.sessionId,
        surfaceId: comment.postId,
        seq: comment.seq,
      });
    }
    const updated = (await store.getPost(post.id)) ?? post;
    bus.broadcast({
      type: "post-updated",
      id: updated.id,
      sessionId: updated.sessionId,
      version: updated.version,
    });
    fireNotify({
      event: "decision",
      project: updated.project,
      slug: updated.slug,
      variant: updated.variant,
      version: updated.version,
      text: text || kind,
      url: postUrl(c.req.raw, updated),
    });
    return c.json({
      ...postWriteView(updated),
      ...itemFields(updated),
      released: released.length,
    });
  });

  // Un-archive a variant hidden behind the "archived (n)" line.
  app.post("/api/posts/:id/restore", async (c) => {
    const updated = await store.setPostStatus(c.req.param("id"), "open");
    if (!updated) return c.json({ error: "post not found" }, 404);
    bus.broadcast({
      type: "post-updated",
      id: updated.id,
      sessionId: updated.sessionId,
      version: updated.version,
    });
    return c.json({ ...postWriteView(updated), ...itemFields(updated) });
  });

  // The operator's unsent notes on a variant (viewer read only).
  app.get("/api/posts/:id/drafts", async (c) =>
    c.json(await withSeen(await store.listDrafts(c.req.param("id")))),
  );

  // --- push and webhooks ---

  app.get("/api/push/vapid", async (c) =>
    c.json({ publicKey: (await vapidKeys(store)).publicKey }),
  );

  app.post("/api/push/subscribe", async (c) => {
    const body = await c.req.json().catch(() => null);
    const subscription = body?.subscription ?? body;
    if (!isPushSubscription(subscription)) {
      return c.json({ error: "invalid push subscription" }, 400);
    }
    await addSubscription(store, subscription);
    return c.body(null, 204);
  });

  app.get("/api/hooks", async (c) => c.json(await listHooks(store)));

  app.post("/api/hooks", async (c) => {
    const body = await c.req.json().catch(() => null);
    const url = typeof body?.url === "string" ? body.url : "";
    if (!/^https?:\/\//.test(url))
      return c.json({ error: 'body must include an http(s) "url"' }, 400);
    const events = (Array.isArray(body.events) ? body.events : []).filter(
      (e: unknown): e is HookEvent => e === "ask" || e === "publish" || e === "decision",
    );
    if (events.length === 0) {
      return c.json({ error: '"events" must list "ask", "publish" and/or "decision"' }, 400);
    }
    const hook: Hook = { id: newId(), url, events };
    await addHook(store, hook);
    return c.json({ id: hook.id }, 201);
  });

  app.delete("/api/hooks/:id", async (c) => {
    if (!(await removeHook(store, c.req.param("id")))) {
      return c.json({ error: "hook not found" }, 404);
    }
    return c.json({ ok: true });
  });

  // --- rendering ---

  // Serves one surface of a post as a themed, sandboxed document. The viewer
  // points an iframe here for every surface kind that becomes HTML — html surfaces
  // (author markup) and the rich kinds (markdown/code/diff/terminal rendered
  // server-side; mermaid as a self-rendering CDN doc). Image/trace/json surfaces
  // are data the viewer renders natively (text nodes / <img> / JSX), so they
  // never reach here.
  // Everything a rendered document depends on. The resolved version makes a
  // version's content immutable, and `origin` is in the key because it is baked
  // into the document (CSP, <base>, asset URLs) — a pre-warm triggered by an
  // agent publishing over one origin must never be served to a viewer on another.
  const renderKey = (o: {
    postId: string;
    idx: number;
    version: number;
    themeId: string;
    mode?: Mode;
    origin: string;
  }) => `${o.postId}:${o.idx}:${o.version}:${o.themeId}:${o.mode ?? "os"}:${o.origin}`;

  // The document itself. Shared by the GET below and the publish-time pre-warm,
  // so both produce byte-identical output for one key.
  async function buildSurfaceDoc(args: {
    post: Post;
    surface: Surface;
    title: string;
    themeId: string;
    mode?: Mode;
    origin: string;
    design: DesignSettings | null;
  }): Promise<string> {
    const { surface, themeId, mode, origin } = args;
    const theme = themeById(themeId);
    if (surface.kind === "html") {
      return renderHtmlPage({
        title: args.title,
        // A page item composes published components by reference; the tags
        // are expanded here, server-side, so the whole page is still ONE
        // sandboxed document rather than nested frames.
        html:
          args.post.kind === "page" ? await expandPageHtml(args.post, surface.html) : surface.html,
        origin,
        theme,
        mode,
        kits: surface.kits,
        design: args.design,
      });
    }
    if (surface.kind === "mermaid") {
      return renderMermaidPage({ mermaid: surface.mermaid, origin, theme, mode });
    }
    // Load the rich renderers on first use, not at module load. richRender.ts
    // pulls in shiki, @pierre/diffs, markdown-it and ansi_up — measured at ~48 MB
    // of RSS and ~240 ms of import time (`npm run bench:all`, process suite), which
    // every server paid at boot whether or not it ever rendered a rich surface.
    // Deferring it past the html and mermaid branches above means an html-only
    // workspace never loads any of it.
    //
    // The runtime's module cache makes every later call cheap, so there's no memo
    // here to keep in sync. On the Worker the module is already inside the
    // deployed bundle — the import defers evaluating it, not fetching it — so this
    // needs no network at runtime. test/workerIntegration covers that on real
    // workerd, because a dynamic import resolving differently there is exactly the
    // way this optimization could break in production and nowhere else.
    const { renderCode, renderDiff, renderMarkdown, renderTerminal } =
      await import("./richRender.ts");
    const rendered =
      surface.kind === "markdown"
        ? await renderMarkdown(surface as MarkdownSurface, { theme: themeId, mode })
        : surface.kind === "code"
          ? await renderCode(surface as CodeSurface, { theme: themeId, mode })
          : surface.kind === "terminal"
            ? renderTerminal(surface as TerminalSurface)
            : await renderDiff(surface as DiffSurface, { theme: themeId, mode }).catch((e) => ({
                body: `<div class="rich-error">Couldn’t render diff — ${escapeHtml(
                  e instanceof Error ? e.message : "render error",
                )}</div>`,
                css: `.rich-error{color:var(--danger);font:13px/1.5 ui-monospace,monospace;padding:8px 12px;}`,
              }));
    return renderSandboxedPart({ body: rendered.body, css: rendered.css, origin, theme, mode });
  }

  // Render the current version of a post into the cache, off the write path.
  // The first thing the viewer does after a publish is load an iframe per
  // surface; warming both schemes of the workspace theme turns that cold render
  // (up to a second for a large code surface) into a cache hit. Detached on
  // purpose: a render failure must never fail — or delay — the write. (The DO
  // stays alive for the duration; there is no ExecutionContext to hand this to.)
  const PREWARM_SURFACE_LIMIT = 4;
  function warmPost(post: Post): void {
    const origin = lastOrigin;
    if (!origin) return;
    void (async () => {
      const themeId = (await store.getSetting("theme")) ?? DEFAULT_THEME_ID;
      const design = await designFor(post.project);
      let warmed = 0;
      for (const [idx, surface] of post.surfaces.entries()) {
        if (warmed >= PREWARM_SURFACE_LIMIT) break;
        if (!isSandboxedSurfaceKind(surface.kind)) continue;
        warmed++;
        for (const mode of ["light", "dark"] as const) {
          const key = renderKey({
            postId: post.id,
            idx,
            version: post.version,
            themeId,
            mode,
            origin,
          });
          if (renderCache.has(key)) continue;
          await cachedRender(key, () =>
            buildSurfaceDoc({
              post,
              surface,
              title: post.title,
              themeId,
              mode,
              origin,
              design,
            }),
          );
        }
      }
    })().catch((err) => console.warn("[sideshow] render pre-warm failed", err));
  }

  const renderPostPage = async (c: any) => {
    // `part` is the legacy query key; `surface` is canonical.
    const surfaceParam = c.req.query("surface") ?? c.req.query("part");
    const ver = c.req.query("ver");
    const themeQuery = c.req.query("theme");
    const modeParam = c.req.query("mode");
    const mode: Mode | undefined =
      modeParam === "light" || modeParam === "dark" ? modeParam : undefined;
    const origin = new URL(c.req.url).origin;

    // Cache-first. A hit needs nothing from the post row, and the row is the
    // expensive part of this route (surfaces + every retained version). Only a
    // version-pinned request can take this path: without `ver` the current
    // version — and so the key — is unknown until the row is read.
    const pinned = Number(ver);
    if (surfaceParam != null && Number.isInteger(pinned) && pinned > 0) {
      const themeId = themeQuery ?? (await store.getSetting("theme")) ?? DEFAULT_THEME_ID;
      const hit = renderCacheHit(
        renderKey({
          postId: c.req.param("id"),
          idx: Number(surfaceParam),
          version: pinned,
          themeId,
          mode,
          origin,
        }),
      );
      if (hit !== undefined) {
        // `ver` is non-null on this path by construction, so this is the same
        // immutability test the render path below applies.
        surfaceDocHeaders(c, themeQuery != null && ver != null);
        return c.html(hit);
      }
    }

    const post = await store.getPost(c.req.param("id"));
    if (!post) return c.text("Post not found", 404);
    if (surfaceParam == null) return c.html(await configuredViewerHtml(c, { post }));

    let title = post.title;
    let surfaces = post.surfaces;
    let version = post.version;
    if (ver && Number(ver) !== post.version) {
      const old = post.history.find((h) => h.version === Number(ver));
      if (!old) return c.text(`Version ${ver} not available`, 404);
      title = old.title;
      surfaces = old.surfaces;
      version = old.version;
    }
    const idx = Number(surfaceParam ?? 0);
    const surface = surfaces[idx];
    // Only the kinds that become HTML are served here. Image/trace/json render
    // natively in the viewer and must not be reachable as a document.
    if (!surface || !isSandboxedSurfaceKind(surface.kind)) {
      return c.text("No renderable surface at that index", 404);
    }
    // Theme: an explicit ?theme= (the viewer keys iframe srcs by it so a switch
    // reloads the frame) wins; otherwise the persisted workspace theme; else default.
    const themeId = themeQuery ?? (await store.getSetting("theme")) ?? DEFAULT_THEME_ID;
    surfaceDocHeaders(c, themeQuery != null && ver != null);

    // Cache the finished document under the same key the pre-warm uses; the
    // resolved `version` makes it immutable, so a hit is always correct.
    // A page's slots are pinned at publish, so they are a function of
    // (id, version) too and need no separate key component.
    const cacheKey = renderKey({ postId: post.id, idx, version, themeId, mode, origin });
    const design = await designFor(post.project);
    const doc = await cachedRender(cacheKey, async () =>
      buildSurfaceDoc({ post, surface, title, themeId, mode, origin, design }),
    );
    return c.html(doc);
  };
  app.get("/s/:id", renderPostPage); // legacy alias
  app.get("/p/:id", renderPostPage);

  // --- assets (agent-uploaded images, traces, files) ---

  // Accepts raw bytes (the asset's own Content-Type, metadata via query) or a
  // JSON envelope { data: base64, contentType, ... } — so curl --data-binary
  // and a JSON client both work, and MCP can ride base64. The body is read once
  // and only treated as an envelope when it is application/json carrying a
  // base64 `data` string; a raw JSON asset (no top-level `data`) stays raw.
  app.post("/api/assets", limitAssetBody, async (c) => {
    const mime = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
    // limitAssetBody has already bounded the body to MAX_ASSET_BYTES, so this
    // read is safe. The post-decode cap in uploadAsset still applies (a base64
    // envelope decodes to ~3/4), enforcing the true asset limit on the bytes.
    const buf = new Uint8Array(await c.req.arrayBuffer());
    let envelope: any = null;
    if (mime === "application/json") {
      try {
        const j = JSON.parse(new TextDecoder().decode(buf));
        if (j && typeof j.data === "string") envelope = j;
      } catch {
        // not an envelope — fall through to the raw path
      }
    }
    const kindQ = c.req.query("kind");
    let body;
    try {
      body = envelope
        ? {
            data: decodeBase64(envelope.data),
            contentType:
              typeof envelope.contentType === "string"
                ? envelope.contentType
                : "application/octet-stream",
            filename: typeof envelope.filename === "string" ? envelope.filename : undefined,
            kind: isAssetKind(envelope.kind) ? envelope.kind : undefined,
            session: typeof envelope.session === "string" ? envelope.session : undefined,
            agent: typeof envelope.agent === "string" ? envelope.agent : undefined,
          }
        : {
            data: buf,
            contentType: mime || "application/octet-stream",
            filename: c.req.query("filename"),
            kind: isAssetKind(kindQ) ? kindQ : undefined,
            session: c.req.query("session"),
            agent: c.req.query("agent"),
          };
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "invalid upload" }, 400);
    }
    const result = await uploadAsset(body);
    if ("error" in result) return c.json({ error: result.error }, result.status);
    const origin = new URL(c.req.url).origin;
    const publicBasePath = requestBasePath(c.req.raw);
    const assetPath = encodeURIComponent(result.asset.id);
    return c.json({ ...result.asset, url: `${origin}${publicBasePath}/a/${assetPath}` }, 201);
  });

  app.get("/a/:id", async (c) => {
    const id = c.req.param("id");
    let asset = await store.getAsset(id);
    // Optimistic uploads: an agent can derive an asset's URL from its content
    // hash and publish a surface referencing it before (or while) the bytes are
    // uploaded. Rather than 404 in that window, briefly wait for the bytes —
    // but only when a live surface actually points at this id, so unknown ids
    // still fail fast.
    if (!asset && (await store.isAssetReferenced(id))) {
      for (let i = 0; i < 20 && !asset; i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        asset = await store.getAsset(id);
      }
    }
    if (!asset) return c.text("Asset not found", 404);
    await store.touchAsset(asset.id);
    const { contentType, disposition } = assetServeHeaders(asset);
    c.header("Content-Type", contentType);
    c.header("Content-Disposition", disposition);
    c.header("X-Content-Type-Options", "nosniff");
    // html surfaces render at an opaque origin, so the icon-sprite loader's
    // fetch of /a/:id is cross-origin. It sends no credentials, and assets are
    // already readable by anyone who can reach the workspace, so allowing the
    // read adds no exposure — without it the sprite silently fails to load.
    c.header("Access-Control-Allow-Origin", "*");
    // Short revalidating cache (not immutable) so touch-on-serve keeps firing
    // and the LRU clock reflects real views; asset ids are unique anyway.
    c.header("Cache-Control", "private, max-age=60");
    return c.body(asset.data as unknown as ArrayBuffer);
  });

  // --- live feed ---

  app.get("/api/events", async (c) => {
    const sessionId = c.req.query("session");
    if (isUnauthenticatedSessionRead(c)) {
      if (!sessionId) return c.json({ error: "session required" }, 401);
      if (!(await store.getSession(sessionId))) return c.json({ error: "session not found" }, 404);
    }
    if (!acquireHold()) return c.json({ error: "too many concurrent connections" }, 503);
    const release = makeRelease();
    // Safety net: if the client disconnects before the stream callback opens,
    // the request abort still releases the slot. close() below is guarded so a
    // later abort firing release again is a no-op.
    c.req.raw.signal.addEventListener("abort", release, { once: true });
    const eventSessionId = (event: Parameters<Parameters<EventBus["subscribe"]>[0]>[0]) => {
      if ("sessionId" in event) return event.sessionId;
      if (event.type.startsWith("session-")) return event.id;
      return undefined;
    };
    return streamSSE(c, async (stream) => {
      const queue: Parameters<Parameters<EventBus["subscribe"]>[0]>[0][] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe((event) => {
        if (sessionId && eventSessionId(event) !== sessionId) return;
        queue.push(event);
        wake?.();
      });
      let open = true;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        open = false;
        unsubscribe();
        wake?.();
        release();
      };
      stream.onAbort(close);
      c.req.raw.signal.addEventListener("abort", close, { once: true });
      try {
        await stream.writeSSE({ event: "hello", data: "{}" });
        while (open) {
          while (queue.length > 0) {
            await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
          }
          let pingTimer: ReturnType<typeof setTimeout> | null = null;
          await Promise.race([
            new Promise<void>((resolve) => {
              wake = resolve;
            }),
            new Promise<void>((resolve) => {
              pingTimer = setTimeout(resolve, 15000);
            }),
          ]);
          wake = null;
          if (pingTimer) clearTimeout(pingTimer);
          if (open && queue.length === 0) {
            await stream.writeSSE({ event: "ping", data: "{}" });
          }
        }
      } finally {
        close();
      }
    });
  });

  // --- MCP over streamable HTTP (works locally and deployed) ---

  registerMcp(app, {
    store,
    basePath: requestBasePath,
    publishPost: publishPostFlow,
    revisePost,
    appendPostSurface,
    replacePostSurface,
    removePostSurface,
    reorderPostSurfaces,
    createComment,
    waitForComments,
    uploadAsset,
    // The same project-aware brief the CLI gets from /agent-howto?brief=1 —
    // every feature works on every tier, and a remote MCP agent needs the
    // project's real palette and kit as much as a shell one does.
    guide: async (project: string) => {
      try {
        const { renderBriefGuide } = await import("./designGuide.ts");
        return renderBriefGuide(await designFor(project));
      } catch (err) {
        console.warn("[sideshow] brief guide unavailable", err);
        return guideMarkdown;
      }
    },
  });

  return app;
}
