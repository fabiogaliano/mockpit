// Typed client for the routes the viewer reads and writes. Response types come
// straight from the server's view functions, so a contract change breaks the
// viewer's typecheck instead of its runtime.

import type {
  areaView,
  designDetailView,
  designSummaryView,
  treeNodeView,
  variantView,
} from "../../server/apiViews.ts";
import type { DecisionLine } from "../../server/decisionList.ts";
import type { FeedEvent } from "../../server/events.ts";
import type {
  AnswerSet,
  AnswerStanding,
  AskAnswer,
  Comment,
  CopyRef,
  LiveCopy,
  Draft,
  FlowStep,
  KnobValue,
  DesignKind,
  StateOutline,
  PartComment,
  ProjectSummary,
  ReplyVerdict,
  SpecLine,
} from "../../server/types.ts";
import { basePath, host, renderRev } from "./host.ts";
import {
  framePalette,
  notePalettes,
  noteSystemRev,
  peekRev,
  systemChanged,
  systemRev,
} from "./systemRev.ts";

import type { JumpHit } from "../../server/jump.ts";
import type { PaletteStatus, System, SystemRevisionHead } from "../../server/system.ts";
import type { PairResult } from "../../server/systemChecks.ts";
import type { ComponentLine } from "../../server/designGuide.ts";

// The System page's read: the system with its checks, the latest revisions, every
// palette's contrast and the components.
export type SystemPage = System & {
  checks: string[];
  revisions: SystemRevisionHead[];
  contrast: PairResult[];
  components: ComponentLine[];
  // The user's own decisions that reached an agent, by the revision each made.
  told?: { rev: number; delivered: boolean }[];
};
export type DesignSummary = ReturnType<typeof designSummaryView>;
// A palette of the project's system as the switcher shows it: a swatch of its first roles.
export type PaletteChoice = {
  id: string;
  label: string;
  status: "default" | "kept" | "open" | "hidden";
  swatch: { light: string[]; dark: string[] };
};
export type DesignDetail = ReturnType<typeof designDetailView> & {
  systemRev?: number;
  palettes?: PaletteChoice[];
};
export type TreeNode = ReturnType<typeof treeNodeView>;
// One area as `read --area` returns it: the area page draws the same.
export type AreaView = ReturnType<typeof areaView>;
// A project's area in the order Home lists them, with what it is for. An `alphabetical`
// one is in no order: it is listed for its description alone.
export type AreaLine = { name: string; description?: string; alphabetical?: true };
// A declared flow as `read` returns it: only steps whose screen exists.
export type FlowView = { name: string; steps: FlowStep[] };
export type VariantView = ReturnType<typeof variantView>;
export type HistoryRow = NonNullable<VariantView["history"]>[number];
// What a restore changed, sent back as it is by its Undo.
export type RestoreUndo = {
  archivedAt: string | null;
  archiveReason: string | null;
  dismissed: string[];
  variants: { id: string; archivedAt: string; reason: string | null }[];
};
export type DecisionListView = { project: string; total: number; lines: DecisionLine[] };
// `ownerGone`: undelivered, and a newer agent session in the project superseded
// the one it was sent to, so the next agent there will get it. `listening`:
// undelivered, with a `mockpit watch` open that will take it. `calledAt`: delivered,
// and the agent's last call of its own since.
export type CommentRow = Comment & {
  delivered: boolean;
  ownerGone?: boolean;
  listening?: boolean;
  calledAt?: string;
  recipient?: string;
};
export interface SendRecipient {
  id: string;
  name: string;
  lastCallAt: string;
  listening: boolean;
  asked: boolean;
  designs: string[];
}
export interface SendRecipients {
  default: string | null;
  recipients: SendRecipient[];
}
export type { FeedEvent, JumpHit, ProjectSummary };

// What the viewer edits: a Draft minus the server's timestamp.
export interface DraftInput {
  version: number;
  answers: Record<string, AskAnswer>;
  borrowed: Record<string, string>;
  tuned: Record<string, KnobValue>;
  comments: PartComment[];
  others: Record<string, string>;
  askComments: Record<string, string>;
  otherImages: Record<string, string[]>;
  askCommentImages: Record<string, string[]>;
}

