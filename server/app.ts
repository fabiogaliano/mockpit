import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { ICON_SIZES, ICON_SVG, themeColor, webManifest } from "./appIcon.ts";
import { ICON_PNG_BASE64 } from "./appIconPng.ts";
import { decodeBase64 } from "./base64.ts";
import {
  type EmbedView,
  draftHolds,
  designDetailView,
  treeNodeView,
  designSummaryView,
  placeOf,
  sessionRowView,
  surfaceRef,
} from "./apiViews.ts";
import { askNudges } from "./askNudges.ts";
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
  type GuidePack,
  guidanceSections,
  MAX_RULES_CHARS,
  parseRulesFile,
  RULES_SETTING,
  USER_RULES_SETTING,
} from "./guidance.ts";
import { HANDOFF_NOTE, handoffReady, supersedes } from "./handoff.ts";
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
import {
  agentDecisionList,
  applyDecisionEdits,
  deriveDecisionLines,
  fullAgentDecisionList,
  parseDecisionEdits,
} from "./decisionList.ts";
import { chosenFills, decisionsFor, settledValues } from "./decisions.ts";
import { composeFills, slotsInSurfaces, spliceFills } from "./fills.ts";
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
import {
  dropRepeatedStyles,
  embedsKey,
  expandHtml,
  firstHtmlEmbeds,
  hasEmbedTags,
  parseEmbedTags,
  type EmbedResolver,
  type Expanded,
} from "./embeds.ts";
import { createCdnInliner, type InlineResult } from "./cdnInline.ts";
import { type McpFlows, registerMcp } from "./mcpHttp.ts";
import { createRunFlow, DEFAULT_RUN_LIMITS, type Executor, type RunLimits } from "./run.ts";
import { type LogSink, logMiddleware, writeLog } from "./eventLog.ts";
import { RUN_API } from "./runApi.ts";
import {
  escapeHtml,
  renderHtmlPage,
  renderMermaidPage,
  knobAttributes,
  renderSandboxedPart,
} from "./surfacePage.ts";
import { DEFAULT_MODE, DEFAULT_THEME_ID, isMode, type Mode, themeById } from "./themes.ts";
import {
  type Anchor,
  type Ask,
  type AskAnswer,
  askAnswered,
  type AskOption,
  type Asset,
  type AssetKind,
  builtinAsk,
  BUILTIN_ASK_ID,
  type CodeSurface,
  type Comment,
  type CommentAnchor,
  DEFAULT_PROJECT,
  DEFAULT_VARIANT,
  type DesignFiles,
  type DesignSystem,
  type DiffSurface,
  type Draft,
  htmlSurface,
  type IconSetRef,
  isSandboxedSurfaceKind,
  type Knobs,
  type KnobValue,
  type MarkdownSurface,
  ATTACHABLE_IMAGE_TYPES,
  MAX_ASK_IMAGES,
  MAX_ASSET_BYTES,
  inUseVersion,
  currentVersion,
  isLive,
  isDesignKind,
  isPlanned,
  MAX_NOTES,
  optionState,
  type Design,
  type DesignKind,
  newId,
  draftedCount,
  openCount,
  OTHER_ID,
  PARAGRAPH_TEXT_MAX,
  type ParagraphAnchor,
  type PartComment,
  type Post,
  type PostHead,
  type Reaction,
  REACTIONS,
  projectFromCwd,
  type Reply,
  AREA_ORDER_SETTING,
  DECISION_EDITS_SETTING,
  type DesignEdit,
  stripNul,
  postAtVersion,
  versionAt,
  type ReplyVerdict,
  variantStatus,
  reservedAgent,
  type Session,
  type Embed,
  type Flow,
  type FlowStep,
  type ForkRef,
  sameScreen,
  slugify,
  type StateOutline,
  type Store,
  type Surface,
  surfacesByteLength,
  type TerminalSurface,
} from "./types.ts";
import {
  coerceSurfaces,
  type SurfaceKitScope,
  type SurfaceValidationFailure,
  validateSurfaces,
} from "./postSurfaces.ts";
import { isViewerRequest } from "./viewerRequest.ts";
import { jumpHits, recentHits } from "./jump.ts";

export type { FeedEvent } from "./events.ts";
export type { FeedbackBatch } from "./feedbackBatch.ts";

const MAX_SURFACE_BYTES = 2 * 1024 * 1024;
// An agent at work makes many calls, and the viewer only needs to hear it's alive.
// Short, because a call swallowed here is one the viewer doesn't hear until the next.
const AGENT_CALL_EVENT_MS = 5_000;
// A held long-poll (watch, the viewer) re-arms rather than pinning a socket
// for good; proxies and serverless hosts drop longer requests anyway.
const MAX_WAIT_SECONDS = 230;
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
// Room for any derived line to be edited: the question plus a whole write-in.
const MAX_DECISION_TEXT = MAX_COMMENT_TEXT + 2000;
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
  // The guide/packs/<id>.md bodies: guidance a rules file can switch on.
  packs?: Partial<Record<GuidePack, string>>;
  // The user's own rules file, read on every brief so an edit applies at once
  // (Node: rules.md next to the database). Null when there is none; absent
  // (the Worker), the copy `mockpit rules --mine` stored is used instead.
  userRules?: () => Promise<string | null>;
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
  // (a design, a post's documents, a session's feed); "full" exposes every GET.
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
  // Identifies what renders /s/:id documents (this server's code, its
  // libraries). The viewer names it in every document URL (`r`), and only a
  // URL naming the current one is cached as immutable, so a renderer change
  // reaches a browser that already holds a version's old document.
  renderRev?: string;
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
  // The script sandbox behind POST /api/run and the MCP `run` tool. Absent (the
  // Worker), both answer that run is unavailable here.
  executor?: Executor;
  // Overrides for the run limits; tests shrink the deadline and budgets.
  runLimits?: Partial<RunLimits>;
  // Where else this machine answers, for a viewer on loopback who wants a phone to
  // open the page. Node supplies it; a Worker is never on loopback in production.
  networkHosts?: () => { localOnly: boolean; hosts: string[] };
  // The event log (server/eventLog.ts): one entry per agent call, viewer write
  // and live-feed connection. The host decides where entries go (a JSONL file
  // on Node, Workers Logs on Cloudflare); absent, nothing is computed.
  log?: LogSink;
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
// design id, a post id (its documents), an asset id, a session's comments/feed.
// Anything addressed by NAME (projects, design slugs, the design list) would let a
// single shared link enumerate the whole workspace, so it stays private.
function isPublicReadAllowed(path: string, mode: PublicReadMode, query: URLSearchParams): boolean {
  if (mode === "full") return true;
  if (path.startsWith("/project/")) return true;
  if (path.startsWith("/s/")) return true;
  if (path.startsWith("/a/")) return true;
  if (/^\/api\/designs\/[^/]+(\/export)?$/.test(path)) {
    return !path.startsWith("/api/designs/recent") && !query.has("project");
  }
  if (path === "/api/comments") return true;
  if (path === "/api/events") return true;
  if (path === "/api/theme") return true;
  if (path === "/api/version") return true;
  // A project's kits are named by project, so only the bundled list is public.
  if (path === "/api/kits") return !query.has("project");
  return false;
}

// A comment as the viewer reads it: stored, plus what's derived about its delivery.
type DeliveredComment = Comment & {
  delivered: boolean;
  ownerGone?: true;
  listening?: true;
  calledAt?: string;
};

export interface CommentWait {
  sessionId?: string;
  designId?: string;
  postId?: string;
  author?: string;
  afterSeq?: number;
  waitSeconds: number;
  // True only for the agent's own reads (feedbackFlow, authenticated
  // author=user reads). The cursor moves for these alone: an anonymous reader on
  // a public-read workspace must never "take" feedback the agent has not seen.
  agent?: boolean;
  // A watcher asking only to hear that a reply landed: the reply stays owed, and
  // the agent takes it with feedback or a write.
  peek?: boolean;
}

// What every design flow returns: a status and a JSON body. REST hands it to
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

const MAX_DESCRIPTION = 400;
// How soon a second version of the same variant reads as a fix to the first.
const AMEND_WINDOW_MS = 5 * 60_000;
const MAX_SOURCE = 1024;
const MAX_WIDTHS = 4;
const MIN_WIDTH = 280;
const MAX_WIDTH = 2560;
const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

const MAX_LABEL = 120;
const MAX_REASON = 280;
// A screen has three standard states and whatever few the user asks for by name.
const MAX_STATE_OUTLINES = 40;
const MAX_CANDIDATES = 50;
const MAX_AREAS = 50;
const MAX_FLOWS = 50;
const MAX_FLOW_STEPS = 100;
const MAX_ASKS = 20;
const MAX_OPTIONS = 20;
const MAX_DRAFT_COMMENTS = 50;

// A title that names a step of the agent's process instead of what the design
// is: it reads as noise on Home, where titles are seen out of context.
const PROCESS_TITLE = /^\s*(round\s*\d+|flow\s*\d+\s*[·:\-–—]|v\d+\b|prototype\b)/i;
// Once, on a variant's first version: a canvas page runs live in every
// overview card, and a browser holds only about 16 WebGL contexts.
const posterNudges = (surfaces: Surface[]): string[] =>
  surfaces.some((s) => s.kind === "html" && !s.poster && /<canvas[\s>]/i.test(s.html))
    ? [
        "this page draws on a <canvas> and has no poster, so Studio and Home run it live; send a still of it as poster (upload the image, or CLI --poster shot.png) with each version",
      ]
    : [];

const titleNudges = (title: string | undefined): string[] =>
  title && PROCESS_TITLE.test(title)
    ? [
        `title "${title}" names your process; title the design by what it is ("Hold menu"), as states are named by what the user sees`,
      ]
    : [];

const APP_FILES = new Set([
  "/manifest.webmanifest",
  "/icon.svg",
  "/apple-touch-icon.png",
  ...ICON_SIZES.map((s) => `/icon-${s}.png`),
]);

const titledDesigns = (designs: Design[], slug: string) =>
  designs.filter((m) => slugify(m.title) === slug);

const titleFromSlug = (slug: string) =>
  slug.replace(/-/g, " ").replace(/^./, (ch) => ch.toUpperCase());

