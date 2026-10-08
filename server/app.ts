import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { decodeBase64 } from "./base64.ts";
import { mockDetailView, mockSummaryView, sessionRowView, surfaceRef } from "./apiViews.ts";
import { EventBus, type FeedEvent } from "./events.ts";
import {
  GUIDE_TOPICS,
  type GuideTopic,
  isGuideTopic,
  renderBriefGuide,
  unknownTopicMessage,
} from "./designGuide.ts";
import { buildFeedbackBatches, type FeedbackBatch } from "./feedbackBatch.ts";
import {
  bundledIconSets,
  expandIcons,
  type IconifyJSON,
  type IconResolver,
  iconCount,
  isIconName,
  mayHaveIcons,
  parseIconSet,
  resolverFor,
} from "./icons.ts";
import { checkProjectKit, KIT_IDS, kitSummaries } from "./kits.ts";
import { checkKnobs, checkKnobValues, discreteChoices } from "./knobs.ts";
import { diffParts, type PartChanges, partsInSurfaces, spliceParts } from "./parts.ts";
import { postToMarkdown } from "./postMarkdown.ts";
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
import {
  escapeHtml,
  renderHtmlPage,
  renderMermaidPage,
  renderSandboxedPart,
  STATIC_ASSET_PREFIX,
  staticAsset,
} from "./surfacePage.ts";
import { DEFAULT_MODE, DEFAULT_THEME_ID, isMode, type Mode, themeById } from "./themes.ts";
import {
  type Anchor,
  type Ask,
  type AskAnswer,
  type AskOption,
  type Asset,
  type AssetKind,
  type CodeSurface,
  type Comment,
  type CommentAnchor,
  DEFAULT_PROJECT,
  DEFAULT_VARIANT,
  type DesignSettings,
  type DiffSurface,
  type Draft,
  htmlSurface,
  type IconSetRef,
  isSandboxedSurfaceKind,
  type Knobs,
  type KnobValue,
  type MarkdownSurface,
  MAX_ASSET_BYTES,
  type Mock,
  type MockKind,
  newId,
  openAsks,
  type PartComment,
  type Post,
  projectFromCwd,
  type Reply,
  type ReplyDecision,
  reservedAgent,
  type Session,
  type Slot,
  slugify,
  type Store,
  type Surface,
  SURFACE_CONTENT_FIELDS,
  surfacesByteLength,
  type TerminalSurface,
} from "./types.ts";
import {
  coerceSurfaces,
  type SurfaceKitScope,
  type SurfaceValidationFailure,
  validateSurfaces,
} from "./postSurfaces.ts";

export type { FeedEvent } from "./events.ts";
export type { FeedbackBatch } from "./feedbackBatch.ts";

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
// A comment's text and a surface's title both ride the feedback channel back to
// the agent in feedback batches, re-sent on every poll — so cap them at the
// edge to keep one oversize value from bloating the agent's context forever.
const MAX_COMMENT_TEXT = 8000;
const MAX_TITLE = 500;

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
// same-origin script. <img>/fetch ignore Content-Disposition, so embedding
// keeps working regardless.
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