export interface Shortlist {
  id: string;
  slug: string;
  title: string;
  candidates: { variant: string; copiedFrom: CopyRef | null }[];
}
export type SaveCandidate = CopyRef;
export type { LiveCopy };

export interface DesignList {
  project?: string;
  designs: DesignSummary[];
  open: number;
  openDesigns: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const url = (path: string) => `${basePath()}${path}`;

// Names this page as the viewer to the server (server/viewerRequest.ts): a
// custom header no cross-origin page or sandboxed surface can send.
const VIEWER = { "x-mockpit-client": "viewer" };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), {
    ...init,
    headers: {
      ...VIEWER,
      ...(init?.headers ?? (init?.body ? { "content-type": "application/json" } : undefined)),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText);
  const rev = Number(res.headers.get("x-mockpit-rev"));
  if (rev && body && typeof body === "object") readRevs.set(body as object, rev);
  return body as T;
}

// The workspace revision a response was read at, beside it rather than in it so
// no response shape has to carry it.
const readRevs = new WeakMap<object, number>();
export const readAt = (body: object | null | undefined) => (body ? (readRevs.get(body) ?? 0) : 0);

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const api = {
  projects: () => call<ProjectSummary[]>("/api/projects"),
  search: (q: string, project: string | null) =>
    call<{ hits: JumpHit[] }>(
      `/api/search?q=${encodeURIComponent(q)}${project ? `&project=${encodeURIComponent(project)}` : ""}`,
    ),
  // The designs this browser opened last, as they are called now.
  searchRecent: (ids: string[]) =>
    call<{ hits: JumpHit[] }>(`/api/search?recent=${ids.map(encodeURIComponent).join(",")}`),
  designs: (project: string) =>
    call<DesignList>(`/api/designs?project=${encodeURIComponent(project)}`),
  // Every project's designs: what the app badge counts.
  shortlists: (project: string) =>
    call<{ shortlists: Shortlist[]; copies: LiveCopy[] }>(
      `/api/projects/${encodeURIComponent(project)}/shortlists`,
    ),
  // Into the design and state `to` names, or the shortlist called `title`, made if
  // need be.
  saveCopies: (body: {
    to?: string;
    state?: string | null;
    title?: string;
    candidates: SaveCandidate[];
  }) =>
    call<{
      to: { id: string; slug: string; title: string; shortlist: boolean };
      saved: { state: string | null; variant: string; already: boolean }[];
    }>("/api/copies", json("POST", body)),
  removeCopy: (design: string, state: string | null, variant: string) =>
    call<unknown>(
      `/api/copies/${encodeURIComponent(design)}/remove`,
      json("POST", { state, variant }),
    ),
  system: (project: string) =>
    call<SystemPage>(`/api/projects/${encodeURIComponent(project)}/system`),
  // The user's hand on the system: one revision, one reply to the project's agent.
  systemDecide: (
    project: string,
    body: { palette: string; status: PaletteStatus } | { restore: number },
  ) =>
    call<{ rev: number; changes: string[]; told?: string | null }>(
      `/api/projects/${encodeURIComponent(project)}/system/decide`,
      json("POST", body),
    ),
  // The project as a tree: what the canvas and the phone's drill-down lay out.
  tree: (project: string) =>
    call<{
      project: string;
      systemRev?: number;
      hasSystem?: boolean;
      tree: TreeNode[];
      flows: FlowView[];
      areas: AreaLine[];
      description?: string;
    }>(`/api/projects/${encodeURIComponent(project)}/tree`).then(seenRev),
  area: (project: string, area: string) =>
    call<AreaView>(
      `/api/projects/${encodeURIComponent(project)}/areas/${encodeURIComponent(area)}`,
    ),
  // The user's words on what an area (or, with no area, the project) is for. They
  // stand against agents until the user clears them.
  describe: (project: string, body: { area?: string; description: string }) =>
    call<unknown>(`/api/projects/${encodeURIComponent(project)}`, json("PATCH", body)),
  // What a phone opening this page would meet (the QR code).
  reach: () =>
    call<{ hosts: string[]; localOnly: boolean; access: "open" | "key" | "read" | "unknown" }>(
      "/api/reach",
    ),
  design: (id: string) =>
    call<DesignDetail>(`/api/designs/${encodeURIComponent(id)}?history=1`)
      .then(seenRev)
      .then((d) => {
        notePalettes(
          d.project,
          (d.palettes ?? []).filter((p) => p.status !== "hidden").map((p) => p.id),
        );
        return d;
      }),
  designIn: (project: string, slug: string) =>
    call<DesignDetail>(
      `/api/designs/${encodeURIComponent(slug)}?history=1&project=${encodeURIComponent(project)}`,
    ).then(seenRev),
  // What the flow bar needs on every design screen, far lighter than the tree.
  flowOutline: (project: string) =>
    call<{
      flows: FlowView[];
      designs: { slug: string; title: string; states: (string | null)[] }[];
    }>(`/api/projects/${encodeURIComponent(project)}/flows`),
  // The same view without version rows: enough to name a design and its variants.
  designHead: (id: string) => call<DesignDetail>(`/api/designs/${encodeURIComponent(id)}`),
  draft: (id: string) =>
    call<{ draft: Draft | null }>(`/api/designs/${encodeURIComponent(id)}/draft`),
  putDraft: (id: string, draft: DraftInput) =>
    call<{ draft: Draft }>(`/api/designs/${encodeURIComponent(id)}/draft`, json("PUT", draft)),
  standing: (
    id: string,
    body: { ask: string; option: string } & (
      | { to: "kept" | "hidden" | "open"; why?: string }
      | { carried: boolean }
    ),
  ) =>
    call<{ ask: string; standing: AnswerStanding }>(
      `/api/designs/${encodeURIComponent(id)}/standings`,
      json("POST", body),
    ),
  saveSet: (
    id: string,
    body: { name: string } & ({ answers: Record<string, AskAnswer> } | { remove: true }),
  ) =>
    call<{ sets: AnswerSet[] }>(`/api/designs/${encodeURIComponent(id)}/sets`, json("POST", body)),
  reply: (
    id: string,
    body: DraftInput & {
      text?: string;
      verdict?: ReplyVerdict;
      to?: string;
      more?: { ask: string; note?: string; like?: string };
      update?: { ask: string; option: string };
      set?: string;
    },
  ) =>
    call<{ reply: CommentRow }>(`/api/designs/${encodeURIComponent(id)}/reply`, json("POST", body)),
  recipients: (id: string) =>
    call<SendRecipients>(`/api/designs/${encodeURIComponent(id)}/recipients`),
  // A new version of the variant made from an older one ("restore as vN").
  restoreVersion: (id: string, postId: string, version: number) =>
    call<unknown>(
      `/api/designs/${encodeURIComponent(id)}/variants/${encodeURIComponent(postId)}/variants/restore`,
      json("POST", { version }),
    ),
  // Use this: one exact version goes in use; the agent hears it as a reply.
  use: (
    id: string,
    body: { state: string | null; variant: string; version: number; to?: string },
  ) =>
    call<{ reply: CommentRow | null }>(
      `/api/designs/${encodeURIComponent(id)}/use`,
      json("POST", body),
    ),
  // Hide a version from the history, or bring it back.
  hide: (
    id: string,
    body: { state: string | null; variant: string; version: number; hidden: boolean },
  ) => call<unknown>(`/api/designs/${encodeURIComponent(id)}/hide`, json("POST", body)),
  // Archive a design: off the shelf, its open asks dismissed, and the agent isn't told.
  // `reason` is the note picked up from what the user last wrote; restoreDesign undoes it.
  archiveDesign: (id: string) =>
    call<{ design: DesignSummary; reason: string | null }>(
      `/api/designs/${encodeURIComponent(id)}/archive`,
      json("POST", {}),
    ),
  restoreDesign: (id: string) =>
    call<{ design: DesignSummary; undo?: RestoreUndo }>(
      `/api/designs/${encodeURIComponent(id)}/restore`,
      json("POST", {}),
    ),
  rearchive: (id: string, undo: RestoreUndo) =>
    call<{ design: DesignSummary }>(
      `/api/designs/${encodeURIComponent(id)}/rearchive`,
      json("POST", undo),
    ),
  // Why an archived design, or with `variant` an archived variant, went.
  reason: (
    id: string,
    body:
      | { reason: string | null }
      | { reason: string | null; state: string | null; variant: string },
  ) => call<unknown>(`/api/designs/${encodeURIComponent(id)}/reason`, json("POST", body)),
  // Keep the version in use and stop asking about the newer one.
  stay: (id: string, state: string | null, variant: string) =>
    call<unknown>(`/api/designs/${encodeURIComponent(id)}/stay`, json("POST", { state, variant })),
  decisions: (project: string) =>
    call<DecisionListView>(`/api/projects/${encodeURIComponent(project)}/decisions`),
  // The user's hand on a line: reword it, remove it, or take that back.
  editDecision: (
    project: string,
    body: { id: string } & ({ text: string } | { removed: true } | { reset: true }),
  ) =>
    call<DecisionListView>(
      `/api/projects/${encodeURIComponent(project)}/decisions`,
      json("PUT", body),
    ),
  // The user moves a design from Home (another kind or area, null: none), or writes a
  // section of its spec. The agent hears it in its next feedback.
  editDesign: (
    id: string,
    body: { kind?: DesignKind; area?: string | null; purpose?: string; behaviour?: SpecLine[] },
  ) =>
    call<{ design: { kind: DesignKind; area?: string } }>(
      `/api/designs/${encodeURIComponent(id)}`,
      json("PATCH", body),
    ),
  stateOutline: (id: string, body: { state: string; to: StateOutline | null }) =>
    call<{ stateOutlines: Record<string, StateOutline> }>(
      `/api/designs/${encodeURIComponent(id)}/outlines`,
      json("POST", body),
    ),
  // Un-archive one variant of one state (D13).
  archiveVariant: (id: string, state: string | null, variant: string) =>
    call<unknown>(
      `/api/designs/${encodeURIComponent(id)}/variants/archive`,
      json("POST", { state, variant }),
    ),
  restoreVariant: (id: string, state: string | null, variant: string) =>
    call<unknown>(
      `/api/designs/${encodeURIComponent(id)}/variants/restore`,
      json("POST", { state, variant }),
    ),
  // A plain comment from the user, outside a reply.
  comment: (designId: string, text: string) =>
    call<CommentRow>("/api/comments", json("POST", { design: designId, text, author: "user" })),
  comments: (designId: string, after?: number) =>
    call<{ comments: CommentRow[]; lastSeq: number }>(
      `/api/comments?design=${encodeURIComponent(designId)}${after === undefined ? "" : `&after=${after}`}`,
    ),
  // An image the user attaches to a write-in or a note; the bytes go up raw.
  attach: (designId: string, image: Blob, filename: string) =>
    call<{ id: string }>(
      `/api/assets?design=${encodeURIComponent(designId)}&kind=image&filename=${encodeURIComponent(filename)}`,
      { method: "POST", body: image, headers: { ...VIEWER, "content-type": image.type } },
    ),
  theme: () => call<{ mode: "dark" | "light" }>("/api/theme"),
  putTheme: (mode: "dark" | "light") => call<{ mode: string }>("/api/theme", json("PUT", { mode })),
};

