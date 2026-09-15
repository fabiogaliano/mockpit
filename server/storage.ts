import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  anchorFromLegacy,
  type Asset,
  type WorkspaceSnapshot,
  collectAssetIds,
  type Comment,
  type CommentQuery,
  DEFAULT_PROJECT,
  DEFAULT_VARIANT,
  detailForItem,
  type ItemDetail,
  type ItemSummary,
  type PostAsk,
  type PostStatus,
  type ProjectSummary,
  projectFromCwd,
  slugify,
  summarizeItems,
  summarizeProjects,
  uniqueSlug,
  type CreateAssetInput,
  type CreateCommentInput,
  type CreateSessionInput,
  type CreatePostInput,
  hashAssetId,
  HISTORY_LIMIT,
  htmlSurface,
  MAX_WORKSPACE_ASSET_BYTES,
  newId,
  normalizeSurfaceIds,
  reservedAgent,
  selectEvictions,
  type Session,
  stripNul,
  stripNulStep,
  type Store,
  type Post,
  type PostVersion,
  type Surface,
  type TraceStep,
  type UpdatePostInput,
} from "./types.ts";

export type * from "./types.ts";

// On disk an asset's bytes are base64 (JSON can't hold a Uint8Array); in memory
// it is the live Asset with raw bytes.
type StoredAsset = Omit<Asset, "data"> & { data: string };

const clone = <T>(value: T): T => structuredClone(value);
const cloneOrNull = <T>(value: T | null | undefined): T | null =>
  value == null ? null : clone(value);

interface FileShape {
  sessions: Session[];
  surfaces: Post[];
  comments: Comment[];
  assets: StoredAsset[];
  trace: Record<string, TraceStep[]>;
  lastSeq: number;
  settings: Record<string, string>;
}

// Pre-0.5.0 workspaces stored `snippets` (a single `html` field) and comments
// keyed by `snippetId`. Read those shapes and lift them into the surfaces model.
interface LegacySnippetVersion {
  version: number;
  title: string;
  html: string;
  at: string;
}
interface LegacySnippet {
  id: string;
  sessionId: string;
  title: string;
  html: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  history: LegacySnippetVersion[];
}
interface LegacyShape extends Omit<Partial<FileShape>, "surfaces"> {
  surfaces?: LegacyPost[];
  snippets?: LegacySnippet[];
}

function liftSnippet(s: LegacySnippet): Post {
  return {
    id: s.id,
    sessionId: s.sessionId,
    title: s.title,
    surfaces: [htmlSurface(s.html)],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    version: s.version,
    history: (s.history ?? []).map((h) => ({
      version: h.version,
      title: h.title,
      surfaces: [htmlSurface(h.html)],
      at: h.at,
    })),
    // Pre-item fields. project/slug can only be resolved against the session,
    // so loadFromDisk fills them in its second pass (same as liftPost).
    project: "",
    slug: "",
    kind: "component",
    variant: DEFAULT_VARIANT,
    status: "open",
    ask: null,
    slots: [],
  };
}

type LegacyComment = Omit<Comment, "kind" | "anchors" | "draft" | "postVersion" | "viewport"> &
  Partial<Comment> & {
    snippetId?: string | null;
    snippetTitle?: string | null;
    // 0.5.x workspaces keyed comments by `surfaceId`/`surfaceTitle`.
    surfaceId?: string | null;
    surfaceTitle?: string | null;
  };

function liftComment(c: LegacyComment): Comment {
  return {
    id: c.id,
    seq: c.seq,
    sessionId: c.sessionId,
    postId: c.postId ?? c.surfaceId ?? c.snippetId ?? null,
    postTitle: c.postTitle ?? c.surfaceTitle ?? c.snippetTitle ?? null,
    author: c.author,
    text: c.text,
    createdAt: c.createdAt,
    ...(c.anchor && { anchor: c.anchor }),
    kind: c.kind ?? "comment",
    anchors: c.anchors ?? anchorFromLegacy(c.anchor),
    draft: c.draft ?? false,
    postVersion: c.postVersion ?? null,
    viewport: c.viewport ?? null,
  };
}

