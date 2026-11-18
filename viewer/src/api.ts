// Typed client for the routes the viewer reads and writes. Response types come
// straight from the server's view functions, so a contract change breaks the
// viewer's typecheck instead of its runtime.

import type {
  designDetailView,
  designSummaryView,
  treeNodeView,
  alternativeView,
} from "../../server/apiViews.ts";
import type { LookView } from "../../server/looks.ts";
import type { StillCell, Stills } from "../../server/stills.ts";
import type { boardView } from "../../server/board.ts";
import type { DecisionLine } from "../../server/decisionLog.ts";
import type { FeedEvent } from "../../server/events.ts";
import type {
  AnswerStanding,
  AskAnswer,
  Comment,
  FollowUps,
  CopyRef,
  IdeaBecomes,
  LiveCopy,
  UsedIn,
  Draft,
  FlowStep,
  KnobValue,
  TunedOn,
  DesignKind,
  StateOutline,
  PartComment,
  ProjectSummary,
  ReplyVerdict,
  SpecLine,
} from "../../server/types.ts";
import { basePath, host, renderRev, root } from "./host.ts";
import {
  framePalette,
  notePalettes,
  noteSystemRev,
  peekRev,
  systemChanged,
  systemRev,
} from "./systemRev.ts";

import type { JumpHit } from "../../server/jump.ts";
import type { ReadyWord } from "../../server/ready.ts";
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
  oneMode?: true;
};
export type DesignDetail = ReturnType<typeof designDetailView> & {
  systemRev?: number;
  palettes?: PaletteChoice[];
};
export type TreeNode = ReturnType<typeof treeNodeView>;
export type BoardPage = ReturnType<typeof boardView> & { onBoard?: boolean };
export type { BoardFrame, BoardSection } from "../../server/board.ts";
// A project's area in the order the Board lists its pages, with what it is for. An `alphabetical`
// one is in no order: it is listed for its description alone.
export type AreaLine = { name: string; description?: string; alphabetical?: true };
// A declared flow as `read` returns it: only steps whose screen exists.
// `planned`: the step's state is declared and not drawn yet.
export type FlowView = {
  name: string;
  // Derived from its steps' screens: a flow carries no mark of its own.
  status?: ReadyWord;
  steps: (FlowStep & { planned?: true })[];
};
export type AlternativeView = ReturnType<typeof alternativeView>;
export type HistoryRow = NonNullable<AlternativeView["history"]>[number];
// What a restore changed, sent back as it is by its Undo.
export type RestoreUndo = {
  archivedAt: string | null;
  archiveReason: string | null;
  dismissed: string[];
  alternatives: { id: string; archivedAt: string; reason: string | null }[];
};
export type DecisionLogView = { project: string; total: number; lines: DecisionLine[] };
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
export type { FeedEvent, JumpHit, LookView, ProjectSummary };

// What the viewer edits: a Draft minus the server's timestamp.
export interface DraftInput {
  version: number;
  answers: Record<string, AskAnswer>;
  borrowed: Record<string, string>;
  tunedOn: TunedOn;
  comments: PartComment[];
  others: Record<string, string>;
  askComments: Record<string, string>;
  otherImages: Record<string, string[]>;
  askCommentImages: Record<string, string[]>;
  // askId → option id → a comment on that one answer, picked or not.
  answerComments: Record<string, Record<string, string>>;
}