// A surface document for a frame or a thumbnail. Every input that changes the
// pixels is in the URL, so a version-pinned document is cacheable.
export function surfaceUrl(
  postId: string,
  surface: number,
  opts: {
    version?: number;
    mode?: string;
    knobs?: Record<string, KnobValue>;
    // The variant's embedsKey: a component's new version is a new URL.
    e?: string;
    // Older component versions to show instead of the latest, slug → version.
    embed?: Record<string, number>;
    // The variant's rewrites: an amended version keeps its number.
    w?: number;
    // A palette of the project's system other than its default.
    p?: string;
  } = {},
): string {
  const q = new URLSearchParams({ surface: String(surface) });
  if (opts.version) q.set("ver", String(opts.version));
  if (opts.mode) q.set("mode", opts.mode);
  if (opts.knobs && Object.keys(opts.knobs).length) q.set("k", JSON.stringify(opts.knobs));
  if (opts.e) q.set("e", opts.e);
  if (opts.embed && Object.keys(opts.embed).length) q.set("embed", JSON.stringify(opts.embed));
  if (opts.w) q.set("w", String(opts.w));
  const p = opts.p ?? framePalette();
  if (p) q.set("p", p);
  const y = systemRev();
  if (y) q.set("y", String(y));
  const sys = peekRev();
  if (sys) q.set("sys", String(sys));
  // The renderer's revision: a new one is a new URL, past the browser's cache.
  const r = renderRev();
  if (r) q.set("r", r);
  return url(`/s/${encodeURIComponent(postId)}?${q}`);
}