// 0.5.x workspaces stored each post's blocks under a `parts` field (and
// `history[].parts`). Map those to the `surfaces` field so old files still load.
type LegacyPostVersion = Omit<PostVersion, "surfaces"> & {
  surfaces?: Surface[];
  parts?: Surface[];
};
type LegacyPost = Omit<
  Post,
  "surfaces" | "history" | "project" | "slug" | "kind" | "variant" | "status" | "ask" | "slots"
> &
  Partial<Post> & {
    surfaces?: Surface[];
    parts?: Surface[];
    history?: LegacyPostVersion[];
  };

function liftPost(s: LegacyPost): Post {
  return {
    id: s.id,
    sessionId: s.sessionId,
    title: s.title,
    surfaces: s.surfaces ?? s.parts ?? [],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    version: s.version,
    history: (s.history ?? []).map((h: LegacyPostVersion, i, all) => {
      const from = h.from ?? (i > 0 ? all[i - 1].version : undefined);
      return {
        version: h.version,
        title: h.title,
        surfaces: h.surfaces ?? h.parts ?? [],
        at: h.at,
        // Keep the key absent (not `undefined`) so a JSON round-trip and the
        // SQLite import produce byte-identical snapshots.
        ...(from === undefined ? {} : { from }),
        prompt: h.prompt ?? "",
        ...(h.author === undefined ? {} : { author: h.author }),
      };
    }),
    // Project and slug can only be resolved against the session, so the caller
    // (loadFromDisk) fills them in a second pass; these are the neutral values
    // an unmigrated row carries until then.
    project: s.project ?? "",
    slug: s.slug ?? "",
    kind: s.kind ?? "component",
    variant: s.variant ?? DEFAULT_VARIANT,
    status: s.status ?? "open",
    ask: s.ask ?? null,
    slots: s.slots ?? [],
    ...(s.from === undefined ? {} : { from: s.from }),
    ...(s.prompt === undefined ? {} : { prompt: s.prompt }),
    ...(s.author === undefined ? {} : { author: s.author }),
  };
}

export class JsonFileStore implements Store {
  private sessions = new Map<string, Session>();
  private surfaces = new Map<string, Post>();
  private comments: Comment[] = [];
  private assets = new Map<string, Asset>();
  private trace = new Map<string, TraceStep[]>();
  private lastSeq = 0;
  private settings = new Map<string, string>();
  private loaded = false;
  // Cached set of asset ids referenced by any live surface (current or a
  // historical version of any post). Built lazily and maintained incrementally
  // — createPost/updatePost add to it, removes invalidate it — so isAssetReferenced
  // (hit on every /a/:id miss) and putAsset's eviction scan don't re-walk every
  // post on each call. Correct because post history is append-only: a surface
  // only ever moves INTO history, so an asset id once referenced stays
  // referenced until the whole post (and its history) is deleted, at which point
  // we invalidate and recompute from scratch.
  private assetRefCache: Set<string> | undefined;
  private loadPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async load() {
    if (this.loaded) return;
    this.loadPromise ??= this.loadFromDisk().catch((err) => {
      this.loadPromise = null;
      throw err;
    });
    await this.loadPromise;
  }