const isAssetKind = (v: unknown): v is AssetKind => v === "image" || v === "file";

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
  setupText: string;
  // The guide/topics/<id>.md bodies, read at boot like the viewer.
  topics?: Partial<Record<GuideTopic, string>>;
  // When set (cloud deployments), this hook authorizes requests before any
  // app route runs. Return true to allow, false to use the default 401, or a
  // Response for custom denials. This is intentionally lower-level than
  // authToken so hosts can validate edge-signed assertions without teaching
  // mockpit about their session/token systems.
  authenticate?: AuthenticateHook;
  // When set (self-hosted Worker deployments), every route except /guide,
  // /setup, and /agent-howto requires it: Authorization bearer, ?key= query,
  // or the cookie it sets.
  authToken?: string;
  // Public path prefix for deployments mounted below an origin root, e.g.
  // /u/:account in a hosted multi-tenant wrapper. The core still receives
  // stripped routes like /api/sessions and /s/:id?surface=0; this prefix is only
  // used when the server/viewer generate browser-visible URLs.
  basePath?: BasePathHook;
  // When set, unauthenticated GET routes can be read without bypassing the
  // write token. "session" exposes only reads addressed by an unguessable id
  // (a mock, a post's documents, a session's feed); "full" exposes every GET.
  publicRead?: PublicReadMode;
  // Whether this deployment can render a post's first surface as a PNG (the
  // /s/:id.png route). That route lives in the Cloudflare Worker entry and needs
  // the Browser Rendering binding; the plain Node server can't drive a headless
  // browser, so it leaves this false. Surfaced to the viewer
  // (window.__MOCKPIT_SCREENSHOTS__) so the screenshot action knows whether to
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
  const res = await fetch("https://registry.npmjs.org/mockpit/latest");
  if (!res.ok) return null;
  const pkg = (await res.json()) as { version?: string };
  if (typeof pkg.version !== "string") return null;
  let notes: string | undefined;
  try {
    const gh = await fetch(
      `https://api.github.com/repos/fabiogaliano/mockpit/releases/tags/v${pkg.version}`,
      { headers: { "user-agent": "mockpit", accept: "application/vnd.github+json" } },
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

// In "session" mode only reads addressed by an unguessable id are public: a
// mock id, a post id (its documents), an asset id, a session's comments/feed.
// Anything addressed by NAME (projects, mock slugs, the mock list) would let a
// single shared link enumerate the whole workspace, so it stays private.
function isPublicReadAllowed(path: string, mode: PublicReadMode, query: URLSearchParams): boolean {
  if (mode === "full") return true;
  if (path.startsWith("/project/")) return true;
  if (path.startsWith("/s/")) return true;
  if (path.startsWith("/a/")) return true;
  if (/^\/api\/mocks\/[^/]+(\/export)?$/.test(path)) {
    return !path.startsWith("/api/mocks/recent") && !query.has("project");
  }
  if (path === "/api/comments") return true;
  if (path === "/api/events") return true;
  if (path === "/api/theme") return true;
  if (path === "/api/version") return true;
  // A project's kits are named by project, so only the bundled list is public.
  if (path === "/api/kits") return !query.has("project");
  return false;
}

export interface CommentWait {
  sessionId?: string;
  mockId?: string;
  postId?: string;
  author?: string;
  afterSeq?: number;
  waitSeconds: number;
  // True only for the agent's own reads (feedbackFlow, authenticated
  // author=user reads). The cursor moves for these alone: an anonymous reader on
  // a public-read workspace must never "take" feedback the agent has not seen.
  agent?: boolean;
}

// What every mock flow returns: a status and a JSON body. REST hands it to
// c.json; the MCP tier turns an error status into a tool error. One shape for
// every tier by construction.
export interface FlowResult {
  status: number;
  body: any;
}

export interface FlowContext {
  // origin + base path, for the URLs a response carries.
  base: string;
  // The trusted viewer (same-origin Fetch Metadata). Only it may act as the user.
  viewer: boolean;
  // REST validates surfaces strictly; MCP drops what it can't use.
  strict: boolean;
  request?: Request;
  signal?: AbortSignal;
}

const ok = (body: unknown, status = 200): FlowResult => ({ status, body });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): FlowResult => ({
  status,
  body: { error, ...extra },
});

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

const MAX_LABEL = 120;
const MAX_ASKS = 20;
const MAX_OPTIONS = 20;
const MAX_DRAFT_COMMENTS = 50;

const titleFromSlug = (slug: string) =>
  slug.replace(/-/g, " ").replace(/^./, (ch) => ch.toUpperCase());

export function createApp({
  store,
  viewerHtml,
  setupText,
  topics = {},
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
  // `?key=` bootstraps cookie auth, so never let a workspace URL disclose that
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
        console.warn("[mockpit] onEvent listener failed", err);
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
    console.error("mockpit: unhandled error", err);
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
    bus.broadcast({ type: "comment-seen", sessionId, seq: fresh[fresh.length - 1].seq });
    const feedback = fresh.filter((cm) => cm.author === "user");
    return feedback.length > 0 ? await buildFeedbackBatches(store, feedback) : undefined;
  }

  // Per-comment delivery state for the viewer: `seen` once the session's
  // agentSeq has passed the comment. Computed, never stored.
  async function withSeen(comments: Comment[]): Promise<(Comment & { seen: boolean })[]> {
    const cursors = new Map<string, number>();
    for (const c of comments) {
      if (!cursors.has(c.sessionId)) {
        cursors.set(c.sessionId, (await store.getSession(c.sessionId))?.agentSeq ?? 0);
      }
    }
    return comments.map((c) => ({ ...c, seen: c.seq <= (cursors.get(c.sessionId) ?? 0) }));
  }

  // The workspace's light/dark choice. Older workspaces stored a theme id under
  // `theme`; that registry is gone, so they start from the default mode.
  async function workspaceMode(): Promise<Mode> {
    const stored = await store.getSetting("mode");
    return isMode(stored) ? stored : DEFAULT_MODE;
  }

  // A project's imported design system (settings key `design:<project>`), or
  // null when `mockpit init` has never run for it.
  async function designFor(project: string): Promise<DesignSettings | null> {
    const raw = await store.getSetting(`design:${project}`);
    if (!raw) return null;
    try {
      const design = JSON.parse(raw) as DesignSettings;
      return {
        ...design,
        tailwindCss: typeof design.tailwindCss === "string" ? design.tailwindCss : "",
        strippedImports: Array.isArray(design.strippedImports) ? design.strippedImports : [],
        iconSets: Array.isArray(design.iconSets) ? design.iconSets : [],
        projectKits: Array.isArray(design.projectKits) ? design.projectKits : [],
      };
    } catch {
      return null;
    }
  }

  // Parsed installed icon sets by asset id. Asset bytes are immutable (the id
  // is their hash), so an entry never goes stale; the bound only caps memory.
  const iconSetCache = new Map<string, IconifyJSON | null>();
  const ICON_SET_CACHE_MAX = 16;
  async function installedIconSet(assetId: string): Promise<IconifyJSON | null> {
    if (iconSetCache.has(assetId)) return iconSetCache.get(assetId)!;
    const asset = await store.getAsset(assetId);
    // A missing asset is not cached: it may be uploaded a moment later.
    if (!asset) return null;
    const set = parseIconSet(new TextDecoder().decode(asset.data));
    if (iconSetCache.size >= ICON_SET_CACHE_MAX) {
      iconSetCache.delete(iconSetCache.keys().next().value!);
    }
    iconSetCache.set(assetId, set);
    return set;
  }

  // The project's installed sets first, so installing a set under a bundled
  // prefix (a newer lucide) overrides the bundled copy.
  async function iconSetsFor(
    design: DesignSettings | null,
  ): Promise<{ prefix: string; set: IconifyJSON; source: "installed" | "bundled" }[]> {
    const out: { prefix: string; set: IconifyJSON; source: "installed" | "bundled" }[] = [];
    for (const ref of design?.iconSets ?? []) {
      const set = await installedIconSet(ref.assetId);
      if (set) out.push({ prefix: ref.prefix, set, source: "installed" });
    }
    for (const [prefix, set] of await bundledIconSets()) {
      if (!out.some((s) => s.prefix === prefix)) out.push({ prefix, set, source: "bundled" });
    }
    return out;
  }

  async function iconResolverFor(
    design: DesignSettings | null,
  ): Promise<{ resolve: IconResolver; prefixes: string[] }> {
    const sets = await iconSetsFor(design);
    return { resolve: resolverFor(sets.map((s) => s.set)), prefixes: sets.map((s) => s.prefix) };
  }

  // Unknown icon names in a write's html surfaces, said at write time so the
  // agent learns without rendering.
  async function iconWarnings(project: string, surfaces: Surface[]): Promise<string[]> {
    const html = surfaces.flatMap((s) =>
      s.kind === "html" && mayHaveIcons(s.html) ? [s.html] : [],
    );
    if (html.length === 0) return [];
    const { resolve, prefixes } = await iconResolverFor(await designFor(project));
    const unknown = new Set<string>();
    for (const h of html) for (const u of expandIcons(h, resolve).unknown) unknown.add(u);
    return [...unknown].map((u) => `unknown icon ${u} (sets: ${prefixes.join(", ")})`);
  }

  // An agent asking for instructions must never get an error page, so a store
  // failure degrades to the brief without project settings.
  async function briefFor(project: string | undefined): Promise<string> {
    try {
      const name = project ?? (await store.listProjects())[0]?.name ?? DEFAULT_PROJECT;
      return renderBriefGuide(await designFor(name));
    } catch (err) {
      console.warn("[mockpit] project design unavailable for the brief", err);
      return renderBriefGuide(null);
    }
  }

  // Push + webhooks. Detached on purpose: a dead push endpoint must never fail
  // (or slow) the write that triggered it.
  function fireNotify(payload: NotifyPayload): void {
    void notify(store, payload).catch((err) => console.warn("[mockpit] notify failed", err));
  }

  const mockUrl = (base: string, mock: Mock, post?: Post | null) => {
    const url = `${base}/project/${encodeURIComponent(mock.project)}/${encodeURIComponent(mock.slug)}`;
    if (!post) return url;
    const q = new URLSearchParams();
    if (post.state !== null) q.set("state", post.state);
    q.set("variant", post.variant);
    return `${url}?${q}`;
  };

  // Project resolution for a session: explicit wins, then the cwd's basename,
  // then the single-workspace fallback.
  const resolveProject = (project?: string, cwd?: string | null): string =>
    project?.trim() || projectFromCwd(cwd) || DEFAULT_PROJECT;

  // A mock reference is its id, or its slug within a project. Without a
  // project, a slug that names exactly one mock in the workspace still resolves —
  // an agent rarely has more than one repo with the same mock name.
  async function resolveMock(
    ref: unknown,
    project?: unknown,
    sessionId?: unknown,
  ): Promise<Mock | FlowResult> {
    const name = typeof ref === "string" ? ref.trim() : "";
    if (!name) return fail(400, 'provide a "mock"');
    const byId = await store.getMock(name);
    if (byId) return byId;
    const slug = slugify(name);
    let proj = typeof project === "string" && project.trim() ? project.trim() : undefined;
    if (!proj && typeof sessionId === "string") {
      const session = await store.getSession(sessionId);
      proj = session?.project ?? undefined;
    }
    if (proj) {
      const mock = await store.findMock(proj, slug);
      return mock ?? fail(404, `${proj} has no mock "${slug}"`);
    }
    const matches = (await store.listMocks()).filter((m) => m.slug === slug);
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) return fail(404, `no mock "${slug}"`);
    return fail(400, `"${slug}" exists in several projects; pass project`, {
      projects: matches.map((m) => m.project),
    });
  }

  const isResult = (v: unknown): v is FlowResult =>
    !!v && typeof v === "object" && "status" in v && "body" in v;

  // A state argument: undefined = not given, null = the single unnamed state.
  const stateArg = (v: unknown): string | null | undefined =>
    v === undefined ? undefined : v === null || v === "" ? null : str(v, MAX_LABEL);

  const variantLabel = (p: Post) => (p.state === null ? p.variant : `${p.state}/${p.variant}`);

  // Which variant a call means. Explicit wins; one candidate is unambiguous;
  // several is an error that names them rather than guessing.
  function chooseVariant(
    mock: Mock,
    posts: Post[],
    stateIn: string | null | undefined,
    variant: string | undefined,
  ): Post | FlowResult {
    let candidates = posts;
    if (stateIn !== undefined) {
      if (stateIn !== null && !mock.states.includes(stateIn)) {
        return fail(404, `${mock.slug} has no state "${stateIn}"`, { states: mock.states });
      }
      candidates = candidates.filter((p) => p.state === stateIn);
    }
    if (variant) candidates = candidates.filter((p) => p.variant === variant);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) {
      return fail(404, `${mock.slug} has no variant ${variant ? `"${variant}"` : ""}`.trim(), {
        variants: posts.map(variantLabel),
      });
    }
    const live = candidates.filter((p) => p.status !== "archived");
    if (live.length === 1 && !variant) return live[0];
    return fail(400, `${mock.slug} has several variants; pass ${variant ? "state" : "variant"}`, {
      variants: candidates.map(variantLabel),
    });
  }

  // The kit ids a surface of this project may name beyond the bundled ones.
  const kitScope = async (project: string): Promise<SurfaceKitScope> => ({
    projectKits: ((await designFor(project))?.projectKits ?? []).map((k) => k.id),
  });

  async function parseSurfaceInput(
    body: any,
    ctx: FlowContext,
    scope: SurfaceKitScope,
  ): Promise<Surface[] | FlowResult | undefined> {
    if (typeof body.html === "string") {
      if (!body.html.trim()) return fail(400, 'body must include non-empty "html" string');
      const raw = [htmlSurface(body.html, body.kits)];
      if (!ctx.strict) return coerceSurfaces(raw, scope);
      const parsed = await validateSurfaces(raw, scope);
      return parsed.ok ? parsed.surfaces : fail(400, parsed.error, surfaceIssues(parsed));
    }
    if (body.surfaces === undefined) return undefined;
    if (!Array.isArray(body.surfaces)) return fail(400, '"surfaces" must be an array');
    if (!ctx.strict) return coerceSurfaces(body.surfaces, scope);
    const parsed = await validateSurfaces(body.surfaces, scope);
    return parsed.ok ? parsed.surfaces : fail(400, parsed.error, surfaceIssues(parsed));
  }

  const surfaceIssues = (failure: SurfaceValidationFailure) => ({
    code: failure.code,
    issues: failure.issues,
  });

  function checkSurfaces(surfaces: Surface[]): FlowResult | null {
    if (surfaces.length === 0) return fail(400, "a variant needs at least one surface");
    if (surfacesByteLength(surfaces) > MAX_SURFACE_BYTES) {
      return fail(413, `surface exceeds ${MAX_SURFACE_BYTES} bytes`);
    }
    return null;
  }

  // A page's slot list, with each missing version pinned to the referenced
  // component's current one (snapshot semantics).
  async function pageSlots(project: string, surfaces: Surface[]): Promise<Slot[]> {
    const html = surfaces.find((s) => s.kind === "html");
    if (!html || html.kind !== "html") return [];
    const slots: Slot[] = [];
    for (const tag of parseSlotTags(html.html)) {
      let version = tag.version;
      if (version == null)
        version = (await slotTarget(project, tag.slug, tag.variant))?.version ?? null;
      if (version != null) slots.push({ slug: tag.slug, variant: tag.variant, version });
    }
    return slots;
  }

  // A slot names a component mock by slug; it renders that mock's first state.
  async function slotTarget(project: string, slug: string, variant: string) {
    const mock = await store.findMock(project, slug);
    if (!mock) return null;
    return store.findPost(mock.id, mock.states[0] ?? null, variant);
  }

  // Inline each `<mockpit-slot>` with the referenced variant version's first
  // html surface body. The stored `slots` list (resolved at publish) wins over
  // a bare tag, so a page keeps rendering the versions it was composed from.
  async function expandPageHtml(project: string, post: Post, html: string): Promise<string> {
    const pinned = new Map(post.slots.map((s) => [`${s.slug}::${s.variant}`, s.version]));
    const bodies = new Map<string, string | null>();
    for (const tag of parseSlotTags(html)) {
      const key = `${tag.slug}::${tag.variant}`;
      const version = tag.version ?? pinned.get(key) ?? null;
      const cacheKey = `${key}::${version}`;
      if (bodies.has(cacheKey)) continue;
      const target = await slotTarget(project, tag.slug, tag.variant);
      if (!target) {
        bodies.set(cacheKey, null);
        continue;
      }
      const surfaces =
        version == null || version === target.version
          ? target.surfaces
          : (target.history.find((h) => h.version === version)?.surfaces ?? null);
      const body = surfaces?.find((s) => s.kind === "html");
      bodies.set(cacheKey, body && body.kind === "html" ? body.html : null);
    }
    return expandSlots(html, ({ slug, variant, version }) => {
      const key = `${slug}::${variant}`;
      const pinnedVersion = version ?? pinned.get(key) ?? null;
      return bodies.get(`${key}::${pinnedVersion}`) ?? null;
    });
  }

  // Knobs with a handful of discrete choices are usually decisions dressed as
  // controls: the user can't compare options they only see one at a time.
  function knobNudges(knobs: Knobs): string[] {
    const out: string[] = [];
    for (const [path, config] of Object.entries(knobs)) {
      const n = discreteChoices(config);
      if (n !== null && n <= 3) {
        out.push(
          `knob "${path}" has ${n} discrete options: if each option needs its own render, ask instead (ask_user with options bound to variants); keep a knob when one render plus a control shows it`,
        );
      }
    }
    return out;
  }

  // The answer to every write: what was published, the parts found per state,
  // what moved since the previous version, and any feedback waiting.
  async function writeResult(
    mock: Mock,
    post: Post,
    ctx: FlowContext,
    extra: { previous?: Surface[]; applied?: string[]; nudges?: string[]; status?: number } = {},
  ): Promise<FlowResult> {
    const posts = await store.listPosts({ mockId: mock.id });
    const detail = mockDetailView(mock, posts);
    let partChanges: PartChanges | undefined;
    if (extra.previous) {
      partChanges = diffParts(partsInSurfaces(extra.previous), partsInSurfaces(post.surfaces));
    }
    const warnings = await iconWarnings(mock.project, post.surfaces);
    const userFeedback = await collectFeedback(post.sessionId);
    return ok(
      {
        mock: {
          id: mock.id,
          project: mock.project,
          slug: mock.slug,
          title: mock.title,
          kind: mock.kind,
          states: mock.states,
        },
        post: {
          id: post.id,
          state: post.state,
          variant: post.variant,
          version: post.version,
          status: post.status,
          surfaces: post.surfaces.map(surfaceRef),
        },
        sessionId: post.sessionId,
        url: mockUrl(ctx.base, mock, post),
        parts: detail.parts,
        ...(extra.applied ? { applied: extra.applied } : {}),
        ...(partChanges && (partChanges.vanished.length || partChanges.renamed.length)
          ? { partChanges }
          : {}),
        ...(extra.nudges?.length ? { nudges: extra.nudges } : {}),
        ...(warnings.length ? { warnings } : {}),
        ...(userFeedback ? { userFeedback } : {}),
      },
      extra.status ?? 200,
    );
  }

  function announcePost(mock: Mock, post: Post, created: boolean) {
    bus.broadcast({
      type: created ? "post-created" : "post-updated",
      id: post.id,
      mockId: mock.id,
      sessionId: post.sessionId,
      version: post.version,
    });
    warmPost(post, mock);
  }

  // Publish one variant of one state of a mock. An existing (mock, state,
  // variant) becomes a new version; anything else is created. `revise` refuses
  // to create.
  async function publishFlow(body: any, ctx: FlowContext, revise = false): Promise<FlowResult> {
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const slugIn = str(body.mock, MAX_TITLE);
    if (!slugIn) return fail(400, 'provide "mock": the mock slug, e.g. "writer"');
    const partEdits = revise ? partEditsArg(body) : undefined;
    if (isResult(partEdits)) return partEdits;
    const knobs = checkKnobs(body.knobs);
    if (!knobs.ok) return fail(400, knobs.error);
    const variantKnobs = checkKnobs(body.variantKnobs);
    if (!variantKnobs.ok) return fail(400, variantKnobs.error);
    const stateIn = stateArg(body.state);
    const variantIn = str(body.variant, MAX_LABEL);
    const kind: MockKind | undefined =
      body.kind === "page" || body.kind === "component" ? body.kind : undefined;
    const title = str(body.title, MAX_TITLE);
    const fromN = Number(body.from);
    const from = Number.isInteger(fromN) && fromN > 0 ? fromN : undefined;
    const prompt = str(body.prompt, MAX_COMMENT_TEXT);
    const author = str(body.author, MAX_TITLE);

    // An existing mock is addressable before a session exists (revise by id).
    let mock: Mock | null = null;
    if (typeof body.mock === "string") mock = await store.getMock(body.mock);

    let session: Session | null = null;
    if (typeof body.session === "string" && body.session) {
      session = await store.getSession(body.session);
      if (!session) return fail(404, `session "${body.session}" not found`);
    }
    const project =
      mock?.project ??
      (str(body.project, MAX_TITLE) ||
        session?.project ||
        projectFromCwd(session?.cwd) ||
        resolveProject(undefined, str(body.cwd, 4096)));
    // With `parts` the surfaces are the base version's, spliced once the variant is known.
    let surfaces: Surface[] = [];
    if (!partEdits) {
      const parsed = await parseSurfaceInput(body, ctx, await kitScope(project));
      if (isResult(parsed)) return parsed;
      if (!parsed) return fail(400, 'provide "surfaces" (or "html")');
      const bad = checkSurfaces(parsed);
      if (bad) return bad;
      surfaces = parsed;
    }
    const slug = mock?.slug ?? slugify(slugIn);
    mock ??= await store.findMock(project, slug);
    if (revise && !mock) return fail(404, `${project} has no mock "${slug}"`);

    let posts = mock ? await store.listPosts({ mockId: mock.id }) : [];
    let target: Post | null = null;
    let state: string | null;
    let applied: string[] | undefined;
    if (revise && mock) {
      const chosen = chooseVariant(mock, posts, stateIn, variantIn);
      if (isResult(chosen)) return chosen;
      target = chosen;
      state = chosen.state;
      if (partEdits) {
        const base =
          from === undefined || from === chosen.version
            ? chosen.surfaces
            : chosen.history.find((h) => h.version === from)?.surfaces;
        if (!base) return fail(404, `${slug} has no version ${from}`);
        const result = spliceParts(base, partEdits);
        if (!result.ok) return fail(400, result.error);
        const bad = checkSurfaces(result.surfaces);
        if (bad) return bad;
        surfaces = result.surfaces;
        applied = result.applied;
      }
    } else {
      if (stateIn === undefined || stateIn === null) {
        if (mock && mock.states.length > 0) {
          return fail(400, `${slug} has states; pass state`, { states: mock.states });
        }
        state = null;
      } else {
        if (mock && mock.states.length === 0 && posts.length > 0) {
          return fail(
            409,
            `${slug} is a single-state mock; its variants have no state name. Publish a multi-state design as a new mock and name every state`,
          );
        }
        state = stateIn;
      }
      const inState = posts.filter((p) => p.state === state);
      let variant = variantIn;
      if (!variant) {
        const live = inState.filter((p) => p.status !== "archived");
        if (inState.length === 0) variant = DEFAULT_VARIANT;
        else if (inState.length === 1) variant = inState[0].variant;
        else if (live.length === 1) variant = live[0].variant;
        else {
          return fail(400, `${slug} has several variants; pass variant`, {
            variants: inState.map(variantLabel),
          });
        }
      }
      target = inState.find((p) => p.variant === variant) ?? null;
      if (!target) {
        // A new variant: carried by the session the agent is writing from.
        if (!session) {
          session = await store.createSession({
            agent: str(body.agent, MAX_TITLE) ?? "agent",
            title: str(body.sessionTitle, MAX_TITLE),
            cwd: str(body.cwd, 4096),
            project,
          });
          bus.broadcast({ type: "session-created", id: session.id });
        }
        if (!mock) {
          mock = await store.createMock({
            project,
            slug,
            title: title ?? titleFromSlug(slug),
            kind: kind ?? "component",
            states: state === null ? [] : [state],
            knobs: knobs.value,
            sessionId: session.id,
          });
          bus.broadcast({ type: "mock-created", id: mock.id, project });
        }
        const slots =
          mock.kind === "page" || kind === "page" ? await pageSlots(project, surfaces) : [];
        const created = await store.createPost({
          sessionId: session.id,
          mock: mock.id,
          state,
          variant,
          title: title ?? mock.title,
          surfaces,
          ...(Object.keys(variantKnobs.value).length ? { knobs: variantKnobs.value } : {}),
          slots,
          from,
          prompt,
          author,
        });
        if (!created) return fail(404, "session not found");
        mock = await updateMockAfterWrite(mock, {
          state,
          kind,
          title,
          knobs: knobs.value,
          session,
        });
        announcePost(mock, created, true);
        if (prompt && ctx.request) notifyPublish(mock, created, prompt, ctx);
        return writeResult(mock, created, ctx, {
          nudges: knobNudges({ ...knobs.value, ...variantKnobs.value }),
          status: 201,
        });
      }
    }

    if (!mock || !target) return fail(404, `${project} has no mock "${slug}"`);
    // A revision is written by whoever revises it; without an explicit session
    // the variant's own session carries it.
    session ??= await store.getSession(target.sessionId);
    const previous = target.surfaces;
    const slots = mock.kind === "page" ? await pageSlots(project, surfaces) : undefined;
    const updated = await store.updatePost(target.id, {
      surfaces,
      title,
      ...(body.variantKnobs !== undefined ? { knobs: variantKnobs.value } : {}),
      slots,
      from,
      prompt,
      author,
    });
    if (!updated) return fail(404, "variant not found");
    mock = await updateMockAfterWrite(mock, { state, kind, knobs: knobs.value, session });
    announcePost(mock, updated, false);
    if (prompt && ctx.request) notifyPublish(mock, updated, prompt, ctx);
    posts = [];
    return writeResult(mock, updated, ctx, {
      previous,
      applied,
      nudges: knobNudges({ ...knobs.value, ...variantKnobs.value }),
    });
  }

  // `parts`: new outer html per part ("name" or "name#key"), spliced into the
  // variant's html so a tweak costs the tweak rather than the whole document.
  function partEditsArg(body: any): Record<string, string> | FlowResult | undefined {
    if (body?.parts === undefined) return undefined;
    const parts = body.parts;
    if (!parts || typeof parts !== "object" || Array.isArray(parts)) {
      return fail(400, '"parts" must be an object: { "<part name>": "<html for that part>" }');
    }
    const entries = Object.entries(parts);
    if (entries.length === 0) return fail(400, '"parts" is empty; name at least one part');
    if (entries.some(([, html]) => typeof html !== "string")) {
      return fail(400, 'each "parts" value must be the html string for that part');
    }
    if (body.html !== undefined || body.surfaces !== undefined) {
      return fail(400, 'pass "parts" or "html"/"surfaces", not both');
    }
    return parts as Record<string, string>;
  }

  // A write may add a state, retitle the mock, declare knobs, and makes its
  // session the one a reply is delivered to.
  async function updateMockAfterWrite(
    mock: Mock,
    w: {
      state: string | null;
      kind?: MockKind;
      title?: string;
      knobs: Knobs;
      session: Session | null;
    },
  ): Promise<Mock> {
    const states =
      w.state !== null && !mock.states.includes(w.state) ? [...mock.states, w.state] : undefined;
    const knobs = Object.keys(w.knobs).length ? { ...mock.knobs, ...w.knobs } : undefined;
    const updated = await store.updateMock(mock.id, {
      ...(states ? { states } : {}),
      ...(w.kind ? { kind: w.kind } : {}),
      ...(w.title ? { title: w.title } : {}),
      ...(knobs ? { knobs } : {}),
      ...(w.session ? { sessionId: w.session.id } : {}),
    });
    if (!updated) return mock;
    bus.broadcast({ type: "mock-updated", id: updated.id, project: updated.project });
    return updated;
  }

  function notifyPublish(mock: Mock, post: Post, text: string, ctx: FlowContext) {
    fireNotify({
      event: "publish",
      project: mock.project,
      slug: mock.slug,
      variant: post.variant,
      version: post.version,
      text,
      url: mockUrl(ctx.base, mock, post),
    });
  }

  async function listMocksFlow(query: { project?: string }): Promise<FlowResult> {
    const project = str(query.project, MAX_TITLE);
    const mocks = await store.listMocks(project);
    const rows = [];
    for (const m of mocks) rows.push(mockSummaryView(m, await store.listPosts({ mockId: m.id })));
    const open = rows.reduce((n, r) => n + r.open, 0);
    return ok({
      ...(project ? { project } : {}),
      mocks: rows,
      open,
      openMocks: rows.filter((r) => r.open > 0).length,
    });
  }

  // The tuned values of the mock's latest reply: what the user last sent.
  async function lastTuned(mockId: string): Promise<Record<string, unknown>> {
    const replies = (await store.listComments({ mockId })).filter((c) => c.kind === "reply");
    return replies[replies.length - 1]?.payload?.tuned ?? {};
  }

  async function getMockFlow(
    ref: unknown,
    query: { project?: unknown; session?: unknown; body?: boolean; history?: boolean },
  ): Promise<FlowResult> {
    const mock = await resolveMock(ref, query.project, query.session);
    if (isResult(mock)) return mock;
    const posts = await store.listPosts({ mockId: mock.id });
    return ok(
      mockDetailView(mock, posts, {
        body: query.body,
        history: query.history,
        tuned: await lastTuned(mock.id),
      }),
    );
  }

  async function exportFlow(
    ref: unknown,
    query: { project?: unknown; state?: unknown; variant?: unknown },
    ctx: FlowContext,
  ): Promise<FlowResult> {
    const mock = await resolveMock(ref, query.project);
    if (isResult(mock)) return mock;
    const posts = await store.listPosts({ mockId: mock.id });
    const wantedState = stateArg(query.state);
    const wantedVariant = str(query.variant, MAX_LABEL);
    const states = (mock.states.length ? mock.states : [null]).filter(
      (s) => wantedState === undefined || s === wantedState,
    );
    if (states.length === 0) return fail(404, `${mock.slug} has no state "${wantedState}"`);
    const entries = [];
    for (const state of states) {
      const inState = posts.filter((p) => p.state === state);
      const post =
        (wantedVariant && inState.find((p) => p.variant === wantedVariant)) ||
        inState.find((p) => p.status === "accepted") ||
        inState.find((p) => p.status === "open") ||
        inState[0];
      if (!post) continue;
      if (wantedVariant && post.variant !== wantedVariant) continue;
      const html = post.surfaces.find((s) => s.kind === "html");
      entries.push({
        state,
        variant: post.variant,
        postId: post.id,
        version: post.version,
        status: post.status,
        html: html && html.kind === "html" ? html.html : "",
        markdown: postToMarkdown(post, {
          postUrl: `${ctx.base}/s/${post.id}`,
          assetBase: ctx.base,
        }),
        history: [
          ...[...post.history]
            .sort((a, b) => a.version - b.version)
            .map((h) => ({
              version: h.version,
              at: h.at,
              from: h.from ?? null,
              prompt: h.prompt ?? "",
            })),
          {
            version: post.version,
            at: post.updatedAt,
            from: post.from ?? null,
            prompt: post.prompt ?? "",
          },
        ],
        screenshotUrl: screenshots ? `${ctx.base}/s/${post.id}.png?v=${post.version}` : null,
      });
    }
    if (entries.length === 0) {
      return fail(404, `${mock.slug} has no variant "${wantedVariant}"`, {
        variants: posts.map(variantLabel),
      });
    }
    const replies = (await store.listComments({ mockId: mock.id })).filter(
      (c) => c.kind === "reply",
    );
    return ok({
      project: mock.project,
      mock: mock.slug,
      title: mock.title,
      kind: mock.kind,
      states: entries,
      knobs: mock.knobs,
      reply: replies[replies.length - 1]?.payload ?? null,
    });
  }

  // --- asks ---

  function sanitizeAsk(raw: any, mock: Mock, posts: Post[], taken: Set<string>): Ask | string {
    if (!raw || typeof raw !== "object") return "each ask must be an object";
    const text = str(raw.text, MAX_COMMENT_TEXT);
    if (!text) return 'each ask needs "text"';
    const scope = raw.scope === "state" || raw.scope === "part" ? raw.scope : "mock";
    const state = str(raw.state, MAX_LABEL);
    if (scope === "state") {
      if (!state) return `ask "${text}" has scope "state" but no state`;
      if (!mock.states.includes(state)) return `${mock.slug} has no state "${state}"`;
    } else if (state && !mock.states.includes(state)) {
      return `${mock.slug} has no state "${state}"`;
    }
    const part = str(raw.part, 200);
    if (scope === "part" && !part) return `ask "${text}" has scope "part" but no part`;
    if (!Array.isArray(raw.options) || raw.options.length === 0) {
      return `ask "${text}" needs options`;
    }
    if (raw.options.length > MAX_OPTIONS)
      return `ask "${text}" has more than ${MAX_OPTIONS} options`;
    const variants = new Set(posts.map((p) => p.variant));
    const options: AskOption[] = [];
    const optionIds = new Set<string>();
    for (const o of raw.options) {
      const opt = typeof o === "string" ? { label: o } : o;
      const label = str(opt?.label, 200);
      if (!label) return `every option of "${text}" needs a label`;
      let id = slugify(str(opt.id, 64) ?? label);
      for (let n = 2; optionIds.has(id); n++) id = `${slugify(str(opt.id, 64) ?? label)}-${n}`;
      optionIds.add(id);
      const variant = str(opt.variant, MAX_LABEL);
      if (variant && !variants.has(variant)) {
        return `option "${label}" names variant "${variant}", which ${mock.slug} does not have`;
      }
      let set: AskOption["set"];
      if (opt.set !== undefined) {
        const checked = checkKnobValues(opt.set, mock, posts, `option "${label}"`);
        if (!checked.ok) return checked.error;
        set = checked.value;
      }
      options.push({ id, label, ...(variant ? { variant } : {}), ...(set ? { set } : {}) });
    }
    let id = slugify(str(raw.id, 64) ?? text).slice(0, 40);
    if (!str(raw.id, 64))
      for (let n = 2; taken.has(id); n++) id = `${slugify(text).slice(0, 36)}-${n}`;
    return {
      id,
      text,
      scope,
      ...(state ? { state } : {}),
      ...(part ? { part } : {}),
      options,
      ...(raw.multi === true ? { multi: true } : {}),
      at: new Date().toISOString(),
    };
  }

  // Ask the user structured questions. An ask whose id matches an existing one
  // replaces it (and reopens it); anything else is appended.
  async function askFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const resolved = await resolveMock(ref, body.project, body.session);
    if (isResult(resolved)) return resolved;
    let mock = resolved;
    const raw = Array.isArray(body.asks) ? body.asks : body.text ? [body] : null;
    if (!raw || raw.length === 0) return fail(400, 'provide "asks": [{text, options}]');
    if (raw.length > MAX_ASKS) return fail(400, `at most ${MAX_ASKS} asks per call`);
    const posts = await store.listPosts({ mockId: mock.id });
    const asks = [...mock.asks];
    const taken = new Set(asks.map((a) => a.id));
    const added: Ask[] = [];
    for (const entry of raw) {
      const ask = sanitizeAsk(entry, mock, posts, taken);
      if (typeof ask === "string") return fail(400, ask);
      const at = asks.findIndex((a) => a.id === ask.id);
      if (at >= 0) asks[at] = ask;
      else asks.push(ask);
      taken.add(ask.id);
      added.push(ask);
    }
    let sessionId = mock.sessionId;
    if (typeof body.session === "string" && (await store.getSession(body.session))) {
      sessionId = body.session;
    }
    const updated = await store.updateMock(mock.id, { asks, sessionId });
    if (!updated) return fail(404, "mock not found");
    mock = updated;
    bus.broadcast({ type: "mock-updated", id: mock.id, project: mock.project });
    // The questions also land in the thread, so the user reads them where they answer.
    const session = sessionId ? await store.getSession(sessionId) : null;
    if (session) {
      const comment = await store.createComment({
        sessionId: session.id,
        mockId: mock.id,
        author: reservedAgent(session.agent),
        text: added.map((a) => a.text).join("\n"),
        kind: "ask",
      });
      if (comment) announceComment(comment);
    }
    fireNotify({
      event: "ask",
      project: mock.project,
      slug: mock.slug,
      variant: "",
      version: Math.max(1, ...posts.map((p) => p.version)),
      text: added.map((a) => a.text).join(" · "),
      url: mockUrl(ctx.base, mock),
    });
    const userFeedback = session ? await collectFeedback(session.id) : undefined;
    return ok({
      mock: mock.slug,
      mockId: mock.id,
      project: mock.project,
      asks: added,
      open: openAsks(mock).length,
      url: mockUrl(ctx.base, mock),
      ...(userFeedback ? { userFeedback } : {}),
    });
  }

  // --- drafts and replies (the user's side; viewer origin only) ---

  function sanitizePartComments(raw: unknown, mock: Mock): PartComment[] | string {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) return '"comments" must be an array';
    if (raw.length > MAX_DRAFT_COMMENTS) return `at most ${MAX_DRAFT_COMMENTS} comments`;
    const out: PartComment[] = [];
    for (const c of raw) {
      const text = str(c?.text, MAX_COMMENT_TEXT);
      if (!text) return "every comment needs text";
      const state = stateArg(c.state) ?? null;
      if (state !== null && !mock.states.includes(state))
        return `${mock.slug} has no state "${state}"`;
      const part = str(c.part, 200) ?? null;
      const a = c.anchor && typeof c.anchor === "object" ? c.anchor : null;
      const anchor = a ? sanitizePartAnchor(a) : undefined;
      out.push({ part, state, text, ...(anchor ? { anchor } : {}) });
    }
    return out;
  }

  function sanitizePartAnchor(a: Record<string, unknown>) {
    const offset =
      Array.isArray(a.offset) && a.offset.length === 2 && a.offset.every((n) => Number.isFinite(n))
        ? ([Number(a.offset[0]), Number(a.offset[1])] as [number, number])
        : undefined;
    const box =
      Array.isArray(a.box) && a.box.length === 4 && a.box.every((n) => Number.isFinite(n))
        ? (a.box.map(Number) as number[])
        : undefined;
    const quote = str(a.quote, 200);
    const selector = str(a.selector, 500);
    if (!offset && !box && !quote && !selector) return undefined;
    return {
      ...(offset ? { offset } : {}),
      ...(quote ? { quote } : {}),
      ...(selector ? { selector } : {}),
      ...(box ? { box } : {}),
    };
  }

  function sanitizeAnswers(raw: unknown, mock: Mock): Record<string, AskAnswer> | string {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) return '"answers" must be an object';
    const out: Record<string, AskAnswer> = {};
    for (const [askId, value] of Object.entries(raw as Record<string, unknown>)) {
      const ask = mock.asks.find((a) => a.id === askId);
      if (!ask) return `${mock.slug} has no ask "${askId}"`;
      const ids = Array.isArray(value) ? value : [value];
      if (ids.length === 0) continue;
      if (!ask.multi && ids.length > 1) return `ask "${askId}" takes one answer`;
      for (const id of ids) {
        if (typeof id !== "string" || !ask.options.some((o) => o.id === id)) {
          return `ask "${askId}" has no option "${String(id)}"`;
        }
      }
      out[askId] = ask.multi ? (ids as string[]) : (ids[0] as string);
    }
    return out;
  }

  function sanitizeMix(raw: unknown, posts: Post[]): Record<string, string> | string {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) return '"mix" must be an object';
    const variants = new Set(posts.map((p) => p.variant));
    const out: Record<string, string> = {};
    for (const [part, variant] of Object.entries(raw as Record<string, unknown>)) {
      if (!part || part.length > 200) return "mix keys are part names";
      if (typeof variant !== "string" || !variants.has(variant)) {
        return `mix "${part}" names a variant that does not exist`;
      }
      out[part] = variant;
    }
    return out;
  }

  // A draft, validated against the mock as it is now: unknown asks, options,
  // variants, knob paths or out-of-range values are refused, never stored.
  function sanitizeDraft(raw: any, mock: Mock, posts: Post[], base: Draft | null): Draft | string {
    const pick = (key: keyof Draft) => (raw?.[key] !== undefined ? raw[key] : base?.[key]);
    const answers = sanitizeAnswers(pick("answers"), mock);
    if (typeof answers === "string") return answers;
    const mix = sanitizeMix(pick("mix"), posts);
    if (typeof mix === "string") return mix;
    const tuned = checkKnobValues(pick("tuned"), mock, posts, "tuned");
    if (!tuned.ok) return tuned.error;
    const comments = sanitizePartComments(pick("comments"), mock);
    if (typeof comments === "string") return comments;
    const versionN = Number(pick("version"));
    const version =
      Number.isInteger(versionN) && versionN > 0
        ? versionN
        : Math.max(1, ...posts.map((p) => p.version));
    return {
      version,
      answers,
      mix,
      tuned: tuned.value,
      comments,
      updatedAt: new Date().toISOString(),
    };
  }

  const viewerOnly = () => fail(403, "only the viewer can do this");

  async function getDraftFlow(ref: unknown, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const mock = await resolveMock(ref);
    if (isResult(mock)) return mock;
    return ok({ draft: mock.draft });
  }

  async function putDraftFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const mock = await resolveMock(ref);
    if (isResult(mock)) return mock;
    const posts = await store.listPosts({ mockId: mock.id });
    const draft = sanitizeDraft(body, mock, posts, null);
    if (typeof draft === "string") return fail(400, draft);
    await store.putDraft(mock.id, draft);
    bus.broadcast({ type: "draft-updated", mockId: mock.id });
    return ok({ draft });
  }

  async function deleteDraftFlow(ref: unknown, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const mock = await resolveMock(ref);
    if (isResult(mock)) return mock;
    await store.putDraft(mock.id, null);
    bus.broadcast({ type: "draft-updated", mockId: mock.id });
    return ok({ draft: null });
  }

  function sanitizeDecision(
    raw: any,
    mock: Mock,
    posts: Post[],
  ): ReplyDecision | string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const kind = raw.kind;
    if (kind !== "accept" && kind !== "revise" && kind !== "drop") {
      return 'decision.kind must be "accept", "revise" or "drop"';
    }
    const chosen = chooseVariant(mock, posts, stateArg(raw.state), str(raw.variant, MAX_LABEL));
    if (isResult(chosen)) return chosen.body.error as string;
    return { kind, state: chosen.state, variant: chosen.variant };
  }

  // Which variants a reply accepts and archives. A variant-bound answer accepts
  // the chosen variant(s) in every state the ask covers and archives their
  // siblings there; a part-scoped pick is a mix, not a verdict.
  function replyFlips(
    mock: Mock,
    posts: Post[],
    answers: Record<string, AskAnswer>,
    decision: ReplyDecision | undefined,
  ): { accept: Set<string>; archive: Set<string> } {
    const accept = new Set<string>();
    const archive = new Set<string>();
    const settle = (inState: Post[], chosen: Set<string>) => {
      if (!inState.some((p) => chosen.has(p.variant))) return;
      for (const p of inState) {
        if (chosen.has(p.variant)) accept.add(p.id);
        else if (p.status !== "archived") archive.add(p.id);
      }
    };
    for (const ask of mock.asks) {
      const answer = answers[ask.id];
      if (answer === undefined || ask.scope === "part") continue;
      const ids = Array.isArray(answer) ? answer : [answer];
      const chosen = new Set(
        ask.options.filter((o) => ids.includes(o.id) && o.variant).map((o) => o.variant!),
      );
      if (chosen.size === 0) continue;
      const states =
        ask.scope === "state" ? [ask.state ?? null] : mock.states.length ? mock.states : [null];
      for (const state of states)
        settle(
          posts.filter((p) => p.state === state),
          chosen,
        );
    }
    if (decision?.kind === "accept") {
      settle(
        posts.filter((p) => p.state === decision.state),
        new Set([decision.variant]),
      );
    } else if (decision?.kind === "drop") {
      const post = posts.find((p) => p.state === decision.state && p.variant === decision.variant);
      if (post) archive.add(post.id);
    }
    for (const id of accept) archive.delete(id);
    return { accept, archive };
  }

  // Send: the user's one batched answer becomes one kind:"reply" comment on the
  // mock's session, delivered through the same cursor as everything else. The
  // draft is cleared and statuses flip in the same store transaction.
  async function replyFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const mock = await resolveMock(ref);
    if (isResult(mock)) return mock;
    const posts = await store.listPosts({ mockId: mock.id });
    const draft = sanitizeDraft(body ?? {}, mock, posts, mock.draft);
    if (typeof draft === "string") return fail(400, draft);
    const text = str(body?.text, MAX_COMMENT_TEXT);
    const decision = sanitizeDecision(body?.decision, mock, posts);
    if (typeof decision === "string") return fail(400, decision);
    const empty =
      !text &&
      !decision &&
      !Object.keys(draft.answers).length &&
      !Object.keys(draft.mix).length &&
      !Object.keys(draft.tuned).length &&
      !draft.comments.length;
    if (empty) return fail(400, "nothing to send");
    const latest = [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const sessionId = mock.sessionId ?? latest?.sessionId;
    if (!sessionId) return fail(409, `${mock.slug} has no agent session to reply to`);
    const payload: Reply = {
      mockId: mock.id,
      version: draft.version,
      answers: draft.answers,
      mix: draft.mix,
      tuned: draft.tuned,
      comments: draft.comments,
      ...(text ? { text } : {}),
      ...(decision ? { decision } : {}),
    };
    const asks = mock.asks.map((a) =>
      draft.answers[a.id] === undefined ? a : { ...a, answer: draft.answers[a.id] },
    );
    const flips = replyFlips(mock, posts, draft.answers, decision);
    const comment = await store.commitReply({
      mockId: mock.id,
      sessionId,
      text: text ?? "",
      payload,
      asks,
      accept: [...flips.accept],
      archive: [...flips.archive],
    });
    if (!comment) return fail(409, `${mock.slug} has no agent session to reply to`);
    announceComment(comment);
    bus.broadcast({ type: "mock-updated", id: mock.id, project: mock.project });
    bus.broadcast({ type: "draft-updated", mockId: mock.id });
    const after = await store.listPosts({ mockId: mock.id });
    for (const p of after) {
      if (flips.accept.has(p.id) || flips.archive.has(p.id)) {
        bus.broadcast({
          type: "post-updated",
          id: p.id,
          mockId: mock.id,
          sessionId: p.sessionId,
          version: p.version,
        });
      }
    }
    fireNotify({
      event: "decision",
      project: mock.project,
      slug: mock.slug,
      variant: decision?.variant ?? "",
      version: draft.version,
      text: text || decision?.kind || "reply",
      url: mockUrl(ctx.base, mock),
    });
    const [seen] = await withSeen([comment]);
    return ok(
      {
        reply: seen,
        accepted: after
          .filter((p) => flips.accept.has(p.id))
          .map((p) => ({ state: p.state, variant: p.variant })),
        archived: after
          .filter((p) => flips.archive.has(p.id))
          .map((p) => ({ state: p.state, variant: p.variant })),
      },
      201,
    );
  }

  async function restoreFlow(ref: unknown, body: any): Promise<FlowResult> {
    const mock = await resolveMock(ref, body?.project);
    if (isResult(mock)) return mock;
    const posts = await store.listPosts({ mockId: mock.id });
    const chosen = chooseVariant(mock, posts, stateArg(body?.state), str(body?.variant, MAX_LABEL));
    if (isResult(chosen)) return chosen;
    const updated = await store.setPostStatus(chosen.id, "open");
    if (!updated) return fail(404, "variant not found");
    bus.broadcast({
      type: "post-updated",
      id: updated.id,
      mockId: mock.id,
      sessionId: updated.sessionId,
      version: updated.version,
    });
    return ok({ state: updated.state, variant: updated.variant, status: updated.status });
  }

  // D8 "restore as vN": the user brings an older version back as the newest
  // one. Distinct from restoreFlow, which un-archives a variant. Viewer-only
  // because the version is authored by the user; an agent restoring is a revise.
  async function restoreVersionFlow(
    ref: unknown,
    postId: string,
    body: any,
    ctx: FlowContext,
  ): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const mock = await resolveMock(ref);
    if (isResult(mock)) return mock;
    const post = await store.getPost(postId);
    if (!post || post.mock !== mock.id) return fail(404, `${mock.slug} has no variant "${postId}"`);
    const version = Number(body?.version);
    if (!Number.isInteger(version) || version < 1) {
      return fail(400, '"version" must be a positive integer');
    }
    if (version === post.version) return fail(409, `v${version} is already the current version`);
    const old = post.history.find((h) => h.version === version);
    if (!old) return fail(404, `v${version} is not available`);
    const updated = await store.updatePost(post.id, {
      surfaces: old.surfaces,
      title: old.title,
      from: version,
      prompt: `restored v${version}`,
      author: "user",
    });
    if (!updated) return fail(404, "variant not found");
    const touched = (await store.updateMock(mock.id, {})) ?? mock;
    bus.broadcast({ type: "mock-updated", id: touched.id, project: touched.project });
    announcePost(touched, updated, false);
    return ok({
      state: updated.state,
      variant: updated.variant,
      version: updated.version,
      from: version,
    });
  }

  async function removeMockFlow(ref: unknown, query: { project?: unknown }): Promise<FlowResult> {
    const mock = await resolveMock(ref, query.project);
    if (isResult(mock)) return mock;
    await store.removeMock(mock.id);
    bus.broadcast({ type: "mock-deleted", id: mock.id, project: mock.project });
    return ok({ ok: true });
  }

  // --- per-surface edits of one variant ---

  function findSurfaceIndex(surfaces: Surface[], target: string): number {
    const byId = surfaces.findIndex((s) => s.id === target);
    if (byId >= 0) return byId;
    const idx = Number(target);
    if (Number.isInteger(idx) && idx >= 0 && idx < surfaces.length) return idx;
    return -1;
  }

  // Slot a content string into a surface's content field, preserving kind and
  // extra fields. Null when the kind has no content field or JSON parse fails.
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

  type SurfaceEdit = (
    surfaces: Surface[],
    scope: SurfaceKitScope,
  ) => Promise<Surface[] | { surfaces: Surface[]; applied: string[] } | FlowResult>;

  async function editSurfaces(
    ref: unknown,
    body: any,
    ctx: FlowContext,
    edit: SurfaceEdit,
  ): Promise<FlowResult> {
    const resolved = await resolveMock(ref, body?.project, body?.session);
    if (isResult(resolved)) return resolved;
    const posts = await store.listPosts({ mockId: resolved.id });
    const post = chooseVariant(
      resolved,
      posts,
      stateArg(body?.state),
      str(body?.variant, MAX_LABEL),
    );
    if (isResult(post)) return post;
    const edited = await edit(post.surfaces, await kitScope(resolved.project));
    if (isResult(edited)) return edited;
    const [next, applied] = Array.isArray(edited)
      ? [edited, undefined]
      : [edited.surfaces, edited.applied];
    const bad = checkSurfaces(next);
    if (bad) return bad;
    const updated = await store.updatePost(post.id, { surfaces: next });
    if (!updated) return fail(404, "variant not found");
    const session = await store.getSession(updated.sessionId);
    const mock = await updateMockAfterWrite(resolved, {
      state: updated.state,
      knobs: {},
      session,
    });
    announcePost(mock, updated, false);
    return writeResult(mock, updated, ctx, { previous: post.surfaces, applied });
  }

  async function oneSurface(
    raw: unknown,
    ctx: FlowContext,
    scope: SurfaceKitScope,
  ): Promise<Surface | FlowResult> {
    if (!ctx.strict) {
      const [surface] = await coerceSurfaces([raw], scope);
      return surface ?? fail(400, "invalid surface");
    }
    const parsed = await validateSurfaces([raw], scope);
    return parsed.ok ? parsed.surfaces[0] : fail(400, parsed.error, surfaceIssues(parsed));
  }

  const appendSurfaceFlow = (ref: unknown, body: any, ctx: FlowContext) =>
    editSurfaces(ref, body, ctx, async (surfaces, scope) => {
      if (!body?.surface) return fail(400, 'provide a "surface" object');
      const surface = await oneSurface(body.surface, ctx, scope);
      if (isResult(surface)) return surface;
      let at = surfaces.length;
      for (const [key, shift] of [
        ["before", 0],
        ["after", 1],
      ] as const) {
        if (body[key] === undefined) continue;
        const i = findSurfaceIndex(surfaces, String(body[key]));
        if (i < 0) return fail(404, `surface "${body[key]}" not found`);
        at = i + shift;
        break;
      }
      const next = [...surfaces];
      next.splice(at, 0, surface);
      return next;
    });

  const replaceSurfaceFlow = (ref: unknown, target: string, body: any, ctx: FlowContext) =>
    editSurfaces(ref, body, ctx, async (surfaces, scope) => {
      const idx = findSurfaceIndex(surfaces, target);
      if (idx < 0) return fail(404, `surface "${target}" not found`);
      const partEdits = partEditsArg(body ?? {});
      if (isResult(partEdits)) return partEdits;
      if (partEdits) {
        if (body.surface !== undefined || body.content !== undefined) {
          return fail(400, 'pass "parts" or "surface"/"content", not both');
        }
        if (surfaces[idx].kind !== "html") {
          return fail(
            400,
            `parts works on html surfaces; surface ${target} is ${surfaces[idx].kind}`,
          );
        }
        const result = spliceParts([surfaces[idx]], partEdits);
        if (!result.ok) return fail(400, result.error);
        const next = [...surfaces];
        next[idx] = result.surfaces[0];
        return { surfaces: next, applied: result.applied };
      }
      let updated: Surface;
      if (body?.surface !== undefined) {
        const surface = await oneSurface(body.surface, ctx, scope);
        if (isResult(surface)) return surface;
        updated = surface;
        if (body.kits !== undefined && updated.kind === "html") {
          updated = { ...updated, kits: Array.isArray(body.kits) ? body.kits : undefined };
        }
      } else if (typeof body?.content === "string") {
        const applied = applyContent(surfaces[idx], body.content, body.kits);
        if (!applied) {
          return fail(400, `content update not supported for ${surfaces[idx].kind} surfaces`);
        }
        const parsed = await validateSurfaces([applied], scope);
        if (!parsed.ok) return fail(400, parsed.error, surfaceIssues(parsed));
        updated = parsed.surfaces[0];
      } else {
        return fail(400, 'provide "surface" or "content"');
      }
      const next = [...surfaces];
      // Validation drops ids; the edited surface keeps its identity.
      next[idx] = { ...updated, id: surfaces[idx].id };
      return next;
    });

  const removeSurfaceFlow = (ref: unknown, target: string, body: any, ctx: FlowContext) =>
    editSurfaces(ref, body, ctx, async (surfaces) => {
      const idx = findSurfaceIndex(surfaces, target);
      if (idx < 0) return fail(404, `surface "${target}" not found`);
      if (surfaces.length === 1) return fail(400, "a variant needs at least one surface");
      return surfaces.filter((_, i) => i !== idx);
    });

  const reorderSurfacesFlow = (ref: unknown, body: any, ctx: FlowContext) =>
    editSurfaces(ref, body, ctx, async (surfaces) => {
      const order = body?.order;
      if (!Array.isArray(order)) return fail(400, 'provide an "order" array');
      if (order.length !== surfaces.length) {
        return fail(400, "order array length must match surface count");
      }
      const used = new Set<number>();
      const next: Surface[] = [];
      for (const entry of order) {
        const idx = findSurfaceIndex(surfaces, String(entry));
        if (idx < 0) return fail(404, `surface "${entry}" not found`);
        if (used.has(idx)) return fail(400, `surface "${entry}" appears twice in order`);
        used.add(idx);
        next.push(surfaces[idx]);
      }
      return next;
    });

  // --- comments ---

  function numberInRange(value: unknown, min: number, max: number): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }

  function sanitizeCommentAnchor(
    raw: unknown,
    mock: Mock,
    post: Post | null,
  ): CommentAnchor | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const input = raw as Record<string, unknown>;
    if (input.kind === "part") {
      const part = str(input.part, 200);
      if (!part) return undefined;
      const state = stateArg(input.state) ?? post?.state ?? null;
      if (state !== null && !mock.states.includes(state)) return undefined;
      return { kind: "part", part, state, ...sanitizePartAnchor(input) };
    }
    if (!post) return undefined;
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
  function sanitizeAnchors(raw: unknown, post: Post | null, viewport: number | null): Anchor[] {
    if (!post || !Array.isArray(raw)) return [];
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

  function announceComment(comment: Comment) {
    bus.broadcast({
      type: "comment-created",
      id: comment.id,
      sessionId: comment.sessionId,
      mockId: comment.mockId,
      postId: comment.postId,
      seq: comment.seq,
    });
  }

  // A comment on a mock (optionally one variant). The viewer may author it as
  // the user; every agent channel writes as its session's agent.
  async function commentFlow(body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const text = str(body.text, MAX_COMMENT_TEXT);
    if (!text) return fail(400, 'provide non-empty "text"');
    let post: Post | null = null;
    let mock: Mock | null = null;
    if (typeof body.post === "string" && body.post) {
      post = await store.getPost(body.post);
      if (!post) return fail(404, "post not found");
      mock = await store.getMock(post.mock);
    } else if (body.mock !== undefined) {
      const resolved = await resolveMock(body.mock, body.project, body.session);
      if (isResult(resolved)) return resolved;
      mock = resolved;
      if (body.variant !== undefined || body.state !== undefined) {
        const posts = await store.listPosts({ mockId: mock.id });
        const chosen = chooseVariant(
          mock,
          posts,
          stateArg(body.state),
          str(body.variant, MAX_LABEL),
        );
        if (isResult(chosen)) return chosen;
        post = chosen;
      }
    } else {
      return fail(400, 'provide "mock" (or "post")');
    }
    if (!mock) return fail(404, "mock not found");
    let session: Session | null = null;
    if (typeof body.session === "string" && body.session) {
      session = await store.getSession(body.session);
      if (!session) return fail(404, `session "${body.session}" not found`);
    }
    if (!session) {
      const sid = mock.sessionId ?? post?.sessionId;
      session = sid ? await store.getSession(sid) : null;
    }
    if (!session) return fail(409, `${mock.slug} has no agent session`);
    // Only the trusted viewer may declare the two non-agent labels. Sandboxed
    // surfaces have opaque origins, so their bridge is stamped "surface" by the
    // viewer rather than by contained code.
    const author =
      ctx.viewer && (body.author === "user" || body.author === "surface")
        ? body.author
        : reservedAgent(session.agent);
    const viewport = sanitizeViewport(body.viewport);
    const comment = await store.createComment({
      sessionId: session.id,
      mockId: mock.id,
      postId: post?.id ?? null,
      author,
      text,
      anchor: sanitizeCommentAnchor(body.anchor, mock, post),
      kind: "comment",
      anchors: sanitizeAnchors(body.anchors, post, viewport),
      postVersion: post ? sanitizePostVersion(body.postVersion, post) : null,
      viewport,
    });
    if (!comment) return fail(404, "session not found");
    announceComment(comment);
    // Agent replies are writes too — piggyback pending feedback on them, but
    // never on the user's own comments.
    const userFeedback = author === "user" ? undefined : await collectFeedback(comment.sessionId);
    return ok({ ...comment, ...(userFeedback ? { userFeedback } : {}) }, 201);
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
    const query = { sessionId: q.sessionId, mockId: q.mockId, postId: q.postId, afterSeq };
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
          if (q.mockId && event.mockId !== q.mockId) return;
          if (q.postId && event.postId !== q.postId) return;
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
    // filtered ones — so the next call doesn't re-read the agent's own comments.
    const lastSeq = all.length > 0 ? all[all.length - 1].seq : (afterSeq ?? 0);
    // An author=user query is the agent listening (the viewer never filters by
    // author) — what it receives here must not be re-delivered as piggyback.
    if (q.agent && q.author === "user" && q.sessionId && all.length > 0) {
      await store.markAgentSeen(q.sessionId, lastSeq);
      bus.broadcast({ type: "comment-seen", sessionId: q.sessionId, seq: lastSeq });
    }
    return { comments, lastSeq };
  }

  // The agent's read: comments plus the batched feedback built from them.
  async function feedbackFlow(q: CommentWait, signal?: AbortSignal): Promise<FlowResult> {
    const result = await waitForComments({ ...q, agent: true }, signal);
    const feedback = await buildFeedbackBatches(store, result.comments);
    return ok({ ...result, feedback });
  }

  // Store an uploaded blob. An explicit session is validated and a missing one
  // is auto-created so an upload can precede the first publish. The asset's
  // data is dropped from the result (it's bytes).
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

  // --- auth ---

  const isAuthenticated = (c: Context): boolean => {
    if (!authToken) return true;
    if (c.req.header("authorization") === `Bearer ${authToken}`) return true;
    if (getCookie(c, "mockpit_key") === authToken) return true;
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
      setCookie(c, "mockpit_key", authToken, {
        httpOnly: true,
        sameSite: "Lax",
        secure: new URL(c.req.url).protocol === "https:",
        maxAge: 60 * 60 * 24 * 90,
        path: "/",
      });
      return next();
    }
    if (
      publicRead &&
      c.req.method === "GET" &&
      isPublicReadAllowed(path, publicRead, new URL(c.req.url).searchParams)
    ) {
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

  const withViewerConfig = (
    text: string,
    request: Request,
    isReadonly: boolean,
    pageTitle?: string | null,
  ) => {
    const config = [
      `window.__MOCKPIT_BASE_PATH__=${JSON.stringify(requestBasePath(request))};`,
      pageTitle ? `window.__MOCKPIT_PAGE_TITLE__=${JSON.stringify(pageTitle)};` : "",
      isReadonly ? "window.__MOCKPIT_READONLY__=true;" : "",
      isReadonly && publicRead
        ? `window.__MOCKPIT_PUBLIC_READ__=${JSON.stringify(publicRead)};`
        : "",
      screenshots ? "window.__MOCKPIT_SCREENSHOTS__=true;" : "",
    ].join("");
    return injectHead(text, `<script>${config}</script>`);
  };

  // --- viewer pages ---

  // Link previews for a mock page: the first open variant's first surface,
  // with every pixel-affecting input pinned in the image URL so the Worker can
  // cache it at the edge.
  const mockPreviewHead = (
    mock: Mock,
    post: Post,
    request: Request,
    mode: Mode,
    rendererGeneration: string,
  ) => {
    const origin = new URL(request.url).origin;
    const publicBasePath = requestBasePath(request);
    const canonical = `${origin}${publicBasePath}/project/${encodeURIComponent(mock.project)}/${encodeURIComponent(mock.slug)}`;
    const imageUrl = new URL(`${origin}${publicBasePath}/s/${post.id}.png`);
    imageUrl.searchParams.set("card", "1");
    imageUrl.searchParams.set("theme", DEFAULT_THEME_ID);
    imageUrl.searchParams.set("mode", mode);
    imageUrl.searchParams.set("v", String(post.version));
    imageUrl.searchParams.set("g", rendererGeneration);
    const image = imageUrl.toString();
    const title = escapeHtml(mock.title);
    const description = "A https://mockpit.sh mock";
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
    opts: { title?: string | null; preview?: { mock: Mock; post: Post } } = {},
  ) => {
    // The viewer HTML is the trusted app origin — it shares that origin with the
    // authenticated API and the comment→agent channel, so a cross-origin page
    // that frames it could clickjack actions or the prompt-injection channel.
    // Refuse cross-origin framing (same-origin embedding still allowed). The
    // sandboxed surface documents at /s/:id are *meant* to be framed and carry
    // their own `sandbox` CSP header instead, so they never pass through here.
    c.header("Content-Security-Policy", "frame-ancestors 'self'");
    const html = withDocumentTitle(
      withViewerConfig(
        withOrigin(viewerHtml, { req: { url: c.req.url } }),
        c.req.raw,
        !!publicRead && !isAuthenticated(c),
        opts.title,
      ),
      opts.title,
    );
    if (!opts.preview) return html;
    const { mock, post } = opts.preview;
    return injectHead(
      html,
      mockPreviewHead(mock, post, c.req.raw, await workspaceMode(), version ?? "dev"),
    );
  };
  app.get("/", async (c) => c.html(await configuredViewerHtml(c)));
  // The engine reads the project/mock out of the URL itself; these render the
  // same shell as "/".
  app.get("/project/:name", async (c) =>
    c.html(await configuredViewerHtml(c, { title: c.req.param("name") })),
  );
  app.get("/project/:name/:slug", async (c) => {
    const mock = await store.findMock(c.req.param("name"), c.req.param("slug"));
    if (!mock) return c.html(await configuredViewerHtml(c, { title: c.req.param("name") }));
    const posts = await store.listPosts({ mockId: mock.id });
    const post = posts.find((p) => p.status !== "archived") ?? posts[0];
    return c.html(
      await configuredViewerHtml(c, {
        title: mock.title,
        ...(post ? { preview: { mock, post } } : {}),
      }),
    );
  });

  // --- REST plumbing for the shared flows ---

  const flowCtx = (c: Context, strict = true): FlowContext => ({
    base: `${new URL(c.req.url).origin}${requestBasePath(c.req.raw)}`,
    // The browser sets Fetch Metadata on same-origin requests; only the trusted
    // viewer may act as the user (drafts, replies, user-authored comments).
    viewer: c.req.header("sec-fetch-site") === "same-origin",
    strict,
    request: c.req.raw,
    signal: c.req.raw.signal,
  });
  const send = (c: Context, result: FlowResult) => c.json(result.body, result.status as 200);
  const jsonBody = (c: Context) => c.req.json().catch(() => null);
  const flag = (c: Context, key: string) => c.req.query(key) === "1";

  // --- sessions ---

  app.get("/api/sessions", async (c) => {
    const [sessions, counts] = await Promise.all([
      store.listSessions(),
      store.countPostsBySession(),
    ]);
    return c.json(sessions.map((s) => sessionRowView(s, counts.get(s.id) ?? 0)));
  });

  app.get("/api/sessions/:id", async (c) => {
    const session = await store.getSession(c.req.param("id"));
    if (!session) return c.json({ error: "session not found" }, 404);
    const posts = await store.listPosts({ sessionId: session.id });
    return c.json(sessionRowView(session, posts.length));
  });

  app.post("/api/sessions", async (c) => {
    const body = (await jsonBody(c)) ?? {};
    const cwd = str(body.cwd, 4096);
    const session = await store.createSession({
      agent: str(body.agent, MAX_TITLE) ?? "agent",
      title: str(body.title, MAX_TITLE),
      cwd,
      // Resolved once here so every mock this session publishes lands in the
      // same project.
      project: resolveProject(str(body.project, MAX_TITLE), cwd),
    });
    bus.broadcast({ type: "session-created", id: session.id });
    return c.json(session, 201);
  });

  app.patch("/api/sessions/:id", async (c) => {
    const body = await jsonBody(c);
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

  // --- projects and mocks ---

  app.get("/api/projects", async (c) => c.json(await store.listProjects()));

  app.get("/api/mocks", async (c) =>
    send(c, await listMocksFlow({ project: c.req.query("project") })),
  );

  app.post("/api/mocks", async (c) => send(c, await publishFlow(await jsonBody(c), flowCtx(c))));

  // A session-scoped public read may only address a mock by its unguessable id.
  const guardPublicMock = async (c: Context): Promise<Response | null> => {
    if (!isUnauthenticatedSessionRead(c)) return null;
    return (await store.getMock(c.req.param("id") ?? ""))
      ? null
      : c.json({ error: "mock not found" }, 404);
  };

  app.get("/api/mocks/:id", async (c) => {
    const denied = await guardPublicMock(c);
    if (denied) return denied;
    return send(
      c,
      await getMockFlow(c.req.param("id"), {
        project: c.req.query("project"),
        body: flag(c, "body"),
        history: flag(c, "history"),
      }),
    );
  });

  app.get("/api/mocks/:id/export", async (c) => {
    const denied = await guardPublicMock(c);
    if (denied) return denied;
    return send(
      c,
      await exportFlow(
        c.req.param("id"),
        {
          project: c.req.query("project"),
          state: c.req.query("state"),
          variant: c.req.query("variant"),
        },
        flowCtx(c),
      ),
    );
  });

  app.post("/api/mocks/:id/revise", async (c) => {
    const body = (await jsonBody(c)) ?? {};
    const mock = await resolveMock(c.req.param("id"), body.project, body.session);
    if (isResult(mock)) return send(c, mock);
    return send(c, await publishFlow({ ...body, mock: mock.id }, flowCtx(c), true));
  });

  app.delete("/api/mocks/:id", async (c) =>
    send(c, await removeMockFlow(c.req.param("id"), { project: c.req.query("project") })),
  );

  app.post("/api/mocks/:id/asks", async (c) =>
    send(c, await askFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );

  app.get("/api/mocks/:id/draft", async (c) =>
    send(c, await getDraftFlow(c.req.param("id"), flowCtx(c))),
  );
  app.put("/api/mocks/:id/draft", async (c) =>
    send(c, await putDraftFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.delete("/api/mocks/:id/draft", async (c) =>
    send(c, await deleteDraftFlow(c.req.param("id"), flowCtx(c))),
  );

  app.post("/api/mocks/:id/reply", async (c) =>
    send(c, await replyFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );

  app.post("/api/mocks/:id/restore", async (c) =>
    send(c, await restoreFlow(c.req.param("id"), await jsonBody(c))),
  );

  app.post("/api/mocks/:id/variants/:postId/restore", async (c) =>
    send(
      c,
      await restoreVersionFlow(
        c.req.param("id"),
        c.req.param("postId"),
        await jsonBody(c),
        flowCtx(c),
      ),
    ),
  );

  app.post("/api/mocks/:id/surfaces", async (c) =>
    send(c, await appendSurfaceFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.patch("/api/mocks/:id/surfaces", async (c) =>
    send(c, await reorderSurfacesFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.patch("/api/mocks/:id/surfaces/:target", async (c) =>
    send(
      c,
      await replaceSurfaceFlow(
        c.req.param("id"),
        c.req.param("target"),
        await jsonBody(c),
        flowCtx(c),
      ),
    ),
  );
  app.delete("/api/mocks/:id/surfaces/:target", async (c) =>
    send(
      c,
      await removeSurfaceFlow(
        c.req.param("id"),
        c.req.param("target"),
        {
          state: c.req.query("state"),
          variant: c.req.query("variant"),
          project: c.req.query("project"),
          session: c.req.query("session"),
        },
        flowCtx(c),
      ),
    ),
  );

  // --- comments ---

  app.post("/api/comments", async (c) => send(c, await commentFlow(await jsonBody(c), flowCtx(c))));

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
    const mockId = c.req.query("mock");
    const postId = c.req.query("post");
    if (isUnauthenticatedSessionRead(c)) {
      if (!sessionId && !mockId && !postId) {
        return c.json({ error: "session, mock or post required" }, 401);
      }
      if (sessionId && !(await store.getSession(sessionId))) {
        return c.json({ error: "session not found" }, 404);
      }
      if (mockId && !(await store.getMock(mockId))) return c.json({ error: "mock not found" }, 404);
      if (postId && !(await store.getPost(postId))) return c.json({ error: "post not found" }, 404);
    }
    const waitSeconds = Number(c.req.query("wait") ?? 0) || 0;
    const author = c.req.query("author");
    const after = c.req.query("after");
    const query: CommentWait = {
      sessionId,
      mockId,
      postId,
      author,
      afterSeq: after ? Number(after) : undefined,
      waitSeconds,
    };
    // An `author=user` read (or any wait) is the agent listening; anything else
    // is the viewer reading a thread, which gets per-comment delivery state.
    // Only an authenticated caller can be the agent: on a public-read workspace
    // an anonymous reader must never advance the feedback cursor, or the agent
    // would silently lose the comments that reader "took".
    const isAgentRead = isAuthenticated(c) && (author === "user" || waitSeconds > 0);
    query.agent = isAgentRead;
    const respond = async (signal?: AbortSignal) => {
      if (isAgentRead) return send(c, await feedbackFlow(query, signal));
      const result = await waitForComments(query, signal);
      return c.json({ ...result, comments: await withSeen(result.comments) });
    };
    if (waitSeconds <= 0) return respond();
    if (!acquireHold()) return c.json({ error: "too many concurrent connections" }, 503);
    const release = makeRelease();
    // If the client disconnects mid-wait, release the slot promptly.
    c.req.raw.signal.addEventListener("abort", release, { once: true });
    try {
      return await respond(c.req.raw.signal);
    } finally {
      release();
    }
  });

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
  app.get("/guide", (c) => c.text(withOrigin(topics.html ?? "", c)));
  app.get("/setup", (c) => c.text(withOrigin(setupText, c)));
  // The brief without `?topic=`, one reference topic with it. Unknown topics
  // are a 400 that names the real ones, so an agent can correct itself.
  app.get("/agent-howto", async (c) => {
    const topic = c.req.query("topic");
    if (topic === undefined) return c.text(withOrigin(await briefFor(c.req.query("project")), c));
    if (!isGuideTopic(topic))
      return c.json({ error: unknownTopicMessage(topic), topics: GUIDE_TOPICS }, 400);
    return c.text(withOrigin(topics[topic] ?? "", c));
  });

  // Opt-in html kits available on this workspace (id, label, summary, classes) —
  // for discovery (`mockpit kits`); the CSS/JS payloads are server-only. With
  // `?project=`, that project's own kits follow the bundled ones.
  app.get("/api/kits", async (c) => {
    const project = c.req.query("project");
    return c.json(kitSummaries(project ? ((await designFor(project))?.projectKits ?? []) : []));
  });

  // --- theme: one palette, so the workspace setting is just its mode ---

  app.get("/api/theme", async (c) => c.json({ mode: await workspaceMode() }));

  app.put("/api/theme", async (c) => {
    const body = await c.req.json().catch(() => null);
    const mode = body?.mode;
    if (!isMode(mode)) return c.json({ error: 'mode must be "dark" or "light"' }, 400);
    await store.setSetting("mode", mode);
    bus.broadcast({ type: "theme-changed", mode });
    return c.json({ mode });
  });

  // The project's design system, imported by `mockpit init` and injected into
  // every html surface of the project (see renderHtmlPage).
  app.get("/api/projects/:name/design", async (c) => c.json(await designFor(c.req.param("name"))));

  app.put("/api/projects/:name/design", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid JSON body" }, 400);
    const project = c.req.param("name");
    // `mockpit init` re-detects the repo and PUTs without iconSets; that must
    // not uninstall what `mockpit icons add` installed.
    const previous = await designFor(project);
    let iconSets = previous?.iconSets ?? [];
    if (body.iconSets !== undefined) {
      const checked = await checkIconSets(body.iconSets);
      if (typeof checked === "string") return c.json({ error: checked }, 400);
      iconSets = checked;
    }
    // Same rule as iconSets: a PUT that omits projectKits keeps them.
    let projectKits = previous?.projectKits ?? [];
    if (body.projectKits !== undefined) {
      const checked = checkProjectKits(body.projectKits);
      if (typeof checked === "string") return c.json({ error: checked }, 400);
      projectKits = checked;
    }
    const kitIds = ["tailwind", "none", ...KIT_IDS, ...projectKits.map((k) => k.id)];
    const kit = body.kit === undefined || body.kit === null ? "none" : body.kit;
    if (typeof kit !== "string" || !kitIds.includes(kit))
      return c.json({ error: `unknown kit "${String(kit)}" — known: ${kitIds.join(", ")}` }, 400);
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
      // A cut stylesheet would not compile, so an oversized one is dropped
      // whole and the frame falls back to `cssVars`.
      tailwindCss:
        typeof body.tailwindCss === "string" && body.tailwindCss.length <= 128_000
          ? body.tailwindCss
          : "",
      strippedImports: Array.isArray(body.strippedImports)
        ? body.strippedImports
            .filter((s: unknown) => typeof s === "string")
            .map((s: string) => s.slice(0, 200))
            .slice(0, 50)
        : [],
      iconSets,
      projectKits,
      updatedAt: new Date().toISOString(),
    };
    return c.json(await saveDesign(project, design));
  });

  async function saveDesign(project: string, design: DesignSettings): Promise<DesignSettings> {
    await store.setSetting(`design:${project}`, JSON.stringify(design));
    // Every rendered surface bakes the design into its document string, so a
    // design change invalidates them all.
    clearRenderCache();
    bus.broadcast({ type: "theme-changed", mode: await workspaceMode() });
    return design;
  }

  const MAX_PROJECT_KITS = 16;
  function checkProjectKits(raw: unknown): DesignSettings["projectKits"] | string {
    if (!Array.isArray(raw)) return "projectKits must be an array";
    if (raw.length > MAX_PROJECT_KITS) return `at most ${MAX_PROJECT_KITS} project kits`;
    const kits: DesignSettings["projectKits"] = [];
    for (const item of raw) {
      const kit = checkProjectKit(item);
      if (typeof kit === "string") return kit;
      if (kits.some((k) => k.id === kit.id)) return `kit "${kit.id}" is listed twice`;
      kits.push(kit);
    }
    return kits;
  }

  const emptyDesign = (): DesignSettings => ({
    detected: null,
    palette: null,
    kit: "none",
    cssVars: "",
    tailwindCss: "",
    strippedImports: [],
    iconSets: [],
    projectKits: [],
    updatedAt: new Date().toISOString(),
  });

  // Add or replace one project kit (`mockpit kit add`). A project that never ran
  // init gets a design holding just the kit.
  app.put("/api/projects/:name/kits/:id", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid JSON body" }, 400);
    const project = c.req.param("name");
    const kit = checkProjectKit({ ...body, id: c.req.param("id") });
    if (typeof kit === "string") return c.json({ error: kit }, 400);
    const design = (await designFor(project)) ?? emptyDesign();
    const others = design.projectKits.filter((k) => k.id !== kit.id);
    if (others.length >= MAX_PROJECT_KITS)
      return c.json({ error: `at most ${MAX_PROJECT_KITS} project kits` }, 400);
    const saved = await saveDesign(project, {
      ...design,
      projectKits: [...others, kit],
      updatedAt: new Date().toISOString(),
    });
    return c.json(saved);
  });

  // Removing the project's default kit falls back to no kit rather than leaving
  // design.kit naming something that no longer resolves.
  app.delete("/api/projects/:name/kits/:id", async (c) => {
    const project = c.req.param("name");
    const id = c.req.param("id");
    const design = await designFor(project);
    if (!design?.projectKits.some((k) => k.id === id))
      return c.json({ error: `${project} has no kit "${id}"` }, 404);
    const saved = await saveDesign(project, {
      ...design,
      kit: design.kit === id ? "none" : design.kit,
      projectKits: design.projectKits.filter((k) => k.id !== id),
      updatedAt: new Date().toISOString(),
    });
    return c.json(saved);
  });

  // Every set an html surface of this project can name, installed first.
  app.get("/api/projects/:name/icons", async (c) => {
    const sets = await iconSetsFor(await designFor(c.req.param("name")));
    return c.json({
      sets: sets.map((s) => ({ prefix: s.prefix, count: iconCount(s.set), source: s.source })),
    });
  });

  // The installed sets a design PUT names: each must be an uploaded Iconify
  // JSON set whose prefix matches, so a typo fails here rather than as blank
  // icons on every render. The count is read off the set, not trusted.
  const MAX_ICON_SETS = 32;
  async function checkIconSets(raw: unknown): Promise<IconSetRef[] | string> {
    if (!Array.isArray(raw)) return "iconSets must be an array of {prefix, assetId}";
    if (raw.length > MAX_ICON_SETS) return `at most ${MAX_ICON_SETS} icon sets`;
    const byPrefix = new Map<string, IconSetRef>();
    for (const entry of raw) {
      const prefix = entry?.prefix;
      const assetId = entry?.assetId;
      if (!isIconName(prefix) || typeof assetId !== "string" || !assetId) {
        return "each icon set needs a prefix (lowercase, e.g. lucide) and an assetId";
      }
      const set = await installedIconSet(assetId);
      if (!set) return `icon set ${prefix}: asset ${assetId} is not an Iconify JSON set`;
      if (set.prefix !== prefix) {
        return `icon set ${prefix}: asset ${assetId} holds the ${set.prefix} set`;
      }
      byPrefix.set(prefix, { prefix, assetId, count: iconCount(set) });
    }
    return [...byPrefix.values()];
  }

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
  // server-side; mermaid as a self-rendering CDN doc). Image/json surfaces
  // are data the viewer renders natively (text nodes / <img> / JSX), so they
  // never reach here.
  // Everything a rendered document depends on. The resolved version makes a
  // version's content immutable, and `origin` is in the key because it is baked
  // into the document (CSP, <base>, asset URLs) — a pre-warm triggered by an
  // agent publishing over one origin must never be served to a viewer on another.
  // `knobs` is the canonical (validated, path-sorted) JSON of `?k=`, so two
  // spellings of the same values share an entry.
  const renderKey = (o: {
    postId: string;
    idx: number;
    version: number;
    mode?: Mode;
    origin: string;
    knobs?: string;
  }) => `${o.postId}:${o.idx}:${o.version}:${o.mode ?? "os"}:${o.origin}:${o.knobs ?? ""}`;

  // The document itself. Shared by the GET below and the publish-time pre-warm,
  // so both produce byte-identical output for one key.
  async function buildSurfaceDoc(args: {
    post: Post;
    mock: Mock | null;
    surface: Surface;
    title: string;
    version: number;
    mode?: Mode;
    origin: string;
    design: DesignSettings | null;
    knobs?: Record<string, KnobValue>;
  }): Promise<string> {
    const { surface, mode, origin } = args;
    const theme = themeById(DEFAULT_THEME_ID);
    const themeId = theme.id;
    if (surface.kind === "html") {
      // A page mock composes published components by reference; the tags
      // are expanded here, server-side, so the whole page is still ONE
      // sandboxed document rather than nested frames.
      const html =
        args.mock?.kind === "page"
          ? await expandPageHtml(args.mock.project, args.post, surface.html)
          : surface.html;
      return renderHtmlPage({
        title: args.title,
        html,
        origin,
        theme,
        mode,
        kits: surface.kits,
        design: args.design,
        version: args.version,
        knobs: args.knobs,
        resolveIcon: mayHaveIcons(html) ? (await iconResolverFor(args.design)).resolve : undefined,
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
  function warmPost(post: Post, mock: Mock): void {
    const origin = lastOrigin;
    if (!origin) return;
    void (async () => {
      const design = await designFor(mock.project);
      let warmed = 0;
      for (const [idx, surface] of post.surfaces.entries()) {
        if (warmed >= PREWARM_SURFACE_LIMIT) break;
        if (!isSandboxedSurfaceKind(surface.kind)) continue;
        warmed++;
        for (const mode of ["light", "dark"] as const) {
          const key = renderKey({ postId: post.id, idx, version: post.version, mode, origin });
          if (renderCache.has(key)) continue;
          await cachedRender(key, () =>
            buildSurfaceDoc({
              post,
              mock,
              surface,
              title: post.title,
              version: post.version,
              mode,
              origin,
              design,
            }),
          );
        }
      }
    })().catch((err) => console.warn("[mockpit] render pre-warm failed", err));
  }

  // `?k=` arrives URL-encoded; past this it is not a set of knob values.
  const MAX_KNOB_QUERY = 8 * 1024;

  const renderPostPage = async (c: any) => {
    const surfaceParam = c.req.query("surface") ?? "0";
    const ver = c.req.query("ver");
    const modeParam = c.req.query("mode");
    const mode: Mode | undefined =
      modeParam === "light" || modeParam === "dark" ? modeParam : undefined;
    const kParam: string | undefined = c.req.query("k");
    const origin = new URL(c.req.url).origin;

    // Cache-first. A hit needs nothing from the post row, and the row is the
    // expensive part of this route (surfaces + every retained version). Only a
    // version-pinned request can take this path: without `ver` the current
    // version — and so the key — is unknown until the row is read. A `?k=`
    // request never does: its values are checked against the mock's knobs,
    // which can change under a pinned version.
    const pinned = Number(ver);
    if (Number.isInteger(pinned) && pinned > 0 && kParam === undefined) {
      const hit = renderCacheHit(
        renderKey({
          postId: c.req.param("id"),
          idx: Number(surfaceParam),
          version: pinned,
          mode,
          origin,
        }),
      );
      if (hit !== undefined) {
        surfaceDocHeaders(c, true);
        return c.html(hit);
      }
    }

    const post = await store.getPost(c.req.param("id"));
    if (!post) return c.text("Post not found", 404);
    const mock = await store.getMock(post.mock);

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
    // Only the kinds that become HTML are served here. Image/json render
    // natively in the viewer and must not be reachable as a document.
    if (!surface || !isSandboxedSurfaceKind(surface.kind)) {
      return c.text("No renderable surface at that index", 404);
    }

    // Knob values are agent/user data: only values the mock (or this variant's
    // per-part overrides) declares, within their schema, ever reach the document.
    let knobs: Record<string, KnobValue> | undefined;
    let knobsKey: string | undefined;
    if (kParam !== undefined) {
      const bad = (error: string) => {
        surfaceDocHeaders(c, false);
        return c.text(error, 400);
      };
      if (kParam.length > MAX_KNOB_QUERY) return bad("k is too long");
      let raw: unknown;
      try {
        raw = JSON.parse(kParam);
      } catch {
        return bad("k must be URL-encoded JSON of {path: value}");
      }
      const checked = checkKnobValues(raw, mock ?? { knobs: {} }, [post], "k");
      if (!checked.ok) return bad(checked.error);
      const paths = Object.keys(checked.value).sort();
      if (paths.length > 0 && surface.kind === "html") {
        knobs = Object.fromEntries(paths.map((p) => [p, checked.value[p]]));
        knobsKey = JSON.stringify(knobs);
      }
    }
    // Every input is in the URL (the palette is fixed, the mode is a query
    // param), so a version-pinned document never changes.
    surfaceDocHeaders(c, ver != null);

    // Cache the finished document under the same key the pre-warm uses; the
    // resolved `version` makes it immutable, so a hit is always correct.
    // A page's slots are pinned at publish, so they are a function of
    // (id, version) too and need no separate key component.
    const cacheKey = renderKey({ postId: post.id, idx, version, mode, origin, knobs: knobsKey });
    const design = mock ? await designFor(mock.project) : null;
    const doc = await cachedRender(cacheKey, async () =>
      buildSurfaceDoc({ post, mock, surface, title, version, mode, origin, design, knobs }),
    );
    return c.html(doc);
  };
  app.get("/s/:id", renderPostPage);

  // --- assets (agent-uploaded images and files) ---

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
    // Short revalidating cache (not immutable) so touch-on-serve keeps firing
    // and the LRU clock reflects real views; asset ids are unique anyway.
    c.header("Cache-Control", "private, max-age=60");
    return c.body(asset.data as unknown as ArrayBuffer);
  });

  // --- live feed ---

  app.get("/api/events", async (c) => {
    const sessionId = c.req.query("session");
    const mockId = c.req.query("mock");
    if (isUnauthenticatedSessionRead(c)) {
      if (!sessionId && !mockId) return c.json({ error: "session or mock required" }, 401);
      if (sessionId && !(await store.getSession(sessionId))) {
        return c.json({ error: "session not found" }, 404);
      }
      if (mockId && !(await store.getMock(mockId))) {
        return c.json({ error: "mock not found" }, 404);
      }
    }
    if (!acquireHold()) return c.json({ error: "too many concurrent connections" }, 503);
    const release = makeRelease();
    // Safety net: if the client disconnects before the stream callback opens,
    // the request abort still releases the slot. close() below is guarded so a
    // later abort firing release again is a no-op.
    c.req.raw.signal.addEventListener("abort", release, { once: true });
    const eventSessionId = (event: FeedEvent) => {
      if ("sessionId" in event) return event.sessionId;
      if (
        event.type === "session-created" ||
        event.type === "session-updated" ||
        event.type === "session-deleted"
      ) {
        return event.id;
      }
      return undefined;
    };
    const eventMockId = (event: FeedEvent) => {
      if ("mockId" in event) return event.mockId;
      if (
        event.type === "mock-created" ||
        event.type === "mock-updated" ||
        event.type === "mock-deleted"
      ) {
        return event.id;
      }
      return undefined;
    };
    return streamSSE(c, async (stream) => {
      const queue: FeedEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe((event) => {
        if (sessionId && eventSessionId(event) !== sessionId) return;
        if (mockId && eventMockId(event) !== mockId) return;
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
    flows: {
      publish: (body, ctx) => publishFlow(body, ctx),
      revise: async (body, ctx) => {
        const mock = await resolveMock(body?.mock, body?.project, body?.session);
        if (isResult(mock)) return mock;
        return publishFlow({ ...body, mock: mock.id }, ctx, true);
      },
      list: (query) => listMocksFlow(query),
      get: (ref, query) => getMockFlow(ref, query),
      ask: (ref, body, ctx) => askFlow(ref, body, ctx),
      exportMock: (ref, query, ctx) => exportFlow(ref, query, ctx),
      comment: (body, ctx) => commentFlow(body, ctx),
      feedback: (query, signal) => feedbackFlow(query, signal),
      appendSurface: appendSurfaceFlow,
      replaceSurface: replaceSurfaceFlow,
      removeSurface: removeSurfaceFlow,
      reorderSurfaces: reorderSurfacesFlow,
    },
    uploadAsset,
    // Every feature works on every tier: a remote MCP agent needs the project's
    // real palette and kit, and the topics, as much as a shell one does.
    guide: (project, topic) => (topic ? (topics[topic] ?? "") : briefFor(project)),
  });

  return app;
}