// A view of a project says which system revision its frames wear.
function seenRev<T extends { project: string; systemRev?: number }>(view: T): T {
  noteSystemRev(view.project, view.systemRev);
  return view;
}

export const assetUrl = (id: string) => url(`/a/${encodeURIComponent(id)}`);

// The System page's type and space specimen, a sandboxed document of its own.
export const specimenUrl = (project: string, mode: string, palette: string | null) => {
  const q = new URLSearchParams({ mode });
  if (palette) q.set("p", palette);
  const y = systemRev();
  if (y) q.set("y", String(y));
  return url(`/api/projects/${encodeURIComponent(project)}/system/specimen?${q}`);
};

// The live feed: one EventSource per tab, shared by every subscriber, since
// browsers hold at most six HTTP/1.1 connections per origin across all tabs.
// EventSource reconnects on its own; `onOpen` runs on each (re)connect so
// callers refetch after a gap and nothing broadcast while disconnected is missed.
// It is given the workspace's revision then, to compare with `readAt`.
type OnOpen = (rev: number) => void;
type Listener = { onEvent: (e: FeedEvent) => void; onOpen?: OnOpen };
const listeners = new Set<Listener>();
let feed: { close: () => void } | null = null;
// The design this tab has on screen, sent as `?viewing=` so the agent's
// pending.viewerOpen is per design.
let viewingId: string | null = null;