  private async loadFromDisk() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as LegacyShape;
      // agentSeq arrived after 0.2.0 — default it for data files written before
      for (const s of data.sessions ?? []) {
        this.sessions.set(s.id, {
          ...s,
          agentSeq: s.agentSeq ?? 0,
          project: s.project ?? projectFromCwd(s.cwd) ?? null,
        });
      }
      // Prefer the surfaces array; fall back to lifting legacy snippets.
      if (data.surfaces) {
        for (const s of data.surfaces) this.surfaces.set(s.id, liftPost(s));
      } else if (data.snippets) {
        for (const s of data.snippets) this.surfaces.set(s.id, liftSnippet(s));
      }
      // Ensure every surface has a stable id (one-time migration for data
      // written before surface ids existed). Cheap: only mutates surfaces
      // that lack an id, and persists on the next write.
      for (const p of this.surfaces.values()) {
        p.surfaces = normalizeSurfaceIds(p.surfaces);
        for (const h of p.history) h.surfaces = normalizeSurfaceIds(h.surfaces);
      }
      // Second pass: resolve each pre-item post into a project › item › variant
      // (the project comes from its session, so it can't be done while lifting).
      const takenSlugs = new Map<string, Set<string>>();
      for (const p of [...this.surfaces.values()].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      )) {
        if (p.slug) {
          const used = takenSlugs.get(p.project) ?? new Set<string>();
          used.add(p.slug);
          takenSlugs.set(p.project, used);
          continue;
        }
        const session = this.sessions.get(p.sessionId);
        p.project =
          p.project || session?.project || projectFromCwd(session?.cwd ?? null) || DEFAULT_PROJECT;
        let used = takenSlugs.get(p.project);
        if (!used) takenSlugs.set(p.project, (used = new Set<string>()));
        p.slug = uniqueSlug(p.title, p.id, used);
        used.add(p.slug);
      }
      this.comments = (data.comments ?? []).map(liftComment);
      for (const a of data.assets ?? []) {
        this.assets.set(a.id, {
          ...a,
          data: new Uint8Array(Buffer.from(a.data, "base64")),
          lastAccessedAt: a.lastAccessedAt ?? a.createdAt,
        });
      }
      for (const [sid, steps] of Object.entries(data.trace ?? {})) this.trace.set(sid, steps);
      this.lastSeq = data.lastSeq ?? 0;
      for (const [k, v] of Object.entries(data.settings ?? {})) this.settings.set(k, v);
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
    this.loaded = true;
  }

  private persist() {
    const data = JSON.stringify(
      {
        sessions: [...this.sessions.values()],
        surfaces: [...this.surfaces.values()],
        comments: this.comments,
        assets: [...this.assets.values()].map((a) => ({
          ...a,
          data: Buffer.from(a.data).toString("base64"),
        })),
        trace: Object.fromEntries(this.trace),
        lastSeq: this.lastSeq,
        settings: Object.fromEntries(this.settings),
      } satisfies FileShape,
      null,
      2,
    );
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, data, "utf8");
      await rename(tmp, this.filePath);
    });
    return this.writeQueue;
  }

  // Snapshot the whole workspace for a one-time backend migration (→ SqlStore.
  // importBoard). The method name predates the workspace terminology; keep it as
  // public API. Returns live references — fine for a read-once-then-import
  // migration, which never mutates the store afterward.
  async exportBoard(): Promise<WorkspaceSnapshot> {
    await this.load();
    return {
      sessions: [...this.sessions.values()],
      posts: [...this.surfaces.values()],
      surfaces: [...this.surfaces.values()],
      comments: this.comments,
      assets: [...this.assets.values()],
      traces: [...this.trace.entries()].map(([sessionId, steps]) => ({ sessionId, steps })),
      settings: [...this.settings.entries()].map(([key, value]) => ({ key, value })),
    };
  }

  // --- sessions ---

  async listSessions() {
    await this.load();
    return [...this.sessions.values()]
      .map(clone)
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  async getSession(id: string) {
    await this.load();
    return cloneOrNull(this.sessions.get(id));
  }

  async createSession(input: CreateSessionInput) {
    await this.load();
    const now = new Date().toISOString();
    const session: Session = {
      id: newId(),
      agent: reservedAgent(stripNul(input.agent).trim() || "agent"),
      title: stripNul(input.title)?.trim() || null,
      cwd: stripNul(input.cwd ?? null),
      createdAt: now,
      lastActiveAt: now,
      agentSeq: 0,
      project:
        stripNul(input.project)?.trim() || projectFromCwd(stripNul(input.cwd ?? null)) || null,
    };
    this.sessions.set(session.id, session);
    await this.persist();
    return clone(session);
  }

  async renameSession(id: string, title: string) {
    await this.load();
    const session = this.sessions.get(id);
    if (!session) return null;
    session.title = stripNul(title).trim() || null;
    await this.persist();
    return clone(session);
  }

  async removeSession(id: string) {
    await this.load();
    if (!this.sessions.delete(id)) return false;
    for (const [postId, post] of this.surfaces) {
      if (post.sessionId === id) this.surfaces.delete(postId);
    }
    this.comments = this.comments.filter((c) => c.sessionId !== id);
    this.trace.delete(id);
    // Assets are content-addressed and may be referenced across sessions, so a
    // session only takes its OWN assets down with it, and only those no live
    // surface still points at (referencedAssetIds is computed after the above
    // deletes, so it reflects survivors only).
    this.invalidateAssetRefs();
    const referenced = this.referencedAssetIds();
    for (const [aid, asset] of this.assets) {
      if (asset.sessionId === id && !referenced.has(aid)) this.assets.delete(aid);
    }
    await this.persist();
    return true;
  }

  private touch(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) session.lastActiveAt = new Date().toISOString();
  }

  async markAgentSeen(sessionId: string, seq: number) {
    await this.load();
    const session = this.sessions.get(sessionId);
    if (!session || seq <= session.agentSeq) return;
    session.agentSeq = seq;
    await this.persist();
  }

  // --- settings ---

  async getSetting(key: string) {
    await this.load();
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string) {
    await this.load();
    this.settings.set(stripNul(key), stripNul(value));
    await this.persist();
  }

  // --- surfaces ---

  async listPosts(sessionId?: string) {
    await this.load();
    const all = [...this.surfaces.values()].filter(
      (s) => sessionId === undefined || s.sessionId === sessionId,
    );
    return all.map(clone).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async countPostsBySession() {
    await this.load();
    const counts = new Map<string, number>();
    for (const post of this.surfaces.values()) {
      counts.set(post.sessionId, (counts.get(post.sessionId) ?? 0) + 1);
    }
    return counts;
  }

  async listRecentPosts(limit: number) {
    await this.load();
    // Decorate with Map insertion order so millisecond timestamp ties have the
    // same explicit newest-insertion-first order as SqlStore's rowid fallback.
    return [...this.surfaces.values()]
      .map((post, insertion) => ({ post, insertion }))
      .sort((a, b) => b.post.updatedAt.localeCompare(a.post.updatedAt) || b.insertion - a.insertion)
      .slice(0, limit)
      .map(({ post }) => clone(post));
  }

  async getPost(id: string) {
    await this.load();
    return cloneOrNull(this.surfaces.get(id));
  }

  async createPost(input: CreatePostInput) {
    await this.load();
    const session = this.sessions.get(input.sessionId);
    if (!session) return null;
    const now = new Date().toISOString();
    const title = stripNul(input.title)?.trim() || "Untitled";
    const post: Post = {
      id: newId(),
      sessionId: input.sessionId,
      title,
      surfaces: normalizeSurfaceIds(clone(input.surfaces)),
      createdAt: now,
      updatedAt: now,
      version: 1,
      history: [],
      project:
        stripNul(input.project)?.trim() ||
        session.project ||
        projectFromCwd(session.cwd) ||
        DEFAULT_PROJECT,
      slug: slugify(stripNul(input.slug)?.trim() || title),
      kind: input.kind === "page" ? "page" : "component",
      variant: stripNul(input.variant)?.trim() || DEFAULT_VARIANT,
      status: "open",
      ask: null,
      slots: clone(input.slots ?? []),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.author === undefined ? {} : { author: stripNul(input.author) }),
    };
    this.surfaces.set(post.id, post);
    this.touch(input.sessionId);
    this.addAssetRefs(input.surfaces);
    await this.persist();
    return clone(post);
  }

  async updatePost(id: string, patch: UpdatePostInput) {
    await this.load();
    const post = this.surfaces.get(id);
    if (!post) return null;
    post.history.push({
      version: post.version,
      title: post.title,
      surfaces: clone(post.surfaces),
      at: post.updatedAt,
      ...(post.from === undefined ? {} : { from: post.from }),
      ...(post.prompt === undefined ? {} : { prompt: post.prompt }),
      ...(post.author === undefined ? {} : { author: post.author }),
    });
    if (post.history.length > HISTORY_LIMIT) post.history.shift();
    if (patch.title !== undefined) post.title = stripNul(patch.title).trim() || post.title;
    if (patch.surfaces !== undefined) post.surfaces = normalizeSurfaceIds(clone(patch.surfaces));
    if (patch.slots !== undefined) post.slots = clone(patch.slots);
    // A revision may branch from any earlier version; default to the one it replaces.
    post.from = patch.from ?? post.version;
    post.prompt = patch.prompt ?? "";
    if (patch.author !== undefined) post.author = stripNul(patch.author);
    post.version += 1;
    post.updatedAt = new Date().toISOString();
    this.touch(post.sessionId);
    if (patch.surfaces !== undefined) this.addAssetRefs(patch.surfaces);
    await this.persist();
    return clone(post);
  }

  async removePost(id: string) {
    await this.load();
    const post = this.surfaces.get(id);
    if (!post) return false;
    this.surfaces.delete(id);
    this.comments = this.comments.filter((c) => c.postId !== id);
    this.invalidateAssetRefs();
    await this.persist();
    return true;
  }

  // --- projects / items / variants ---

  async listProjects(): Promise<ProjectSummary[]> {
    await this.load();
    return summarizeProjects([...this.surfaces.values()].map(clone), [...this.sessions.values()]);
  }

  async listItems(project: string): Promise<ItemSummary[]> {
    await this.load();
    return summarizeItems(
      [...this.surfaces.values()].filter((p) => p.project === project).map(clone),
    );
  }

  async getItem(project: string, slug: string): Promise<ItemDetail | null> {
    await this.load();
    const posts = [...this.surfaces.values()]
      .filter((p) => p.project === project && p.slug === slug)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
    return detailForItem(posts);
  }

  async findVariant(project: string, slug: string, variant: string): Promise<Post | null> {
    await this.load();
    const found = [...this.surfaces.values()]
      .filter((p) => p.project === project && p.slug === slug && p.variant === variant)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return found ? clone(found) : null;
  }

  async setPostStatus(id: string, status: PostStatus): Promise<Post | null> {
    await this.load();
    const post = this.surfaces.get(id);
    if (!post) return null;
    post.status = status;
    await this.persist();
    return clone(post);
  }

  async setPostAsk(id: string, ask: PostAsk | null): Promise<Post | null> {
    await this.load();
    const post = this.surfaces.get(id);
    if (!post) return null;
    post.ask = ask ? clone(ask) : null;
    await this.persist();
    return clone(post);
  }

  async listDrafts(postId: string): Promise<Comment[]> {
    await this.load();
    return this.comments.filter((c) => c.postId === postId && c.draft).map(clone);
  }

  async releaseDrafts(postId: string): Promise<Comment[]> {
    await this.load();
    const drafts = this.comments.filter((c) => c.postId === postId && c.draft);
    if (drafts.length === 0) return [];
    // Fresh seqs, not an in-place flag flip: the session's agentSeq has already
    // stepped past the seqs the drafts were written with, so reusing them would
    // drop the feedback on the floor. Remove and re-append above the cursor so
    // the one delivery stream picks each up exactly once.
    this.comments = this.comments.filter((c) => !(c.postId === postId && c.draft));
    const released: Comment[] = [];
    for (const d of drafts) {
      const next: Comment = { ...d, seq: ++this.lastSeq, draft: false };
      this.comments.push(next);
      released.push(clone(next));
    }
    await this.persist();
    return released;
  }

  // --- comments ---

  async listComments(query: CommentQuery) {
    await this.load();
    return this.comments
      .filter(
        (c) =>
          (query.sessionId === undefined || c.sessionId === query.sessionId) &&
          (query.postId === undefined || c.postId === query.postId) &&
          (query.afterSeq === undefined || c.seq > query.afterSeq) &&
          // Drafts are the operator's unsent notes: agent-facing reads (the
          // default) must never see them.
          (query.includeDrafts === true || !c.draft),
      )
      .map(clone);
  }

  async createComment(input: CreateCommentInput) {
    await this.load();
    if (!this.sessions.has(input.sessionId)) return null;
    const post = input.postId ? this.surfaces.get(input.postId) : null;
    const comment: Comment = {
      id: newId(),
      seq: ++this.lastSeq,
      sessionId: input.sessionId,
      postId: post?.id ?? null,
      postTitle: post?.title ?? null,
      author: stripNul(input.author).trim() || "user",
      text: stripNul(input.text),
      createdAt: new Date().toISOString(),
      ...(input.anchor && { anchor: input.anchor }),
      kind: input.kind ?? "comment",
      anchors: clone(input.anchors ?? []),
      draft: input.draft === true,
      postVersion: input.postVersion ?? post?.version ?? null,
      viewport: input.viewport ?? null,
    };
    this.comments.push(comment);
    this.touch(input.sessionId);
    await this.persist();
    return clone(comment);
  }

  async removeComment(id: string) {
    await this.load();
    const idx = this.comments.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    const [comment] = this.comments.splice(idx, 1);
    this.touch(comment.sessionId);
    await this.persist();
    return clone(comment);
  }

  // --- trace ---

  async listTrace(sessionId: string) {
    await this.load();
    return clone(this.trace.get(sessionId) ?? []);
  }

  async setTrace(sessionId: string, steps: TraceStep[]) {
    await this.load();
    if (steps.length === 0) this.trace.delete(sessionId);
    else this.trace.set(sessionId, steps.map(stripNulStep));
    await this.persist();
  }

  // --- assets ---

  private referencedAssetIds(): Set<string> {
    if (this.assetRefCache) return this.assetRefCache;
    const out = new Set<string>();
    for (const s of this.surfaces.values()) {
      collectAssetIds(s.surfaces, out);
      for (const h of s.history) collectAssetIds(h.surfaces, out);
    }
    this.assetRefCache = out;
    return out;
  }

  // Fold a freshly-written surfaces list into the cache. If the cache hasn't
  // been built yet, skip — the next referencedAssetIds() walks the in-memory
  // posts and picks it up. Only mutates a populated cache.
  private addAssetRefs(surfaces: Surface[]): void {
    if (this.assetRefCache) collectAssetIds(surfaces, this.assetRefCache);
  }

  private invalidateAssetRefs(): void {
    this.assetRefCache = undefined;
  }

  async putAsset(input: CreateAssetInput) {
    await this.load();
    if (!this.sessions.has(input.sessionId)) return null;
    // Content-addressed: identical bytes dedupe to the existing blob (idempotent
    // upload), keeping its original session and createdAt; we just warm it.
    const id = await hashAssetId(input.data);
    const existing = this.assets.get(id);
    if (existing) {
      existing.lastAccessedAt = new Date().toISOString();
      this.touch(input.sessionId);
      await this.persist();
      return clone(existing);
    }
    const referenced = this.referencedAssetIds();
    const candidates = [...this.assets.values()].map((a) => ({
      id: a.id,
      byteLength: a.byteLength,
      lastAccessedAt: a.lastAccessedAt,
      referenced: referenced.has(a.id),
    }));
    for (const id of selectEvictions(
      candidates,
      input.data.byteLength,
      MAX_WORKSPACE_ASSET_BYTES,
    )) {
      this.assets.delete(id);
    }
    const now = new Date().toISOString();
    const asset: Asset = {
      id,
      sessionId: input.sessionId,
      kind: input.kind,
      contentType: stripNul(input.contentType),
      byteLength: input.data.byteLength,
      filename: stripNul(input.filename ?? null),
      data: new Uint8Array(input.data),
      createdAt: now,
      lastAccessedAt: now,
    };
    this.assets.set(asset.id, asset);
    this.touch(input.sessionId);
    await this.persist();
    return clone(asset);
  }

  async getAsset(id: string) {
    await this.load();
    return cloneOrNull(this.assets.get(id));
  }

  async touchAsset(id: string) {
    await this.load();
    const asset = this.assets.get(id);
    if (!asset) return;
    asset.lastAccessedAt = new Date().toISOString();
    await this.persist();
  }

  async listAssets(sessionId: string) {
    await this.load();
    return [...this.assets.values()].filter((a) => a.sessionId === sessionId).map(clone);
  }

  async removeAsset(id: string) {
    await this.load();
    if (!this.assets.delete(id)) return false;
    await this.persist();
    return true;
  }

  async isAssetReferenced(id: string) {
    await this.load();
    return this.referencedAssetIds().has(id);
  }
}
