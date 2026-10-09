// Shared data model — no runtime imports, safe for any platform.

import type { Palette } from "./themes.ts";

export interface Session {
  id: string;
  agent: string;
  title: string | null;
  cwd: string | null;
  createdAt: string;
  lastActiveAt: string;
  // Highest comment seq already delivered to the agent — lets responses to
  // agent writes piggyback comments the agent has not seen yet.
  agentSeq: number;
  // The repo this session's agent is working in. Resolved once at session
  // create; null when neither a project nor a cwd was given.
  project: string | null;
}

// A post is an ordered list of surfaces. Each surface declares its own kind;
// the post itself is kind-agnostic. An `html` surface is arbitrary agent
// markup rendered in an opaque-origin iframe. Rich text/code kinds are structured
// data rendered into sandboxed documents; image/json stay as data rendered
// natively by the trusted viewer. A diagram-with-its-diff is `[html, diff]`.
// The canonical, ordered list of every surface kind — the single source of
// truth. `SurfaceKind` derives from it, and the MCP tool schemas (mcpSpec.ts)
// build their `kind` enums from it, so a kind can't be added to the model
// without the MCP tier advertising it too (the gap that left `json`/`code`
// publishable over CLI/REST but invisible to MCP). The per-kind FIELD schemas
// in postSurfaces.ts and mcpSpec.ts are still hand-written; test/mcpSpec.test.ts
// guards that every kind here round-trips through both the MCP schema and the
// validator with its fields, so neither half can silently fall behind.
export const SURFACE_KINDS = [
  "html",
  "diff",
  "image",
  "markdown",
  "terminal",
  "mermaid",
  "json",
  "code",
] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export type SurfaceContentField =
  | "html"
  | "markdown"
  | "mermaid"
  | "patch"
  | "text"
  | "data"
  | "code";

export interface SurfaceKindMetadata {
  // Primary inline content slot used by content-only edits and feed previews.
  // Kinds without one are either by-reference assets or structured timelines.
  contentField?: SurfaceContentField;
  // Kinds served as opaque-origin HTML documents from /s/:id?surface=N.
  sandboxed: boolean;
  // Stable iframe selector hook for sandboxed kinds that need kind-specific CSS.
  frameClass?: string;
}

export const SURFACE_KIND_METADATA = {
  html: { contentField: "html", sandboxed: true },
  diff: { contentField: "patch", sandboxed: true, frameClass: "diffframe" },
  image: { sandboxed: false },
  markdown: { contentField: "markdown", sandboxed: true, frameClass: "mdframe" },
  terminal: { contentField: "text", sandboxed: true, frameClass: "termframe" },
  mermaid: { contentField: "mermaid", sandboxed: true, frameClass: "mermaidframe" },
  json: { contentField: "data", sandboxed: false },
  code: { contentField: "code", sandboxed: true, frameClass: "codeframe" },
} as const satisfies Record<SurfaceKind, SurfaceKindMetadata>;

export const SURFACE_KIND_LIST = SURFACE_KINDS.join(", ");
export const SANDBOXED_SURFACE_KINDS = SURFACE_KINDS.filter(
  (kind) => SURFACE_KIND_METADATA[kind].sandboxed,
);
export const NATIVE_SURFACE_KINDS = SURFACE_KINDS.filter(
  (kind) => !SURFACE_KIND_METADATA[kind].sandboxed,
);
export const SURFACE_CONTENT_FIELDS = Object.fromEntries(
  SURFACE_KINDS.flatMap((kind) => {
    const meta = SURFACE_KIND_METADATA[kind];
    const field = "contentField" in meta ? meta.contentField : undefined;
    return field ? [[kind, field]] : [];
  }),
) as Partial<Record<SurfaceKind, SurfaceContentField>>;
export const SURFACE_FRAME_CLASSES = Object.fromEntries(
  SURFACE_KINDS.flatMap((kind) => {
    const meta = SURFACE_KIND_METADATA[kind];
    const frameClass = "frameClass" in meta ? meta.frameClass : undefined;
    return frameClass ? [[kind, frameClass]] : [];
  }),
) as Partial<Record<SurfaceKind, string>>;

export function isSurfaceKind(kind: unknown): kind is SurfaceKind {
  return typeof kind === "string" && Object.hasOwn(SURFACE_KIND_METADATA, kind);
}

export function isSandboxedSurfaceKind(kind: unknown): kind is SurfaceKind {
  return isSurfaceKind(kind) && SURFACE_KIND_METADATA[kind].sandboxed;
}