function connect(): { close: () => void } | null {
  const Source = (host().window as Window & typeof globalThis).EventSource;
  if (!Source) return null;
  const path = viewingId ? `/api/events?viewing=${encodeURIComponent(viewingId)}` : "/api/events";
  const es = new Source(url(path));
  es.onmessage = (m: MessageEvent<string>) => {
    let event: FeedEvent;
    try {
      event = JSON.parse(m.data) as FeedEvent;
    } catch {
      // A malformed frame is dropped; the next event or reconnect refetches.
      return;
    }
    if (event.type === "system-changed") systemChanged(event);
    for (const l of listeners) l.onEvent(event);
  };
  es.addEventListener("hello", (m: MessageEvent<string>) => {
    let rev = Infinity;
    try {
      rev = Number((JSON.parse(m.data) as { rev?: number }).rev ?? Infinity);
    } catch {
      // Unreadable reads as newer than anything held, so callers refetch.
    }
    for (const l of listeners) l.onOpen?.(rev);
  });
  return { close: () => es.close() };
}

export function subscribe(onEvent: (e: FeedEvent) => void, onOpen?: OnOpen): () => void {
  const entry = { onEvent, onOpen };
  listeners.add(entry);
  feed ??= connect();
  return () => {
    listeners.delete(entry);
    if (listeners.size === 0) {
      feed?.close();
      feed = null;
    }
  };
}

// Marks `designId` as on screen until the returned release runs. Changing it
// reconnects the feed, whose hello refetches like any other gap. The release
// only clears its own id, so a screen torn down after the next one mounted
// can't unmark the new one.
export function watchDesign(designId: string): () => void {
  setViewing(designId);
  return () => {
    if (viewingId === designId) setViewing(null);
  };
}

function setViewing(id: string | null) {
  if (viewingId === id) return;
  viewingId = id;
  if (feed) {
    feed.close();
    feed = connect();
  }
}