export function createApp({
  store,
  viewerHtml,
  setupText,
  topics = {},
  packs = {},
  userRules,
  authenticate,
  authToken,
  basePath,
  publicRead,
  screenshots,
  version,
  upgradeCommand,
  renderRev,
  fetchLatestRelease,
  onEvent,
  maxHoldConnections = DEFAULT_MAX_HOLD_CONNECTIONS,
  executor,
  runLimits,
  networkHosts,
  log,
}: AppOptions) {
  const app = new Hono();
  // The scripts topic carries the run API from runApi.ts, its one source.
  if (topics.scripts)
    topics = {
      ...topics,
      scripts: topics.scripts.replace("<!-- run-api -->", `\`\`\`ts\n${RUN_API}\n\`\`\``),
    };
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
    lastOrigin = requestOrigin(c.req.raw);
    c.header("Referrer-Policy", "no-referrer");
    return next();
  });
  if (log) app.use("*", logMiddleware(log));
  const bus = new EventBus();
  // Where the workspace's data stands: a read says the revision it began at, the
  // feed's hello says the current one, and a read at least that new missed nothing,
  // so a client can skip refetching on connect. Starting from the clock keeps it
  // rising across restarts, when this memory is lost. A write counts even if it
  // broadcasts nothing, since a reconnect is the only way a client would learn of it.
  let revision = Date.now();
  bus.subscribe(() => {
    revision++;
  });
  app.use("*", async (c, next) => {
    const isRead = c.req.method === "GET" || c.req.method === "HEAD";
    if (isRead && c.req.path.startsWith("/api/")) c.header("x-mockpit-rev", String(revision));
    await next();
    if (!isRead) revision++;
  });
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
  // Only the viewer holds /api/events (watch long-polls). Each tab names the
  // design it has on screen (`?viewing=`), so pending.viewerOpen is per design: a
  // tab on Home or on another design doesn't read as "looking at this one".
  const viewing = new Map<string, number>();
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
  const cdnInliner = createCdnInliner();
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
    const current = !renderRev || c.req.query("r") === renderRev;
    c.header(
      "Cache-Control",
      immutable && current ? "public, max-age=31536000, immutable" : "private, no-cache",
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
  // A document built while a CDN was failing goes out as it is and is not kept: the next
  // request gets another try at the whole thing.
  async function cachedRender(
    key: string,
    build: () => Promise<InlineResult>,
  ): Promise<InlineResult> {
    const hit = renderCacheHit(key);
    if (hit !== undefined) return { doc: hit, complete: true };
    const built = await build();
    if (!built.complete) return built;
    const { doc } = built;
    renderCache.set(key, doc);
    renderCacheBytes += docBytes(doc);
    while (renderCacheBytes > MAX_RENDER_CACHE_BYTES && renderCache.size > 1) {
      const oldest = renderCache.keys().next().value;
      if (oldest === undefined) break;
      dropCacheEntry(oldest);
    }
    return built;
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

  // Behind a TLS-terminating proxy (tailscale serve, a tunnel) the request
  // reaches us as http while the browser is on https. A surface bakes this
  // origin into its script URLs and CSP, and an http script inside an https
  // page is blocked as mixed content: the frame then never runs its bridge, so
  // live knobs and part reports silently stop. Trusting the header is safe
  // here: it only shapes the caller's own response.
  const requestOrigin = (request: Request): string => {
    const url = new URL(request.url);
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
    return url.origin;
  };

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

  // Sessions with an author=user long-poll held open right now: a waiting
  // `mockpit watch` is a live agent, whatever its agentActiveAt says.
  const listening = new Map<string, number>();
  // When each session last made a call of its own: a write or `feedback`, never a
  // watch re-arming, which keeps agentActiveAt fresh all night with nobody working.
  // That's what lets the viewer say "working" only when something is. Memory only:
  // after a restart the viewer says less, which is still true.
  const agentCalls = new Map<string, number>();
  // The newest comment each session's watcher has been told about, so a waiter that
  // restarts before the agent reads doesn't wake it for the same reply forever. Memory
  // only: after a restart the worst case is one repeated wake.
  const noticed = new Map<string, number>();
  const agentCallEvents = new Map<string, number>();
  const noteAgentCall = (sessionId: string) => {
    const now = Date.now();
    agentCalls.set(sessionId, now);
    if (now - (agentCallEvents.get(sessionId) ?? 0) >= AGENT_CALL_EVENT_MS) {
      agentCallEvents.set(sessionId, now);
      bus.broadcast({ type: "agent-called", sessionId });
    }
  };

  // Who hears the user on this design: the agent driving it, or on a shortlist no
  // agent has written to, the one working in the project right now. A session
  // with `mockpit watch` open is live whatever its last call says.
  async function projectAgent(project: string): Promise<Session | null> {
    const sessions = await store.listSessions(project);
    const when = (s: Session) => s.agentActiveAt ?? s.createdAt;
    const newest = (list: Session[]) =>
      list.reduce<Session | null>((a, b) => (a && when(a) >= when(b) ? a : b), null);
    return newest(sessions.filter((s) => listening.has(s.id))) ?? newest(sessions);
  }

  async function replySessionId(design: Design, posts: Post[]): Promise<string | undefined> {
    if (design.sessionId) return design.sessionId;
    const agent = design.shortlist ? await projectAgent(design.project) : null;
    if (agent) return agent.id;
    return [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.sessionId;
  }

  // User comments the agent has not seen yet ride along on its next write, so
  // agents hear feedback without blocking on the long-poll. The cursor also
  // advances past the agent's own comments to keep reads cheap.
  async function collectFeedback(sessionId: string, base: string): Promise<FeedbackBatch[]> {
    // Touch before reading the cursor: a taker's handOff checks agentActiveAt,
    // so it can't move this cursor under a read already in flight.
    await store.touchAgent(sessionId);
    const session = await store.getSession(sessionId);
    if (!session) return [];
    noteAgentCall(sessionId);
    const handedOff = await takeOrphaned(session);
    const fresh = await store.listComments({ sessionId, afterSeq: session.agentSeq });
    if (fresh.length > 0) {
      await store.markAgentSeen(sessionId, fresh[fresh.length - 1].seq);
      bus.broadcast({ type: "comment-delivered", sessionId, seq: fresh[fresh.length - 1].seq });
    }
    const feedback = fresh.filter((cm) => cm.author === "user");
    return feedbackWithHandoffs(feedback, handedOff, base);
  }

  async function feedbackWithHandoffs(
    own: Comment[],
    handedOff: Comment[],
    base: string,
  ): Promise<FeedbackBatch[]> {
    const mine = own.length > 0 ? await buildFeedbackBatches(store, own, base) : [];
    if (handedOff.length === 0) return mine;
    const theirs = await buildFeedbackBatches(store, handedOff, base);
    return [...mine, ...theirs.map((b) => ({ ...b, handoff: HANDOFF_NOTE }))];
  }

  // What takeOrphaned would take right now, with no cursor moved.
  async function owedOrphans(taker: Session): Promise<Comment[]> {
    if (!taker.project) return [];
    const now = Date.now();
    const owed: Comment[] = [];
    for (const owner of await store.listSessions(taker.project)) {
      if (!supersedes(taker, owner, listening.has(owner.id))) continue;
      for (const c of await store.listComments({ sessionId: owner.id, afterSeq: owner.agentSeq })) {
        if (c.author !== "user") continue;
        if (!handoffReady(c, owner, taker, now)) break;
        owed.push(c);
      }
    }
    return owed;
  }

  // The user comments still owed to sessions `taker` supersedes (handoff.ts),
  // taken for `taker`: each owner's cursor moves past them in one conditional
  // write, so delivery stays exactly-once across sessions.
  async function takeOrphaned(taker: Session): Promise<Comment[]> {
    if (!taker.project) return [];
    const now = Date.now();
    const taken: Comment[] = [];
    for (const owner of await store.listSessions(taker.project)) {
      if (!supersedes(taker, owner, listening.has(owner.id))) continue;
      const owed = await store.listComments({ sessionId: owner.id, afterSeq: owner.agentSeq });
      // Seq order is time order, so the ready comments are a prefix; stop at the
      // first one still inside its grace and leave the rest owed.
      let upto = owner.agentSeq;
      const take: Comment[] = [];
      for (const c of owed) {
        if (c.author === "user" && !handoffReady(c, owner, taker, now)) break;
        upto = c.seq;
        if (c.author === "user") take.push(c);
      }
      if (take.length === 0) continue;
      if (!(await store.handOff(owner.id, owner, upto))) continue;
      bus.broadcast({ type: "comment-delivered", sessionId: owner.id, seq: upto });
      taken.push(...take);
    }
    return taken;
  }

  // Per-comment delivery state for the viewer: `delivered` once the session's
  // agentSeq has passed the comment. Computed, never stored. `ownerGone` marks
  // an undelivered user comment whose session a newer one already supersedes,
  // so the Thread can say the next agent here will get it. With `live` (the signed-in
  // viewer, not an agent or an anonymous reader), a user comment also says who could
  // act on it: `listening`, undelivered with a `mockpit watch` held open that will
  // take it; `calledAt`, delivered with a call of the agent's own since.
  async function withDelivered(comments: Comment[], live = false): Promise<DeliveredComment[]> {
    const sessions = new Map<string, Session | null>();
    for (const c of comments) {
      if (!sessions.has(c.sessionId))
        sessions.set(c.sessionId, await store.getSession(c.sessionId));
    }
    const peers = new Map<string, Session[]>();
    const peersOf = async (owner: Session): Promise<Session[]> => {
      if (!peers.has(owner.id)) {
        peers.set(owner.id, owner.project ? await store.listSessions(owner.project) : []);
      }
      return peers.get(owner.id)!;
    };
    const out: DeliveredComment[] = [];
    for (const c of comments) {
      const owner = sessions.get(c.sessionId);
      const delivered = c.seq <= (owner?.agentSeq ?? 0);
      const unread = !delivered && !!owner && c.author === "user";
      const others = unread ? await peersOf(owner) : [];
      const waiting = unread && others.some((t) => supersedes(t, owner, listening.has(owner.id)));
      // A newer session's watch counts: handoff.ts gives it this reply after the grace.
      const heard =
        unread &&
        (listening.has(owner.id) ||
          (noticed.get(owner.id) ?? 0) >= c.seq ||
          others.some((t) => listening.has(t.id) && supersedes(t, owner, false)));
      const called = agentCalls.get(c.sessionId);
      const acted =
        delivered &&
        c.author === "user" &&
        called !== undefined &&
        called >= Date.parse(c.createdAt);
      out.push({
        ...c,
        delivered,
        ...(waiting ? { ownerGone: true as const } : {}),
        ...(live && heard ? { listening: true as const } : {}),
        ...(live && acted ? { calledAt: new Date(called).toISOString() } : {}),
      });
    }
    return out;
  }

  // The workspace's light/dark choice. Older workspaces stored a theme id under
  // `theme`; that registry is gone, so they start from the default mode.
  async function workspaceMode(): Promise<Mode> {
    const stored = await store.getSetting("mode");
    return isMode(stored) ? stored : DEFAULT_MODE;
  }

  // A project's imported design system (settings key `design:<project>`), or
  // null when `mockpit init` has never run for it.
  async function designSystemFor(project: string): Promise<DesignSystem | null> {
    const raw = await store.getSetting(`design:${project}`);
    if (!raw) return null;
    try {
      const designSystem = JSON.parse(raw) as DesignSystem;
      return {
        ...designSystem,
        tailwindCss: typeof designSystem.tailwindCss === "string" ? designSystem.tailwindCss : "",
        strippedImports: Array.isArray(designSystem.strippedImports)
          ? designSystem.strippedImports
          : [],
        iconSets: Array.isArray(designSystem.iconSets) ? designSystem.iconSets : [],
        projectKits: Array.isArray(designSystem.projectKits) ? designSystem.projectKits : [],
        designFiles: designSystem.designFiles ?? null,
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
    designSystem: DesignSystem | null,
  ): Promise<{ prefix: string; set: IconifyJSON; source: "installed" | "bundled" }[]> {
    const out: { prefix: string; set: IconifyJSON; source: "installed" | "bundled" }[] = [];
    for (const ref of designSystem?.iconSets ?? []) {
      const set = await installedIconSet(ref.assetId);
      if (set) out.push({ prefix: ref.prefix, set, source: "installed" });
    }
    for (const [prefix, set] of await bundledIconSets()) {
      if (!out.some((s) => s.prefix === prefix)) out.push({ prefix, set, source: "bundled" });
    }
    return out;
  }

  async function iconResolverFor(
    designSystem: DesignSystem | null,
  ): Promise<{ resolve: IconResolver; prefixes: string[] }> {
    const sets = await iconSetsFor(designSystem);
    return { resolve: resolverFor(sets.map((s) => s.set)), prefixes: sets.map((s) => s.prefix) };
  }

  // Unknown icon names in a write's html surfaces, said at write time so the
  // agent learns without rendering.
  async function iconWarnings(project: string, surfaces: Surface[]): Promise<string[]> {
    const html = surfaces.flatMap((s) =>
      s.kind === "html" && mayHaveIcons(s.html) ? [s.html] : [],
    );
    if (html.length === 0) return [];
    const { resolve, prefixes } = await iconResolverFor(await designSystemFor(project));
    const unknown = new Set<string>();
    for (const h of html) for (const u of expandIcons(h, resolve).unknown) unknown.add(u);
    return [...unknown].map((u) => `unknown icon ${u} (sets: ${prefixes.join(", ")})`);
  }

  // An agent asking for instructions must never get an error page, so a store
  // failure degrades to the brief without project settings.
  async function briefFor(project: string | undefined): Promise<string> {
    try {
      const name = project ?? (await store.listProjects())[0]?.name ?? DEFAULT_PROJECT;
      return renderBriefGuide(await designSystemFor(name), await guidanceFor(name));
    } catch (err) {
      console.warn("[mockpit] project design unavailable for the brief", err);
      return renderBriefGuide(null);
    }
  }

  // The user's file wins over the stored copy when the host can read it: the
  // copy exists for hosts that can't.
  async function userRulesText(): Promise<string | null> {
    const file = userRules ? await userRules().catch(() => null) : null;
    return file ?? (await store.getSetting(USER_RULES_SETTING));
  }

  async function guidanceFor(project: string) {
    return guidanceSections({
      packs,
      user: await userRulesText(),
      project: await store.getSetting(`${RULES_SETTING}:${project}`),
    });
  }

  // A rules file as sent by `mockpit rules`: stored whole, "" clears it. The
  // answer says what the brief will make of it, so a mistyped pack name shows
  // at once rather than as a quietly missing layer.
  async function saveRules(key: string, body: any): Promise<FlowResult> {
    if (!body || typeof body !== "object" || typeof body.text !== "string") {
      return fail(400, 'provide "text", the rules file ("" clears it)');
    }
    const text = stripNul(body.text).trim();
    if (text.length > MAX_RULES_CHARS) {
      return fail(400, `a rules file is at most ${MAX_RULES_CHARS} characters`);
    }
    await store.setSetting(key, text);
    const parsed = parseRulesFile(text);
    const unknown = parsed.packs.filter((p) => !(p in packs));
    return ok({ packs: parsed.packs, unknown, rules: parsed.body.length > 0, cleared: !text });
  }

  // Push + webhooks. Detached on purpose: a dead push endpoint must never fail
  // (or slow) the write that triggered it.
  function fireNotify(payload: NotifyPayload): void {
    void notify(store, payload).catch((err) => console.warn("[mockpit] notify failed", err));
  }

  const designUrl = (base: string, design: Design, post?: Post | null) => {
    const url = `${base}/project/${encodeURIComponent(design.project)}/${encodeURIComponent(design.slug)}`;
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

  // A design reference is its id, or its slug within a project, or its title: the
  // name the user sees is the name they tell an agent. Without a project, a name
  // that fits exactly one design in the workspace still resolves — an agent rarely
  // has more than one repo with the same design name.
  async function resolveDesign(
    ref: unknown,
    project?: unknown,
    sessionId?: unknown,
  ): Promise<Design | FlowResult> {
    const name = typeof ref === "string" ? ref.trim() : "";
    if (!name) return fail(400, 'provide a "design"');
    const byId = await store.getDesign(name);
    if (byId) return byId;
    const slug = slugify(name);
    let proj = typeof project === "string" && project.trim() ? project.trim() : undefined;
    if (!proj && typeof sessionId === "string") {
      const session = await store.getSession(sessionId);
      proj = session?.project ?? undefined;
    }
    if (proj) {
      const design = await store.findDesign(proj, slug);
      if (design) return design;
      const titled = titledDesigns(await store.listDesigns(proj), slug);
      if (titled.length === 1) return titled[0];
      return titled.length
        ? fail(400, `several designs in ${proj} are titled "${name}"; pass a slug`, {
            designs: titled.map((m) => m.slug),
          })
        : fail(404, `${proj} has no design "${slug}"`);
    }
    const all = await store.listDesigns();
    const bySlug = all.filter((m) => m.slug === slug);
    const matches = bySlug.length ? bySlug : titledDesigns(all, slug);
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) return fail(404, `no design "${slug}"`);
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
    design: Design,
    posts: Post[],
    stateIn: string | null | undefined,
    variant: string | undefined,
  ): Post | FlowResult {
    let candidates = posts;
    if (stateIn !== undefined) {
      if (stateIn !== null && !design.states.includes(stateIn)) {
        return fail(404, `${design.slug} has no state "${stateIn}"`, { states: design.states });
      }
      candidates = candidates.filter((p) => p.state === stateIn);
    }
    if (variant) candidates = candidates.filter((p) => p.variant === variant);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) {
      return fail(404, `${design.slug} has no variant ${variant ? `"${variant}"` : ""}`.trim(), {
        variants: posts.map(variantLabel),
      });
    }
    const live = candidates.filter((p) => isLive(p.status));
    if (live.length === 1 && !variant) return live[0];
    return fail(400, `${design.slug} has several variants; pass ${variant ? "state" : "variant"}`, {
      variants: candidates.map(variantLabel),
    });
  }

  // The kit ids a surface of this project may name beyond the bundled ones.
  const kitScope = async (project: string): Promise<SurfaceKitScope> => ({
    projectKits: ((await designSystemFor(project))?.projectKits ?? []).map((k) => k.id),
  });

  async function parseSurfaceInput(
    body: any,
    ctx: FlowContext,
    scope: SurfaceKitScope,
    base: () => Surface[] | FlowResult,
  ): Promise<Surface[] | FlowResult> {
    if (body.html !== undefined) {
      if (typeof body.html !== "string" || !body.html.trim()) {
        return fail(400, 'body must include non-empty "html" string');
      }
      const raw = [htmlSurface(body.html, body.kits)];
      if (!ctx.strict) return coerceSurfaces(raw, scope);
      const parsed = await validateSurfaces(raw, scope);
      return parsed.ok ? parsed.surfaces : fail(400, parsed.error, surfaceIssues(parsed));
    }
    if (!Array.isArray(body.surfaces)) return fail(400, '"surfaces" must be an array');
    return surfaceList(body.surfaces, ctx, scope, base);
  }

  // The full ordered list replaces the variant's surfaces, so one shape covers
  // add, edit, remove and reorder: an entry that is only `{id}` keeps that
  // surface, an id with content replaces it in place, an entry without an id is
  // new, and an id left out is removed.
  async function surfaceList(
    raw: unknown[],
    ctx: FlowContext,
    scope: SurfaceKitScope,
    base: () => Surface[] | FlowResult,
  ): Promise<Surface[] | FlowResult> {
    const out: Surface[] = [];
    const used = new Set<string>();
    const issues: SurfaceValidationFailure["issues"] = [];
    for (const [i, entry] of raw.entries()) {
      const record =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : null;
      const id = typeof record?.id === "string" ? record.id : undefined;
      if (id !== undefined) {
        if (used.has(id)) return fail(400, `surface "${id}" appears twice in "surfaces"`);
        used.add(id);
        const current = base();
        if (isResult(current)) return current;
        const kept = current.find((s) => s.id === id);
        if (!kept) {
          return fail(404, `surface "${id}" not found`, { surfaces: current.map(surfaceRef) });
        }
        if (record?.kind === undefined) {
          out.push(kept);
          continue;
        }
      }
      const { id: _id, ...content } = record ?? {};
      const one = record ? [content] : [entry];
      if (!ctx.strict) {
        const [surface] = await coerceSurfaces(one, scope);
        if (surface) out.push(id ? { ...surface, id } : surface);
        continue;
      }
      const parsed = await validateSurfaces(one, scope);
      if (!parsed.ok) {
        for (const issue of parsed.issues) {
          issues.push({
            ...issue,
            requestPath: issue.requestPath.replace(/^surfaces\[0\]/, `surfaces[${i}]`),
          });
        }
        continue;
      }
      out.push(id ? { ...parsed.surfaces[0], id } : parsed.surfaces[0]);
    }
    if (issues.length) {
      return fail(400, issues.map((x) => `${x.requestPath}: ${x.message}`).join("; "), {
        code: "surface_validation_failed",
        issues,
      });
    }
    return out;
  }

  const surfaceIssues = (failure: SurfaceValidationFailure) => ({
    code: failure.code,
    issues: failure.issues,
  });

  // A poster is a still of the html beside it. Carried over unchanged onto
  // changed html (a parts or fills splice, a fork with edits) it would show an
  // old page, so it goes unless the write brings one; `poster` names the still
  // of the page this write produces.
  async function withPoster(
    surfaces: Surface[],
    before: Surface[] | null,
    poster: unknown,
  ): Promise<Surface[] | FlowResult> {
    const given = poster === undefined ? undefined : str(poster, MAX_LABEL);
    if (poster !== undefined && !given) {
      return fail(400, '"poster" must be the asset id of an uploaded image');
    }
    const pagesBefore = (before ?? []).filter((s) => s.kind === "html");
    let ordinal = 0;
    const out = surfaces.map((s) => {
      if (s.kind !== "html") return s;
      const old =
        (s.id !== undefined && pagesBefore.find((b) => b.id === s.id)) || pagesBefore[ordinal];
      let next: Surface = s;
      if (s.poster && old?.kind === "html" && old.html !== s.html && old.poster === s.poster) {
        const { poster: _stale, ...rest } = s;
        next = rest;
      }
      if (ordinal === 0 && given) next = { ...next, poster: given };
      ordinal++;
      return next;
    });
    if (given && ordinal === 0)
      return fail(400, '"poster" needs an html surface to be the still of');
    for (const s of out) {
      if (s.kind !== "html" || !s.poster) continue;
      const asset = await store.getAsset(s.poster);
      if (!asset)
        return fail(404, `poster "${s.poster}" is not an uploaded asset; upload the image first`);
      if (!asset.contentType.startsWith("image/")) {
        return fail(400, `poster "${s.poster}" is ${asset.contentType}, not an image`);
      }
    }
    return out;
  }

  // A still taken after the publish, by the CLI or the stdio server, once the page exists
  // to be rendered. It adds a picture to the version, so it makes no new version and no
  // rewrite, isn't the user's or a new word from the agent, and asks no frame to reload. It
  // never replaces a poster, which is the agent's own or an earlier capture's, and a
  // version amended or replaced while the browser worked refuses it: it shows an old page.
  async function attachPosterFlow(ref: unknown, postId: string, body: any): Promise<FlowResult> {
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const post = await store.getPost(postId);
    if (!post || post.design !== design.id) return fail(404, "variant not found");
    const session = typeof body?.session === "string" ? body.session : "";
    if (publisherOf(post) !== session) {
      return fail(403, `v${post.version} of ${post.variant} was published by another session`);
    }
    if (body?.version !== post.version || (body?.rewrites ?? 0) !== (post.rewrites ?? 0)) {
      return fail(409, `${post.variant} has changed since this still was taken`);
    }
    const poster = str(body?.poster, MAX_LABEL);
    if (!poster) return fail(400, '"poster" must be the asset id of an uploaded image');
    const asset = await store.getAsset(poster);
    if (!asset?.contentType.startsWith("image/")) {
      return fail(400, `poster "${poster}" is not an uploaded image`);
    }
    const attached = await store.setPosterOnce(post.id, post.version, poster);
    if (!attached) return fail(409, `${post.variant} already has a poster`);
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    return ok({ poster });
  }

  function checkSurfaces(surfaces: Surface[]): FlowResult | null {
    if (surfaces.length === 0) return fail(400, "a variant needs at least one surface");
    if (surfacesByteLength(surfaces) > MAX_SURFACE_BYTES) {
      return fail(413, `surface exceeds ${MAX_SURFACE_BYTES} bytes`);
    }
    return null;
  }

  // The component post an embed shows: the named variant of its first state,
  // else the accepted one there, else "default", else the first live one.
  async function embedTarget(
    project: string,
    slug: string,
    variant: string | null,
  ): Promise<Post | null> {
    const design = await store.findDesign(project, slug);
    if (!design) return null;
    const state = design.states[0] ?? null;
    if (variant) return store.findPost(design.id, state, variant);
    const inState = (await store.listPosts({ designId: design.id })).filter(
      (p) => p.state === state,
    );
    return (
      inState.find((p) => p.status === "accepted") ??
      inState.find((p) => p.variant === DEFAULT_VARIANT && isLive(p.status)) ??
      inState.find((p) => isLive(p.status)) ??
      inState[0] ??
      null
    );
  }

  // Resolves tags to bodies: the tag's version if it pins one, else a peek
  // (`overrides`, slug → version) the viewer asked for, else the latest. The
  // body shows the component as decided: its slots composed to the fills its
  // settled values chose, its other settled values on the wrapper.
  function embedResolver(project: string, overrides: Record<string, number> = {}): EmbedResolver {
    return async (tag) => {
      const post = await embedTarget(project, tag.slug, tag.variant);
      if (!post) return null;
      const version = tag.version ?? overrides[tag.slug] ?? currentVersion(post);
      const surfaces =
        version === post.version
          ? post.surfaces
          : post.history.find((h) => h.version === version)?.surfaces;
      const body = surfaces?.find((x) => x.kind === "html");
      if (!surfaces || !body || body.kind !== "html") return null;
      const design = await store.getDesign(post.design);
      const settled = design
        ? settledValues(
            await replyPayloads(design.id),
            design,
            await store.listPosts({ designId: design.id }),
          )
        : {};
      const slots = slotsInSurfaces(surfaces);
      const fills = new Set(slots.map((sl) => sl.part));
      const rest = Object.fromEntries(Object.entries(settled).filter(([p]) => !fills.has(p)));
      return {
        variant: post.variant,
        version,
        html: slots.length ? composeFills(body.html, chosenFills(slots, settled)) : body.html,
        attrs: knobAttributes(rest).attrs,
        // A rewritten component version keeps its number; its screens re-render on it.
        ...(Object.keys(settled).length || post.rewrites
          ? {
              stamp:
                (Object.keys(settled).length ? JSON.stringify(settled) : "") +
                (post.rewrites ? `~${post.rewrites}` : ""),
            }
          : {}),
      };
    };
  }

  // A surface's html with its embeds expanded, and what they resolved to.
  async function composedHtml(
    project: string,
    slug: string,
    html: string,
    overrides?: Record<string, number>,
  ): Promise<Expanded> {
    if (!hasEmbedTags(html)) return { html, used: [], stamps: [], cycle: null };
    const expanded = await expandHtml(html, embedResolver(project, overrides), [slug]);
    return { ...expanded, html: dropRepeatedStyles(expanded.html) };
  }

  // The component versions a publish renders with, recorded on the version;
  // an embed chain that loops back to this design is refused.
  async function publishEmbeds(
    project: string,
    slug: string,
    surfaces: Surface[],
  ): Promise<Embed[] | FlowResult> {
    const html = surfaces.find((x) => x.kind === "html");
    if (!html || html.kind !== "html") return [];
    const { used, cycle } = await composedHtml(project, slug, html.html);
    if (cycle) {
      return fail(400, `embeds loop back on themselves: ${cycle.join(" → ")}`, { cycle });
    }
    return used;
  }

  // Being embedded is what makes a design a component, so an idea another design
  // embeds becomes one; a declared screen stays a screen.
  async function promoteEmbedded(project: string, embeds: Embed[]) {
    for (const slug of new Set(embeds.map((e) => e.slug))) {
      const m = await store.findDesign(project, slug);
      if (m?.kind !== "idea") continue;
      const updated = await store.updateDesign(m.id, { kind: "component" });
      if (updated) bus.broadcast({ type: "design-updated", id: updated.id, project });
    }
  }

  // What the variants of a design show through their embeds now: per post, the
  // resolved list (nested included) with each component's versions, and the
  // key that changes when any of them does.
  async function embedViews(design: Design, posts: Post[]): Promise<Map<string, EmbedView>> {
    const out = new Map<string, EmbedView>();
    for (const post of posts) {
      if (!firstHtmlEmbeds(post.surfaces)) continue;
      const html = post.surfaces.find((x) => x.kind === "html");
      if (html?.kind !== "html") continue;
      const composed = await composedHtml(design.project, design.slug, html.html);
      const { used } = composed;
      const list = [];
      for (const e of used) {
        const target = await embedTarget(design.project, e.slug, e.variant);
        const versions = target
          ? [target.version, ...target.history.map((h) => h.version)].sort((a, b) => b - a)
          : [e.version];
        list.push({ ...e, latest: target?.version ?? e.version, versions });
      }
      out.set(post.id, { key: embedsKey(composed), list });
    }
    return out;
  }

  // The designs whose html embeds this slug, directly or through other
  // components: they render differently once it changes.
  async function embeddersOf(project: string, slug: string): Promise<Design[]> {
    const designs = await store.listDesigns(project);
    const heads = headsByDesign(await store.listPostHeads(project));
    const tagsOf = new Map<string, Set<string>>();
    for (const m of designs) {
      // Every publish comes through here, and most of a project's bytes are
      // designs with no embed.
      if (!heads.get(m.id)?.some((p) => p.surfaces.some((x) => x.marked))) continue;
      const slugs = new Set<string>();
      for (const p of await store.listPosts({ designId: m.id })) {
        for (const x of p.surfaces) {
          if (x.kind === "html") for (const t of parseEmbedTags(x.html)) slugs.add(t.slug);
        }
      }
      tagsOf.set(m.id, slugs);
    }
    const reached = new Set<string>([slug]);
    const out: Design[] = [];
    for (let grew = true; grew; ) {
      grew = false;
      for (const m of designs) {
        if (reached.has(m.slug)) continue;
        if ([...(tagsOf.get(m.id) ?? [])].some((s) => reached.has(s))) {
          reached.add(m.slug);
          out.push(m);
          grew = true;
        }
      }
    }
    return out;
  }

  // Knobs with a handful of discrete choices are usually decisions dressed as
  // controls: the user can't compare options they only see one at a time.
  function knobNudges(knobs: Knobs): string[] {
    const out: string[] = [];
    for (const [path, config] of Object.entries(knobs)) {
      const n = discreteChoices(config);
      if (n !== null && n >= 2 && n <= 3) {
        out.push(
          `knob "${path}": a 2–3 option knob is a choice. Ask with options that \`set\` it.`,
        );
      }
    }
    return out;
  }

  // Ask discipline: two live variants of a state with no ask binding them all
  // leave the user nothing to answer in one Send, and the agent tends to ask in
  // chat instead. The nudge carries a ready ask: design-wide when every state has
  // the same variant names, else for this state.
  function unboundVariants(
    design: Design,
    posts: Post[],
    state: string | null,
  ): { nudge: string; ask: Record<string, unknown> } | null {
    const live = (s: string | null) =>
      posts.filter((p) => p.state === s && isLive(p.status)).map((p) => p.variant);
    const names = live(state);
    if (names.length < 2) return null;
    const applies = (a: Ask) => a.scope !== "part" && !(a.scope === "state" && a.state !== state);
    const bound = design.asks.some((a) => {
      if (!applies(a)) return false;
      const variants = new Set(a.options.map((o) => o.variant));
      return names.every((n) => variants.has(n));
    });
    if (bound) return null;
    const where = state === null ? design.slug : `${design.slug} state "${state}"`;
    const key = (list: string[]) => [...list].sort().join("\n");
    const states = design.states.length ? design.states : [null];
    const wide = states.every((s) => key(live(s)) === key(names));
    // An ask that already picks between some of these variants is the question:
    // a second, generic "Which variant?" would make the user choose twice.
    // A design-wide one only fits while every state has the same variants; else a
    // variant only some states have would leave the others no real choice.
    const existing = design.asks.find(
      (a) => applies(a) && a.options.some((o) => o.variant) && (a.scope === "state" || wide),
    );
    if (existing) {
      const have = new Set(existing.options.map((o) => o.variant));
      const missing = names.filter((n) => !have.has(n));
      const ask = {
        id: existing.id,
        text: existing.text,
        scope: existing.scope,
        ...(existing.state ? { state: existing.state } : {}),
        ...(existing.multi ? { multi: true } : {}),
        options: [
          ...existing.options.map((o) => ({
            id: o.id,
            label: o.label,
            ...(o.variant ? { variant: o.variant } : {}),
            ...(o.set ? { set: o.set } : {}),
          })),
          ...missing.map((v) => ({ label: v, variant: v })),
        ],
      };
      return {
        nudge: `${where}: bind ${missing.map((m) => `"${m}"`).join(", ")} to your existing question "${existing.id}": call ask with suggestedAsk. Never ask in chat.`,
        ask,
      };
    }
    const options = names.map((v) => ({ label: v, variant: v }));
    // Not the built-in's reserved id: a stored ask under it would collide with the
    // built-in the viewer synthesizes once a new variant goes unbound. Nor any id
    // already taken, which sending this would silently replace.
    const base = wide ? "choice" : `choice-${slugify(state ?? "")}`;
    let id = base;
    for (let n = 2; design.asks.some((a) => a.id === id); n++) id = `${base}-${n}`;
    const ask = wide
      ? { id, text: "Which variant?", scope: "design", options }
      : { id, text: "Which variant?", scope: "state", state, options };
    return {
      nudge: `${where} has ${names.length} variants and no question binds them: call ask with suggestedAsk. Never ask in chat.`,
      ask,
    };
  }

  // The answer to every write: what was published, the parts found per state,
  // what moved since the previous version, and any feedback waiting — for the
  // session that wrote, which on a new version may not be the variant's own.
  async function writeResult(
    design: Design,
    post: Post,
    ctx: FlowContext,
    extra: {
      previous?: Surface[];
      applied?: string[];
      nudges?: string[];
      status?: number;
      writer?: Session | null;
      flow?: { name: string; steps: FlowStep[] };
      withdrawn?: number;
    } = {},
  ): Promise<FlowResult> {
    const posts = await store.listPosts({ designId: design.id });
    const detail = designDetailView(design, posts);
    const unbound = unboundVariants(design, posts, post.state);
    // A part with fills that no ask sets is a decision nobody was asked; hand over the ask.
    const slots = slotsInSurfaces(post.surfaces);
    const setPaths = new Set(
      design.asks.flatMap((a) => a.options.flatMap((o) => Object.keys(o.set ?? {}))),
    );
    const slotAsks = slots
      .filter((sl) => !setPaths.has(sl.part))
      .map((sl) => ({
        id: sl.part,
        text: `Which ${sl.label ?? sl.part}?`,
        scope: "part" as const,
        part: sl.part,
        options: sl.fills.map((f) => ({ label: f.label ?? f.name, set: { [sl.part]: f.name } })),
      }));
    const nudges = [
      ...(extra.nudges ?? []),
      ...(unbound ? [unbound.nudge] : []),
      ...(slotAsks.length
        ? [
            `${slotAsks.map((a) => `part "${a.part}"`).join(", ")} ${slotAsks.length === 1 ? "has" : "have"} fills and no question sets ${slotAsks.length === 1 ? "it" : "them"}: send suggestedFillAsks with ask (reword the text in the user's terms)`,
          ]
        : []),
    ];
    let partChanges: PartChanges | undefined;
    if (extra.previous) {
      partChanges = diffParts(partsInSurfaces(extra.previous), partsInSurfaces(post.surfaces));
    }
    const warnings = await iconWarnings(design.project, post.surfaces);
    const feedback = await collectFeedback(extra.writer?.id ?? post.sessionId, ctx.base);
    return ok(
      {
        design: {
          id: design.id,
          project: design.project,
          slug: design.slug,
          title: design.title,
          kind: design.kind,
          ...placeOf(design),
          states: design.states,
        },
        post: {
          id: post.id,
          state: post.state,
          variant: post.variant,
          version: post.version,
          ...(post.amendedAt ? { amendedAt: post.amendedAt } : {}),
          status: variantStatus(post.status),
          surfaces: post.surfaces.map(surfaceRef),
        },
        ...(extra.withdrawn ? { withdrawn: { version: extra.withdrawn } } : {}),
        sessionId: post.sessionId,
        url: designUrl(ctx.base, design, post),
        parts: detail.parts,
        ...(slots.length ? { fills: slots } : {}),
        ...(extra.applied ? { applied: extra.applied } : {}),
        ...(partChanges && (partChanges.vanished.length || partChanges.renamed.length)
          ? { partChanges }
          : {}),
        ...(nudges.length ? { nudges } : {}),
        ...(unbound ? { suggestedAsk: unbound.ask } : {}),
        ...(slotAsks.length ? { suggestedFillAsks: slotAsks } : {}),
        ...(warnings.length ? { warnings } : {}),
        ...(extra.flow ? { flow: extra.flow } : {}),
        feedback,
      },
      extra.status ?? 200,
    );
  }

  function announcePost(
    design: Design,
    post: Post,
    created: boolean,
    by: "agent" | "user" = "agent",
  ) {
    bus.broadcast({
      type: created ? "post-created" : "post-updated",
      id: post.id,
      designId: design.id,
      sessionId: post.sessionId,
      version: post.version,
      by,
    });
    warmPost(post, design);
    void announceEmbedders(design).catch((err) => console.warn("[mockpit] embedders", err));
  }

  // A component's new version changes every design that shows it: their views
  // carry a new embeds key, so open viewers refetch and reload those frames.
  async function announceEmbedders(design: Design): Promise<void> {
    for (const m of await embeddersOf(design.project, design.slug)) {
      bus.broadcast({ type: "design-updated", id: m.id, project: m.project });
    }
  }

  // The one write: publish one variant of one state of a design. An existing
  // (design, state, variant) becomes a new version; anything else is created.
  // Exactly one body: `html`, the full ordered `surfaces` list, or `parts` or
  // `fills` spliced into the variant's latest (or `from`) version.
  async function publishFlow(body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    if (body.withdraw === true) return withdrawFlow(body, ctx);
    const amend = body.amend === true;
    const slugIn = str(body.design, MAX_TITLE);
    if (!slugIn) return fail(400, 'provide "design": the design slug, e.g. "writer"');
    const given = ["html", "surfaces", "parts", "fills"].filter((k) => body[k] !== undefined);
    const forkIn = forkArg(body.fork);
    if (isResult(forkIn)) return forkIn;
    const flowIn = flowArg(body);
    if (isResult(flowIn)) return flowIn;
    // `flow` alone places an existing screen in a flow without a new version.
    const flowOnly = given.length === 0 && !forkIn && !!flowIn;
    // With no body, a declared kind plans the screen or component instead of drawing it.
    const declaring = body.kind === "screen" || body.kind === "component";
    const noBody =
      'provide "html", "surfaces", "parts" or "fills" (or "fork" alone, or "kind" screen or component to plan it)';
    if (given.length === 0 && !forkIn && !flowIn && !declaring) return fail(400, noBody);
    if (given.length > 1) {
      return fail(
        400,
        `pass one of "html", "surfaces", "parts" or "fills", not ${given.join(" and ")}`,
      );
    }
    if (amend && (forkIn || given.length === 0)) {
      return fail(
        400,
        forkIn
          ? '"amend" replaces a variant\'s latest version; "fork" starts a new variant'
          : '"amend" needs the new "html", "surfaces", "parts" or "fills"',
      );
    }
    const partEdits = editsArg(body, "parts");
    if (isResult(partEdits)) return partEdits;
    const fillEdits = editsArg(body, "fills");
    if (isResult(fillEdits)) return fillEdits;
    const knobs = checkKnobs(body.knobs);
    if (!knobs.ok) return fail(400, knobs.error);
    const variantKnobs = checkKnobs(body.variantKnobs);
    if (!variantKnobs.ok) return fail(400, variantKnobs.error);
    const stateIn = stateArg(body.state);
    const variantIn = str(body.variant, MAX_LABEL);
    // Never quietly filed as an idea: an agent still saying page or sketch has to hear it.
    if (body.kind !== undefined && !isDesignKind(body.kind)) {
      return fail(400, '"kind" must be screen, component or idea');
    }
    const kind: DesignKind | undefined = body.kind;
    const title = str(body.title, MAX_TITLE);
    const fromN = Number(body.from);
    const from = Number.isInteger(fromN) && fromN > 0 ? fromN : undefined;
    const prompt = str(body.prompt, MAX_COMMENT_TEXT);
    const author = str(body.author, MAX_TITLE);
    const description =
      body.description === undefined ? undefined : (str(body.description, MAX_DESCRIPTION) ?? "");
    const widths = widthsArg(body.widths);
    if (isResult(widths)) return widths;
    const area = labelArg(body, "area", MAX_LABEL);
    if (isResult(area)) return area;
    const source = labelArg(body, "source", MAX_SOURCE);
    if (isResult(source)) return source;

    // An existing design is addressable by id before a session exists.
    let design: Design | null = null;
    if (typeof body.design === "string") design = await store.getDesign(body.design);

    let session: Session | null = null;
    if (typeof body.session === "string" && body.session) {
      session = await store.getSession(body.session);
      if (!session) return fail(404, `session "${body.session}" not found`);
    }
    const project =
      design?.project ??
      (str(body.project, MAX_TITLE) ||
        session?.project ||
        projectFromCwd(session?.cwd) ||
        resolveProject(undefined, str(body.cwd, 4096)));
    let slug = design?.slug ?? slugify(slugIn);
    design ??= await store.findDesign(project, slug);
    // Told a design by its title, the agent means that design, not a new one named
    // after it. Only for what can't be a slug: a slug it chose stays a new design.
    if (!design && slugIn !== slug) {
      const titled = titledDesigns(await store.listDesigns(project), slug);
      if (titled.length === 1) {
        design = titled[0];
        slug = design.slug;
      }
    }

    const posts = design ? await store.listPosts({ designId: design.id }) : [];
    let state: string | null;
    if (stateIn === undefined || stateIn === null) {
      if (design && design.states.length > 0) {
        return fail(400, `${slug} has states; pass state`, { states: design.states });
      }
      state = null;
    } else {
      if (design && design.states.length === 0 && posts.length > 0) {
        return fail(
          409,
          `${slug} is a single-state design; its variants have no state name. Name theirs first with edit firstState, or publish a multi-state design as a new design`,
        );
      }
      state = stateIn;
    }
    const inState = posts.filter((p) => p.state === state);
    const screen: FlowStep = { design: slug, state };
    // Nothing to draw and nothing there yet: the plan itself is the write. A body-less
    // publish naming a variant, or landing on what is already drawn, is a forgotten body.
    const planning =
      given.length === 0 &&
      !forkIn &&
      variantIn === undefined &&
      inState.length === 0 &&
      (declaring || (!!design && isPlanned(design, posts.length)));
    if (planning) {
      if (flowIn) {
        const full = await flowFull(project, flowIn.name, screen, flowIn.step);
        if (full) return full;
      }
      if (!session) {
        session = await store.createSession({
          agent: str(body.agent, MAX_TITLE) ?? "agent",
          title: str(body.sessionTitle, MAX_TITLE),
          cwd: str(body.cwd, 4096),
          project,
        });
        bus.broadcast({ type: "session-created", id: session.id });
      }
      const created = !design;
      // As when drawing it: a plan with no state name takes its first, and the steps
      // of any flow that planned it follow.
      if (design && state !== null && design.states.length === 0 && posts.length === 0) {
        design = (await store.nameFirstState(design.id, state)) ?? design;
      }
      if (!design) {
        design = await store.createDesign({
          project,
          slug,
          title: title ?? titleFromSlug(slug),
          kind,
          ...(area === undefined ? {} : { area }),
          ...(source === undefined ? {} : { source }),
          states: state === null ? [] : [state],
          knobs: knobs.value,
          ...(widths ? { widths } : {}),
          sessionId: session.id,
        });
        bus.broadcast({ type: "design-created", id: design.id, project });
      } else {
        design = await updateDesignAfterWrite(design, {
          state,
          kind,
          title,
          knobs: knobs.value,
          widths,
          area,
          source,
          session,
        });
      }
      const flow = flowIn ? await placeFlow(project, flowIn.name, screen, flowIn.step) : undefined;
      if (flow) bus.broadcast({ type: "design-updated", id: design.id, project });
      const nudges = titleNudges(title);
      return ok(
        {
          design: {
            id: design.id,
            project: design.project,
            slug: design.slug,
            title: design.title,
            kind: design.kind,
            ...placeOf(design),
            states: design.states,
          },
          planned: true,
          sessionId: session.id,
          url: designUrl(ctx.base, design),
          ...(flow ? { flow } : {}),
          ...(nudges.length ? { nudges } : {}),
          feedback: await collectFeedback(session.id, ctx.base),
        },
        created ? 201 : 200,
      );
    }
    if (given.length === 0 && !forkIn && !flowIn) return fail(400, noBody);
    let variant = variantIn;
    if (!variant) {
      const live = inState.filter((p) => isLive(p.status));
      if (inState.length === 0) variant = DEFAULT_VARIANT;
      else if (inState.length === 1) variant = inState[0].variant;
      else if (live.length === 1) variant = live[0].variant;
      else if (flowOnly) variant = (live[0] ?? inState[0]).variant;
      else {
        return fail(400, `${slug} has several variants; pass variant`, {
          variants: inState.map(variantLabel),
        });
      }
    }
    const target = inState.find((p) => p.variant === variant) ?? null;
    const missing = () =>
      fail(404, `${slug} has no variant "${variant}"${state === null ? "" : ` in "${state}"`}`, {
        variants: posts.map(variantLabel),
      });
    if (amend) {
      if (!design || !target) {
        return fail(404, `${slug} has no variant "${variant}" to amend`, {
          fix: "publish without --amend to create it",
        });
      }
      const refused = await rewriteRefusal(design, target, session, "amend");
      if (refused) return refused;
    }
    if (flowIn) {
      const full = await flowFull(project, flowIn.name, screen, flowIn.step);
      if (full) return full;
    }
    if (flowOnly) {
      if (!design || inState.length === 0) {
        return fail(
          404,
          `${slug} has no ${state === null ? "design" : `state "${state}"`} yet: publish it with "flow" to place it`,
        );
      }
      if (!target) return missing();
      const flow = await placeFlow(project, flowIn!.name, screen, flowIn!.step);
      bus.broadcast({ type: "design-updated", id: design.id, project });
      return writeResult(design, target, ctx, { writer: session, flow });
    }
    // A fork starts a new variant from a sibling's version: that version's
    // surfaces are what `parts`, `fills` and kept surface ids refer to.
    let fork: { ref: ForkRef; surfaces: Surface[]; knobs?: Knobs; description?: string } | null =
      null;
    if (forkIn) {
      if (target) {
        return fail(409, `${variant} already exists; fork names a new variant to start`);
      }
      const source = inState.find((p) => p.variant === forkIn.variant);
      if (!source) {
        return fail(404, `no variant "${forkIn.variant}" to fork in this state`, {
          variants: inState.map(variantLabel),
        });
      }
      const version = forkIn.version ?? source.version;
      const surfacesAt =
        version === source.version
          ? source.surfaces
          : source.history.find((h) => h.version === version)?.surfaces;
      if (!surfacesAt) return fail(404, `${source.variant} has no version ${version}`);
      fork = {
        ref: { variant: source.variant, version },
        surfaces: surfacesAt,
        ...(source.knobs ? { knobs: source.knobs } : {}),
        ...(source.description ? { description: source.description } : {}),
      };
    }
    // What `parts` and kept surface ids refer to: the variant's current
    // version, or the one `from` names.
    const base = (): Surface[] | FlowResult => {
      if (fork) return fork.surfaces;
      if (!target) return missing();
      if (from === undefined || from === target.version) return target.surfaces;
      return (
        target.history.find((h) => h.version === from)?.surfaces ??
        fail(404, `${slug} has no version ${from}`)
      );
    };

    let surfaces: Surface[];
    let applied: string[] | undefined;
    if (fork && given.length === 0) {
      surfaces = fork.surfaces;
    } else if (partEdits || fillEdits) {
      const current = base();
      if (isResult(current)) return current;
      const result = partEdits
        ? spliceParts(current, partEdits)
        : spliceFills(current, fillEdits as Record<string, string>);
      if (!result.ok) return fail(400, result.error);
      surfaces = result.surfaces;
      applied = result.applied;
    } else {
      const parsed = await parseSurfaceInput(body, ctx, await kitScope(project), base);
      if (isResult(parsed)) return parsed;
      surfaces = parsed;
    }
    const before = base();
    const postered = await withPoster(surfaces, isResult(before) ? null : before, body.poster);
    if (isResult(postered)) return postered;
    surfaces = postered;
    const bad = checkSurfaces(surfaces);
    if (bad) return bad;
    const nudges = [
      ...knobNudges({ ...knobs.value, ...variantKnobs.value }),
      ...titleNudges(title),
      // The CLI or stdio server has a browser and is taking the still itself.
      ...(target || body.posterComing === true ? [] : posterNudges(surfaces)),
    ];
    const embeds = await publishEmbeds(project, slug, surfaces);
    if (isResult(embeds)) return embeds;
    await promoteEmbedded(project, embeds);

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
      // The first drawing of a plan with no state name yet gives it one, and the
      // steps of any flow that planned it follow.
      if (design && state !== null && design.states.length === 0 && posts.length === 0) {
        design = (await store.nameFirstState(design.id, state)) ?? design;
      }
      if (!design) {
        design = await store.createDesign({
          project,
          slug,
          title: title ?? titleFromSlug(slug),
          kind: kind ?? "idea",
          ...(area === undefined ? {} : { area }),
          ...(source === undefined ? {} : { source }),
          states: state === null ? [] : [state],
          knobs: knobs.value,
          ...(widths ? { widths } : {}),
          sessionId: session.id,
        });
        bus.broadcast({ type: "design-created", id: design.id, project });
      }
      const created = await store.createPost({
        sessionId: session.id,
        design: design.id,
        state,
        variant,
        title: title ?? design.title,
        surfaces,
        ...(Object.keys(variantKnobs.value).length
          ? { knobs: variantKnobs.value }
          : fork?.knobs
            ? { knobs: fork.knobs }
            : {}),
        ...(description
          ? { description }
          : description === undefined && fork?.description
            ? { description: fork.description }
            : {}),
        embeds,
        ...(fork ? { forkedFrom: fork.ref } : {}),
        from,
        prompt,
        author,
      });
      if (!created) return fail(404, "session not found");
      design = await updateDesignAfterWrite(design, {
        state,
        kind,
        title,
        knobs: knobs.value,
        widths,
        area,
        source,
        session,
      });
      const flow = flowIn ? await placeFlow(project, flowIn.name, screen, flowIn.step) : undefined;
      announcePost(design, created, true);
      if (prompt && ctx.request) notifyPublish(design, created, prompt, ctx);
      return writeResult(design, created, ctx, { nudges, status: 201, flow });
    }

    if (!design) return missing();
    if (amend) {
      const amended = await store.amendPost(target.id, target.version, {
        surfaces,
        title,
        ...(body.variantKnobs !== undefined ? { knobs: variantKnobs.value } : {}),
        ...(description !== undefined ? { description } : {}),
        embeds,
        from,
        prompt,
        author,
      });
      if (!amended) {
        return fail(409, `${variant} has a newer version than v${target.version}`, {
          fix: `mockpit read ${slug} --history, then amend that one`,
        });
      }
      dropPostRenders(amended.id);
      const flow = flowIn ? await placeFlow(project, flowIn.name, screen, flowIn.step) : undefined;
      design = await updateDesignAfterWrite(design, {
        state,
        kind,
        knobs: knobs.value,
        widths,
        area,
        source,
        session,
      });
      announcePost(design, amended, false);
      return writeResult(design, amended, ctx, {
        previous: target.surfaces,
        applied,
        nudges,
        writer: session,
        flow,
      });
    }
    // A new version is written by whoever writes it; without an explicit
    // session the variant's own session carries it.
    session ??= await store.getSession(target.sessionId);
    // A second version moments after the first, before the user did anything
    // with it, is almost always the agent fixing its own mistake: the user
    // would get two near-identical versions to tell apart.
    if (
      session &&
      publisherOf(target) === session.id &&
      Date.now() - Date.parse(target.updatedAt) < AMEND_WINDOW_MS &&
      !(await touchedBy(design, target))
    ) {
      nudges.push(
        `v${target.version} of ${variant} was minutes old and untouched by the user: one request gets one version. Fix a version the user hasn't acted on with amend (CLI --amend) instead of adding one; withdraw takes this one back`,
      );
    }
    const updated = await store.updatePost(target.id, {
      surfaces,
      title,
      ...(body.variantKnobs !== undefined ? { knobs: variantKnobs.value } : {}),
      ...(description !== undefined ? { description } : {}),
      embeds,
      from,
      prompt,
      author,
      ...(session ? { publishedBy: session.id } : {}),
    });
    if (!updated) return fail(404, "variant not found");
    const flow = flowIn ? await placeFlow(project, flowIn.name, screen, flowIn.step) : undefined;
    design = await updateDesignAfterWrite(design, {
      state,
      kind,
      knobs: knobs.value,
      widths,
      area,
      source,
      session,
    });
    announcePost(design, updated, false);
    if (prompt && ctx.request) notifyPublish(design, updated, prompt, ctx);
    return writeResult(design, updated, ctx, {
      previous: target.surfaces,
      applied,
      nudges,
      writer: session,
      flow,
    });
  }

  // Versions from before the publisher was kept count as the variant's own session's.
  const publisherOf = (post: Post) => post.publishedBy ?? post.sessionId;

  // Whether a reply's or a draft's content may be about `post`'s state. The
  // variants of a state compete, so a word on any of them may have weighed
  // this one; another state's questions, parts and comments did not. What
  // can't be placed (free text, a close, a design-wide question) counts.
  function speaksToState(
    r: Pick<Reply, "answers" | "borrowed" | "tuned" | "comments" | "others" | "askComments"> &
      Partial<Pick<Reply, "otherImages" | "askCommentImages" | "text" | "verdict" | "archived">>,
    design: Design,
    post: Post,
    siblings: Post[],
  ): boolean {
    const state = post.state;
    const parts = new Set(siblings.flatMap((p) => partsInSurfaces(p.surfaces).map((x) => x.name)));
    const names = new Set(siblings.map((p) => p.variant));
    const askAbout = (id: string) => {
      if (id === BUILTIN_ASK_ID) return true;
      if (id.startsWith(`${BUILTIN_ASK_ID}:`)) return id.slice(BUILTIN_ASK_ID.length + 1) === state;
      const a = design.asks.find((x) => x.id === id);
      if (!a || a.scope === "design") return true;
      if (a.scope === "state") return a.state === state;
      return a.state === undefined ? !!a.part && parts.has(a.part) : a.state === state;
    };
    const asked = [
      ...Object.keys(r.answers),
      ...Object.keys(r.others ?? {}),
      ...Object.keys(r.askComments ?? {}),
      ...Object.keys(r.otherImages ?? {}),
      ...Object.keys(r.askCommentImages ?? {}),
    ];
    return (
      !!r.text ||
      r.verdict?.state === state ||
      asked.some(askAbout) ||
      Object.entries(r.borrowed).some(([part, from]) => parts.has(part) || names.has(from)) ||
      Object.keys(r.tuned).length > 0 ||
      r.comments.some((c) => c.state === state)
    );
  }

  // What the user did with a variant's latest version, if anything: put it in
  // use, hid it, made it (a restore), or, since it was published, sent,
  // commented or started answering on its state, or on a design that shows it.
  // Null means untouched, so rewriting it loses no feedback.
  async function touchedBy(design: Design, post: Post): Promise<string | null> {
    const v = `v${post.version} of ${post.variant}`;
    if (post.status === "accepted" && post.acceptedVersion === post.version)
      return `${v} is in use`;
    if (post.author === "user") return `the user made ${v}`;
    if (post.hiddenVersions?.includes(post.version)) return `the user hid ${v}`;
    const since = post.updatedAt;
    const siblings = (await store.listPosts({ designId: design.id })).filter(
      (p) => p.state === post.state,
    );
    const inState = new Set(siblings.map((p) => p.id));
    const where = post.state === null ? "" : ` on "${post.state}"`;
    for (const c of await store.listComments({ designId: design.id })) {
      if (c.author !== "user" || c.createdAt < since) continue;
      if (c.kind === "reply") {
        if (c.payload && !c.payload.edited && speaksToState(c.payload, design, post, siblings)) {
          return `the user replied${where} after ${v} was published`;
        }
        continue;
      }
      const anchored = c.anchor?.kind === "part" ? c.anchor.state : undefined;
      const elsewhere = c.postId
        ? !inState.has(c.postId)
        : anchored !== undefined && anchored !== post.state;
      if (!elsewhere) return `the user commented${where} after ${v} was published`;
    }
    const d = design.draft;
    if (d && d.updatedAt >= since && speaksToState(d, design, post, siblings)) {
      return `the user is answering${where} since ${v} was published`;
    }
    // A screen that shows this component can't say which of its parts a word
    // was about, so anything the user said there counts.
    for (const m of await embeddersOf(design.project, design.slug)) {
      const said = (await store.listComments({ designId: m.id })).some(
        (c) => c.author === "user" && c.createdAt >= since && !c.payload?.edited,
      );
      const drafting = !!m.draft && m.draft.updatedAt >= since && draftHasContent(m.draft);
      if (said || drafting) return `the user responded on ${m.slug}, which shows ${v}`;
    }
    return null;
  }

  // The viewer may keep a draft that holds nothing yet.
  const draftHasContent = (d: Draft) =>
    [
      d.answers,
      d.borrowed,
      d.tuned,
      d.others,
      d.askComments,
      d.otherImages,
      d.askCommentImages,
    ].some((x) => x && Object.keys(x).length > 0) || d.comments.length > 0;

  // Amend and withdraw rewrite a version in place, so only its own session
  // may, and only while the user hasn't acted on it.
  async function rewriteRefusal(
    design: Design,
    post: Post,
    session: Session | null,
    verb: "amend" | "withdraw",
  ): Promise<FlowResult | null> {
    const fix =
      verb === "amend"
        ? "publish without --amend to add a version"
        : "publish a new version instead";
    const v = `v${post.version} of ${post.variant}`;
    if (!session) {
      return fail(400, `${verb} needs the session that published ${v}`, { fix: "pass session" });
    }
    if (publisherOf(post) !== session.id) {
      return fail(403, `${v} was published by another session`, { fix });
    }
    const touched = await touchedBy(design, post);
    return touched ? fail(409, touched, { fix }) : null;
  }

  // `withdraw` takes back the latest version of a variant before the user did
  // anything with it. Nobody answered it, so it is deleted rather than hidden:
  // the version before it is current again (a hidden one would stay on stage
  // and keep its number), and a variant with no other version goes.
  async function withdrawFlow(body: any, ctx: FlowContext): Promise<FlowResult> {
    const extra = ["html", "surfaces", "parts", "fills", "fork", "flow", "poster", "amend"].filter(
      (k) => body[k] !== undefined && body[k] !== false,
    );
    if (extra.length) {
      return fail(
        400,
        `"withdraw" takes a version back; drop ${extra.map((k) => `"${k}"`).join(", ")}`,
      );
    }
    let session: Session | null = null;
    if (typeof body.session === "string" && body.session) {
      session = await store.getSession(body.session);
      if (!session) return fail(404, `session "${body.session}" not found`);
    }
    const design = await resolveDesign(
      body.design,
      str(body.project, MAX_TITLE) ?? session?.project,
      body.session,
    );
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const post = chooseVariant(design, posts, stateArg(body.state), str(body.variant, MAX_LABEL));
    if (isResult(post)) return post;
    const refused = await rewriteRefusal(design, post, session, "withdraw");
    if (refused) return refused;
    const v = post.version;
    // Its number is reused by the next publish, so nothing may still point at it.
    const fork = posts.find(
      (p) =>
        p.state === post.state &&
        p.forkedFrom?.variant === post.variant &&
        p.forkedFrom.version === v,
    );
    if (fork) {
      return fail(409, `${fork.variant} was forked from v${v} of ${post.variant}`, {
        fix: `withdraw ${fork.variant} first`,
      });
    }
    const previous = post.history.at(-1);
    if (!previous) {
      if (!posts.some((p) => p.id !== post.id && p.state === post.state)) {
        return fail(
          409,
          `v1 of ${post.variant} is the only design of ${post.state ?? design.slug}`,
          {
            fix: "publish with --amend to replace it",
          },
        );
      }
      const binding = design.asks.find(
        (a) =>
          (a.state === undefined || a.state === post.state) &&
          a.options.some((o) => o.variant === post.variant),
      );
      if (binding) {
        return fail(409, `question "${binding.id}" offers ${post.variant}`, {
          fix: `ask "${binding.id}" again without it, then withdraw`,
        });
      }
    }
    const embeds = previous
      ? await publishEmbeds(design.project, design.slug, previous.surfaces)
      : [];
    const result = await store.withdrawVersion(post.id, v, isResult(embeds) ? [] : embeds);
    if (!result) {
      return fail(409, `${post.variant} has a newer version than v${v}`, {
        fix: `mockpit read ${design.slug} --history`,
      });
    }
    dropPostRenders(post.id);
    if (!result.post) {
      bus.broadcast({
        type: "post-deleted",
        id: post.id,
        designId: design.id,
        sessionId: post.sessionId,
      });
      bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
      void announceEmbedders(design).catch((err) => console.warn("[mockpit] embedders", err));
      return ok({
        withdrawn: { state: post.state, variant: post.variant, version: v },
        removed: true,
        url: designUrl(ctx.base, design),
        feedback: await collectFeedback(session!.id, ctx.base),
      });
    }
    const after = (await store.getDesign(design.id)) ?? design;
    announcePost(after, result.post, false);
    return writeResult(after, result.post, ctx, {
      previous: post.surfaces,
      writer: session,
      withdrawn: v,
    });
  }

  // `flow` names a flow; `step` is the 1-based place of this screen in it
  // (moving it if it is there already), 0 takes the screen out, and without
  // `step` a screen not yet in the flow joins at its end.
  function flowArg(body: any): { name: string; step?: number } | FlowResult | undefined {
    const stepIn = body.step;
    if (body.flow === undefined || body.flow === null) {
      return stepIn === undefined || stepIn === null
        ? undefined
        : fail(400, '"step" needs "flow": the flow\'s name, e.g. "Morning"');
    }
    const name = str(body.flow, MAX_LABEL);
    if (!name) return fail(400, '"flow" must be the flow\'s name, e.g. "Morning"');
    if (stepIn === undefined || stepIn === null) return { name };
    const step = Number(stepIn);
    if (!Number.isInteger(step) || step < 0) {
      return fail(400, '"step" must be the 1-based place in the flow, or 0 to take it out');
    }
    return { name, step };
  }

  // Checked before anything is written, so a full flow leaves no new version behind.
  async function flowFull(
    project: string,
    name: string,
    screen: FlowStep,
    step: number | undefined,
  ): Promise<FlowResult | null> {
    if (step === 0) return null;
    const flows = await store.listFlows(project);
    const flow = flows.find((f) => f.name === name);
    if (!flow && flows.length >= MAX_FLOWS) {
      return fail(400, `${project} already has ${MAX_FLOWS} flows; reuse one`);
    }
    if (
      flow &&
      flow.steps.length >= MAX_FLOW_STEPS &&
      !flow.steps.some((x) => sameScreen(x, screen))
    ) {
      return fail(400, `flow "${name}" already has ${MAX_FLOW_STEPS} steps`);
    }
    return null;
  }

  async function placeFlow(
    project: string,
    name: string,
    screen: FlowStep,
    step: number | undefined,
  ): Promise<{ name: string; steps: FlowStep[] }> {
    let at = step;
    if (at === undefined) {
      const flow = (await store.listFlows(project)).find((f) => f.name === name);
      const i = flow ? flow.steps.findIndex((x) => sameScreen(x, screen)) : -1;
      at = i >= 0 ? i + 1 : MAX_FLOW_STEPS + 1;
    }
    const flow = await store.placeFlowStep(project, name, screen, at);
    return { name, steps: flow?.steps ?? [] };
  }

  // The project's flows as `read` returns them: only steps whose screen exists.
  async function flowsView(project: string, designs: Design[]) {
    const bySlug = new Map(designs.map((m) => [m.slug, m]));
    const exists = (x: FlowStep) => {
      const m = bySlug.get(x.design);
      return !!m && (x.state === null ? m.states.length === 0 : m.states.includes(x.state));
    };
    return (await store.listFlows(project))
      .map((f: Flow) => ({ name: f.name, steps: f.steps.filter(exists) }))
      .filter((f) => f.steps.length > 0);
  }

  // `fork`: "variant" or "variant@N", the sibling version a new variant starts
  // from.
  function forkArg(v: unknown): { variant: string; version?: number } | FlowResult | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    const bad = '"fork" must be "<variant>" or "<variant>@<version>", e.g. "quiet@2"';
    if (typeof v !== "string") return fail(400, bad);
    const m = /^(.+?)(?:@(\d+))?$/.exec(v.trim());
    const variant = m && str(m[1], MAX_LABEL);
    if (!variant) return fail(400, bad);
    const version = m[2] === undefined ? undefined : Number(m[2]);
    if (version !== undefined && version < 1) return fail(400, bad);
    return version === undefined ? { variant } : { variant, version };
  }

  // An optional free-text field of the design (`area`, `source`): absent keeps
  // it, "" or null clears it.
  function labelArg(body: any, key: string, max: number): string | null | undefined | FlowResult {
    const v = body?.[key];
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== "string") return fail(400, `"${key}" must be a string; "" clears it`);
    return str(v, max) ?? null;
  }

  // `widths`: the device widths the design is judged at, in the agent's order;
  // [] hands the choice back to the viewer.
  function widthsArg(v: unknown): number[] | FlowResult | undefined {
    if (v === undefined) return undefined;
    const bad = `"widths" must be up to ${MAX_WIDTHS} integer px widths between ${MIN_WIDTH} and ${MAX_WIDTH}, e.g. [390, 1280]`;
    if (!Array.isArray(v) || v.length > MAX_WIDTHS) return fail(400, bad);
    const out: number[] = [];
    for (const w of v) {
      if (!Number.isInteger(w) || w < MIN_WIDTH || w > MAX_WIDTH) return fail(400, bad);
      if (!out.includes(w)) out.push(w);
    }
    return out;
  }

  // `parts`: new outer html per part ("name" or "name#key"), spliced into the
  // variant's html so a tweak costs the tweak rather than the whole document.
  // `fills`: the same per slot alternative ("part#fill"), replaced or added.
  function editsArg(
    body: any,
    key: "parts" | "fills",
  ): Record<string, string> | FlowResult | undefined {
    if (body?.[key] === undefined) return undefined;
    const edits = body[key];
    const shape =
      key === "parts"
        ? '{ "<part name>": "<html for that part>" }'
        : '{ "<part>#<fill>": "<html for that fill>" }';
    if (!edits || typeof edits !== "object" || Array.isArray(edits)) {
      return fail(400, `"${key}" must be an object: ${shape}`);
    }
    const entries = Object.entries(edits);
    if (entries.length === 0)
      return fail(400, `"${key}" is empty; name at least one ${key.slice(0, -1)}`);
    if (entries.some(([, html]) => typeof html !== "string")) {
      return fail(400, `each "${key}" value must be the html string for that ${key.slice(0, -1)}`);
    }
    return edits as Record<string, string>;
  }

  // A write may add a state, retitle the design, declare knobs, and makes its
  // session the one a reply is delivered to.
  async function updateDesignAfterWrite(
    design: Design,
    w: {
      state: string | null;
      kind?: DesignKind;
      title?: string;
      knobs: Knobs;
      widths?: number[];
      area?: string | null;
      source?: string | null;
      session: Session | null;
    },
  ): Promise<Design> {
    const states =
      w.state !== null && !design.states.includes(w.state)
        ? [...design.states, w.state]
        : undefined;
    const knobs = Object.keys(w.knobs).length ? { ...design.knobs, ...w.knobs } : undefined;
    const updated = await store.updateDesign(design.id, {
      ...(states ? { states } : {}),
      ...(w.kind ? { kind: w.kind } : {}),
      ...(w.title ? { title: w.title } : {}),
      ...(knobs ? { knobs } : {}),
      ...(w.widths ? { widths: w.widths } : {}),
      ...(w.area === undefined ? {} : { area: w.area }),
      ...(w.source === undefined ? {} : { source: w.source }),
      ...(w.session ? { sessionId: w.session.id } : {}),
    });
    if (!updated) return design;
    bus.broadcast({ type: "design-updated", id: updated.id, project: updated.project });
    return updated;
  }

  function notifyPublish(design: Design, post: Post, text: string, ctx: FlowContext) {
    fireNotify({
      event: "publish",
      project: design.project,
      slug: design.slug,
      variant: post.variant,
      version: post.version,
      text,
      url: designUrl(ctx.base, design, post),
    });
  }

  function headsByDesign(heads: PostHead[]): Map<string, PostHead[]> {
    const out = new Map<string, PostHead[]>();
    for (const h of heads) {
      const list = out.get(h.design);
      if (list) list.push(h);
      else out.set(h.design, [h]);
    }
    return out;
  }

  // --- the decision list ---

  const derivedDecisions = async (project: string, designs?: Design[]) =>
    deriveDecisionLines(
      designs ?? (await store.listDesigns(project)),
      await store.listDecisionSources(project),
    );
  const decisionEdits = async (project: string) =>
    parseDecisionEdits(await store.getSetting(`${DECISION_EDITS_SETTING}:${project}`));
  const decisionLines = async (project: string, designs?: Design[]) =>
    applyDecisionEdits(await derivedDecisions(project, designs), await decisionEdits(project));

  // What every agent read carries, once the project has any: the first thing a
  // new session needs is what it must not contradict. Omitted for the viewer,
  // which shows it on its own, and for a session-scoped public read, which may
  // see one design and not the project around it.
  async function decisionListField(project: string, here?: string, designs?: Design[]) {
    const lines = await decisionLines(project, designs);
    return lines.length ? { decisionList: agentDecisionList(lines, here) } : {};
  }

  async function decisionsFlow(query: { project?: unknown }, ctx?: { viewer: boolean }) {
    const project = str(query.project, MAX_TITLE);
    if (!project) return fail(400, '"project" is required');
    const lines = await decisionLines(project);
    return ok(
      ctx?.viewer
        ? { project, total: lines.length, lines }
        : { project, ...fullAgentDecisionList(lines) },
    );
  }

  // The user's own hand on a line: reword it, remove it, or take that back. An
  // agent never edits the list; the user's word is what makes it worth trusting.
  async function editDecisionFlow(name: string, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const project = str(name, MAX_TITLE);
    if (!project) return fail(400, '"project" is required');
    const id = str(body?.id, 1000);
    if (!id) return fail(400, '"id" is required');
    const designs = await store.listDesigns(project);
    const line = (await derivedDecisions(project, designs)).find((l) => l.id === id);
    if (!line) return fail(404, "no such line");
    const edits = await decisionEdits(project);
    if (body.reset === true) delete edits[id];
    else if (body.removed === true) edits[id] = { basis: line.basis, removed: true };
    else {
      const text = str(body.text, MAX_DECISION_TEXT);
      if (!text) return fail(400, 'provide "text", "removed" or "reset"');
      edits[id] = { basis: line.basis, text };
    }
    await store.setSetting(`${DECISION_EDITS_SETTING}:${project}`, JSON.stringify(edits));
    const design = designs.find((m) => m.slug === line.design);
    if (design) bus.broadcast({ type: "design-updated", id: design.id, project });
    return decisionsFlow({ project }, ctx);
  }

  async function listDesignsFlow(query: {
    project?: string;
    noDecisions?: boolean;
  }): Promise<FlowResult> {
    const project = str(query.project, MAX_TITLE);
    const designs = await store.listDesigns(project);
    const heads = headsByDesign(await store.listPostHeads(project));
    const rows = [];
    const pending = [];
    for (const m of designs) {
      const posts = heads.get(m.id) ?? [];
      rows.push(designSummaryView(m, posts));
      pending.push(pendingOf(m));
    }
    const open = rows.reduce((n, r) => n + r.open, 0);
    return ok({
      ...(project ? { project, flows: await flowsView(project, designs) } : {}),
      ...(project && !query.noDecisions
        ? await decisionListField(project, undefined, designs)
        : {}),
      designs: rows,
      open,
      openDesigns: rows.filter((r) => r.open > 0).length,
      pending,
    });
  }

  // The project as a tree: every design with its variants per state (status,
  // lineage, what its embeds resolve to) and the components it embeds and is
  // embedded in, and the declared flows. What the viewer's Home and an agent's
  // `read --tree` lay out.
  async function treeFlow(query: {
    project?: string;
    live?: boolean;
    noDescriptions?: boolean;
  }): Promise<FlowResult> {
    const project = str(query.project, MAX_TITLE);
    if (!project) return fail(400, 'provide "project"');
    const designs = await store.listDesigns(project);
    const heads = headsByDesign(await store.listPostHeads(project));
    const nodes = [];
    const pending = [];
    for (const m of designs) {
      const designHeads = heads.get(m.id) ?? [];
      // Only embeds and fills need the html: most of a workspace's bytes are
      // pages with neither, which this list has no reason to read.
      const marked = designHeads.some((p) => p.surfaces.some((x) => x.marked));
      const posts = marked ? await store.listPosts({ designId: m.id }) : null;
      const views = posts ? await embedViews(m, posts) : new Map<string, EmbedView>();
      const embeds = new Set<string>();
      for (const p of posts ?? []) {
        if (!isLive(p.status)) continue;
        for (const x of p.surfaces) {
          if (x.kind === "html") for (const t of parseEmbedTags(x.html)) embeds.add(t.slug);
        }
      }
      const replies = await replyComments(m.id);
      const lastReplyAt = replies[replies.length - 1]?.createdAt;
      // Whose turn, for the viewer's covers. Not an agent's concern, and an ended
      // design's cover says nothing of the kind.
      const sends = query.live && !m.archivedAt ? replies.filter((c) => !c.payload?.archived) : [];
      const lastSend = sends.length
        ? (await withDelivered([sends[sends.length - 1]], true))[0]
        : undefined;
      nodes.push(
        treeNodeView(m, posts ?? designHeads, {
          settled: settledValues(
            replies.map((c) => c.payload as Reply),
            m,
            posts ?? designHeads.map((p) => ({ knobs: p.knobs })),
          ),
          embeds: [...embeds],
          embedViews: views,
          noDescriptions: query.noDescriptions,
          ...(lastReplyAt ? { lastReplyAt } : {}),
          ...(lastSend
            ? {
                lastSend: {
                  sessionId: lastSend.sessionId,
                  at: lastSend.createdAt,
                  delivered: lastSend.delivered,
                  ...(lastSend.calledAt ? { calledAt: lastSend.calledAt } : {}),
                },
              }
            : {}),
          ...(query.live && !m.archivedAt && draftHolds(m.draft) ? { drafting: true } : {}),
        }),
      );
      pending.push(pendingOf(m));
    }
    const bySlug = new Map(nodes.map((n) => [n.slug, n]));
    for (const n of nodes) {
      n.embeds = n.embeds.filter((s) => bySlug.has(s));
      for (const s of n.embeds) bySlug.get(s)!.embeddedIn.push(n.slug);
    }
    return ok({
      project,
      tree: nodes,
      flows: await flowsView(project, designs),
      areaOrder: await areaOrderOf(project),
      pending,
    });
  }

  // The flows and what names a step, without the tree's pictures and counts:
  // every design screen wants this much on open, few want the rest.
  async function flowOutlineFlow(name: string): Promise<FlowResult> {
    const project = str(name, MAX_TITLE);
    if (!project) return fail(400, 'provide "project"');
    const designs = await store.listDesigns(project);
    return ok({
      flows: await flowsView(project, designs),
      designs: designs.map((m) => ({
        slug: m.slug,
        title: m.title,
        states: m.states.length ? m.states : [null],
      })),
    });
  }

  async function replyComments(designId: string) {
    return (await store.listComments({ designId })).filter(
      (c) => c.kind === "reply" && c.payload && !c.payload.edited,
    );
  }

  async function replyPayloads(designId: string): Promise<Reply[]> {
    return (await replyComments(designId)).map((c) => c.payload as Reply);
  }

  async function getDesignFlow(
    ref: unknown,
    query: {
      project?: unknown;
      session?: unknown;
      body?: boolean;
      history?: boolean;
      noDecisions?: boolean;
    },
  ): Promise<FlowResult> {
    const design = await resolveDesign(ref, query.project, query.session);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    return ok({
      ...(query.noDecisions ? {} : await decisionListField(design.project, design.slug)),
      ...designDetailView(design, posts, {
        body: query.body,
        history: query.history,
        settled: settledValues(await replyPayloads(design.id), design, posts),
        embeds: await embedViews(design, posts),
        ...(await shortlistReach(design)),
      }),
      pending: pendingOf(design),
    });
  }

  async function shortlistReach(design: Design): Promise<{ repliesGoTo?: string }> {
    if (!design.shortlist || design.sessionId) return {};
    const agent = await projectAgent(design.project);
    return agent ? { repliesGoTo: agent.title ?? agent.agent } : {};
  }

  async function exportFlow(
    ref: unknown,
    query: { project?: unknown; state?: unknown; variant?: unknown },
    ctx: FlowContext,
  ): Promise<FlowResult> {
    const design = await resolveDesign(ref, query.project);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const wantedState = stateArg(query.state);
    const wantedVariant = str(query.variant, MAX_LABEL);
    const states = (design.states.length ? design.states : [null]).filter(
      (s) => wantedState === undefined || s === wantedState,
    );
    if (states.length === 0) return fail(404, `${design.slug} has no state "${wantedState}"`);
    const replies = await replyPayloads(design.id);
    const lastReply = replies[replies.length - 1] ?? null;
    const settled = settledValues(replies, design, posts);
    const entries = [];
    for (const state of states) {
      const inState = posts.filter((p) => p.state === state);
      const found =
        (wantedVariant && inState.find((p) => p.variant === wantedVariant)) ||
        inState.find((p) => p.status === "accepted") ||
        inState.find((p) => p.status === "open") ||
        inState[0];
      if (!found) continue;
      if (wantedVariant && found.variant !== wantedVariant) continue;
      const post = postAtVersion(found, inUseVersion(found)) ?? found;
      const html = post.surfaces.find((s) => s.kind === "html");
      // With fills, the state as decided: only the chosen fills, by every
      // value sent so far (defaults before any reply). The authored markup with
      // every fill stays available as `allFills`.
      const slots = slotsInSurfaces(post.surfaces);
      const raw = html && html.kind === "html" ? html.html : "";
      const composed = slots.length ? composeFills(raw, chosenFills(slots, settled)) : raw;
      entries.push({
        state,
        variant: post.variant,
        postId: post.id,
        version: post.version,
        // The agent's newer versions wait until the user puts one in use.
        ...(found.version !== post.version ? { latest: found.version } : {}),
        status: variantStatus(post.status),
        html: composed,
        ...(slots.length ? { allFills: raw } : {}),
        markdown: postToMarkdown(post, {
          postUrl: `${ctx.base}/s/${post.id}`,
          assetBase: ctx.base,
        }),
        history: [
          ...[...found.history]
            .filter((h) => !(found.hiddenVersions ?? []).includes(h.version))
            .sort((a, b) => a.version - b.version)
            .map((h) => ({
              version: h.version,
              at: h.at,
              from: h.from ?? null,
              prompt: h.prompt ?? "",
            })),
          {
            version: found.version,
            at: found.updatedAt,
            from: found.from ?? null,
            prompt: found.prompt ?? "",
          },
        ],
        screenshotUrl: screenshots ? `${ctx.base}/s/${post.id}.png?v=${post.version}` : null,
      });
    }
    if (entries.length === 0) {
      if (posts.length === 0) return fail(404, `${design.slug} isn't drawn yet`);
      return fail(404, `${design.slug} has no variant "${wantedVariant}"`, {
        variants: posts.map(variantLabel),
      });
    }
    const decisions = lastReply ? decisionsFor(design, posts, lastReply) : null;
    return ok({
      project: design.project,
      design: design.slug,
      title: design.title,
      kind: design.kind,
      states: entries,
      knobs: design.knobs,
      settled,
      reply: lastReply,
      ...(decisions ? { decisions } : {}),
    });
  }

  // --- asks ---

  function sanitizeAsk(raw: any, design: Design, posts: Post[], taken: Set<string>): Ask | string {
    if (!raw || typeof raw !== "object") return "each ask must be an object";
    const text = str(raw.text, MAX_COMMENT_TEXT);
    if (!text) return 'each ask needs "text"';
    const scope = raw.scope === "state" || raw.scope === "part" ? raw.scope : "design";
    const state = str(raw.state, MAX_LABEL);
    if (scope === "state") {
      if (!state) return `ask "${text}" has scope "state" but no state`;
      if (!design.states.includes(state)) return `${design.slug} has no state "${state}"`;
    } else if (state && !design.states.includes(state)) {
      return `${design.slug} has no state "${state}"`;
    }
    const part = str(raw.part, 200);
    if (scope === "part" && !part) return `ask "${text}" has scope "part" but no part`;
    const states: string[] = [];
    if (raw.states !== undefined) {
      if (!Array.isArray(raw.states)) return `ask "${text}": states must be a list of state names`;
      if (scope !== "design") {
        return `ask "${text}": states is for a design-wide question; a "${scope}" question already says where it is`;
      }
      for (const name of raw.states) {
        const label = str(name, MAX_LABEL);
        if (!label || !design.states.includes(label)) {
          return `${design.slug} has no state "${String(name)}"`;
        }
        if (!states.includes(label)) states.push(label);
      }
    }
    if (!Array.isArray(raw.options) || raw.options.length === 0) {
      return `ask "${text}" needs options`;
    }
    if (raw.options.length > MAX_OPTIONS)
      return `ask "${text}" has more than ${MAX_OPTIONS} options`;
    const variants = new Set(posts.map((p) => p.variant));
    const options: AskOption[] = [];
    // Seeded with the viewer's write-in, so a label "Other" slugs to "other-2".
    const optionIds = new Set<string>([OTHER_ID]);
    // The agent's own pick, shown as a quiet mark on its option: one per ask.
    const picks = raw.options.filter(
      (o: any) => o && typeof o === "object" && o.recommended === true,
    ).length;
    if (picks > 1) return `ask "${text}" recommends ${picks} options; recommend one`;
    for (const o of raw.options) {
      const opt = typeof o === "string" ? { label: o } : o;
      const label = str(opt?.label, 200);
      if (!label) return `every option of "${text}" needs a label`;
      if (str(opt.id, 64) && slugify(str(opt.id, 64)!) === OTHER_ID) {
        return `option id "${OTHER_ID}" is reserved: the viewer adds its own "Other…" write-in to every ask`;
      }
      let id = slugify(str(opt.id, 64) ?? label);
      for (let n = 2; optionIds.has(id); n++) id = `${slugify(str(opt.id, 64) ?? label)}-${n}`;
      optionIds.add(id);
      const variant = str(opt.variant, MAX_LABEL);
      if (variant && !variants.has(variant)) {
        return `option "${label}" names variant "${variant}", which ${design.slug} does not have`;
      }
      let set: AskOption["set"];
      if (opt.set !== undefined) {
        const checked = checkKnobValues(opt.set, design, posts, `option "${label}"`);
        if (!checked.ok) return checked.error;
        set = checked.value;
      }
      const pick = opt.recommended === true ? { recommended: true as const } : {};
      if (opt.version !== undefined) {
        const pinned = versionOption(opt.version, label, variant, { scope, state }, design, posts);
        if (typeof pinned === "string") return pinned;
        options.push({ id, label, ...pinned, ...(set ? { set } : {}), ...pick });
        continue;
      }
      options.push({
        id,
        label,
        ...(variant ? { variant } : {}),
        ...(set ? { set } : {}),
        ...pick,
      });
    }
    let id = slugify(str(raw.id, 64) ?? text).slice(0, 40);
    if (!str(raw.id, 64))
      for (let n = 2; taken.has(id); n++) id = `${slugify(text).slice(0, 36)}-${n}`;
    const after = raw.after === undefined ? undefined : str(raw.after, 64);
    if (raw.after !== undefined) {
      if (!after || after === id || !taken.has(after)) {
        return `ask "${text}": after must name an earlier ask's id (asked before it or earlier in this call)`;
      }
    }
    return {
      id,
      text,
      scope,
      ...(state ? { state } : {}),
      ...(states.length ? { states } : {}),
      ...(part ? { part } : {}),
      options,
      ...(raw.multi === true ? { multi: true } : {}),
      ...(after ? { after } : {}),
      at: new Date().toISOString(),
    };
  }

  // A version option names one version of one variant in the ask's
  // state (`optionState`); the variant may be left out when that state has
  // only one, or one accepted.
  function versionOption(
    raw: unknown,
    label: string,
    variant: string | undefined,
    ask: Pick<Ask, "scope" | "state">,
    design: Design,
    posts: Post[],
  ): { variant: string; version: number } | string {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) {
      return `option "${label}": version must be a positive integer`;
    }
    if (ask.scope === "part") {
      return `option "${label}" names a version, which puts it in use: ask with scope "state" or "design", not "part"`;
    }
    if (ask.state === undefined && design.states.length > 1) {
      return `option "${label}" names a version: give the ask a state (${design.slug} has ${design.states.map((x) => `"${x}"`).join(", ")})`;
    }
    const state = optionState(ask, design);
    const inState = posts.filter((p) => p.state === state);
    const accepted = inState.filter((p) => p.status === "accepted");
    const post = variant
      ? inState.find((p) => p.variant === variant)
      : inState.length === 1
        ? inState[0]
        : accepted.length === 1
          ? accepted[0]
          : undefined;
    const where = state === null ? design.slug : `"${state}"`;
    if (!post) {
      return variant
        ? `option "${label}" names variant "${variant}", which ${where} does not have`
        : `option "${label}" names version ${version} but ${where} has several variants (${inState.map((p) => p.variant).join(", ")}): name one`;
    }
    const versions = [post.version, ...post.history.map((h) => h.version)].sort((a, b) => a - b);
    if (!versions.includes(version)) {
      return `option "${label}" names ${post.variant} v${version}; ${post.variant} has ${versions.map((v) => `v${v}`).join(", ")}`;
    }
    return { variant: post.variant, version };
  }

  // Ask the user structured questions. An ask whose id matches an existing one
  // replaces it (and reopens it); anything else is appended.
  async function askFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const resolved = await resolveDesign(ref, body.project, body.session);
    if (isResult(resolved)) return resolved;
    let design = resolved;
    const raw = Array.isArray(body.asks) ? body.asks : body.text ? [body] : null;
    if (!raw || raw.length === 0) return fail(400, 'provide "asks": [{text, options}]');
    if (raw.length > MAX_ASKS) return fail(400, `at most ${MAX_ASKS} asks per call`);
    const posts = await store.listPosts({ designId: design.id });
    const asks = [...design.asks];
    const taken = new Set(asks.map((a) => a.id));
    const added: Ask[] = [];
    for (const entry of raw) {
      const ask = sanitizeAsk(entry, design, posts, taken);
      if (typeof ask === "string") return fail(400, ask);
      const at = asks.findIndex((a) => a.id === ask.id);
      if (at >= 0) asks[at] = ask;
      else asks.push(ask);
      taken.add(ask.id);
      added.push(ask);
    }
    let sessionId = design.sessionId;
    if (typeof body.session === "string" && (await store.getSession(body.session))) {
      sessionId = body.session;
    }
    // A question on something the user archived brings it back to the open list, or it
    // would wait where they no longer look. Asked again, a question it left
    // unanswered is simply open again: guidance about what to ask lives in the
    // conversation, not in a refusal here.
    const updated = await store.updateDesign(design.id, {
      asks,
      sessionId,
      ...(design.archivedAt ? { archivedAt: null } : {}),
    });
    if (!updated) return fail(404, "design not found");
    design = updated;
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    // The questions also land in the thread, so the user reads them where they answer.
    const session = sessionId ? await store.getSession(sessionId) : null;
    if (session) {
      const comment = await store.createComment({
        sessionId: session.id,
        designId: design.id,
        author: reservedAgent(session.agent),
        text: added.map((a) => a.text).join("\n"),
        kind: "ask",
      });
      if (comment) announceComment(comment);
    }
    fireNotify({
      event: "ask",
      project: design.project,
      slug: design.slug,
      variant: "",
      version: Math.max(1, ...posts.map((p) => p.version)),
      text: added.map((a) => a.text).join(" · "),
      url: designUrl(ctx.base, design),
    });
    const feedback = session ? await collectFeedback(session.id, ctx.base) : [];
    const nudges = askNudges(added, design.asks);
    return ok({
      design: design.slug,
      designId: design.id,
      project: design.project,
      asks: added,
      open: openCount(design),
      url: designUrl(ctx.base, design),
      ...(nudges.length ? { nudges } : {}),
      feedback,
    });
  }

  // --- drafts and replies (the user's side; viewer origin only) ---

  function sanitizePartComments(
    raw: unknown,
    design: Design,
    posts: Post[],
  ): PartComment[] | string {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) return '"comments" must be an array';
    if (raw.length > MAX_DRAFT_COMMENTS) return `at most ${MAX_DRAFT_COMMENTS} comments`;
    const out: PartComment[] = [];
    for (const c of raw) {
      const reaction = c?.reaction;
      if (reaction !== undefined && !(REACTIONS as readonly unknown[]).includes(reaction))
        return `reaction must be one of ${REACTIONS.join(", ")}`;
      const text = str(c?.text, MAX_COMMENT_TEXT);
      const borrowIn = c?.borrow;
      if (!text && !reaction && !borrowIn) return "every comment needs text";
      const state = stateArg(c.state) ?? null;
      if (state !== null && !design.states.includes(state))
        return `${design.slug} has no state "${state}"`;
      const part = str(c.part, 200) ?? null;
      const variant = str(c.variant, 200);
      const post = variant ? posts.find((p) => p.variant === variant && p.state === state) : null;
      if (variant && !post)
        return `${design.slug} has no variant "${variant}"${state ? ` in "${state}"` : ""}`;
      const version = c.version;
      if (
        version !== undefined &&
        (!post || !Number.isInteger(version) || version < 1 || version > post.version)
      )
        return `${design.slug} has no version ${String(version)}${variant ? ` of "${variant}"` : ""}`;
      let borrow: PartComment["borrow"];
      if (borrowIn !== undefined) {
        const from = str(borrowIn?.from, 240);
        const at = from ? /^(.+)@(\d+)$/.exec(from) : null;
        const source = at && posts.find((p) => p.variant === at[1] && p.state === state);
        if (!at || !source || Number(at[2]) < 1 || Number(at[2]) > source.version)
          return `borrow.from must be variant@version of "${design.slug}"${state ? ` in "${state}"` : ""}`;
        if (!post || version === undefined) return "a borrow names the version it goes into";
        const borrowed = str(borrowIn?.part, 200);
        borrow = { from: at[0], ...(borrowed ? { part: borrowed } : {}) };
      }
      const a = c.anchor && typeof c.anchor === "object" ? c.anchor : null;
      const anchor = a ? sanitizePartAnchor(a) : undefined;
      const next: PartComment = {
        part,
        state,
        text: text ?? "",
        ...(anchor ? { anchor } : {}),
        ...(reaction ? { reaction: reaction as Reaction } : {}),
        ...(variant ? { variant } : {}),
        ...(version !== undefined ? { version: version as number } : {}),
        ...(borrow ? { borrow } : {}),
      };
      // One reaction per target: a later tap on the same part replaces the earlier one.
      if (reaction) {
        const same = out.findIndex(
          (o) =>
            o.reaction &&
            o.part === part &&
            o.state === state &&
            (o.variant ?? null) === (variant ?? null) &&
            (o.version ?? null) === (version ?? null),
        );
        if (same >= 0) out.splice(same, 1);
      }
      out.push(next);
    }
    return out;
  }

  // The text came out of a sandboxed frame by way of the viewer: plain, clipped data,
  // never read as anything but the words an agent gets back.
  function sanitizeParagraph(raw: unknown): ParagraphAnchor | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const p = raw as Record<string, unknown>;
    const place = (v: unknown) =>
      Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10000;
    const text = str(p.text, PARAGRAPH_TEXT_MAX);
    const kind = str(p.kind, 20);
    if (!text || !kind || !place(p.surface) || !place(p.index)) return undefined;
    return { surface: p.surface as number, index: p.index as number, kind, text };
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
    const width =
      typeof a.width === "number" && Number.isFinite(a.width) && a.width >= 1 && a.width <= 10000
        ? Math.round(a.width)
        : undefined;
    const paragraph = sanitizeParagraph(a.paragraph);
    if (!offset && !box && !quote && !selector && !paragraph) return undefined;
    return {
      ...(offset ? { offset } : {}),
      ...(quote ? { quote } : {}),
      ...(selector ? { selector } : {}),
      ...(box ? { box } : {}),
      ...(paragraph ? { paragraph } : {}),
      ...(width ? { width } : {}),
    };
  }

  // A stored ask, else the viewer's built-in variant ask under its reserved id.
  const askById = (design: Design, posts: Post[], id: string): Ask | undefined =>
    design.asks.find((a) => a.id === id) ?? builtinAsk(design, posts, id);

  function sanitizeAnswers(
    raw: unknown,
    design: Design,
    posts: Post[],
  ): Record<string, AskAnswer> | string {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) return '"answers" must be an object';
    const out: Record<string, AskAnswer> = {};
    for (const [askId, value] of Object.entries(raw as Record<string, unknown>)) {
      const ask = askById(design, posts, askId);
      if (!ask) return `${design.slug} has no ask "${askId}"`;
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

  // askId → text, for the write-ins and the comments: known asks only, text capped
  // like a comment, blanks dropped.
  function sanitizeAskTexts(
    raw: unknown,
    design: Design,
    posts: Post[],
    key: "others" | "askComments",
  ): Record<string, string> | string {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) return `"${key}" must be an object`;
    const out: Record<string, string> = {};
    for (const [askId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!askById(design, posts, askId)) return `${design.slug} has no ask "${askId}"`;
      if (value !== undefined && value !== null && typeof value !== "string") {
        return `${key} "${askId}" must be text`;
      }
      const text = str(value, MAX_COMMENT_TEXT);
      if (text) out[askId] = text;
    }
    return out;
  }

  // askId → attached image ids: known asks, ids of stored raster images only,
  // deduped and capped, empty lists dropped.
  async function sanitizeAskImages(
    raw: unknown,
    design: Design,
    posts: Post[],
    key: "otherImages" | "askCommentImages",
  ): Promise<Record<string, string[]> | string> {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) return `"${key}" must be an object`;
    const out: Record<string, string[]> = {};
    for (const [askId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!askById(design, posts, askId)) return `${design.slug} has no ask "${askId}"`;
      if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
        return `${key} "${askId}" must be a list of asset ids`;
      }
      const ids = [...new Set(value as string[])];
      if (ids.length > MAX_ASK_IMAGES) {
        return `${key} "${askId}" takes at most ${MAX_ASK_IMAGES} images`;
      }
      for (const id of ids) {
        const asset = await store.getAsset(id);
        if (!asset) return `asset "${id}" not found`;
        if (!ATTACHABLE_IMAGE_TYPES.has(asset.contentType)) {
          return `asset "${id}" is not an attachable image`;
        }
      }
      if (ids.length) out[askId] = ids;
    }
    return out;
  }

  function sanitizeBorrowed(raw: unknown, posts: Post[]): Record<string, string> | string {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) return '"borrowed" must be an object';
    const variants = new Set(posts.map((p) => p.variant));
    const out: Record<string, string> = {};
    for (const [part, variant] of Object.entries(raw as Record<string, unknown>)) {
      if (!part || part.length > 200) return "borrowed keys are part names";
      if (typeof variant !== "string" || !variants.has(variant)) {
        return `borrowed "${part}" names a variant that does not exist`;
      }
      out[part] = variant;
    }
    return out;
  }

  // A draft, validated against the design as it is now: unknown asks, options,
  // variants, knob paths or out-of-range values are refused, never stored.
  async function sanitizeDraft(
    raw: any,
    design: Design,
    posts: Post[],
    base: Draft | null,
  ): Promise<Draft | string> {
    const pick = (key: keyof Draft) => (raw?.[key] !== undefined ? raw[key] : base?.[key]);
    const answers = sanitizeAnswers(pick("answers"), design, posts);
    if (typeof answers === "string") return answers;
    const borrowed = sanitizeBorrowed(pick("borrowed"), posts);
    if (typeof borrowed === "string") return borrowed;
    const tuned = checkKnobValues(pick("tuned"), design, posts, "tuned");
    if (!tuned.ok) return tuned.error;
    const comments = sanitizePartComments(pick("comments"), design, posts);
    if (typeof comments === "string") return comments;
    const others = sanitizeAskTexts(pick("others"), design, posts, "others");
    if (typeof others === "string") return others;
    const askComments = sanitizeAskTexts(pick("askComments"), design, posts, "askComments");
    if (typeof askComments === "string") return askComments;
    const otherImages = await sanitizeAskImages(pick("otherImages"), design, posts, "otherImages");
    if (typeof otherImages === "string") return otherImages;
    const askCommentImages = await sanitizeAskImages(
      pick("askCommentImages"),
      design,
      posts,
      "askCommentImages",
    );
    if (typeof askCommentImages === "string") return askCommentImages;
    for (const askId of Object.keys(otherImages)) others[askId] ??= "";
    for (const askId of Object.keys(askCommentImages)) askComments[askId] ??= "";
    for (const askId of Object.keys(others)) {
      const ask = askById(design, posts, askId);
      if (!ask?.multi && answers[askId] !== undefined) return `ask "${askId}" takes one answer`;
    }
    const versionN = Number(pick("version"));
    const version =
      Number.isInteger(versionN) && versionN > 0
        ? versionN
        : Math.max(1, ...posts.map((p) => p.version));
    return {
      version,
      answers,
      borrowed,
      tuned: tuned.value,
      comments,
      others,
      askComments,
      ...(Object.keys(otherImages).length ? { otherImages } : {}),
      ...(Object.keys(askCommentImages).length ? { askCommentImages } : {}),
      updatedAt: new Date().toISOString(),
    };
  }

  const viewerOnly = () => fail(403, "only the viewer can do this");

  async function getDraftFlow(ref: unknown, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    return ok({ draft: design.draft });
  }

  async function putDraftFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const draft = await sanitizeDraft(body, design, posts, null);
    if (typeof draft === "string") return fail(400, draft);
    await store.putDraft(design.id, draft);
    bus.broadcast({ type: "draft-updated", designId: design.id });
    return ok({ draft });
  }

  async function deleteDraftFlow(ref: unknown, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    await store.putDraft(design.id, null);
    bus.broadcast({ type: "draft-updated", designId: design.id });
    return ok({ draft: null });
  }

  function sanitizeVerdict(
    raw: any,
    design: Design,
    posts: Post[],
  ): ReplyVerdict | string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const kind = raw.kind;
    if (kind !== "use" && kind !== "revise") return 'verdict.kind must be "use" or "revise"';
    const chosen = chooseVariant(design, posts, stateArg(raw.state), str(raw.variant, MAX_LABEL));
    if (isResult(chosen)) return chosen.body.error as string;
    return { kind, state: chosen.state, variant: chosen.variant };
  }

  // Which variants a reply puts in use and archives. A variant-bound answer puts
  // the chosen variant(s) in use in every state the ask covers and archives
  // their siblings there; a part-scoped pick is a borrow, not a verdict. The
  // built-in variant questions flip the same way, per state. Each variant is put
  // in use at the version the reply was made on (`version`, a design version), not
  // whatever the agent published since — or, for a version option, at its version.
  function replyFlips(
    design: Design,
    posts: Post[],
    answers: Record<string, AskAnswer>,
    verdict: ReplyVerdict | undefined,
    version: number,
  ): { accept: Map<string, number>; archive: Set<string> } {
    const accept = new Map<string, number>();
    const archive = new Set<string>();
    const settle = (inState: Post[], chosen: Set<string>, pins?: Map<string, number>) => {
      if (!inState.some((p) => chosen.has(p.variant))) return;
      for (const p of inState) {
        if (!chosen.has(p.variant)) {
          if (isLive(p.status)) archive.add(p.id);
          continue;
        }
        const pin = pins?.get(p.variant);
        // A version option outranks a looser pick of the same variant (the
        // built-in Which variant?, or the agent's own variant question) in the
        // same reply.
        if (pin === undefined && accept.has(p.id)) continue;
        // A pinned version history retention has since dropped falls back to
        // what the stage showed, rather than pinning one nothing can render.
        accept.set(p.id, pin !== undefined && postAtVersion(p, pin) ? pin : versionAt(p, version));
      }
    };
    const builtins = Object.keys(answers)
      .filter((id) => !design.asks.some((a) => a.id === id))
      .flatMap((id) => builtinAsk(design, posts, id) ?? []);
    for (const ask of [...design.asks, ...builtins]) {
      const answer = answers[ask.id];
      if (answer === undefined || ask.scope === "part") continue;
      const ids = Array.isArray(answer) ? answer : [answer];
      const picked = ask.options.filter((o) => ids.includes(o.id) && o.variant);
      const pinned = picked.filter((o) => o.version !== undefined);
      if (pinned.length) {
        const state = optionState(ask, design);
        settle(
          posts.filter((p) => p.state === state),
          new Set(pinned.map((o) => o.variant!)),
          new Map(pinned.map((o) => [o.variant!, o.version!])),
        );
      }
      const chosen = new Set(picked.filter((o) => o.version === undefined).map((o) => o.variant!));
      if (chosen.size === 0) continue;
      const states =
        ask.scope === "state" ? [ask.state ?? null] : design.states.length ? design.states : [null];
      for (const state of states)
        settle(
          posts.filter((p) => p.state === state),
          chosen,
        );
    }
    if (verdict?.kind === "use") {
      settle(
        posts.filter((p) => p.state === verdict.state),
        new Set([verdict.variant]),
      );
    }
    for (const id of accept.keys()) archive.delete(id);
    return { accept, archive };
  }

  // An ask as a reply leaves it. A pick or a write-in replaces whatever was
  // answered before; a comment alone keeps that answer and adds to it.
  function sentAsk(a: Ask, draft: Draft): Ask {
    const answer = draft.answers[a.id];
    const other = draft.others?.[a.id];
    const comment = draft.askComments?.[a.id];
    if (answer === undefined && other === undefined && comment === undefined) return a;
    const next: Ask = { ...a };
    delete next.dismissed;
    if (answer !== undefined || other !== undefined) {
      delete next.answer;
      delete next.other;
      delete next.otherImages;
      if (answer !== undefined) next.answer = answer;
      if (other !== undefined) next.other = other;
      const images = draft.otherImages?.[a.id];
      if (other !== undefined && images) next.otherImages = images;
      // A comment qualified the answer it was written on, not this one.
      delete next.comment;
      delete next.commentImages;
    }
    if (comment !== undefined) {
      next.comment = comment;
      delete next.commentImages;
      const images = draft.askCommentImages?.[a.id];
      if (images) next.commentImages = images;
    }
    return next;
  }

  // Send: the user's one batched answer becomes one kind:"reply" comment on the
  // design's session, delivered through the same cursor as everything else. The
  // draft is cleared and statuses flip in the same store transaction.
  async function replyFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const draft = await sanitizeDraft(body ?? {}, design, posts, design.draft);
    if (typeof draft === "string") return fail(400, draft);
    const text = str(body?.text, MAX_COMMENT_TEXT);
    const verdict = sanitizeVerdict(body?.verdict, design, posts);
    if (typeof verdict === "string") return fail(400, verdict);
    const empty =
      !text &&
      !verdict &&
      !Object.keys(draft.answers).length &&
      !Object.keys(draft.borrowed).length &&
      !Object.keys(draft.tuned).length &&
      !draft.comments.length &&
      !Object.keys(draft.others ?? {}).length &&
      !Object.keys(draft.askComments ?? {}).length;
    if (empty) return fail(400, "nothing to send");
    const sessionId = await replySessionId(design, posts);
    if (!sessionId) return fail(409, `${design.slug} has no agent session to reply to`);
    const payload: Reply = {
      designId: design.id,
      version: draft.version,
      answers: draft.answers,
      borrowed: draft.borrowed,
      tuned: draft.tuned,
      comments: draft.comments,
      ...(Object.keys(draft.others ?? {}).length ? { others: draft.others } : {}),
      ...(Object.keys(draft.askComments ?? {}).length ? { askComments: draft.askComments } : {}),
      ...(draft.otherImages ? { otherImages: draft.otherImages } : {}),
      ...(draft.askCommentImages ? { askCommentImages: draft.askCommentImages } : {}),
      ...(text ? { text } : {}),
    };
    const asks = design.asks.map((a) => sentAsk(a, draft));
    const flips = replyFlips(design, posts, draft.answers, verdict, draft.version);
    if (verdict) {
      const target = posts.find((p) => p.state === verdict.state && p.variant === verdict.variant);
      const pinned = verdict.kind === "use" && target ? flips.accept.get(target.id) : undefined;
      payload.verdict = pinned === undefined ? verdict : { ...verdict, version: pinned };
    }
    const comment = await store.commitReply({
      designId: design.id,
      sessionId,
      text: text ?? "",
      payload,
      asks,
      accept: [...flips.accept].map(([id, version]) => ({ id, version })),
      archive: [...flips.archive],
    });
    if (!comment) return fail(409, `${design.slug} has no agent session to reply to`);
    announceComment(comment);
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    bus.broadcast({ type: "draft-updated", designId: design.id });
    void announceEmbedders(design).catch((err) => console.warn("[mockpit] embedders", err));
    const after = await store.listPosts({ designId: design.id });
    for (const p of after) {
      if (flips.accept.has(p.id) || flips.archive.has(p.id)) {
        bus.broadcast({
          type: "post-updated",
          id: p.id,
          designId: design.id,
          sessionId: p.sessionId,
          version: p.version,
          by: "user",
        });
      }
    }
    fireNotify({
      event: "decision",
      project: design.project,
      slug: design.slug,
      variant: verdict?.variant ?? "",
      version: draft.version,
      text: text || verdict?.kind || "reply",
      url: designUrl(ctx.base, design),
    });
    const [delivered] = await withDelivered([comment]);
    return ok(
      {
        reply: delivered,
        inUse: after
          .filter((p) => flips.accept.has(p.id))
          .map((p) => ({ state: p.state, variant: p.variant, version: inUseVersion(p) })),
        archived: after
          .filter((p) => flips.archive.has(p.id))
          .map((p) => ({ state: p.state, variant: p.variant })),
      },
      201,
    );
  }

  // "Use this": the user puts one exact version of a variant in use. It
  // archives the variant's live siblings in that state and reaches the agent
  // once, as a reply carrying the verdict, through the same cursor as a Send;
  // the user's unsent draft is left for their next Send.
  async function useFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const chosen = chooseVariant(
      design,
      posts,
      stateArg(body?.state),
      str(body?.variant, MAX_LABEL),
    );
    if (isResult(chosen)) return chosen;
    const version = Number(body?.version);
    if (!Number.isInteger(version) || version < 1) {
      return fail(400, '"version" must be a positive integer');
    }
    if (!postAtVersion(chosen, version)) {
      return fail(404, `${chosen.variant} has no version ${version}`, {
        versions: [chosen.version, ...chosen.history.map((h) => h.version)],
      });
    }
    const inUse = { state: chosen.state, variant: chosen.variant, version };
    if (chosen.status === "accepted" && chosen.acceptedVersion === version) {
      return ok({ reply: null, inUse, archived: [] });
    }
    const sessionId = await replySessionId(design, posts);
    if (!sessionId) return fail(409, `${design.slug} has no agent session to reply to`);
    const archive = posts.filter(
      (p) => p.state === chosen.state && p.id !== chosen.id && isLive(p.status),
    );
    const comment = await store.commitReply({
      designId: design.id,
      sessionId,
      text: "",
      payload: {
        designId: design.id,
        version,
        answers: {},
        borrowed: {},
        tuned: {},
        comments: [],
        verdict: { kind: "use", ...inUse },
      },
      asks: design.asks,
      accept: [{ id: chosen.id, version }],
      archive: archive.map((p) => p.id),
      keepDraft: true,
    });
    if (!comment) return fail(409, `${design.slug} has no agent session to reply to`);
    announceComment(comment);
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    void announceEmbedders(design).catch((err) => console.warn("[mockpit] embedders", err));
    for (const p of [chosen, ...archive]) {
      bus.broadcast({
        type: "post-updated",
        id: p.id,
        designId: design.id,
        sessionId: p.sessionId,
        version: p.version,
        by: "user",
      });
    }
    fireNotify({
      event: "decision",
      project: design.project,
      slug: design.slug,
      variant: chosen.variant,
      version,
      text: "use",
      url: designUrl(ctx.base, design),
    });
    const [delivered] = await withDelivered([comment]);
    return ok(
      {
        reply: delivered,
        inUse,
        archived: archive.map((p) => ({ state: p.state, variant: p.variant })),
      },
      201,
    );
  }

  // The user hides one version of a variant from the history, or brings it
  // back; an agent asked to tidy up hides through `move`. Hidden, not removed: replies and embeds may point at it, so it still
  // renders by URL. The version in use can't be hidden, nor a state's last.
  async function hideFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    if (typeof body?.hidden !== "boolean") return fail(400, '"hidden" must be true or false');
    const posts = await store.listPosts({ designId: design.id });
    const chosen = chooseVariant(
      design,
      posts,
      stateArg(body?.state),
      str(body?.variant, MAX_LABEL),
    );
    if (isResult(chosen)) return chosen;
    const version = Number(body?.version);
    if (!Number.isInteger(version) || version < 1) {
      return fail(400, '"version" must be a positive integer');
    }
    if (!postAtVersion(chosen, version)) {
      return fail(404, `${chosen.variant} has no version ${version}`);
    }
    if (body.hidden) {
      if (chosen.status === "accepted" && inUseVersion(chosen) === version) {
        return fail(409, `v${version} of ${chosen.variant} is in use; use another version first`);
      }
      const visible = posts
        .filter((p) => p.state === chosen.state)
        .flatMap((p) => [p.version, ...p.history.map((h) => h.version)].map((v) => [p, v] as const))
        .filter(([p, v]) => !(p.hiddenVersions ?? []).includes(v));
      if (visible.length === 1 && visible[0][0].id === chosen.id && visible[0][1] === version) {
        return fail(409, "the last visible version can't be hidden");
      }
    }
    const updated = await store.setVersionHidden(chosen.id, version, body.hidden);
    if (!updated) return fail(404, "variant not found");
    bus.broadcast({
      type: "post-updated",
      id: updated.id,
      designId: design.id,
      sessionId: updated.sessionId,
      version: updated.version,
      by: "user",
    });
    // An embed following this variant passes over a version the user hid.
    void announceEmbedders(design).catch((err) => console.warn("[mockpit] embedders", err));
    return ok({
      state: updated.state,
      variant: updated.variant,
      version,
      hidden: body.hidden,
    });
  }

  // What the user last wrote about a design, to keep as why it was archived: the comment on the
  // draft they were still writing, else on their last reply, unless a version has
  // answered that since.
  async function reasonFromNote(design: Design, posts: Post[]): Promise<string | null> {
    const lastWords = (r: { text?: string; askComments?: Record<string, string> }) =>
      r.text?.trim() ||
      Object.values(r.askComments ?? {})
        .map((n) => n.trim())
        .filter(Boolean)
        .at(-1) ||
      null;
    const drafted = design.draft && lastWords(design.draft);
    if (drafted) return drafted.slice(0, MAX_REASON);
    const replies = (await replyComments(design.id)).filter((c) => !c.payload?.archived);
    const last = replies.at(-1);
    if (!last?.payload || posts.some((p) => p.updatedAt > last.createdAt)) return null;
    const said = lastWords({ ...last.payload, text: last.text });
    return said ? said.slice(0, MAX_REASON) : null;
  }

  // The user ends a design: it leaves the working shelf and its open asks stop counting.
  // The agent isn't told and nothing is refused: it reads `archivedAt` as information,
  // and a question it asks brings the design back. An unsent draft stays with the design
  // for its Undo; what was already sent stays on the cursor, undisturbed.
  async function archiveDesignFlow(ref: unknown, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    if (design.archivedAt) {
      return ok({ design: designSummaryView(design, posts), reason: design.archiveReason });
    }
    const reason = await reasonFromNote(design, posts);
    const updated = await store.updateDesign(design.id, {
      asks: design.asks.map((a): Ask => (askAnswered(a) ? a : { ...a, dismissed: true })),
      archivedAt: new Date().toISOString(),
      archiveReason: reason,
    });
    if (!updated) return fail(404, "design not found");
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    return ok({ design: designSummaryView(updated, posts), reason });
  }

  // Back from the archive: the asks it dismissed are open again, and an answer
  // given now reaches the agent as a normal Send. With every variant archived, ending
  // it isn't what keeps it off the shelf, so they all come back too. `undo` is what
  // puts it exactly where it was, day included.
  async function restoreDesignFlow(ref: unknown, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const nothingLive = posts.length > 0 && !posts.some((p) => isLive(p.status));
    if (!design.archivedAt && !nothingLive) return ok({ design: designSummaryView(design, posts) });
    const undo = {
      archivedAt: design.archivedAt,
      archiveReason: design.archiveReason,
      dismissed: design.asks.filter((a) => a.dismissed).map((a) => a.id),
      variants: nothingLive
        ? posts.map((p) => ({
            id: p.id,
            archivedAt: p.archivedAt ?? design.updatedAt,
            reason: p.archiveReason ?? null,
          }))
        : [],
    };
    const asks = design.asks.map(({ dismissed: _, ...a }) => a);
    const updated = await store.updateDesign(design.id, { asks, archivedAt: null });
    if (!updated) return fail(404, "design not found");
    if (nothingLive) for (const post of posts) await setStatus(design, post, "open");
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    return ok({
      design: designSummaryView(updated, await store.listPosts({ designId: design.id })),
      undo,
    });
  }

  // The Undo of a restore: back to what restoreDesignFlow's `undo` says it was. A design the
  // agent has archived or removed since is left as it is.
  async function rearchiveFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const when = (v: unknown) => {
      const text = str(v, 40);
      return text && !Number.isNaN(Date.parse(text)) ? text : null;
    };
    const posts = new Map(
      (await store.listPosts({ designId: design.id })).map((p): [string, Post] => [p.id, p]),
    );
    const given: any[] = Array.isArray(body?.variants) ? body.variants : [];
    for (const v of given) {
      const post = posts.get(v?.id);
      if (!post || !isLive(post.status)) continue;
      const updated = await store.setPostArchived(
        post.id,
        when(v.archivedAt) ?? new Date().toISOString(),
        str(v.reason, MAX_REASON) ?? null,
      );
      if (updated) {
        bus.broadcast({
          type: "post-updated",
          id: updated.id,
          designId: design.id,
          sessionId: updated.sessionId,
          version: updated.version,
          by: "user",
        });
      }
    }
    const dismissed = new Set<unknown>(Array.isArray(body?.dismissed) ? body.dismissed : []);
    const updated = await store.updateDesign(design.id, {
      asks: design.asks.map((a): Ask => (dismissed.has(a.id) ? { ...a, dismissed: true } : a)),
      archivedAt: when(body?.archivedAt),
      archiveReason: str(body?.archiveReason, MAX_REASON) ?? null,
    });
    if (!updated) return fail(404, "design not found");
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    return ok({ design: designSummaryView(updated, [...posts.values()]) });
  }

  // The user says why something went, or rewords it: on an archived design, or with a
  // variant, on an archived variant. Information only, read back in `read`.
  async function reasonFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const reason = str(body?.reason, MAX_REASON) ?? null;
    if (body?.variant === undefined) {
      // Every variant archived is as gone as archived, and sits beside it in the Archive.
      const posts = await store.listPosts({ designId: design.id });
      const gone = design.archivedAt || (posts.length > 0 && !posts.some((p) => isLive(p.status)));
      if (!gone) return fail(409, `${design.slug} is not archived`);
      await store.updateDesign(design.id, { archiveReason: reason });
      bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
      return ok({ reason });
    }
    const posts = await store.listPosts({ designId: design.id });
    const chosen = chooseVariant(
      design,
      posts,
      stateArg(body?.state),
      str(body?.variant, MAX_LABEL),
    );
    if (isResult(chosen)) return chosen;
    if (isLive(chosen.status)) return fail(409, `${chosen.variant} is not archived`);
    const updated = await store.setPostReason(chosen.id, reason);
    if (!updated) return fail(404, "variant not found");
    bus.broadcast({
      type: "post-updated",
      id: updated.id,
      designId: design.id,
      sessionId: updated.sessionId,
      version: updated.version,
      by: "user",
    });
    return ok({ reason });
  }

  // What the user says about a state a declared screen doesn't have: it doesn't apply,
  // or they've asked for it (the asking itself is a normal reply). null takes that back.
  // Dismissing a state only the agent planned also takes it out of the list, since
  // nothing is drawn there to lose.
  async function outlineFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const state = str(body?.state, MAX_LABEL);
    if (!state) return fail(400, '"state" must name the state');
    const to: unknown = body?.to;
    if (to !== "dismissed" && to !== "requested" && to !== null) {
      return fail(400, '"to" must be "dismissed", "requested" or null');
    }
    const { [state]: _, ...rest } = design.stateOutlines;
    if (to !== null && Object.keys(rest).length >= MAX_STATE_OUTLINES) {
      return fail(400, `${design.slug} already has ${MAX_STATE_OUTLINES} of these`);
    }
    const stateOutlines: Record<string, StateOutline> =
      to === null ? rest : { ...rest, [state]: to };
    const posts = await store.listPosts({ designId: design.id });
    const undrawn =
      to === "dismissed" && design.states.includes(state) && !posts.some((p) => p.state === state);
    const updated = await store.updateDesign(design.id, {
      stateOutlines,
      ...(undrawn ? { states: design.states.filter((st) => st !== state) } : {}),
    });
    if (!updated) return fail(404, "design not found");
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    return ok({ stateOutlines });
  }

  // The user looked at a newer version of what's in use and keeps what they have.
  // Nothing moves and nobody is told: it only stops asking until a newer one comes.
  async function stayFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const chosen = chooseVariant(
      design,
      posts,
      stateArg(body?.state),
      str(body?.variant, MAX_LABEL),
    );
    if (isResult(chosen)) return chosen;
    if (chosen.status !== "accepted") return fail(409, `${chosen.variant} is not in use`);
    const updated = await store.setPostStayed(chosen.id, chosen.version);
    if (!updated) return fail(404, "variant not found");
    bus.broadcast({
      type: "post-updated",
      id: updated.id,
      designId: design.id,
      sessionId: updated.sessionId,
      version: updated.version,
      by: "user",
    });
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    return ok({ state: updated.state, variant: updated.variant, version: inUseVersion(updated) });
  }

  async function restoreFlow(ref: unknown, body: any): Promise<FlowResult> {
    const design = await resolveDesign(ref, body?.project);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const chosen = chooseVariant(
      design,
      posts,
      stateArg(body?.state),
      str(body?.variant, MAX_LABEL),
    );
    if (isResult(chosen)) return chosen;
    const updated = await setStatus(design, chosen, "open");
    if (!updated) return fail(404, "variant not found");
    return ok({
      state: updated.state,
      variant: updated.variant,
      status: variantStatus(updated.status),
    });
  }

  // Not by "agent", even when an agent's move did it: that would notify once per
  // design, and the move's one Thread line already says it.
  async function setStatus(design: Design, post: Post, status: "open" | "archived") {
    const updated = await store.setPostStatus(post.id, status);
    if (!updated) return null;
    bus.broadcast({
      type: "post-updated",
      id: updated.id,
      designId: design.id,
      sessionId: updated.sessionId,
      version: updated.version,
      by: "user",
    });
    return updated;
  }

  // A pick of a design that just left: it would hold the stage on the version the
  // draft was made on, and Send would put in use something nobody can see. Only
  // those picks go; whatever the user wrote stays.
  async function dropStalePicks(design: Design): Promise<void> {
    const draft = (await store.getDesign(design.id))?.draft;
    if (!draft) return;
    const posts = await store.listPosts({ designId: design.id });
    const answers: Record<string, AskAnswer> = {};
    for (const [askId, value] of Object.entries(draft.answers)) {
      const ask = askById(design, posts, askId);
      const here = (variant: string) =>
        posts.some(
          (p) =>
            p.variant === variant &&
            isLive(p.status) &&
            (ask?.state === undefined || p.state === ask.state),
        );
      const stays = (id: string) => {
        const variant = ask?.options.find((o) => o.id === id)?.variant;
        return !variant || here(variant);
      };
      if (Array.isArray(value)) {
        const kept = value.filter(stays);
        if (kept.length) answers[askId] = kept;
      } else if (stays(value)) {
        answers[askId] = value;
      }
    }
    if (Object.keys(answers).length === Object.keys(draft.answers).length) return;
    const next = { ...draft, answers, updatedAt: new Date().toISOString() };
    const nothing =
      Object.keys(answers).length === 0 &&
      Object.keys(draft.borrowed).length === 0 &&
      Object.keys(draft.tuned).length === 0 &&
      draft.comments.length === 0 &&
      Object.keys(draft.others ?? {}).length === 0 &&
      Object.keys(draft.askComments ?? {}).length === 0;
    await store.putDraft(design.id, nothing ? null : next);
    bus.broadcast({ type: "draft-updated", designId: design.id });
  }

  // The user archives a variant they're done with, short of choosing another:
  // Studio's × on its last version. Restore is the way back. The variant in
  // use stays, because archiving it would leave the state with nothing chosen
  // and no reply saying why.
  async function archiveFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const chosen = chooseVariant(
      design,
      posts,
      stateArg(body?.state),
      str(body?.variant, MAX_LABEL),
    );
    if (isResult(chosen)) return chosen;
    if (variantStatus(chosen.status) === "inUse") return fail(409, `${chosen.variant} is in use`);
    const updated = await setStatus(design, chosen, "archived");
    if (!updated) return fail(404, "variant not found");
    await dropStalePicks(design);
    return ok({
      state: updated.state,
      variant: updated.variant,
      status: variantStatus(updated.status),
    });
  }

  // The user stars (or unstars) a variant: a favourite to come back to, which
  // decides nothing. Viewer-only; the agent reads it as `starred`.
  async function starFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    if (typeof body?.starred !== "boolean") return fail(400, '"starred" must be true or false');
    const posts = await store.listPosts({ designId: design.id });
    const chosen = chooseVariant(
      design,
      posts,
      stateArg(body?.state),
      str(body?.variant, MAX_LABEL),
    );
    if (isResult(chosen)) return chosen;
    const updated = await store.setPostStarred(chosen.id, body.starred);
    if (!updated) return fail(404, "variant not found");
    bus.broadcast({
      type: "post-updated",
      id: updated.id,
      designId: design.id,
      sessionId: updated.sessionId,
      version: updated.version,
      by: "user",
    });
    bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
    return ok({ state: updated.state, variant: updated.variant, starred: !!updated.starred });
  }

  // The user copies a version into an idea they are gathering (stored as a shortlist,
  // the word `read` still carries), or into any other design or state of the project. It stays a copy of that one version, so its original and that
  // design's decisions stay as they were, and an agent iterates on it like any other
  // variant.
  async function shortlistsFlow(project: string): Promise<FlowResult> {
    const designs = (await store.listDesigns(project)).filter((m) => m.shortlist && !m.archivedAt);
    designs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // One design at a time: every open design screen calls this, and a project's
    // heads are far more than its few shortlists need.
    const shortlists = [];
    for (const m of designs) {
      const posts = await store.listPosts({ designId: m.id });
      shortlists.push({
        id: m.id,
        slug: m.slug,
        title: m.title,
        candidates: posts
          .filter((p) => isLive(p.status))
          .map((p) => ({ variant: p.variant, copiedFrom: p.copiedFrom ?? null })),
      });
    }
    return ok({ shortlists, copies: await store.listCopies(project) });
  }

  async function uniqueSlug(project: string, wanted: string): Promise<string> {
    const base = slugify(wanted) || "idea";
    let slug = base;
    for (let n = 2; await store.findDesign(project, slug); n++) slug = `${base}-${n}`;
    return slug;
  }

  // Not announcePost: a shortlist embeds nothing new, and finding what embeds a
  // design reads every post in the project before the response can leave.
  function announceCopy(list: Design, post: Post, created: boolean) {
    bus.broadcast({
      type: created ? "post-created" : "post-updated",
      id: post.id,
      designId: list.id,
      sessionId: post.sessionId,
      version: post.version,
      by: "user",
    });
  }

  // A copy's name, which must not take another candidate's. Two labs can share
  // a name, and two versions of one variant are two candidates.
  function candidateName(wanted: string, version: number, origin: Design, taken: Set<string>) {
    // A live "default" is what a component shows wherever it is embedded, so a copy
    // must not take that name just by arriving first.
    const name = wanted === DEFAULT_VARIANT ? origin.title : wanted;
    const tries = [name, `${name} #${version}`, `${name} (${origin.title})`];
    const free = tries.find((t) => !taken.has(t));
    if (free) return free;
    let n = 2;
    while (taken.has(`${tries[2]} ${n}`)) n++;
    return `${tries[2]} ${n}`;
  }

  async function saveCopiesFlow(body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    return copyCandidates(body);
  }

  async function copyCandidates(body: any): Promise<FlowResult> {
    const picks: any[] = Array.isArray(body?.candidates) ? body.candidates : [];
    if (picks.length === 0) return fail(400, 'provide "candidates": the versions to save');
    if (picks.length > MAX_CANDIDATES) {
      return fail(400, `save at most ${MAX_CANDIDATES} candidates at once`);
    }
    const origins = [];
    for (const pick of picks) {
      const design = await resolveDesign(pick?.design);
      if (isResult(design)) return design;
      const posts = await store.listPosts({ designId: design.id });
      const post = chooseVariant(
        design,
        posts,
        stateArg(pick?.state),
        str(pick?.variant, MAX_LABEL),
      );
      if (isResult(post)) return post;
      const version = Number.isInteger(pick?.version) ? (pick.version as number) : post.version;
      const surfaces =
        version === post.version
          ? post.surfaces
          : post.history.find((h) => h.version === version)?.surfaces;
      if (!surfaces) return fail(404, `${post.variant} has no version ${version}`);
      origins.push({ design, post, version, surfaces });
    }
    const first = origins[0].design;
    const project = first.project;
    if (origins.some((o) => o.design.project !== project)) {
      return fail(400, "copy within one project");
    }

    let list: Design | undefined;
    if (body.to !== undefined && body.to !== null) {
      const named = await resolveDesign(body.to, project);
      if (isResult(named)) return named;
      if (named.project !== project) return fail(400, "copy within one project");
      list = named;
    } else {
      const title = str(body.title, MAX_LABEL)?.trim();
      if (!title) return fail(400, 'provide "to" or "title": where to gather them');
      // The same name again means the same list, not a second one beside it.
      list = titledDesigns(await store.listDesigns(project), slugify(title)).find(
        (m) => m.shortlist,
      );
      if (!list) {
        list = await store.createDesign({
          project,
          slug: await uniqueSlug(project, title),
          title,
          kind: "idea",
          area: first.area,
          widths: first.widths,
          shortlist: true,
        });
        bus.broadcast({ type: "design-created", id: list.id, project });
      }
    }
    // A shortlist is flat; anywhere else the copy lands in a state the design has.
    const state = list.shortlist ? null : (stateArg(body.state) ?? null);
    if (body.newState && state !== null && !list.shortlist && !list.states.includes(state)) {
      // Named states would hide what a flat design already holds under no name.
      const flat = (await store.listPosts({ designId: list.id })).some((p) => p.state === null);
      if (flat) return fail(400, `${list.slug} has no states; move without "toState"`);
      list = (await store.updateDesign(list.id, { states: [...list.states, state] })) ?? list;
    }
    if (state === null ? !list.shortlist && list.states.length > 0 : !list.states.includes(state)) {
      return fail(400, `${list.slug} has no such state`, { states: list.states });
    }
    const target = list;
    if (origins.some((o) => o.design.id === target.id && o.post.state === state)) {
      return fail(400, `already in ${target.title}`);
    }
    if (list.archivedAt) list = (await store.updateDesign(list.id, { archivedAt: null })) ?? list;

    const posts = (await store.listPosts({ designId: list.id })).filter((p) => p.state === state);
    const taken = new Set(posts.map((p) => p.variant));
    const saved: { state: string | null; variant: string; already: boolean }[] = [];
    const copies: { from: (typeof origins)[number]; copy: Post }[] = [];
    for (const origin of origins) {
      const { design, post, version, surfaces } = origin;
      const same = posts.find(
        (p) =>
          p.copiedFrom?.design === design.id &&
          p.copiedFrom.state === post.state &&
          p.copiedFrom.variant === post.variant &&
          p.copiedFrom.version === version,
      );
      if (same) {
        copies.push({ from: origin, copy: same });
        saved.push({ state, variant: same.variant, already: isLive(same.status) });
        if (isLive(same.status)) continue;
        const back = await store.setPostStatus(same.id, "open");
        if (back) {
          posts[posts.indexOf(same)] = back;
          announceCopy(list, back, false);
        }
        continue;
      }
      const knobs = { ...design.knobs, ...post.knobs };
      // A shortlist can't loop, since nothing embeds it. A real design can.
      const embeds = await publishEmbeds(project, list.slug, surfaces);
      if (isResult(embeds)) return embeds;
      const created = await store.createPost({
        sessionId: post.sessionId,
        design: list.id,
        state,
        variant: candidateName(post.variant, version, design, taken),
        title: list.title,
        surfaces,
        ...(Object.keys(knobs).length ? { knobs } : {}),
        ...(post.description ? { description: post.description } : {}),
        embeds,
        copiedFrom: { design: design.id, state: post.state, variant: post.variant, version },
      });
      if (!created) return fail(409, `${post.variant} has no agent session to copy it under`);
      copies.push({ from: origin, copy: created });
      posts.push(created);
      taken.add(created.variant);
      saved.push({ state, variant: created.variant, already: false });
      if (list.shortlist) announceCopy(list, created, true);
      else announcePost(list, created, true, "user");
    }
    // A group stays a group where it lands: a variation hangs under its lead's copy,
    // whether that came along now or was saved here before.
    for (const { from, copy } of copies) {
      const lead = from.post.forkedFrom;
      if (!lead || copy.forkedFrom) continue;
      const under = posts.find(
        (p) =>
          isLive(p.status) &&
          p.copiedFrom?.design === from.design.id &&
          p.copiedFrom.state === from.post.state &&
          p.copiedFrom.variant === lead.variant &&
          p.copiedFrom.version === lead.version,
      );
      if (!under) continue;
      const updated = await store.setForkedFrom(copy.id, {
        variant: under.variant,
        version: under.version,
      });
      if (updated) {
        bus.broadcast({
          type: "post-updated",
          id: updated.id,
          designId: list.id,
          sessionId: updated.sessionId,
          version: updated.version,
          by: "user",
        });
      }
    }
    bus.broadcast({ type: "design-updated", id: list.id, project });
    return ok({
      to: { id: list.id, slug: list.slug, title: list.title, shortlist: list.shortlist },
      saved,
    });
  }

  // Undo, or taking a save back. A copy nobody acted on leaves no trace, and a
  // shortlist left with nothing and no thread goes with it; anything else archives,
  // since a reply may still name it. Only ever a copy, or a shortlist's own: the
  // originals of a design leave through archive.
  async function removeCopyFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const posts = await store.listPosts({ designId: design.id });
    const post = chooseVariant(
      design,
      posts,
      stateArg(body?.state) ?? null,
      str(body?.variant, MAX_LABEL),
    );
    if (isResult(post)) return post;
    if (!design.shortlist && !post.copiedFrom) return fail(400, `${post.variant} is not a copy`);
    if (variantStatus(post.status) === "inUse") return fail(409, `${post.variant} is in use`);
    const thread = await store.listComments({ designId: design.id });
    // A real design's thread is about the rest of it too, so only what touched this
    // copy keeps it.
    const kept = design.shortlist
      ? design.draft || thread.some((c) => c.author === "user")
      : await touchedBy(design, post);
    if (post.history.length > 0 || kept) {
      return archiveFlow(design.id, { state: post.state, variant: post.variant }, ctx);
    }
    const gone = await store.withdrawVersion(post.id, post.version, []);
    if (!gone) return fail(409, `${post.variant} has a newer version`);
    dropPostRenders(post.id);
    bus.broadcast({
      type: "post-deleted",
      id: post.id,
      designId: design.id,
      sessionId: post.sessionId,
    });
    const empty = design.shortlist && posts.length === 1 && thread.length === 0;
    if (empty) {
      await store.removeDesign(design.id);
      bus.broadcast({ type: "design-deleted", id: design.id, project: design.project });
    } else {
      bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
      if (!design.shortlist) await announceEmbedders(design);
    }
    return ok({ removed: post.variant, shortlistGone: empty });
  }

  // The agent tidies up: variants go to another design or tab, out of sight, or back.
  // Nothing is destroyed, so the user can always undo it from Archived, and a variant
  // in use stays, since which design is in use is the user's call. A group moves
  // together, as it does when the user moves one.
  // Why one older version can't be deleted, if anything points at it. A reply or comment
  // made while it was the current one counts even when it names no version: it answered
  // what was on screen, and that picture is the record of what the user meant.
  async function deleteBlocker(
    design: Design,
    post: Post,
    version: number,
    siblings: Post[],
    comments: Comment[],
    elsewhere: { design: Design; posts: Post[] }[],
  ): Promise<string | null> {
    if (variantStatus(post.status) === "inUse" && inUseVersion(post) === version) return "in use";
    if (post.stayedVersion === version) return "the user chose to stay on it";
    const steps = post.history
      .map((h) => [h.version, h.at] as const)
      .concat([[post.version, post.updatedAt]])
      .sort((a, b) => a[0] - b[0]);
    const at = steps.findIndex(([v]) => v === version);
    const from = steps[at][1];
    const until = steps[at + 1]?.[1] ?? "￿";
    const during = (when: string) => when >= from && when < until;
    const inState = new Set(siblings.map((p) => p.id));

    for (const c of comments) {
      if (c.author !== "user") continue;
      if (c.kind === "reply") {
        const r = c.payload;
        if (!r || r.edited) continue;
        const names =
          (r.verdict?.variant === post.variant &&
            r.verdict.state === post.state &&
            r.verdict.version === version) ||
          r.comments.some(
            (x) => x.variant === post.variant && x.state === post.state && x.version === version,
          );
        if (names) return "a reply names it";
        if (during(c.createdAt) && speaksToState(r, design, post, siblings)) {
          return "the user replied while it was current";
        }
        continue;
      }
      const anchorVersion =
        c.anchor && "postVersion" in c.anchor ? c.anchor.postVersion : undefined;
      if (
        c.postId === post.id &&
        (c.postVersion === version ||
          anchorVersion === version ||
          c.anchors.some((a) => a.postVersion === version))
      ) {
        return "the user commented on it";
      }
      const anchored = c.anchor?.kind === "part" ? c.anchor.state : undefined;
      const other = c.postId
        ? !inState.has(c.postId)
        : anchored !== undefined && anchored !== post.state;
      if (!other && during(c.createdAt)) return "the user commented while it was current";
    }

    // A note on a question is about the question, so only picks and comments hold a version.
    const d = design.draft;
    if (d) {
      const here = d.comments.filter((x) => x.state === post.state);
      if (here.some((x) => x.variant === post.variant && x.version === version)) {
        return "the user's draft names it";
      }
      const holds =
        here.length > 0 || Object.keys(d.answers).length > 0 || Object.keys(d.borrowed).length > 0;
      if (holds && during(d.updatedAt)) return "the user's draft was made on it";
    }

    for (const ask of design.asks) {
      if (ask.state !== undefined && ask.state !== post.state) continue;
      if (ask.options.some((o) => o.variant === post.variant && o.version === version)) {
        return `question "${ask.id}" offers it`;
      }
    }
    const fork = siblings.find(
      (p) => p.forkedFrom?.variant === post.variant && p.forkedFrom.version === version,
    );
    if (fork) return `${fork.variant} was forked from it`;

    for (const { design: other, posts } of elsewhere) {
      for (const p of posts) {
        const copy = p.copiedFrom;
        if (
          copy?.design === design.id &&
          copy.state === post.state &&
          copy.variant === post.variant &&
          copy.version === version
        ) {
          return `copied to ${other.slug}`;
        }
        const embeds = p.embeds.some(
          (e) => e.slug === design.slug && e.variant === post.variant && e.version === version,
        );
        const pinned = [p, ...p.history].some((v) =>
          v.surfaces.some(
            (s) =>
              s.kind === "html" &&
              parseEmbedTags(s.html).some(
                (t) =>
                  t.slug === design.slug &&
                  t.version === version &&
                  (t.variant === null || t.variant === post.variant),
              ),
          ),
        );
        if (embeds || pinned) return `embedded in ${other.slug}`;
      }
    }
    return null;
  }

  // `move`'s tidying of versions rather than variants, only when the user asks for it.
  // Each variant keeps its latest, or its newest visible one if the user hid the latest,
  // so no variant is left with nothing to show.
  async function tidyVersionsFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    const deleting = body.deleteOlder === true;
    const given: unknown[] = Array.isArray(body.variants) ? body.variants : [];
    const names = [...new Set(given.flatMap((v) => str(v, MAX_LABEL) ?? []))];
    const target = await commentTarget({
      design: ref,
      project: body.project,
      session: body.session,
    });
    if (isResult(target)) return target;
    const { design, session } = target;
    const posts = await store.listPosts({ designId: design.id });
    const state = stateArg(body.state);
    const unknown = names.find((n) => !posts.some((p) => p.variant === n));
    if (unknown) return fail(404, `${design.slug} has no variant "${unknown}"`);
    const scope = posts.filter(
      (p) => (!names.length || names.includes(p.variant)) && (state == null || p.state === state),
    );

    const comments = deleting ? await store.listComments({ designId: design.id }) : [];
    const elsewhere = deleting
      ? await Promise.all(
          (await store.listDesigns(design.project))
            .filter((d) => d.id !== design.id)
            .map(async (d) => ({ design: d, posts: await store.listPosts({ designId: d.id }) })),
        )
      : [];

    const versions: { state: string | null; variant: string; version: number }[] = [];
    const skipped: { state: string | null; variant: string; version?: number; why: string }[] = [];
    const changed = new Set<string>();
    for (const post of scope) {
      if (!isLive(post.status)) {
        skipped.push({ state: post.state, variant: post.variant, why: "archived" });
        continue;
      }
      const hidden = post.hiddenVersions ?? [];
      const all = [post.version, ...post.history.map((h) => h.version)].sort((a, b) => b - a);
      const keep = all.find((v) => !hidden.includes(v)) ?? post.version;
      const older = all.filter((v) => v < keep);
      const siblings = posts.filter((p) => p.state === post.state);
      const going: number[] = [];
      for (const version of older) {
        const why = deleting
          ? await deleteBlocker(design, post, version, siblings, comments, elsewhere)
          : variantStatus(post.status) === "inUse" && inUseVersion(post) === version
            ? "in use"
            : hidden.includes(version)
              ? "already hidden"
              : null;
        if (why) skipped.push({ state: post.state, variant: post.variant, version, why });
        else going.push(version);
      }
      if (!going.length) continue;
      changed.add(post.id);
      if (deleting) {
        await store.deleteOldVersions(post.id, going);
        dropPostRenders(post.id);
      } else {
        for (const version of going) await store.setVersionHidden(post.id, version, true);
      }
      for (const version of going) {
        versions.push({ state: post.state, variant: post.variant, version });
      }
      bus.broadcast({
        type: "post-updated",
        id: post.id,
        designId: design.id,
        sessionId: post.sessionId,
        version: post.version,
        by: "agent",
      });
    }

    if (versions.length) {
      bus.broadcast({ type: "design-updated", id: design.id, project: design.project });
      const n = versions.length;
      const word = `older version${n === 1 ? "" : "s"}`;
      const line = deleting
        ? `Deleted ${n} ${word} of ${changed.size} ${changed.size === 1 ? "render" : "renders"}. This can't be undone.`
        : `Hid ${n} ${word} of ${changed.size} ${changed.size === 1 ? "render" : "renders"}. Studio brings them back.`;
      const comment = await store.createComment({
        sessionId: session.id,
        designId: design.id,
        postId: null,
        author: reservedAgent(session.agent),
        text: line,
        kind: "comment",
        anchors: [],
        postVersion: null,
        viewport: null,
      });
      if (comment) announceComment(comment);
    }
    return ok({
      variants: [],
      versions,
      skipped,
      url: designUrl(ctx.base, design),
      feedback: await feedbackFor(body.session, ctx.base),
    });
  }

  async function moveFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const given: unknown[] = Array.isArray(body.variants) ? body.variants : [];
    const names = [...new Set(given.flatMap((v) => str(v, MAX_LABEL) ?? []))];
    const tidying = body.hideOlder === true || body.deleteOlder === true;
    if (names.length === 0 && !tidying) return fail(400, 'provide "variants": which ones to move');
    if (names.length > MAX_CANDIDATES) {
      return fail(400, `move at most ${MAX_CANDIDATES} variants at once`);
    }
    const toState = stateArg(body.toState) ?? undefined;
    const moving = (body.to !== undefined && body.to !== null) || toState !== undefined;
    const actions = [
      moving,
      body.archive === true,
      body.restore === true,
      body.hideOlder === true,
      body.deleteOlder === true,
    ];
    if (actions.filter(Boolean).length !== 1) {
      return fail(
        400,
        'provide one of "to" or "toState", "archive", "restore", "hideOlder" or "deleteOlder"',
      );
    }
    if (tidying) return tidyVersionsFlow(ref, body, ctx);
    const target = await commentTarget({
      design: ref,
      project: body.project,
      session: body.session,
    });
    if (isResult(target)) return target;
    const { design, session } = target;
    const posts = await store.listPosts({ designId: design.id });
    const named: Post[] = [];
    for (const name of names) {
      const post = chooseVariant(design, posts, stateArg(body.state), name);
      if (isResult(post)) return post;
      named.push(post);
    }

    const skipped: { variant: string; why: string }[] = [];
    const changing: Post[] = [];
    const take = (post: Post) => {
      if (changing.includes(post)) return;
      if (body.restore === true ? isLive(post.status) : variantStatus(post.status) === "inUse") {
        skipped.push({
          variant: post.variant,
          why: body.restore === true ? "not archived" : "in use",
        });
        return;
      }
      if (body.archive === true && !isLive(post.status)) {
        skipped.push({ variant: post.variant, why: "already archived" });
        return;
      }
      changing.push(post);
      if (body.restore === true) return;
      for (const p of posts) {
        if (p.state === post.state && p.forkedFrom?.variant === post.variant && isLive(p.status)) {
          take(p);
        }
      }
    };
    for (const post of named) take(post);

    let to: { design: string; title: string; state: string | null } | undefined;
    let saved: unknown;
    let moved: Design = design;
    if (moving && changing.length) {
      const copied = await copyCandidates({
        candidates: changing.map((p) => ({
          design: design.id,
          state: p.state,
          variant: p.variant,
        })),
        to: body.to ?? design.id,
        state: toState,
        newState: true,
      });
      if (copied.status >= 400) return copied;
      const { slug, title, id } = copied.body.to;
      to = { design: slug, title, state: copied.body.saved[0]?.state ?? null };
      saved = copied.body.saved;
      moved = (await store.getDesign(id)) ?? design;
    }
    const done: { state: string | null; variant: string; status: string }[] = [];
    for (const post of changing) {
      const updated = await setStatus(design, post, body.restore === true ? "open" : "archived");
      if (updated) {
        done.push({
          state: updated.state,
          variant: updated.variant,
          status: variantStatus(updated.status),
        });
      }
    }
    if (done.length) {
      if (body.restore !== true) await dropStalePicks(design);
      void announceEmbedders(design).catch((err) => console.warn("[mockpit] embedders", err));
      const list = done.map((d) => d.variant).join(", ");
      const where = to ? `${to.title}${to.state === null ? "" : ` · ${to.state}`}` : "";
      const line = to
        ? `Moved ${done.length} to ${where}: ${list}`
        : `${body.restore === true ? "Restored" : "Archived"} ${done.length}: ${list}`;
      const comment = await store.createComment({
        sessionId: session.id,
        designId: design.id,
        postId: null,
        author: reservedAgent(session.agent),
        text: str(line, MAX_COMMENT_TEXT) ?? line,
        kind: "comment",
        anchors: [],
        postVersion: null,
        viewport: null,
      });
      if (comment) announceComment(comment);
    }
    return ok({
      variants: done,
      skipped,
      ...(to ? { to, saved } : {}),
      url: designUrl(ctx.base, moved),
      feedback: await feedbackFor(body.session, ctx.base),
    });
  }

  // D8 "restore as vN": the user brings an older version back as the newest
  // one. Distinct from restoreFlow, which un-archives a variant. Viewer-only
  // because the version is authored by the user; an agent restoring publishes.
  async function restoreVersionFlow(
    ref: unknown,
    postId: string,
    body: any,
    ctx: FlowContext,
  ): Promise<FlowResult> {
    if (!ctx.viewer) return viewerOnly();
    const design = await resolveDesign(ref);
    if (isResult(design)) return design;
    const post = await store.getPost(postId);
    if (!post || post.design !== design.id)
      return fail(404, `${design.slug} has no variant "${postId}"`);
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
    const touched = (await store.updateDesign(design.id, {})) ?? design;
    bus.broadcast({ type: "design-updated", id: touched.id, project: touched.project });
    announcePost(touched, updated, false, "user");
    return ok({
      state: updated.state,
      variant: updated.variant,
      version: updated.version,
      from: version,
    });
  }

  async function removeDesignFlow(ref: unknown, query: { project?: unknown }): Promise<FlowResult> {
    const design = await resolveDesign(ref, query.project);
    if (isResult(design)) return design;
    await store.removeDesign(design.id);
    bus.broadcast({ type: "design-deleted", id: design.id, project: design.project });
    return ok({ ok: true });
  }

  // A write's feedback for the session that made it, when it named one: an
  // edit needs no session, so without one there is no cursor to read from.
  const feedbackFor = async (session: unknown, base: string): Promise<FeedbackBatch[]> =>
    typeof session === "string" && session ? collectFeedback(session, base) : [];

  // `edit`: a design's own fields, without a new version. A new slug rewrites
  // every reference to the old one in the project (store.renameDesign), so pages
  // keep showing it and flows keep walking it.
  async function editDesignFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const given = ["slug", "title", "kind", "area", "source", "firstState", "notes"].filter(
      (k) => body[k] !== undefined,
    );
    if (given.length === 0) {
      return fail(
        400,
        'provide one of "slug", "title", "kind", "area", "source", "firstState" or "notes"',
      );
    }
    const design = await resolveDesign(ref, body.project, body.session);
    if (isResult(design)) return design;
    const slugIn = body.slug === undefined ? undefined : str(body.slug, MAX_TITLE);
    if (body.slug !== undefined && !slugIn)
      return fail(400, '"slug" must name the design, e.g. "onni"');
    const slug = slugIn === undefined ? undefined : slugify(slugIn);
    const title = str(body.title, MAX_TITLE);
    if (body.title !== undefined && !title) return fail(400, '"title" must be non-empty text');
    if (body.kind !== undefined && !isDesignKind(body.kind)) {
      return fail(400, '"kind" must be screen, component or idea');
    }
    const kind: DesignKind | undefined = body.kind;
    const area = labelArg(body, "area", MAX_LABEL);
    if (isResult(area)) return area;
    const source = labelArg(body, "source", MAX_SOURCE);
    if (isResult(source)) return source;

    const notesIn = notesArg(body.notes);
    if (isResult(notesIn)) return notesIn;
    // The user's words stand until they clear them, so a later draft can't quietly
    // undo a correction. The agent is told, and shown what stands.
    const notesKept = notesIn !== undefined && !ctx.viewer && design.notes?.by === "user";
    // Saved as it was isn't an edit: it mustn't take an agent's draft for the user's.
    const notesSame = notesIn === (design.notes?.text ?? "");
    const notes =
      notesIn === undefined || notesKept || notesSame
        ? undefined
        : notesIn
          ? {
              text: notesIn,
              by: ctx.viewer ? ("user" as const) : ("agent" as const),
              at: new Date().toISOString(),
            }
          : null;

    const firstState = body.firstState === undefined ? undefined : str(body.firstState, MAX_LABEL);
    if (body.firstState !== undefined && !firstState) {
      return fail(400, '"firstState" must name the state, e.g. "Moss ball"');
    }
    if (firstState !== undefined && design.states.length > 0) {
      return fail(409, `${design.slug} already has states`, { states: design.states });
    }

    const renaming = slug !== undefined && slug !== design.slug;
    if (renaming && (await store.findDesign(design.project, slug))) {
      return fail(409, `${design.project} already has a design "${slug}"; pick another slug`);
    }
    // Being embedded is what makes a design a component: an idea that is still
    // embedded would be promoted back on its embedder's next publish.
    if (kind === "idea" && design.kind !== "idea") {
      const embedders = await embeddersOf(design.project, design.slug);
      if (embedders.length) {
        return fail(
          409,
          `${design.slug} is embedded in ${embedders.map((m) => m.slug).join(", ")}; being embedded makes it a component. Take the embeds out first`,
          { embeddedIn: embedders.map((m) => m.slug) },
        );
      }
    }

    let next: Design = design;
    // The rename goes first: it is the part that can still lose a race for the slug.
    if (renaming) {
      const renamed = await store.renameDesign(design.id, slug);
      if (!renamed) return fail(409, `${design.project} already has a design "${slug}"`);
      next = renamed;
      clearRenderCache();
    }
    if (
      title !== undefined ||
      kind !== undefined ||
      area !== undefined ||
      source !== undefined ||
      notes !== undefined
    ) {
      next =
        (await store.updateDesign(design.id, {
          ...(title === undefined ? {} : { title }),
          ...(kind === undefined ? {} : { kind }),
          ...(area === undefined ? {} : { area }),
          ...(source === undefined ? {} : { source }),
          ...(notes === undefined ? {} : { notes }),
        })) ?? next;
    }
    if (firstState !== undefined) {
      next = (await store.nameFirstState(design.id, firstState)) ?? next;
    }
    bus.broadcast({ type: "design-updated", id: next.id, project: next.project });
    if (renaming) await announceEmbedders(next);
    if (ctx.viewer) await tellAgentEdited(design, next);

    // Flows are declared apart from kind, so a page that stops being one stays
    // in them until the agent takes it out.
    const nudges: string[] = [...titleNudges(title)];
    if (notesKept) {
      nudges.push(
        "The user edited these notes by hand, so your draft was not applied: work from theirs, in notes.text. They stand until the user clears them",
      );
    }
    if (kind !== undefined && kind !== "screen" && design.kind === "screen") {
      for (const f of await store.listFlows(next.project)) {
        if (!f.steps.some((x) => x.design === next.slug)) continue;
        nudges.push(
          `${next.slug} is still a step of flow "${f.name}"; publish it with flow "${f.name}" and step 0 to take it out`,
        );
      }
    }
    return ok({
      design: {
        id: next.id,
        project: next.project,
        slug: next.slug,
        title: next.title,
        kind: next.kind,
        ...placeOf(next),
        states: next.states,
      },
      ...(renaming ? { renamed: { from: design.slug, to: next.slug } } : {}),
      ...(notesIn === undefined
        ? {}
        : { notes: { applied: !notesKept, ...(notesKept ? { text: design.notes?.text } : {}) } }),
      url: designUrl(ctx.base, next),
      ...(nudges.length ? { nudges } : {}),
      feedback: await feedbackFor(body.session, ctx.base),
    });
  }

  // `notes`: plain text and short, since agents read all of it on every read of the
  // design. Refused rather than cut: a spec missing its end reads as a complete one.
  function notesArg(v: unknown): string | undefined | FlowResult {
    if (v === undefined) return undefined;
    if (typeof v !== "string") return fail(400, '"notes" must be plain text; "" clears them');
    const text = stripNul(v).trim();
    if (text.length > MAX_NOTES) {
      return fail(
        400,
        `notes are a short spec: at most ${MAX_NOTES} characters, got ${text.length}`,
      );
    }
    return text;
  }

  // The user moved a design from Home (another kind or area), or corrected its notes:
  // the agent hears it once, through the same cursor as a Send, on the session driving
  // the design. Nothing to tell when no agent has written it.
  async function tellAgentEdited(before: Design, after: Design): Promise<void> {
    const notes = after.notes?.text ?? null;
    const edited: DesignEdit = {
      ...(after.kind !== before.kind ? { kind: after.kind } : {}),
      ...(after.area !== before.area ? { area: after.area } : {}),
      ...(notes !== (before.notes?.text ?? null) ? { notes } : {}),
    };
    if (Object.keys(edited).length === 0) return;
    await tellAgentEdit(after, edited);
  }

  async function tellAgentEdit(after: Design, edited: DesignEdit): Promise<void> {
    const posts = await store.listPosts({ designId: after.id });
    const sessionId = await replySessionId(after, posts);
    if (!sessionId) return;
    const comment = await store.commitReply({
      designId: after.id,
      sessionId,
      text: "",
      payload: {
        designId: after.id,
        version: Math.max(1, ...posts.map((p) => p.version)),
        answers: {},
        borrowed: {},
        tuned: {},
        comments: [],
        edited,
      },
      asks: after.asks,
      accept: [],
      archive: [],
      keepDraft: true,
    });
    if (comment) announceComment(comment);
  }

  const areaOrderOf = async (project: string): Promise<string[]> => {
    const raw = await store.getSetting(`${AREA_ORDER_SETTING}:${project}`);
    if (!raw) return [];
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };

  // `areaOrder`: the areas in the order Home lists them; [] (or "") hands the
  // order back to the alphabet.
  function areaOrderArg(v: unknown): string[] | FlowResult {
    const list: unknown = typeof v === "string" ? v.split(",") : v;
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) {
      return fail(400, '"areaOrder" must be a list of area names, e.g. ["Shell", "Food"]');
    }
    const names = [...new Set((list as string[]).map((x) => stripNul(x).trim()).filter(Boolean))];
    if (names.length > MAX_AREAS) return fail(400, `"areaOrder" takes at most ${MAX_AREAS} areas`);
    if (names.some((x) => x.length > MAX_LABEL)) {
      return fail(400, `an area name is at most ${MAX_LABEL} characters`);
    }
    return names;
  }

  // `edit` on a project: a new name for it, carrying its designs, sessions,
  // flows and settings (refused onto a project that already has designs), and
  // the order Home lists its areas in.
  async function editProjectFlow(name: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const from = str(name, MAX_TITLE);
    if (!from) return fail(400, "provide the project to edit");
    if (body.name === undefined && body.areaOrder === undefined) {
      return fail(400, 'provide "name" (the project\'s new name) or "areaOrder"');
    }
    const to = body.name === undefined ? undefined : str(body.name, MAX_TITLE);
    if (body.name !== undefined && !to) return fail(400, '"name" must be the project\'s new name');
    if (to === from) return fail(400, `${from} already has that name`);
    const order = body.areaOrder === undefined ? undefined : areaOrderArg(body.areaOrder);
    if (isResult(order)) return order;
    const designs = await store.listDesigns(from);
    if (designs.length === 0) return fail(404, `no project "${from}" with designs`);
    if (to !== undefined) {
      if (!(await store.renameProject(from, to))) {
        return fail(409, `${to} already has designs; pick another name`);
      }
      clearRenderCache();
    }
    const project = to ?? from;
    if (order !== undefined) {
      await store.setSetting(`${AREA_ORDER_SETTING}:${project}`, JSON.stringify(order));
    }
    for (const m of designs) bus.broadcast({ type: "design-updated", id: m.id, project });
    const named = new Set(designs.flatMap((m) => (m.area ? [m.area] : [])));
    const unnamed = (order ?? []).filter((a) => !named.has(a));
    return ok({
      project,
      ...(to === undefined ? {} : { renamed: { from, to } }),
      ...(order === undefined ? {} : { areaOrder: order }),
      designs: designs.length,
      url: `${ctx.base}/project/${encodeURIComponent(project)}`,
      ...(unnamed.length
        ? {
            nudges: [
              `no design in ${project} has area ${unnamed.map((a) => `"${a}"`).join(", ")} yet; Home lists it once one does`,
            ],
          }
        : {}),
      feedback: await feedbackFor(body.session, ctx.base),
    });
  }

  // --- comments ---

  function numberInRange(value: unknown, min: number, max: number): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }

  function sanitizeCommentAnchor(
    raw: unknown,
    design: Design,
    post: Post | null,
  ): CommentAnchor | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const input = raw as Record<string, unknown>;
    if (input.kind === "part") {
      const part = str(input.part, 200);
      if (!part) return undefined;
      const state = stateArg(input.state) ?? post?.state ?? null;
      if (state !== null && !design.states.includes(state)) return undefined;
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
      designId: comment.designId,
      postId: comment.postId,
      seq: comment.seq,
    });
  }

  // Where a thread comment lands: a design, optionally one variant of it, and the
  // session whose stream carries it.
  async function commentTarget(
    body: any,
  ): Promise<{ design: Design; post: Post | null; session: Session } | FlowResult> {
    let post: Post | null = null;
    let design: Design | null = null;
    if (typeof body.post === "string" && body.post) {
      post = await store.getPost(body.post);
      if (!post) return fail(404, "post not found");
      design = await store.getDesign(post.design);
    } else if (body.design !== undefined) {
      const resolved = await resolveDesign(body.design, body.project, body.session);
      if (isResult(resolved)) return resolved;
      design = resolved;
      if (body.variant !== undefined || body.state !== undefined) {
        const posts = await store.listPosts({ designId: design.id });
        const chosen = chooseVariant(
          design,
          posts,
          stateArg(body.state),
          str(body.variant, MAX_LABEL),
        );
        if (isResult(chosen)) return chosen;
        post = chosen;
      }
    } else {
      return fail(400, 'provide "design" (or "post")');
    }
    if (!design) return fail(404, "design not found");
    let session: Session | null = null;
    if (typeof body.session === "string" && body.session) {
      session = await store.getSession(body.session);
      if (!session) return fail(404, `session "${body.session}" not found`);
    }
    if (!session) {
      const sid = design.sessionId ?? post?.sessionId;
      session = sid ? await store.getSession(sid) : null;
    }
    if (!session) return fail(409, `${design.slug} has no agent session`);
    return { design, post, session };
  }

  // The user's comment in a thread: the trusted viewer's verb only. Sandboxed
  // surfaces have opaque origins, so their bridge is stamped "surface" by the
  // viewer rather than by contained code. An agent writes with say.
  async function commentFlow(body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!ctx.viewer) return fail(403, "only the viewer can do this; an agent posts with say");
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const text = str(body.text, MAX_COMMENT_TEXT);
    if (!text) return fail(400, 'provide non-empty "text"');
    const target = await commentTarget(body);
    if (isResult(target)) return target;
    const { design, post, session } = target;
    const viewport = sanitizeViewport(body.viewport);
    const comment = await store.createComment({
      sessionId: session.id,
      designId: design.id,
      postId: post?.id ?? null,
      author: body.author === "surface" ? "surface" : "user",
      text,
      anchor: sanitizeCommentAnchor(body.anchor, design, post),
      kind: "comment",
      anchors: sanitizeAnchors(body.anchors, post, viewport),
      postVersion: post ? sanitizePostVersion(body.postVersion, post) : null,
      viewport,
    });
    if (!comment) return fail(404, "session not found");
    announceComment(comment);
    const [delivered] = await withDelivered([comment]);
    return ok(delivered, 201);
  }

  // The agent's plain-text message in a design's thread. Stored as text and
  // rendered as a text node, never as HTML. A write, so feedback rides along.
  async function sayFlow(ref: unknown, body: any, ctx: FlowContext): Promise<FlowResult> {
    if (!body || typeof body !== "object") return fail(400, "invalid JSON body");
    const text = typeof body.message === "string" ? str(body.message, MAX_COMMENT_TEXT) : undefined;
    if (!text) return fail(400, 'provide non-empty "message" text');
    const target = await commentTarget({ ...body, design: ref, post: undefined });
    if (isResult(target)) return target;
    const { design, post, session } = target;
    const comment = await store.createComment({
      sessionId: session.id,
      designId: design.id,
      postId: post?.id ?? null,
      author: reservedAgent(session.agent),
      text,
      kind: "comment",
      anchors: [],
      postVersion: post ? post.version : null,
      viewport: null,
    });
    if (!comment) return fail(404, "session not found");
    announceComment(comment);
    return ok({ feedback: await collectFeedback(comment.sessionId, ctx.base) }, 201);
  }

  // Long-poll: resolves as soon as a matching comment lands, or at timeout.
  async function waitForComments(
    q: CommentWait,
    signal?: AbortSignal,
  ): Promise<{ comments: Comment[]; lastSeq: number; handedOff: Comment[] }> {
    // The agent listening for its feedback: it is alive, and it may take
    // replies owed to a session it superseded (handoff.ts).
    const listener = q.agent && q.author === "user" ? q.sessionId : undefined;
    if (listener) await store.touchAgent(listener);
    // An author=user session wait with no explicit cursor resumes from the
    // session's agentSeq — "where the agent left off" lives server-side so the
    // CLI, both MCP transports, and piggyback share one exactly-once stream.
    let afterSeq = q.afterSeq;
    if (afterSeq === undefined && q.author === "user" && q.sessionId) {
      afterSeq = (await store.getSession(q.sessionId))?.agentSeq;
    }
    const peekFrom = q.peek && q.sessionId ? (noticed.get(q.sessionId) ?? 0) : 0;
    if (q.peek) afterSeq = Math.max(afterSeq ?? 0, peekFrom);
    const takeOrphanedFor = async (id: string | undefined) => {
      const taker = id ? await store.getSession(id) : null;
      if (!taker) return [];
      if (q.peek) return (await owedOrphans(taker)).filter((c) => c.seq > peekFrom);
      return await takeOrphaned(taker);
    };
    let handedOff = await takeOrphanedFor(listener);
    const query = { sessionId: q.sessionId, designId: q.designId, postId: q.postId, afterSeq };
    const matches = (list: Comment[]) =>
      q.author ? list.filter((cm) => cm.author === q.author) : list;
    const wait = Math.min(Math.max(q.waitSeconds, 0), MAX_WAIT_SECONDS);

    let all = await store.listComments(query);
    let comments = matches(all);
    if (comments.length === 0 && handedOff.length === 0 && wait > 0) {
      if (listener) listening.set(listener, (listening.get(listener) ?? 0) + 1);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, wait * 1000);
        const unsubscribe = bus.subscribe((event) => {
          if (event.type !== "comment-created") return;
          if (q.sessionId && event.sessionId !== q.sessionId) return;
          if (q.designId && event.designId !== q.designId) return;
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
      if (listener) {
        const n = (listening.get(listener) ?? 1) - 1;
        if (n > 0) listening.set(listener, n);
        else listening.delete(listener);
      }
      // A caller that gave up can't receive this batch, so delivering it would
      // advance the cursor past feedback no agent ever saw.
      if (signal?.aborted) return { comments: [], lastSeq: afterSeq ?? 0, handedOff: [] };
      if (listener) await store.touchAgent(listener);
      handedOff = await takeOrphanedFor(listener);
      all = await store.listComments(query);
      comments = matches(all);
    }
    // The cursor advances past every comment in the window — not just the
    // filtered ones — so the next call doesn't re-read the agent's own comments.
    const lastSeq = all.length > 0 ? all[all.length - 1].seq : (afterSeq ?? 0);
    if (q.peek) {
      const seqs = [...comments, ...handedOff].map((c) => c.seq);
      if (q.sessionId && seqs.length > 0) {
        noticed.set(q.sessionId, Math.max(peekFrom, ...seqs));
      }
      return { comments, lastSeq, handedOff };
    }
    // An author=user query is the agent listening (the viewer never filters by
    // author) — what it receives here must not be re-delivered as piggyback.
    if (q.agent && q.author === "user" && q.sessionId && all.length > 0) {
      await store.markAgentSeen(q.sessionId, lastSeq);
      bus.broadcast({ type: "comment-delivered", sessionId: q.sessionId, seq: lastSeq });
    }
    return { comments, lastSeq, handedOff };
  }

  // The watch long-poll's answer: comments plus the batched feedback built
  // from them.
  async function listenFlow(
    q: CommentWait,
    base: string,
    signal?: AbortSignal,
  ): Promise<FlowResult> {
    const { handedOff, ...result } = await waitForComments({ ...q, agent: true }, signal);
    const feedback = await feedbackWithHandoffs(result.comments, handedOff, base);
    return ok({ ...result, feedback });
  }

  // What the user is doing right now, per design: derived from the SSE registry
  // and the server-side draft, never stored. It is why an empty `feedback` still
  // tells the agent something ("2 of 3 answered", or nobody is looking).
  const pendingOf = (design: Design) => ({
    design: design.slug,
    // Closed by the user: nothing there is waiting on them, or on you.
    ...(design.archivedAt ? { closed: true } : {}),
    viewerOpen: viewing.has(design.id),
    // One kept for an archived design's Undo isn't someone still answering.
    draft:
      design.draft && !design.archivedAt
        ? {
            answered: draftedCount(design) ?? 0,
            of: openCount(design),
            comments: design.draft.comments.length,
            touchedAt: design.draft.updatedAt,
          }
        : null,
  });

  // The feedback verb: never blocks. Takes what the session has not heard yet
  // (the same cursor as piggyback and watch) plus `pending` for the project.
  async function feedbackFlow(
    query: { session?: unknown; project?: unknown },
    ctx: FlowContext,
  ): Promise<FlowResult> {
    if (typeof query.session !== "string" || !query.session) {
      return fail(400, 'provide "session": the session id a write returned');
    }
    const session = await store.getSession(query.session);
    if (!session) return fail(404, `session "${query.session}" not found`);
    // Before the read: delivering tells the viewer to look, and this should be there.
    noteAgentCall(session.id);
    const { comments, handedOff } = await waitForComments({
      sessionId: session.id,
      author: "user",
      waitSeconds: 0,
      agent: true,
    });
    const project = str(query.project, MAX_TITLE) ?? session.project ?? undefined;
    return ok({
      feedback: await feedbackWithHandoffs(comments, handedOff, ctx.base),
      pending: (await store.listDesigns(project)).map(pendingOf),
    });
  }

  // Store an uploaded blob. An explicit session is validated and a missing one
  // is auto-created so an upload can precede the first publish. An image the
  // user attaches names its design instead, and belongs to the session that design
  // replies to. The asset's data is dropped from the result (it's bytes).
  async function uploadAsset(input: {
    data: Uint8Array;
    contentType: string;
    filename?: string;
    kind?: AssetKind;
    session?: string;
    agent?: string;
    design?: string;
  }): Promise<
    { asset: Omit<Asset, "data"> } | { error: string; status: 400 | 404 | 409 | 413 | 415 }
  > {
    if (input.data.byteLength === 0) return { error: "empty upload", status: 400 };
    if (input.data.byteLength > MAX_ASSET_BYTES) {
      return { error: `asset exceeds ${MAX_ASSET_BYTES} bytes`, status: 413 };
    }
    let sessionId = input.session;
    if (input.design !== undefined) {
      if (!ATTACHABLE_IMAGE_TYPES.has(input.contentType)) {
        return { error: "attach a png, jpeg, webp or gif image", status: 415 };
      }
      const design = await store.getDesign(input.design);
      if (!design) return { error: `design "${input.design}" not found`, status: 404 };
      const posts = await store.listPosts({ designId: design.id });
      const latest = [...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      sessionId = design.sessionId ?? latest?.sessionId;
      if (!sessionId) return { error: `${design.slug} has no agent session`, status: 409 };
    }
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
    // The installable-app files carry no workspace data, and a browser may
    // fetch them without the cookie; the manifest adds the key only for a
    // caller that already holds it.
    if (APP_FILES.has(path)) return next();

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

  const withOrigin = (text: string, c: { req: { raw: Request } }) =>
    text.replaceAll(LOCAL_ORIGIN, requestOrigin(c.req.raw));

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
      renderRev ? `window.__MOCKPIT_RENDER_REV__=${JSON.stringify(renderRev)};` : "",
    ].join("");
    return injectHead(text, `<script>${config}</script>`);
  };

  // The tags that make the viewer installable to a home screen. `use-credentials`
  // sends the cookie with the manifest fetch, which browsers otherwise omit.
  const withAppHead = (request: Request, mode: Mode) => (text: string) => {
    const base = escapeHtml(requestBasePath(request));
    return injectHead(
      text,
      [
        `<link rel="manifest" href="${base}/manifest.webmanifest" crossorigin="use-credentials">`,
        `<link rel="icon" href="${base}/icon.svg" type="image/svg+xml">`,
        `<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png">`,
        `<meta name="theme-color" content="${themeColor(mode)}">`,
        `<meta name="mobile-web-app-capable" content="yes">`,
        `<meta name="apple-mobile-web-app-capable" content="yes">`,
        `<meta name="apple-mobile-web-app-title" content="mockpit">`,
        `<meta name="apple-mobile-web-app-status-bar-style" content="default">`,
      ].join("\n"),
    );
  };

  // --- viewer pages ---

  // Link previews for a design page: the first open variant's first surface,
  // with every pixel-affecting input pinned in the image URL so the Worker can
  // cache it at the edge.
  const designPreviewHead = (
    design: Design,
    post: Post,
    request: Request,
    mode: Mode,
    rendererGeneration: string,
  ) => {
    const origin = requestOrigin(request);
    const publicBasePath = requestBasePath(request);
    const canonical = `${origin}${publicBasePath}/project/${encodeURIComponent(design.project)}/${encodeURIComponent(design.slug)}`;
    const imageUrl = new URL(`${origin}${publicBasePath}/s/${post.id}.png`);
    imageUrl.searchParams.set("card", "1");
    imageUrl.searchParams.set("theme", DEFAULT_THEME_ID);
    imageUrl.searchParams.set("mode", mode);
    imageUrl.searchParams.set("v", String(post.version));
    imageUrl.searchParams.set("g", rendererGeneration);
    const image = imageUrl.toString();
    const title = escapeHtml(design.title);
    const description = "A https://mockpit.sh design";
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
    opts: { title?: string | null; preview?: { design: Design; post: Post } } = {},
  ) => {
    // The viewer HTML is the trusted app origin — it shares that origin with the
    // authenticated API and the comment→agent channel, so a cross-origin page
    // that frames it could clickjack actions or the prompt-injection channel.
    // Refuse cross-origin framing (same-origin embedding still allowed). The
    // sandboxed surface documents at /s/:id are *meant* to be framed and carry
    // their own `sandbox` CSP header instead, so they never pass through here.
    c.header("Content-Security-Policy", "frame-ancestors 'self'");
    const html = withAppHead(
      c.req.raw,
      await workspaceMode(),
    )(
      withDocumentTitle(
        withViewerConfig(
          withOrigin(viewerHtml, c),
          c.req.raw,
          !!publicRead && !isAuthenticated(c),
          opts.title,
        ),
        opts.title,
      ),
    );
    if (!opts.preview) return html;
    const { design, post } = opts.preview;
    return injectHead(
      html,
      designPreviewHead(design, post, c.req.raw, await workspaceMode(), version ?? "dev"),
    );
  };
  app.get("/", async (c) => c.html(await configuredViewerHtml(c)));

  // --- the installable app: manifest and icons ---

  app.get("/manifest.webmanifest", async (c) => {
    // A tokened workspace bakes the key into start_url for a caller that holds
    // it (the viewer links the manifest with credentials), so a home-screen
    // launch, which may not share the browser's cookies, signs itself in.
    const keyed = !!authToken && isAuthenticated(c);
    const manifest = webManifest(
      await workspaceMode(),
      keyed ? `./?key=${encodeURIComponent(authToken!)}` : "./",
    );
    c.header("Content-Type", "application/manifest+json; charset=utf-8");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", keyed ? "private, no-store" : "no-cache");
    return c.body(JSON.stringify(manifest));
  });
  app.get("/icon.svg", (c) => {
    c.header("Content-Type", "image/svg+xml");
    // Our own art, but SVG is a document: opened top-level it runs at this origin.
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(ICON_SVG);
  });
  const iconPng = (size: number) => (c: Context) => {
    c.header("Content-Type", "image/png");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(decodeBase64(ICON_PNG_BASE64[size]).buffer as ArrayBuffer);
  };
  for (const size of ICON_SIZES) app.get(`/icon-${size}.png`, iconPng(size));
  app.get("/apple-touch-icon.png", iconPng(180));
  // The engine reads the project/design out of the URL itself; these render the
  // same shell as "/".
  app.get("/project/:name", async (c) =>
    c.html(await configuredViewerHtml(c, { title: c.req.param("name") })),
  );
  app.get("/project/:name/:slug", async (c) => {
    const design = await store.findDesign(c.req.param("name"), c.req.param("slug"));
    if (!design) return c.html(await configuredViewerHtml(c, { title: c.req.param("name") }));
    const posts = await store.listPosts({ designId: design.id });
    const post = posts.find((p) => isLive(p.status)) ?? posts[0];
    return c.html(
      await configuredViewerHtml(c, {
        title: design.title,
        ...(post ? { preview: { design, post } } : {}),
      }),
    );
  });

  // Someone following a bad link gets the viewer's page with a way out; a client
  // that isn't a browser keeps the plain 404.
  app.notFound(async (c) =>
    c.req.method === "GET" && c.req.header("accept")?.includes("text/html")
      ? c.html(await configuredViewerHtml(c), 404)
      : c.text("404 Not Found", 404),
  );

  // --- REST plumbing for the shared flows ---

  const flowCtx = (c: Context, strict = true): FlowContext => ({
    base: `${requestOrigin(c.req.raw)}${requestBasePath(c.req.raw)}`,
    // Only the trusted viewer may act as the user (drafts, replies,
    // user-authored comments); server/viewerRequest.ts says how it is known.
    viewer: isViewerRequest(c.req.raw),
    strict,
    request: c.req.raw,
    signal: c.req.raw.signal,
  });
  const send = (c: Context, result: FlowResult) => c.json(result.body, result.status as 200);
  const jsonBody = (c: Context) => c.req.json().catch(() => null);
  const flag = (c: Context, key: string) => c.req.query(key) === "1";

  // --- sessions ---

  app.get("/api/sessions", async (c) => {
    // A watcher started with every conversation finds that conversation's
    // session without creating one, and never mistakes a sibling's in the same
    // repo for its own.
    const key = c.req.query("key");
    if (key !== undefined) {
      const session = key ? await store.getSessionByKey(key) : null;
      if (!session) return c.json([]);
      const posts = await store.listPosts({ sessionId: session.id });
      return c.json([sessionRowView(session, posts.length)]);
    }
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
    const key = str(body.key, MAX_TITLE);
    const existing = key ? await store.getSessionByKey(key) : null;
    if (existing) {
      // A resumed conversation is that agent back, not a new one superseding it.
      await store.touchAgent(existing.id);
      return c.json((await store.getSession(existing.id)) ?? existing, 200);
    }
    const session = await store.createSession({
      agent: str(body.agent, MAX_TITLE) ?? "agent",
      title: str(body.title, MAX_TITLE),
      cwd,
      // Resolved once here so every design this session publishes lands in the
      // same project.
      project: resolveProject(str(body.project, MAX_TITLE), cwd),
      key,
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

  // --- projects and designs ---

  app.get("/api/projects", async (c) => c.json(await store.listProjects()));
  // Named by nothing unguessable, so in "session" mode this stays private
  // (isPublicReadAllowed) like the rest of the workspace's listings.
  app.get("/api/search", async (c) => {
    const rows = await store.listJumpRows();
    const recent = c.req.query("recent");
    if (recent !== undefined) {
      return c.json({ hits: recentHits(rows, recent.split(",").filter(Boolean).slice(0, 20)) });
    }
    const q = str(c.req.query("q"), MAX_LABEL) ?? "";
    return c.json({ hits: jumpHits(rows, q, str(c.req.query("project"), MAX_TITLE) ?? null) });
  });

  const withoutDecisions = (c: Context) =>
    isViewerRequest(c.req.raw) || isUnauthenticatedSessionRead(c);
  app.get("/api/designs", async (c) =>
    send(
      c,
      await listDesignsFlow({ project: c.req.query("project"), noDecisions: withoutDecisions(c) }),
    ),
  );

  app.post("/api/designs", async (c) => send(c, await publishFlow(await jsonBody(c), flowCtx(c))));

  // A session-scoped public read may only address a design by its unguessable id.
  const guardPublicDesign = async (c: Context): Promise<Response | null> => {
    if (!isUnauthenticatedSessionRead(c)) return null;
    return (await store.getDesign(c.req.param("id") ?? ""))
      ? null
      : c.json({ error: "design not found" }, 404);
  };

  app.get("/api/designs/:id", async (c) => {
    const denied = await guardPublicDesign(c);
    if (denied) return denied;
    return send(
      c,
      await getDesignFlow(c.req.param("id"), {
        project: c.req.query("project"),
        body: flag(c, "body"),
        history: flag(c, "history"),
        noDecisions: withoutDecisions(c),
      }),
    );
  });

  app.get("/api/designs/:id/export", async (c) => {
    const denied = await guardPublicDesign(c);
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

  app.patch("/api/designs/:id", async (c) => {
    const body = await jsonBody(c);
    // A slug names its project in the body or, as on the reads, in the query.
    const project = c.req.query("project");
    const withProject =
      body && typeof body === "object" && body.project === undefined && project
        ? { ...body, project }
        : body;
    return send(c, await editDesignFlow(c.req.param("id"), withProject, flowCtx(c)));
  });

  app.delete("/api/designs/:id", async (c) =>
    send(c, await removeDesignFlow(c.req.param("id"), { project: c.req.query("project") })),
  );

  app.post("/api/designs/:id/asks", async (c) =>
    send(c, await askFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );

  app.get("/api/designs/:id/draft", async (c) =>
    send(c, await getDraftFlow(c.req.param("id"), flowCtx(c))),
  );
  app.put("/api/designs/:id/draft", async (c) =>
    send(c, await putDraftFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.delete("/api/designs/:id/draft", async (c) =>
    send(c, await deleteDraftFlow(c.req.param("id"), flowCtx(c))),
  );

  app.post("/api/designs/:id/reply", async (c) =>
    send(c, await replyFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );

  app.post("/api/designs/:id/use", async (c) =>
    send(c, await useFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );

  app.post("/api/designs/:id/hide", async (c) =>
    send(c, await hideFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );

  app.post("/api/designs/:id/archive", async (c) =>
    send(c, await archiveDesignFlow(c.req.param("id"), flowCtx(c))),
  );
  app.post("/api/designs/:id/restore", async (c) =>
    send(c, await restoreDesignFlow(c.req.param("id"), flowCtx(c))),
  );
  app.post("/api/designs/:id/rearchive", async (c) =>
    send(c, await rearchiveFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.post("/api/designs/:id/reason", async (c) =>
    send(c, await reasonFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.post("/api/designs/:id/outlines", async (c) =>
    send(c, await outlineFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.post("/api/designs/:id/stay", async (c) =>
    send(c, await stayFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );

  app.get("/api/projects/:name/shortlists", async (c) =>
    send(c, await shortlistsFlow(c.req.param("name"))),
  );
  app.post("/api/copies", async (c) =>
    send(c, await saveCopiesFlow(await jsonBody(c), flowCtx(c))),
  );
  app.post("/api/copies/:design/remove", async (c) =>
    send(c, await removeCopyFlow(c.req.param("design"), await jsonBody(c), flowCtx(c))),
  );
  app.post("/api/designs/:id/star", async (c) =>
    send(c, await starFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.post("/api/designs/:id/variants/archive", async (c) =>
    send(c, await archiveFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.post("/api/designs/:id/variants/restore", async (c) =>
    send(c, await restoreFlow(c.req.param("id"), await jsonBody(c))),
  );

  app.post("/api/designs/:id/variants/:postId/poster", async (c) =>
    send(c, await attachPosterFlow(c.req.param("id"), c.req.param("postId"), await jsonBody(c))),
  );
  app.post("/api/designs/:id/variants/:postId/restore", async (c) =>
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

  app.post("/api/designs/:id/move", async (c) =>
    send(c, await moveFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );
  app.post("/api/designs/:id/say", async (c) =>
    send(c, await sayFlow(c.req.param("id"), await jsonBody(c), flowCtx(c))),
  );

  app.get("/api/feedback", async (c) =>
    send(
      c,
      await feedbackFlow(
        { session: c.req.query("session"), project: c.req.query("project") },
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

  // What a phone opening this page would meet, for the QR code: how it gets in, and
  // on a loopback viewer, the addresses that would reach this machine. Never the
  // token, and the addresses only for someone signed in.
  app.get("/api/reach", (c) => {
    const net = isAuthenticated(c) ? networkHosts?.() : undefined;
    return c.json({
      hosts: net?.hosts ?? [],
      localOnly: net?.localOnly ?? false,
      // Session-level public read only opens what's addressed by id, which a link to a
      // design by name isn't: only full public read gets a phone in without the key.
      access: authenticate
        ? "unknown"
        : !authToken
          ? "open"
          : publicRead === "full"
            ? "read"
            : "key",
    });
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
  // a matching comment arrives. Plumbing for `mockpit watch` and the viewer;
  // agents read with GET /api/feedback, which never blocks.
  // A wait counts against the connection cap (it pins a socket just like SSE);
  // an instant ?wait=0 read does not.
  app.get("/api/comments", async (c) => {
    const sessionId = c.req.query("session");
    const designId = c.req.query("design");
    const postId = c.req.query("post");
    if (isUnauthenticatedSessionRead(c)) {
      if (!sessionId && !designId && !postId) {
        return c.json({ error: "session, design or post required" }, 401);
      }
      if (sessionId && !(await store.getSession(sessionId))) {
        return c.json({ error: "session not found" }, 404);
      }
      if (designId && !(await store.getDesign(designId)))
        return c.json({ error: "design not found" }, 404);
      if (postId && !(await store.getPost(postId))) return c.json({ error: "post not found" }, 404);
    }
    const waitSeconds = Number(c.req.query("wait") ?? 0) || 0;
    const author = c.req.query("author");
    const after = c.req.query("after");
    const query: CommentWait = {
      sessionId,
      designId,
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
    query.peek = isAgentRead && c.req.query("peek") === "1";
    const respond = async (signal?: AbortSignal) => {
      if (isAgentRead) return send(c, await listenFlow(query, flowCtx(c).base, signal));
      const { handedOff: _none, ...result } = await waitForComments(query, signal);
      const live = isViewerRequest(c.req.raw) && isAuthenticated(c);
      return c.json({ ...result, comments: await withDelivered(result.comments, live) });
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
    return c.json(
      kitSummaries(project ? ((await designSystemFor(project))?.projectKits ?? []) : []),
    );
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
  app.get("/api/projects/:name/decisions", async (c) =>
    send(c, await decisionsFlow({ project: c.req.param("name") }, flowCtx(c))),
  );
  app.put("/api/projects/:name/decisions", async (c) =>
    send(c, await editDecisionFlow(c.req.param("name"), await jsonBody(c), flowCtx(c))),
  );
  app.get("/api/projects/:name/tree", async (c) =>
    send(
      c,
      await treeFlow({
        project: c.req.param("name"),
        live: isViewerRequest(c.req.raw) && isAuthenticated(c),
        noDescriptions: isViewerRequest(c.req.raw),
      }),
    ),
  );
  app.get("/api/projects/:name/flows", async (c) =>
    send(c, await flowOutlineFlow(c.req.param("name"))),
  );
  app.patch("/api/projects/:name", async (c) =>
    send(c, await editProjectFlow(c.req.param("name"), await jsonBody(c), flowCtx(c))),
  );
  app.get("/api/projects/:name/design-system", async (c) =>
    c.json(await designSystemFor(c.req.param("name"))),
  );
  // A project's rules file (.mockpit/rules.md, sent by `mockpit rules` and
  // `mockpit init`) and the user's own (`mockpit rules --mine`).
  app.get("/api/projects/:name/rules", async (c) =>
    c.json({ text: (await store.getSetting(`${RULES_SETTING}:${c.req.param("name")}`)) ?? "" }),
  );
  app.put("/api/projects/:name/rules", async (c) =>
    send(c, await saveRules(`${RULES_SETTING}:${c.req.param("name")}`, await jsonBody(c))),
  );
  app.get("/api/rules", async (c) => c.json({ text: (await userRulesText()) ?? "" }));
  app.put("/api/rules", async (c) =>
    send(c, await saveRules(USER_RULES_SETTING, await jsonBody(c))),
  );

  app.put("/api/projects/:name/design-system", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid JSON body" }, 400);
    const project = c.req.param("name");
    // `mockpit init` re-detects the repo and PUTs without iconSets; that must
    // not uninstall what `mockpit icons add` installed.
    const previous = await designSystemFor(project);
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
    const designFiles = checkDesignFiles(body.designFiles);
    if (typeof designFiles === "string") return c.json({ error: designFiles }, 400);
    const designSystem: DesignSystem = {
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
      designFiles,
      updatedAt: new Date().toISOString(),
    };
    return c.json(await saveDesignSystem(project, designSystem));
  });

  async function saveDesignSystem(
    project: string,
    designSystem: DesignSystem,
  ): Promise<DesignSystem> {
    await store.setSetting(`design:${project}`, JSON.stringify(designSystem));
    // Every rendered surface bakes the design into its document string, so a
    // design change invalidates them all.
    clearRenderCache();
    bus.broadcast({ type: "theme-changed", mode: await workspaceMode() });
    return designSystem;
  }

  const MAX_PROJECT_KITS = 16;
  function checkProjectKits(raw: unknown): DesignSystem["projectKits"] | string {
    if (!Array.isArray(raw)) return "projectKits must be an array";
    if (raw.length > MAX_PROJECT_KITS) return `at most ${MAX_PROJECT_KITS} project kits`;
    const kits: DesignSystem["projectKits"] = [];
    for (const item of raw) {
      const kit = checkProjectKit(item);
      if (typeof kit === "string") return kit;
      if (kits.some((k) => k.id === kit.id)) return `kit "${kit.id}" is listed twice`;
      kits.push(kit);
    }
    return kits;
  }

  const emptyDesignSystem = (): DesignSystem => ({
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
    const designSystem = (await designSystemFor(project)) ?? emptyDesignSystem();
    const others = designSystem.projectKits.filter((k) => k.id !== kit.id);
    if (others.length >= MAX_PROJECT_KITS)
      return c.json({ error: `at most ${MAX_PROJECT_KITS} project kits` }, 400);
    const saved = await saveDesignSystem(project, {
      ...designSystem,
      projectKits: [...others, kit],
      updatedAt: new Date().toISOString(),
    });
    return c.json(saved);
  });

  // Removing the project's default kit falls back to no kit rather than leaving
  // designSystem.kit naming something that no longer resolves.
  app.delete("/api/projects/:name/kits/:id", async (c) => {
    const project = c.req.param("name");
    const id = c.req.param("id");
    const designSystem = await designSystemFor(project);
    if (!designSystem?.projectKits.some((k) => k.id === id))
      return c.json({ error: `${project} has no kit "${id}"` }, 404);
    const saved = await saveDesignSystem(project, {
      ...designSystem,
      kit: designSystem.kit === id ? "none" : designSystem.kit,
      projectKits: designSystem.projectKits.filter((k) => k.id !== id),
      updatedAt: new Date().toISOString(),
    });
    return c.json(saved);
  });

  // Every set an html surface of this project can name, installed first.
  app.get("/api/projects/:name/icons", async (c) => {
    const sets = await iconSetsFor(await designSystemFor(c.req.param("name")));
    return c.json({
      sets: sets.map((s) => ({ prefix: s.prefix, count: iconCount(s.set), source: s.source })),
    });
  });

  // The repo's design files as init read them: every map and list is cut to
  // the reader's own caps, then the whole is refused past 32k so one project
  // cannot bloat every brief and every settings read.
  const DESIGN_FILES_MAX = 32_000;
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  function checkDesignFiles(raw: unknown): DesignFiles | null | string {
    if (raw === undefined || raw === null) return null;
    if (!isRecord(raw)) return "designFiles must be an object";
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    const strs = (v: unknown, n: number, max: number) =>
      Array.isArray(v)
        ? v
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.slice(0, max))
            .slice(0, n)
        : [];
    const flat = (v: unknown, n: number): Record<string, string> =>
      Object.fromEntries(
        Object.entries(isRecord(v) ? v : {})
          .filter((e): e is [string, string] => typeof e[1] === "string")
          .slice(0, n)
          .map(([k, x]) => [k.slice(0, 80), x.slice(0, 120)]),
      );
    const nested = (v: unknown, n: number): Record<string, Record<string, string>> =>
      Object.fromEntries(
        Object.entries(isRecord(v) ? v : {})
          .filter(([, x]) => isRecord(x))
          .slice(0, n)
          .map(([k, x]) => [k.slice(0, 80), flat(x, 12)]),
      );
    const out: DesignFiles = {};
    const md = raw.designMd;
    if (isRecord(md)) {
      out.designMd = {
        name: str(md.name, 120),
        colors: flat(md.colors, 100),
        typography: nested(md.typography, 40),
        rounded: flat(md.rounded, 30),
        spacing: flat(md.spacing, 30),
        components: nested(md.components, 60),
        headings: strs(md.headings, 20, 120),
        dos: str(md.dos, 1_500),
      };
    }
    const tokens = raw.tokens;
    if (isRecord(tokens)) {
      out.tokens = {
        files: strs(tokens.files, 20, 200),
        count: Math.max(0, Math.floor(Number(tokens.count) || 0)),
        cssVars: tokens.cssVars === true,
        values: flat(tokens.values, 400),
      };
    }
    const shadcn = raw.shadcn;
    if (isRecord(shadcn)) {
      out.shadcn = {
        style: str(shadcn.style, 60),
        baseColor: str(shadcn.baseColor, 60),
        iconLibrary: str(shadcn.iconLibrary, 60),
        components: strs(shadcn.components, 80, 60),
      };
    }
    const size = JSON.stringify(out).length;
    if (size > DESIGN_FILES_MAX) {
      return `designFiles is ${size} characters serialized; at most ${DESIGN_FILES_MAX}`;
    }
    return Object.keys(out).length ? out : null;
  }

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
    embeds?: string;
    rewrites?: number;
  }) =>
    `${o.postId}:${o.idx}:${o.version}:${o.mode ?? "os"}:${o.origin}:${o.knobs ?? ""}:${o.embeds ?? ""}${o.rewrites ? `:w${o.rewrites}` : ""}`;

  // After a version is rewritten in place: a frame still naming the old `w`
  // must miss the cache and get the version as it is now.
  const dropPostRenders = (postId: string) => {
    for (const key of renderCache.keys()) if (key.startsWith(`${postId}:`)) dropCacheEntry(key);
  };

  // The document itself. Shared by the GET below and the publish-time pre-warm,
  // so both produce byte-identical output for one key.
  async function buildSurfaceDoc(args: {
    post: Post;
    design: Design | null;
    surface: Surface;
    title: string;
    version: number;
    mode?: Mode;
    origin: string;
    designSystem: DesignSystem | null;
    knobs?: Record<string, KnobValue>;
    composed?: string;
  }): Promise<InlineResult> {
    const { surface, mode, origin } = args;
    const theme = themeById(DEFAULT_THEME_ID);
    const themeId = theme.id;
    if (surface.kind === "html") {
      // Embedded components are expanded server-side (the caller passes the
      // expansion), so the whole page is still ONE sandboxed document rather
      // than nested frames.
      const html = args.composed ?? surface.html;
      const page = renderHtmlPage({
        title: args.title,
        html,
        origin,
        theme,
        mode,
        kits: surface.kits,
        designSystem: args.designSystem,
        version: args.version,
        knobs: args.knobs,
        resolveIcon: mayHaveIcons(html)
          ? (await iconResolverFor(args.designSystem)).resolve
          : undefined,
      });
      return cdnInliner.inline(page, html);
    }
    if (surface.kind === "mermaid") {
      return {
        doc: renderMermaidPage({
          mermaid: surface.mermaid,
          origin,
          theme,
          mode,
          version: args.version,
        }),
        complete: true,
      };
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
    // needs no network at runtime. Check it on real workerd (`npm run dev:cloud`):
    // a dynamic import resolving differently there is exactly the way this
    // optimization could break in production and nowhere else.
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
    return {
      doc: renderSandboxedPart({
        body: rendered.body,
        css: rendered.css,
        origin,
        theme,
        mode,
        version: args.version,
      }),
      complete: true,
    };
  }

  // Render the current version of a post into the cache, off the write path.
  // The first thing the viewer does after a publish is load an iframe per
  // surface; warming both schemes of the workspace theme turns that cold render
  // (up to a second for a large code surface) into a cache hit. Detached on
  // purpose: a render failure must never fail — or delay — the write. (The DO
  // stays alive for the duration; there is no ExecutionContext to hand this to.)
  const PREWARM_SURFACE_LIMIT = 4;
  function warmPost(post: Post, design: Design): void {
    const origin = lastOrigin;
    if (!origin) return;
    void (async () => {
      const designSystem = await designSystemFor(design.project);
      let warmed = 0;
      for (const [idx, surface] of post.surfaces.entries()) {
        if (warmed >= PREWARM_SURFACE_LIMIT) break;
        if (!isSandboxedSurfaceKind(surface.kind)) continue;
        warmed++;
        const composed =
          surface.kind === "html" && hasEmbedTags(surface.html)
            ? await composedHtml(design.project, design.slug, surface.html)
            : null;
        for (const mode of ["light", "dark"] as const) {
          const key = renderKey({
            postId: post.id,
            idx,
            version: post.version,
            mode,
            origin,
            embeds: composed ? embedsKey(composed) : undefined,
            rewrites: post.rewrites,
          });
          if (renderCache.has(key)) continue;
          await cachedRender(key, () =>
            buildSurfaceDoc({
              post,
              design,
              surface,
              title: post.title,
              version: post.version,
              mode,
              origin,
              designSystem,
              composed: composed?.html,
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
    // `e`: the embeds key the caller saw (cache identity); `embed`: a peek at
    // older component versions, JSON {slug: version}.
    const eParam: string | undefined = c.req.query("e");
    const embedParam: string | undefined = c.req.query("embed");
    // `w`: the variant's rewrites the caller saw, since an amend keeps the number.
    const wParam = Number(c.req.query("w") ?? 0) || 0;
    const origin = requestOrigin(c.req.raw);

    // Cache-first. A hit needs nothing from the post row, and the row is the
    // expensive part of this route (surfaces + every retained version). Only a
    // version-pinned request can take this path: without `ver` the current
    // version — and so the key — is unknown until the row is read. A `?k=`
    // request never does: its values are checked against the design's knobs,
    // which can change under a pinned version.
    const pinned = Number(ver);
    // A document with embeds is stored only under the key its resolved embeds
    // give, so a hit here was rendered with exactly the `e` this URL names.
    if (Number.isInteger(pinned) && pinned > 0 && kParam === undefined && !embedParam) {
      const hit = renderCacheHit(
        renderKey({
          postId: c.req.param("id"),
          idx: Number(surfaceParam),
          version: pinned,
          mode,
          origin,
          embeds: eParam,
          rewrites: wParam,
        }),
      );
      if (hit !== undefined) {
        surfaceDocHeaders(c, true);
        return c.html(hit);
      }
    }

    const post = await store.getPost(c.req.param("id"));
    if (!post) return c.text("Post not found", 404);
    const design = await store.getDesign(post.design);

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

    // Knob values are agent/user data: only values the design (or this variant's
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
      const checked = checkKnobValues(raw, design ?? { knobs: {} }, [post], "k");
      if (!checked.ok) return bad(checked.error);
      const paths = Object.keys(checked.value).sort();
      if (paths.length > 0 && surface.kind === "html") {
        knobs = Object.fromEntries(paths.map((p) => [p, checked.value[p]]));
        knobsKey = JSON.stringify(knobs);
      }
    }
    let composed: Expanded | null = null;
    if (surface.kind === "html" && hasEmbedTags(surface.html) && design) {
      let overrides: Record<string, number> | undefined;
      if (embedParam !== undefined) {
        let raw: unknown;
        try {
          raw = JSON.parse(embedParam);
        } catch {
          raw = null;
        }
        const ok =
          raw !== null &&
          typeof raw === "object" &&
          !Array.isArray(raw) &&
          Object.values(raw).every((v) => Number.isInteger(v) && (v as number) > 0);
        if (!ok || embedParam.length > MAX_KNOB_QUERY) {
          surfaceDocHeaders(c, false);
          return c.text("embed must be URL-encoded JSON of {slug: version}", 400);
        }
        overrides = raw as Record<string, number>;
      }
      composed = await composedHtml(design.project, design.slug, surface.html, overrides);
    }
    const eKey = composed ? embedsKey(composed) : undefined;
    // Cache the finished document under the same key the pre-warm uses; the
    // resolved `version` and embeds key make it immutable, so a hit is always
    // correct.
    const cacheKey = renderKey({
      postId: post.id,
      idx,
      version,
      mode,
      origin,
      knobs: knobsKey,
      embeds: eKey,
      rewrites: post.rewrites,
    });
    const designSystem = design ? await designSystemFor(design.project) : null;
    const { doc, complete } = await cachedRender(cacheKey, () =>
      buildSurfaceDoc({
        post,
        design,
        surface,
        title,
        version,
        mode,
        origin,
        designSystem,
        knobs,
        composed: composed?.html,
      }),
    );
    // Every input is in the URL (the palette is fixed, the mode is a query
    // param), so a version-pinned document never changes, unless it follows a
    // component's latest version and the URL does not name that state (`e`), or
    // a CDN it links failed this time and the next one may do better.
    surfaceDocHeaders(
      c,
      complete &&
        ver != null &&
        (eKey === undefined || eKey === eParam) &&
        wParam === (post.rewrites ?? 0),
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
            design: c.req.query("design"),
          };
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "invalid upload" }, 400);
    }
    // An attachment on a design is the user's, so only the viewer may make one.
    if (body.design !== undefined && !flowCtx(c).viewer) {
      return c.json({ error: "only the viewer can attach images to a design" }, 403);
    }
    const result = await uploadAsset(body);
    if ("error" in result) return c.json({ error: result.error }, result.status);
    const origin = requestOrigin(c.req.raw);
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
    const designId = c.req.query("design");
    if (isUnauthenticatedSessionRead(c)) {
      if (!sessionId && !designId) return c.json({ error: "session or design required" }, 401);
      if (sessionId && !(await store.getSession(sessionId))) {
        return c.json({ error: "session not found" }, 404);
      }
      if (designId && !(await store.getDesign(designId))) {
        return c.json({ error: "design not found" }, 404);
      }
    }
    if (!acquireHold()) return c.json({ error: "too many concurrent connections" }, 503);
    const openedAt = Date.now();
    const viewingId = str(c.req.query("viewing"), MAX_TITLE);
    if (viewingId) viewing.set(viewingId, (viewing.get(viewingId) ?? 0) + 1);
    let attached = true;
    const releaseHold = makeRelease();
    const release = () => {
      if (attached) {
        if (viewingId) {
          const left = (viewing.get(viewingId) ?? 1) - 1;
          if (left > 0) viewing.set(viewingId, left);
          else viewing.delete(viewingId);
        }
        writeLog(log, {
          t: new Date().toISOString(),
          op: "sse close",
          client: "viewer",
          status: 200,
          ms: Date.now() - openedAt,
          ...(viewingId ? { viewing: viewingId } : {}),
        });
      }
      attached = false;
      releaseHold();
    };
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
    const eventDesignId = (event: FeedEvent) => {
      if ("designId" in event) return event.designId;
      if (
        event.type === "design-created" ||
        event.type === "design-updated" ||
        event.type === "design-deleted"
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
        if (designId && eventDesignId(event) !== designId) return;
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
        await stream.writeSSE({ event: "hello", data: JSON.stringify({ rev: revision }) });
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

  const mcpFlows: McpFlows = {
    publish: (body, ctx) => publishFlow(body, ctx),
    list: (query) => listDesignsFlow(query),
    tree: (query) => treeFlow(query),
    decisions: (query) => decisionsFlow(query),
    get: (ref, query) => getDesignFlow(ref, query),
    ask: (ref, body, ctx) => askFlow(ref, body, ctx),
    exportDesign: (ref, query, ctx) => exportFlow(ref, query, ctx),
    say: (ref, body, ctx) => sayFlow(ref, body, ctx),
    move: (ref, body, ctx) => moveFlow(ref, body, ctx),
    feedback: (query, ctx) => feedbackFlow(query, ctx),
    edit: (ref, body, ctx) => editDesignFlow(ref, body, ctx),
    editProject: (name, body, ctx) => editProjectFlow(name, body, ctx),
  };
  const guide = (project: string, topic?: GuideTopic) =>
    topic ? (topics[topic] ?? "") : briefFor(project);

  // --- run: an agent script over the same flows (server/run.ts) ---

  const runFlow = createRunFlow({
    store,
    executor,
    limits: { ...DEFAULT_RUN_LIMITS, ...runLimits },
    flows: mcpFlows,
    guide,
    uploadAsset,
    async createSession({ agent, project }) {
      const session = await store.createSession({ agent, project: resolveProject(project) });
      bus.broadcast({ type: "session-created", id: session.id });
      return session.id;
    },
  });
  // Never the viewer's verb: a script acts as the agent whatever origin sent it.
  app.post("/api/run", async (c) => send(c, await runFlow(await jsonBody(c), flowCtx(c, false))));

  registerMcp(app, {
    store,
    basePath: requestBasePath,
    flows: mcpFlows,
    run: runFlow,
    uploadAsset,
    // Every feature works on every tier: a remote MCP agent needs the project's
    // real palette and kit, and the topics, as much as a shell one does.
    guide,
  });

  return app;
}