export interface HtmlSurface {
  kind: "html";
  html: string;
  // Opt-in style/behavior bundles (see kits.ts). The sandbox doc gets each
  // listed kit's CSS/JS injected after the base kit; omit for plain html.
  kits?: string[];
}

// A markdown surface is prose — explanations, plans, tradeoff write-ups. The
// server renders it to HTML with raw HTML escaped, then serves that HTML as a
// sandboxed rich surface document. Agents wanting live markup use an html surface
// instead.
export interface MarkdownSurface {
  kind: "markdown";
  markdown: string;
}

// A mermaid surface is diagram source (flowchart, sequence, ERD, gantt, …).
// Mermaid needs a DOM, so /s/:id serves a sandboxed self-rendering document that
// loads mermaid from the CDN allowlist. Agents wanting hand-drawn vector art use
// an html surface with inline <svg> instead.
export interface MermaidSurface {
  kind: "mermaid";
  mermaid: string;
}

export interface DiffFile {
  filename: string;
  before: string;
  after: string;
  // Shiki language id; inferred from the filename when omitted.
  language?: string;
}

export interface DiffSurface {
  kind: "diff";
  // A unified/git patch (may span multiple files) and/or explicit before/after
  // file pairs. At least one must be present; the viewer prefers `patch`.
  patch?: string;
  files?: DiffFile[];
  layout?: "unified" | "split";
}

// An image surface references an uploaded asset by id; the trusted viewer renders
// it as a plain <img> in its own chrome (no iframe). Agents can also embed the
// asset's URL inside an html surface instead — both paths resolve to /a/:id.
export interface ImageSurface {
  kind: "image";
  assetId: string;
  alt?: string;
  caption?: string;
}

// A terminal surface renders monospace terminal output the viewer styles as a
// terminal window. `text` travels inline (like html) — raw output that may
// carry ANSI SGR escapes (colors/bold/italic); the viewer converts those to
// styled spans and HTML-escapes everything else. `cols` is an optional render
// width hint; `title` labels the window chrome. The renderer is intentionally
// SGR-only for now (cursor-addressing TUIs aren't resolved) — the wire shape
// is renderer-agnostic so a full VT emulator can replace it later.
export interface TerminalSurface {
  kind: "terminal";
  text: string;
  cols?: number;
  title?: string;
}

// A json surface is a pre-parsed JSON value the trusted viewer renders as a
// collapsible tree (objects/arrays expand and collapse; primitives show inline).
// Like image it is DATA, not markup: the viewer renders it with Solid
// text nodes, which escape by construction — so agent-authored JSON can never
// execute in the trusted viewer origin, and no sandboxed iframe is needed.
// `data` is `unknown` (any JSON value, including null); the wire body already
// parsed it, so the viewer never needs to JSON.parse.
export interface JsonSurface {
  kind: "json";
  data: unknown;
}

// A code surface is source code the trusted viewer highlights with shiki (the
// same highlighter MarkdownPart uses for fenced code blocks) and renders in a
// sandboxed iframe. Like markdown/mermaid it is DATA, not markup: the viewer
// produces the HTML string via shiki, then SandboxedPart parses it inside an
// opaque-origin iframe. `language` is a shiki lang id (ts, js, python, rust,
// go, ...); omit or use "text" for plain monospace. `title` is an optional
// label (e.g. a filename) shown above the code.
export interface CodeSurface {
  kind: "code";
  code: string;
  language?: string;
  title?: string;
  // 1-based line number the displayed code starts at (e.g. 80 for "lines
  // 80-150 of x.ts"). The viewer renders line numbers starting here instead
  // of 1, so an agent can show an excerpt with its original line numbers.
  lineStart?: number;
}

// Every surface optionally carries a server-assigned id — a short, stable
// identifier for per-surface targeting (append/edit/remove/reorder). The id
// is assigned by normalizeSurfaceIds on create/update and preserved across
// per-surface mutations; full-replace updates assign fresh ids.
export type Surface =
  | (HtmlSurface & { id?: string })
  | (DiffSurface & { id?: string })
  | (ImageSurface & { id?: string })
  | (MarkdownSurface & { id?: string })
  | (TerminalSurface & { id?: string })
  | (MermaidSurface & { id?: string })
  | (JsonSurface & { id?: string })
  | (CodeSurface & { id?: string });

// --- knobs ---
// Mirrors tunekit's `usePane` config shape as plain data, so the viewer can hand
// a mock's knobs to tunekit unchanged while the server never imports tunekit.
// Only value-carrying controls are knobs: tunekit's action/slot/folder have no
// value a reply could carry, and folders are flattened into dotted paths.