export interface Shortlist {
  id: string;
  slug: string;
  title: string;
  candidates: { alternative: string; copiedFrom: CopyRef | null }[];
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
    // A new idea, typed by where it was started.
    for?: string;
    becomes?: IdeaBecomes;
    area?: string;
    candidates: SaveCandidate[];
  }) =>
    call<{
      to: { id: string; slug: string; title: string; shortlist: boolean };
      saved: { state: string | null; alternative: string; already: boolean }[];
    }>("/api/copies", json("POST", body)),
  removeCopy: (design: string, state: string | null, alternative: string) =>
    call<unknown>(
      `/api/copies/${encodeURIComponent(design)}/remove`,
      json("POST", { state, alternative }),
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
  // One page of the Board: an area, the screens no area claims, or the page a design is on.
  board: (project: string, page: { area?: string | null; unsorted?: boolean; design?: string }) => {
    const q = new URLSearchParams();
    if (page.design) q.set("design", page.design);
    else if (page.unsorted) q.set("unsorted", "1");
    else if (page.area) q.set("area", page.area);
    const qs = q.toString();
    return call<BoardPage>(
      `/api/projects/${encodeURIComponent(project)}/board${qs ? `?${qs}` : ""}`,
    );
  },
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
  // The same view without version rows: enough to name a design and its alternatives.
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
  // The user's look, saved from the frame on screen, or removed.
  saveLook: (
    id: string,
    body: { name: string } & ({ values: Record<string, KnobValue> } | { remove: true }),
  ) =>
    call<{ looks: LookView[] }>(`/api/designs/${encodeURIComponent(id)}/looks`, json("POST", body)),
  // A sheet's cached stills, key → asset id, and whether this server can make more.
  stills: (id: string) =>
    call<{ stills: Stills; taking: boolean }>(`/api/designs/${encodeURIComponent(id)}/stills`),
  takeStills: (id: string, cells: Omit<StillCell, "system" | "rewrites">[]) =>
    call<{ asked: number; taking: boolean }>(
      `/api/designs/${encodeURIComponent(id)}/stills/take`,
      json("POST", { cells }),
    ),
  reply: (
    id: string,
    body: DraftInput & {
      text?: string;
      verdict?: ReplyVerdict;
      to?: string;
      more?: { ask: string; note?: string; like?: string };
      update?: { ask: string; option: string };
      // The frame on screen, whose tune the reply's design-wide `tuned` carries.
      shown?: { state: string | null; alternative: string };
    },
  ) =>
    call<{ reply: CommentRow }>(`/api/designs/${encodeURIComponent(id)}/reply`, json("POST", body)),
  recipients: (id: string) =>
    call<SendRecipients>(`/api/designs/${encodeURIComponent(id)}/recipients`),
  // A new version of the alternative made from an older one ("restore as vN").
  restoreVersion: (id: string, postId: string, version: number) =>
    call<unknown>(
      `/api/designs/${encodeURIComponent(id)}/alternatives/${encodeURIComponent(postId)}/alternatives/restore`,
      json("POST", { version }),
    ),
  // Use this: one exact version goes in use; the agent hears it as a reply.
  use: (
    id: string,
    body: { state: string | null; alternative: string; version: number; to?: string },
  ) =>
    call<{ reply: CommentRow | null; usedIn?: UsedIn; followUps?: FollowUps }>(
      `/api/designs/${encodeURIComponent(id)}/use`,
      json("POST", body),
    ),
  // Hide a version from the history, or bring it back.
  hide: (
    id: string,
    body: { state: string | null; alternative: string; version: number; hidden: boolean },
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
  // Why an archived design, or with `alternative` an archived alternative, went.
  reason: (
    id: string,
    body:
      | { reason: string | null }
      | { reason: string | null; state: string | null; alternative: string },
  ) => call<unknown>(`/api/designs/${encodeURIComponent(id)}/reason`, json("POST", body)),
  // Keep the version in use and stop asking about the newer one.
  stay: (id: string, state: string | null, alternative: string) =>
    call<unknown>(
      `/api/designs/${encodeURIComponent(id)}/stay`,
      json("POST", { state, alternative }),
    ),
  // Ready: this is the version, recorded at what each state shows now; false takes it off.
  // Move into an idea: a new idea for the design takes its alternatives.
  toIdea: (id: string) =>
    call<{ idea: { id: string; slug: string; title: string }; moved: string[] }>(
      `/api/designs/${encodeURIComponent(id)}/to-idea`,
      json("POST", {}),
    ),
  ready: (id: string, ready: boolean) =>
    call<{
      carried: { slug: string; alternative: string; version: number; alsoShown?: number[] }[];
    }>(`/api/designs/${encodeURIComponent(id)}/ready`, json("POST", { ready })),
  decisions: (project: string) =>
    call<DecisionLogView>(`/api/projects/${encodeURIComponent(project)}/decisions`),
  // The user's hand on a line: reword it, remove it, or take that back.
  editDecision: (
    project: string,
    body: { id: string } & ({ text: string } | { removed: true } | { reset: true }),
  ) =>
    call<DecisionLogView>(
      `/api/projects/${encodeURIComponent(project)}/decisions`,
      json("PUT", body),
    ),
  // The user moves a design from a cover's ⋯ (another kind or area, null: none), or writes a
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
  // Un-archive one alternative of one state (D13).
  archiveAlternative: (id: string, state: string | null, alternative: string) =>
    call<unknown>(
      `/api/designs/${encodeURIComponent(id)}/alternatives/archive`,
      json("POST", { state, alternative }),
    ),
  restoreAlternative: (id: string, state: string | null, alternative: string) =>
    call<unknown>(
      `/api/designs/${encodeURIComponent(id)}/alternatives/restore`,
      json("POST", { state, alternative }),
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
    // The alternative's instancesKey: a component's new version is a new URL.
    e?: string;
    // Older component versions to show instead of the latest, slug → version.
    instance?: Record<string, number>;
    // The alternative's rewrites: an amended version keeps its number.
    w?: number;
    // A palette of the project's system other than its default. Absent: the one
    // picked to view in; null: the default.
    p?: string | null;
  } = {},
): string {
  const q = new URLSearchParams({ surface: String(surface) });
  if (opts.version) q.set("ver", String(opts.version));
  if (opts.mode) q.set("mode", opts.mode);
  if (opts.knobs && Object.keys(opts.knobs).length) q.set("k", JSON.stringify(opts.knobs));
  if (opts.e) q.set("e", opts.e);
  if (opts.instance && Object.keys(opts.instance).length)
    q.set("instance", JSON.stringify(opts.instance));
  if (opts.w) q.set("w", String(opts.w));
  const p = opts.p === undefined ? framePalette() : opts.p;
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

// The live feed, shared by every subscriber and by every tab. A feed holds its
// connection for as long as it is open, and browsers allow six HTTP/1.1 connections
// per origin across all tabs: with a feed each, six tabs left none for any request and
// the seventh never loaded. So one tab holds the feed for all of them: the one with
// the `feed` lock (Web Locks hands it on when that tab closes) opens the EventSource
// and repeats every frame on a BroadcastChannel. Without either API a tab keeps a feed
// of its own. EventSource reconnects on its own; `onOpen` runs on each (re)connect so
// callers refetch after a gap and nothing broadcast while disconnected is missed.
// It is given the workspace's revision then, to compare with `readAt`.
type OnOpen = (rev: number) => void;
type Listener = { onEvent: (e: FeedEvent) => void; onOpen?: OnOpen };
type Feed = { close: () => void; viewing: () => void };
// What tabs say to each other. `who`: a new holder asks what each tab has on screen.
// `ping`/`pong`: a tab that starts listening learns a feed is already up, its first open.
type Wire =
  | { t: "event"; event: FeedEvent }
  | { t: "hello"; rev: number }
  | { t: "viewing"; tab: string; id: string | null }
  | { t: "who" }
  | { t: "ping"; tab: string }
  | { t: "pong"; tab: string };
const listeners = new Set<Listener>();
let feed: Feed | null = null;
// The design this tab has on screen, sent as `?viewing=` so the agent's
// pending.viewerOpen is per design.
let viewingId: string | null = null;

const deliver = (event: FeedEvent) => {
  if (event.type === "system-changed") systemChanged(event);
  for (const l of listeners) l.onEvent(event);
};
const opened = (rev: number) => {
  for (const l of listeners) l.onOpen?.(rev);
};

function source(
  w: Window & typeof globalThis,
  ids: string[],
  onEvent: (e: FeedEvent) => void,
  onHello: (rev: number) => void,
): { close: () => void } {
  const q = ids.map((id) => `viewing=${encodeURIComponent(id)}`).join("&");
  const es = new w.EventSource(url(q ? `/api/events?${q}` : "/api/events"));
  es.onmessage = (m: MessageEvent<string>) => {
    let event: FeedEvent;
    try {
      event = JSON.parse(m.data) as FeedEvent;
    } catch {
      // A malformed frame is dropped; the next event or reconnect refetches.
      return;
    }
    onEvent(event);
  };
  es.addEventListener("hello", (m: MessageEvent<string>) => {
    let rev = Infinity;
    try {
      rev = Number((JSON.parse(m.data) as { rev?: number }).rev ?? Infinity);
    } catch {
      // Unreadable reads as newer than anything held, so callers refetch.
    }
    onHello(rev);
  });
  return { close: () => es.close() };
}

// A feed of this tab's own, where tabs can't share one.
function ownFeed(w: Window & typeof globalThis): Feed {
  const open = () => source(w, viewingId ? [viewingId] : [], deliver, opened);
  let es = open();
  return {
    close: () => es.close(),
    viewing: () => {
      es.close();
      es = open();
    },
  };
}

function sharedFeed(w: Window & typeof globalThis, locks: LockManager): Feed {
  const name = `mockpit-feed:${basePath()}`;
  const tab = w.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
  const tabLock = (id: string) => `${name}:${id}`;
  const channel = new w.BroadcastChannel(name);
  const say = (m: Wire) => channel.postMessage(m);
  const stop = new AbortController();
  const aborted = () => {
    // Closing the feed withdraws its lock requests; nothing to do about it.
  };
  // Held while this tab holds the feed: what the other tabs have on screen, and the
  // tabs it is waiting on to hear that they closed.
  const others = new Map<string, string>();
  const watched = new Set<string>();
  let held = false;
  let greeted = false;
  let es: { close: () => void } | null = null;
  let current = "";
  let handOn: (() => void) | null = null;
  let leave: (() => void) | null = null;

  const ids = () => [...new Set([...(viewingId ? [viewingId] : []), ...others.values()])].sort();
  const open = () => {
    es?.close();
    const now = ids();
    current = now.join("\n");
    es = source(
      w,
      now,
      (event) => {
        say({ t: "event", event });
        deliver(event);
      },
      (rev) => {
        say({ t: "hello", rev });
        opened(rev);
      },
    );
  };
  // The server counts viewers per connection, so the one connection names every
  // design any tab has on screen and reconnects when that set changes.
  const reopen = () => {
    if (held && ids().join("\n") !== current) open();
  };
  const note = (from: string, id: string | null) => {
    if (id) others.set(from, id);
    else others.delete(from);
    // A tab that crashes says nothing: its own lock coming free is how its closing is heard.
    if (!watched.has(from)) {
      watched.add(from);
      void locks
        .request(tabLock(from), { signal: stop.signal }, () => {
          watched.delete(from);
          others.delete(from);
          reopen();
        })
        .catch(aborted);
    }
    reopen();
  };

  channel.onmessage = (m: MessageEvent<Wire>) => {
    const d = m.data;
    if (d.t === "event") {
      if (!held) deliver(d.event);
    } else if (d.t === "hello") {
      if (!held) opened(d.rev);
    } else if (d.t === "viewing") {
      if (held) note(d.tab, d.id);
    } else if (d.t === "who") {
      if (!held) say({ t: "viewing", tab, id: viewingId });
    } else if (d.t === "ping") {
      if (held) say({ t: "pong", tab: d.tab });
    } else if (!held && !greeted && d.tab === tab) {
      greeted = true;
      opened(Infinity);
    }
  };
  // A frozen tab hears nothing; what it missed is a gap like any other.
  const thawed = () => {
    if (!held) opened(Infinity);
  };
  root().addEventListener("resume", thawed);

  void locks
    .request(tabLock(tab), { signal: stop.signal }, () => new Promise<void>((r) => (leave = r)))
    .catch(aborted);
  void locks
    .request(name, { signal: stop.signal }, () => {
      held = true;
      say({ t: "who" });
      open();
      return new Promise<void>((r) => (handOn = r));
    })
    .catch(aborted);
  say({ t: "ping", tab });
  say({ t: "viewing", tab, id: viewingId });

  return {
    close: () => {
      root().removeEventListener("resume", thawed);
      stop.abort();
      es?.close();
      held = false;
      say({ t: "viewing", tab, id: null });
      channel.close();
      handOn?.();
      leave?.();
    },
    viewing: () => {
      if (held) reopen();
      else say({ t: "viewing", tab, id: viewingId });
    },
  };
}

function connect(): Feed | null {
  const w = host().window as Window & typeof globalThis;
  if (!w.EventSource) return null;
  const locks = w.navigator?.locks;
  return locks && w.BroadcastChannel ? sharedFeed(w, locks) : ownFeed(w);
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
// reconnects the feed (every tab's, when they share one), whose hello refetches like any
// other gap. The release
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
  feed?.viewing();
}