export interface SliderKnob {
  type: "slider";
  value: number;
  min: number;
  max: number;
  step?: number;
}
export interface ToggleKnob {
  type: "toggle";
  value: boolean;
}
export type KnobOption = string | { value: string; label: string };
export interface SelectKnob {
  type: "select";
  value?: string;
  options: KnobOption[];
}
export interface ColorKnob {
  type: "color";
  value?: string;
  gradient?: boolean;
  contrast?: string;
}
export interface TextKnob {
  type: "text";
  value?: string;
  placeholder?: string;
}
export interface SpringKnob {
  type: "spring";
  stiffness?: number;
  damping?: number;
  mass?: number;
  visualDuration?: number;
  bounce?: number;
}
export interface EasingKnob {
  type: "easing";
  duration: number;
  ease: [number, number, number, number];
}
export interface ImageKnob {
  type: "image";
  value?: string;
  options?: KnobOption[];
}
// [default, min, max, step?] — tunekit's slider-tuple notation.
export type KnobAxis = [number, number, number] | [number, number, number, number];
export interface PadKnob {
  type: "pad";
  x?: KnobAxis;
  y?: KnobAxis;
  labels?: { x?: string; y?: string };
}
export type ExplicitKnob =
  | SliderKnob
  | ToggleKnob
  | SelectKnob
  | ColorKnob
  | TextKnob
  | SpringKnob
  | EasingKnob
  | ImageKnob
  | PadKnob;
// tunekit's shorthands: a number or tuple is a slider, a boolean a toggle, a
// string a color or text.
export type KnobConfig = ExplicitKnob | KnobAxis | number | boolean | string;
// Keyed by path: "size" is global, "body.size" belongs to the `body` part.
export type Knobs = Record<string, KnobConfig>;
export interface PadValue {
  x: number;
  y: number;
}
export type KnobValue = number | boolean | string | PadValue | SpringKnob | EasingKnob;

// --- project › mock › state › variant › version ---

export type MockKind = "page" | "component";
// A variant's review state. A variant-bound answer accepts the chosen variant
// and archives its siblings in that state; archived variants are restorable.
export type PostStatus = "open" | "accepted" | "archived";

export interface AskOption {
  id: string;
  label: string;
  // Picking this option means "this look": the variant it names is accepted.
  variant?: string;
  // Picking this option means "these knob values".
  set?: Record<string, KnobValue>;
}

export type AskAnswer = string | string[];

// A structured question from the agent. `scope` says what it decides: the whole
// mock, one state, or one part.
export interface Ask {
  id: string;
  text: string;
  scope: "mock" | "state" | "part";
  state?: string;
  part?: string;
  options: AskOption[];
  multi?: boolean;
  // Set when a reply answered it; an ask with none of answer, other or note is
  // still open.
  answer?: AskAnswer;
  // The user's write-in under the viewer's "Other…" option.
  other?: string;
  // The user's note qualifying the answer ("Table on desktop, Cards on mobile").
  note?: string;
  at: string;
}

// The viewer's write-in option on every ask. Reserved, so a delivered
// `{id: "other", other: true}` choice never shadows an option the agent declared.
export const OTHER_ID = "other";

// A comment the user left on a part (or, with part null, anywhere on the render
// via the Mark tool). Rides inside the reply rather than as its own comment.
export interface PartCommentAnchor {
  offset?: [number, number];
  quote?: string;
  selector?: string;
  box?: number[];
}
export interface PartComment {
  part: string | null;
  state: string | null;
  text: string;
  anchor?: PartCommentAnchor;
}

// What a reply decides about one variant outside the ask flow (the plain
// Accept / Revise / Drop of a mock without asks).
export interface ReplyDecision {
  kind: "accept" | "revise" | "drop";
  state: string | null;
  variant: string;
}

// The user's unsent picks, tuned values and comments for one mock. Lives
// server-side so it survives a reload; never delivered until Send.
export interface Draft {
  // The variant version on stage when the draft was made; a newer version
  // arriving mid-answer leaves the draft bound to this one.
  version: number;
  answers: Record<string, AskAnswer>;
  mix: Record<string, string>;
  tuned: Record<string, KnobValue>;
  comments: PartComment[];
  // askId → the write-in under "Other…" / the note on that question. Optional
  // because drafts stored before they existed lack them.
  others?: Record<string, string>;
  notes?: Record<string, string>;
  updatedAt: string;
}

// The user's one batched answer — the payload of a kind:"reply" comment.
export interface Reply {
  mockId: string;
  version: number;
  answers: Record<string, AskAnswer>;
  mix: Record<string, string>;
  tuned: Record<string, KnobValue>;
  comments: PartComment[];
  others?: Record<string, string>;
  notes?: Record<string, string>;
  text?: string;
  decision?: ReplyDecision;
}

export interface Mock {
  id: string;
  project: string;
  slug: string;
  title: string;
  kind: MockKind;
  // Ordered state labels; [] means a single-state mock whose posts carry state null.
  states: string[];
  asks: Ask[];
  knobs: Knobs;
  draft: Draft | null;
  // The agent conversation currently driving this mock (its latest writer), so a
  // reply lands on the cursor of the session that is waiting for it.
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

// One component included in a page, pinned to an exact version (snapshot
// semantics: pulling a newer version is an explicit new page version). `slug`
// names a mock in the same project.
export interface Slot {
  slug: string;
  variant: string;
  version: number;
}

export interface PostVersion {
  version: number;
  title: string;
  surfaces: Surface[];
  at: string;
  // The version this one was based on — usually the previous one, but an agent
  // may branch from any earlier version.
  from?: number;
  // What prompted this version. Empty for the initial version.
  prompt?: string;
  author?: string;
}

// A variant of one state of a mock.
export interface Post {
  id: string;
  sessionId: string;
  mock: string;
  state: string | null;
  variant: string;
  status: PostStatus;
  title: string;
  surfaces: Surface[];
  createdAt: string;
  updatedAt: string;
  version: number;
  history: PostVersion[];
  // Per-part knob overrides for this variant.
  knobs?: Knobs;
  slots: Slot[];
  // Provenance of the CURRENT version — the same three fields a PostVersion
  // carries; on the next update they move into the history entry.
  from?: number;
  prompt?: string;
  author?: string;
}

export interface ProjectSummary {
  name: string;
  mocks: number;
  // Open asks across the project's mocks.
  open: number;
  lastActiveAt: string;
  sessions: number;
}

// Per-project design system state, imported from the repo by `mockpit init`
// and rendered into every html surface's sandbox (see renderHtmlPage). Stored
// as JSON under the settings key `design:<project>`.
export interface DesignSettings {
  detected: { tailwind: boolean; shadcn: boolean; cssVars: number; fonts: string[] } | null;
  palette: { light: Palette; dark: Palette } | null;
  // "tailwind" (the repo's own utilities), "none", or a bundled or project kit
  // id injected into every html surface of the project.
  kit: string;
  // Raw `:root{...}` block imported from the repo, injected into the frame.
  cssVars: string;
  // The repo's Tailwind entry stylesheet, reduced to what the browser build
  // compiles, so the repo's theme classes work in the frame. Empty when the
  // project is not on Tailwind v4. Older settings predate it; read as "".
  tailwindCss: string;
  // What init removed from it (non-core imports, plugins, configs): the
  // utilities those provide are missing in the frame.
  strippedImports: string[];
  // Iconify sets installed for this project (`mockpit icons add`), on top of
  // the ones bundled with the server. Older settings predate it; read as [].
  iconSets: IconSetRef[];
  // Kits this project defined (`mockpit kit add`). Older settings predate it;
  // read as [].
  projectKits: ProjectKit[];
  // What the repo's DESIGN.md, DTCG token files and shadcn components.json
  // say, read by init for the brief. Older settings predate it; read as null.
  designFiles?: DesignFiles | null;
  updatedAt: string;
}

// A team's own component CSS on the CDN allowlist: addressable in
// `surfaces[].kits` like a bundled kit. `doc` is the class cheat sheet the brief
// prints when this kit is the project's default.
export interface ProjectKit {
  id: string;
  href: string;
  script?: string;
  doc: string;
}

// Each part is present only when the repo has that file.
export interface DesignFiles {
  designMd?: {
    name: string;
    colors: Record<string, string>;
    typography: Record<string, Record<string, string>>;
    rounded: Record<string, string>;
    spacing: Record<string, string>;
    components: Record<string, Record<string, string>>;
    headings: string[];
    dos: string;
  };
  tokens?: {
    files: string[];
    // Before the cap; `values` holds at most 400.
    count: number;
    // Every token name, dots as dashes, is declared in the frame's stylesheet.
    cssVars: boolean;
    values: Record<string, string>;
  };
  shadcn?: { style: string; baseColor: string; iconLibrary: string; components: string[] };
}

// One installed Iconify JSON set: the uploaded asset holding it and how many
// visible icons it has.
export interface IconSetRef {
  prefix: string;
  assetId: string;
  count: number;
}

export type CommentAnchor =
  | {
      kind: "point";
      surfaceIndex: number;
      surfaceId?: string;
      surfaceKind?: SurfaceKind;
      postVersion: number;
      x: number;
      y: number;
    }
  | {
      kind: "rect";
      surfaceIndex: number;
      surfaceId?: string;
      surfaceKind?: SurfaceKind;
      postVersion: number;
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | {
      kind: "lineRange";
      surfaceIndex: number;
      surfaceId?: string;
      surfaceKind?: SurfaceKind;
      postVersion: number;
      startLine: number;
      endLine: number;
      file?: string;
    }
  | ({ kind: "part"; part: string; state: string | null } & PartCommentAnchor);

// A reply is a comment with a kind, so delivery reuses the one cursor.
export type CommentKind = "comment" | "ask" | "reply";

// One point-and-comment marker drawn over a rendered surface (the Mark tool).
// Everything here is DATA: the overlay lives in the trusted viewer origin and
// renders it as text nodes / positioned elements, never as HTML.
export interface Anchor {
  // The `@n` token that ties this marker to its mention in the comment text.
  ref: string;
  shape: "pin" | "rect" | "circle";
  // [x,y] for a pin, [x,y,w,h] for rect/circle — normalized 0..1 of the surface.
  box: number[];
  surfaceIndex: number;
  postVersion: number;
  // CSS path and first line of visible text, answered by the sandbox hit test.
  path?: string;
  text?: string;
  // Viewport preset (390 | 820 | 1280) in use when the marker was drawn.
  viewport?: number;
}

export interface Comment {
  id: string;
  seq: number;
  sessionId: string;
  mockId: string | null;
  postId: string | null;
  author: string;
  text: string;
  createdAt: string;
  // Optional anchor on a rendered area, line or part. Data only: render with
  // text/positioned elements in the trusted viewer, never as HTML.
  anchor?: CommentAnchor;
  kind: CommentKind;
  anchors: Anchor[];
  postVersion: number | null;
  viewport: number | null;
  // Set on kind "reply": the user's batched answer.
  payload?: Reply;
}

// An uploaded blob (image, arbitrary file) the agent pushes once and references
// by id. Stored apart from surfaces so binary never bloats the surfaces JSON or
// the 2 MB post limit. `data` is raw bytes — base64 is an edge-only encoding.
export type AssetKind = "image" | "file";

export interface Asset {
  id: string;
  sessionId: string;
  kind: AssetKind;
  contentType: string;
  byteLength: number;
  filename: string | null;
  data: Uint8Array;
  createdAt: string;
  // Bumped on each serve; drives the reference-aware LRU eviction below.
  lastAccessedAt: string;
}

export interface CreateAssetInput {
  sessionId: string;
  kind: AssetKind;
  contentType: string;
  filename?: string;
  data: Uint8Array;
}

export interface CreateSessionInput {
  agent: string;
  title?: string;
  cwd?: string;
  project?: string;
}

export interface CreateMockInput {
  project: string;
  slug: string;
  title?: string;
  kind?: MockKind;
  states?: string[];
  knobs?: Knobs;
  sessionId?: string | null;
}

export interface UpdateMockInput {
  title?: string;
  kind?: MockKind;
  states?: string[];
  asks?: Ask[];
  knobs?: Knobs;
  sessionId?: string | null;
}

export interface CreatePostInput {
  sessionId: string;
  mock: string;
  state: string | null;
  variant?: string;
  title?: string;
  surfaces: Surface[];
  knobs?: Knobs;
  slots?: Slot[];
  from?: number;
  prompt?: string;
  author?: string;
}

export interface UpdatePostInput {
  title?: string;
  surfaces?: Surface[];
  // undefined keeps, null clears.
  knobs?: Knobs | null;
  slots?: Slot[];
  from?: number;
  prompt?: string;
  author?: string;
  // Re-files the variant under another state (a single-state mock adopting its
  // first named state).
  state?: string | null;
}

export interface CreateCommentInput {
  sessionId: string;
  mockId?: string | null;
  postId?: string | null;
  author: string;
  text: string;
  anchor?: CommentAnchor;
  kind?: CommentKind;
  anchors?: Anchor[];
  postVersion?: number | null;
  viewport?: number | null;
  payload?: Reply;
}

export interface CommentQuery {
  sessionId?: string;
  mockId?: string;
  postId?: string;
  afterSeq?: number;
}

// Everything one Send writes. The store applies it atomically: the reply
// comment, the answers recorded on the asks, the status flips, the cleared draft.
export interface CommitReplyInput {
  mockId: string;
  sessionId: string;
  text: string;
  payload: Reply;
  asks: Ask[];
  accept: string[];
  archive: string[];
}

export interface PostQuery {
  mockId?: string;
  sessionId?: string;
}

export interface Store {
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;
  createSession(input: CreateSessionInput): Promise<Session>;
  renameSession(id: string, title: string): Promise<Session | null>;
  removeSession(id: string): Promise<boolean>;
  // Advance the delivered-to-agent comment cursor (never moves backwards).
  markAgentSeen(sessionId: string, seq: number): Promise<void>;

  // Workspace-level key/value settings (e.g. the selected theme id). Returns null
  // for an unset key.
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  listProjects(): Promise<ProjectSummary[]>;
  // Newest first; every project when `project` is omitted.
  listMocks(project?: string): Promise<Mock[]>;
  getMock(id: string): Promise<Mock | null>;
  findMock(project: string, slug: string): Promise<Mock | null>;
  createMock(input: CreateMockInput): Promise<Mock>;
  updateMock(id: string, patch: UpdateMockInput): Promise<Mock | null>;
  // Cascades the mock's posts and comments.
  removeMock(id: string): Promise<boolean>;
  putDraft(mockId: string, draft: Draft | null): Promise<Mock | null>;

  // Oldest first.
  listPosts(query?: PostQuery): Promise<Post[]>;
  // Variants per session, without loading bodies or history.
  countPostsBySession(): Promise<Map<string, number>>;
  getPost(id: string): Promise<Post | null>;
  findPost(mockId: string, state: string | null, variant: string): Promise<Post | null>;
  createPost(input: CreatePostInput): Promise<Post | null>;
  updatePost(id: string, patch: UpdatePostInput): Promise<Post | null>;
  removePost(id: string): Promise<boolean>;
  setPostStatus(id: string, status: PostStatus): Promise<Post | null>;

  listComments(query: CommentQuery): Promise<Comment[]>;
  createComment(input: CreateCommentInput): Promise<Comment | null>;
  removeComment(id: string): Promise<Comment | null>;
  commitReply(input: CommitReplyInput): Promise<Comment | null>;

  // Assets. putAsset evicts to stay under MAX_WORKSPACE_ASSET_BYTES (see
  // selectEvictions) and returns null only if the session is missing.
  putAsset(input: CreateAssetInput): Promise<Asset | null>;
  getAsset(id: string): Promise<Asset | null>;
  // Bump lastAccessedAt (called when bytes are served), keeping live assets warm.
  touchAsset(id: string): Promise<void>;
  listAssets(sessionId: string): Promise<Asset[]>;
  removeAsset(id: string): Promise<boolean>;
  // Whether any live surface (current or historical version) references this
  // asset id. Drives the optimistic-read wait and reference-aware deletion.
  isAssetReferenced(id: string): Promise<boolean>;
}

// The slice of a Durable Object's `SqlStorage` that SqlStore actually uses.
// Declared here as a plain interface (rather than leaning on the ambient
// Cloudflare global) so the SAME SqlStore runs on the DO and on Node's
// node:sqlite via a thin adapter, and both the node and workers typecheck
// programs resolve it the same way. A real DO `SqlStorage` is structurally
// assignable to this narrower shape.
export type SqlStorageValue = ArrayBuffer | string | number | null;
export interface SqlStorageCursor {
  toArray(): Record<string, SqlStorageValue>[];
  one(): Record<string, SqlStorageValue>;
}
export interface SqlStorage {
  exec(query: string, ...bindings: SqlStorageValue[]): SqlStorageCursor;
  // Runs fn atomically. Optional: a Durable Object already commits the
  // synchronous writes of one event as a unit, so its SqlStorage omits it.
  transactionSync?<T>(fn: () => T): T;
}

export const HISTORY_LIMIT = 20;

// "user" is the reserved trust label for genuine human comments. A session
// agent with that name could otherwise have its programmatic comments delivered
// as user feedback, so the store normalizes it when creating sessions.
export function reservedAgent(name: string): string {
  return name === "user" ? "agent" : name;
}

// SQLite terminates a TEXT value at the first embedded NUL byte. A NUL has no
// place in a title/comment/label anyway, so stored text is stripped of it
// (removing the byte, not truncating). Returns the input untouched when there's
// nothing to strip, so the common path is free.
const NUL_CHAR = String.fromCharCode(0);
export function stripNul<T extends string | null | undefined>(s: T): T {
  return (typeof s === "string" && s.includes(NUL_CHAR) ? s.replaceAll(NUL_CHAR, "") : s) as T;
}

// Per-asset upload cap (enforced at the HTTP/MCP edge → 413) and the workspace-wide
// budget the store evicts down to. One Durable Object holds the whole workspace, so
// the budget sits well under its ~10 GB SQLite ceiling.
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_WORKSPACE_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

// Short, unguessable id: 8 random bytes (64 bits) as 11 url-safe base64 chars.
// These double as bearer capabilities: in publicRead mode `/s/:id` and
// `/api/mocks/:id` are reachable without the workspace token, so the id IS the
// share secret and must resist enumeration. btoa is a global in both Node and
// Workers.
export const newId = () => {
  let id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(8))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  // Ids are used as CLI positional args and path segments. A leading "-" or
  // "_" makes node:util parseArgs treat them as options, so swap a leading
  // separator for an alphanumeric.
  if (id[0] === "-" || id[0] === "_") id = "0" + id.slice(1);
  return id;
};

// Content-addressed asset id: the lowercase hex SHA-256 of the bytes. Because
// it depends only on the content, an agent can derive `/a/:id` from the bytes
// alone — no upload round-trip — and write the URL into a surface before (or
// while) the upload lands. Identical uploads collapse to one stored blob.
export async function hashAssetId(data: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view: digest wants a definite
  // ArrayBuffer, and this also avoids the SharedArrayBuffer-backed lib type.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Assign a stable id to every surface that lacks one, preserving existing ids.
export function normalizeSurfaceIds(surfaces: Surface[]): Surface[] {
  return surfaces.map((s) => (s.id ? s : { ...s, id: newId() }));
}

// Fallback project for sessions that never declared one (bare `curl` publishes).
export const DEFAULT_PROJECT = "workspace";
export const DEFAULT_VARIANT = "default";

// Stable, url-safe slug derived from a title. Empty input yields "mock" so a
// slug is never the empty string.
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "mock";
}

// Last path segment of a working directory, for sessions that never declared a
// project. Handles both separators so a Windows cwd resolves the same way.
export function projectFromCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const parts = cwd.split(/[/\\]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

export const htmlSurface = (html: string, kits?: unknown): HtmlSurface => ({
  kind: "html",
  html,
  ...(Array.isArray(kits) && kits.length > 0
    ? { kits: kits.filter((k) => typeof k === "string") }
    : {}),
});

// An open ask is one no reply has answered yet: a write-in or a note alone
// answers it too ("Neither, because…").
export const askAnswered = (a: Pick<Ask, "answer" | "other" | "note">): boolean =>
  a.answer !== undefined || a.other !== undefined || a.note !== undefined;
export const openAsks = (mock: Pick<Mock, "asks">): Ask[] =>
  mock.asks.filter((a) => !askAnswered(a));

// How many built-in "Which one?" asks the viewer shows: one mock-wide when every
// state needs one and the live names line up, else one per needing state. Same
// rule as viewer/src/logic.ts builtinAsks, so Home, `read` and `pending` count
// the question the user actually sees. Answering it archives the losers, which
// is what makes it stop counting.
export function builtinAskCount(
  mock: Pick<Mock, "asks" | "states">,
  posts: Pick<Post, "mock" | "state" | "variant" | "status">[],
  mockId: string,
): number {
  const live = (state: string | null) =>
    posts
      .filter((p) => p.mock === mockId && p.state === state && p.status !== "archived")
      .map((p) => p.variant);
  const needs = (state: string | null) => {
    const names = live(state);
    if (names.length < 2) return false;
    return !mock.asks.some(
      (a) =>
        (a.scope === "mock" || (a.scope === "state" && a.state === state)) &&
        names.every((n) => a.options.some((o) => o.variant === n)),
    );
  };
  const states = mock.states.length ? mock.states : [null];
  const needing = states.filter(needs);
  if (!needing.length) return 0;
  const key = (state: string | null) => [...live(state)].sort().join("\n");
  const first = key(needing[0]);
  return needing.length === states.length && states.every((st) => key(st) === first)
    ? 1
    : needing.length;
}

export const openCount = (
  mock: Pick<Mock, "id" | "asks" | "states">,
  posts: Pick<Post, "mock" | "state" | "variant" | "status">[],
): number => openAsks(mock).length + builtinAskCount(mock, posts, mock.id);

// The viewer's built-in "Which one?" for variants no agent ask binds: `variant`
// mock-wide, `variant:<state>` per state. Never stored; synthesized from the
// variants so a reply answering it validates, flips and reads like any ask. An
// option's id is the variant name, so the viewer needs no id mapping.
export const BUILTIN_ASK_ID = "variant";

export function builtinAsk(
  mock: Pick<Mock, "states">,
  posts: Pick<Post, "state" | "variant">[],
  id: string,
): Ask | undefined {
  let state: string | null = null;
  if (id !== BUILTIN_ASK_ID) {
    if (!id.startsWith(`${BUILTIN_ASK_ID}:`)) return undefined;
    state = id.slice(BUILTIN_ASK_ID.length + 1);
    if (!mock.states.includes(state)) return undefined;
  }
  const names = [
    ...new Set(posts.filter((p) => state === null || p.state === state).map((p) => p.variant)),
  ];
  if (names.length === 0) return undefined;
  return {
    id,
    text: "Which one?",
    scope: state === null ? "mock" : "state",
    ...(state === null ? {} : { state }),
    options: names.map((v) => ({ id: v, label: v, variant: v })),
    at: "",
  };
}

// Per-project rollup for the projects list. Pure, so every store agrees on
// what "open" and "lastActiveAt" mean.
export function summarizeProjects(
  mocks: Mock[],
  sessions: Session[],
  posts: Post[] = [],
): ProjectSummary[] {
  const byProject = new Map<string, Mock[]>();
  for (const m of mocks) {
    const list = byProject.get(m.project);
    if (list) list.push(m);
    else byProject.set(m.project, [m]);
  }
  const sessionCounts = new Map<string, number>();
  const sessionActive = new Map<string, string>();
  for (const s of sessions) {
    const name = s.project ?? projectFromCwd(s.cwd) ?? DEFAULT_PROJECT;
    sessionCounts.set(name, (sessionCounts.get(name) ?? 0) + 1);
    const prev = sessionActive.get(name);
    if (!prev || s.lastActiveAt > prev) sessionActive.set(name, s.lastActiveAt);
  }
  const names = new Set([...byProject.keys(), ...sessionCounts.keys()]);
  return [...names]
    .map((name) => {
      const list = byProject.get(name) ?? [];
      const lastMock = list.reduce((max, m) => (m.updatedAt > max ? m.updatedAt : max), "");
      return {
        name,
        mocks: list.length,
        open: list.reduce((n, m) => n + openCount(m, posts), 0),
        lastActiveAt: [lastMock, sessionActive.get(name) ?? ""].sort().pop() ?? "",
        sessions: sessionCounts.get(name) ?? 0,
      };
    })
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

// The combined byte weight of a post's surfaces, for size limits. image
// surfaces are tiny refs — the asset bytes they point at are bounded separately
// by MAX_ASSET_BYTES, not this post cap.
export function surfacesByteLength(surfaces: Surface[]): number {
  let n = 0;
  for (const p of surfaces) {
    if (p.kind === "html") n += p.html.length;
    else if (p.kind === "diff") {
      n += p.patch?.length ?? 0;
      for (const f of p.files ?? []) n += f.before.length + f.after.length;
    } else if (p.kind === "image") {
      n += p.assetId.length + (p.alt?.length ?? 0) + (p.caption?.length ?? 0);
    } else if (p.kind === "markdown") {
      n += p.markdown.length;
    } else if (p.kind === "terminal") {
      n += p.text.length + (p.title?.length ?? 0);
    } else if (p.kind === "mermaid") {
      n += p.mermaid.length;
    } else if (p.kind === "json") {
      n += JSON.stringify(p.data).length;
    } else {
      n +=
        p.code.length + (p.language?.length ?? 0) + (p.title?.length ?? 0) + (p.lineStart ? 4 : 0);
    }
  }
  return n;
}

// Collect the asset ids an ordered surfaces list references (image surfaces).
// Used to keep referenced assets out of eviction's first wave. Assets embedded
// by raw URL inside html markup are invisible here — touch-on-serve keeps those
// warm instead.
export function collectAssetIds(surfaces: Surface[], out: Set<string>): void {
  for (const p of surfaces) {
    if (p.kind === "image") out.add(p.assetId);
  }
}

export interface EvictionCandidate {
  id: string;
  byteLength: number;
  lastAccessedAt: string;
  referenced: boolean;
}

// Pick the assets to evict so `incomingBytes` fits under `budget`. Oldest
// (lastAccessedAt) first, but unreferenced assets go before referenced ones —
// a live embed is only evicted as a last resort, once unreferenced candidates
// are exhausted. Returns the ids to remove (possibly empty).
export function selectEvictions(
  candidates: EvictionCandidate[],
  incomingBytes: number,
  budget: number,
): string[] {
  let total = candidates.reduce((sum, c) => sum + c.byteLength, 0);
  if (total + incomingBytes <= budget) return [];
  const order = [...candidates].sort((a, b) => {
    if (a.referenced !== b.referenced) return a.referenced ? 1 : -1;
    return a.lastAccessedAt.localeCompare(b.lastAccessedAt);
  });
  const evict: string[] = [];
  for (const c of order) {
    if (total + incomingBytes <= budget) break;
    evict.push(c.id);
    total -= c.byteLength;
  }
  return evict;
}
