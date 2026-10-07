import {
  type Anchor,
  anchorFromLegacy,
  type Asset,
  type WorkspaceSnapshot,
  collectAssetIds,
  type Comment,
  type CommentAnchor,
  type CommentQuery,
  DEFAULT_PROJECT,
  DEFAULT_VARIANT,
  type ItemDetail,
  type ItemKind,
  type ItemSummary,
  type PostAsk,
  type PostStatus,
  type ProjectSummary,
  projectFromCwd,
  detailForItem,
  type Slot,
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
  type SqlStorage,
  type SqlStorageValue,
  stripNul,
  stripNulStep,
  type Store,
  type Post,
  type Surface,
  type PostVersion,
  type TraceStep,
  type UpdatePostInput,
} from "./types.ts";

function parseAnchors(raw: SqlStorageValue): Anchor[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Anchor[]) : [];
  } catch {
    return [];
  }
}

// Store implementation on SQLite — a Durable Object's `ctx.storage.sql` in the
// Worker, or node:sqlite via an adapter on Node (see server/sqliteStorage.ts).
// One workspace = one database, so plain SQL with no tenant columns.
export class SqlStore implements Store {
  private sql: SqlStorage;
  // Cached set of asset ids referenced by any live surface (current or a
  // historical version of any post). Built lazily and maintained incrementally
  // — createPost/updatePost add to it, removes invalidate it — so isAssetReferenced
  // (hit on every /a/:id miss) and putAsset's eviction scan no longer re-parse
  // every post's surfaces+history JSON on each call. Stays correct because post
  // history is append-only: a surface only ever moves INTO history, so an asset
  // id once referenced stays referenced until the whole post (and its history)
  // is deleted — at which point we invalidate and recompute from scratch.
  private assetRefCache: Set<string> | undefined;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT, cwd TEXT,
        createdAt TEXT NOT NULL, lastActiveAt TEXT NOT NULL,
        agentSeq INTEGER NOT NULL DEFAULT 0, project TEXT
      );
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, title TEXT NOT NULL,
        surfaces TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        version INTEGER NOT NULL, history TEXT NOT NULL,
        project TEXT NOT NULL DEFAULT 'workspace', slug TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'component', variant TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL DEFAULT 'open', ask TEXT,
        slots TEXT NOT NULL DEFAULT '[]',
        curFrom INTEGER, curPrompt TEXT, curAuthor TEXT
      );
      CREATE TABLE IF NOT EXISTS post_versions (
        postId TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL,
        surfaces TEXT NOT NULL, at TEXT NOT NULL,
        fromVersion INTEGER, prompt TEXT, author TEXT,
        PRIMARY KEY (postId, version)
      );
      CREATE TABLE IF NOT EXISTS comments (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL,
        sessionId TEXT NOT NULL, postId TEXT, postTitle TEXT,
        author TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'comment', anchors TEXT NOT NULL DEFAULT '[]',
        draft INTEGER NOT NULL DEFAULT 0, postVersion INTEGER, viewport INTEGER
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, kind TEXT NOT NULL,
        contentType TEXT NOT NULL, byteLength INTEGER NOT NULL, filename TEXT,
        data BLOB NOT NULL, createdAt TEXT NOT NULL, lastAccessedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trace_steps (
        sessionId TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT,
        label TEXT NOT NULL, detail TEXT, ts TEXT,
        PRIMARY KEY (sessionId, seq)
      );
    `);
    // Workspaces created before agentSeq existed need the column added; SQLite
    // has no ADD COLUMN IF NOT EXISTS, so probe and patch.
    const sessionCols = this.sql.exec("SELECT name FROM pragma_table_info('sessions')").toArray();
    if (!sessionCols.some((c) => c.name === "agentSeq")) {
      this.sql.exec("ALTER TABLE sessions ADD COLUMN agentSeq INTEGER NOT NULL DEFAULT 0");
    }
    const commentCols = this.sql.exec("SELECT name FROM pragma_table_info('comments')").toArray();
    if (!commentCols.some((c) => c.name === "anchor")) {
      this.sql.exec("ALTER TABLE comments ADD COLUMN anchor TEXT");
    }
    this.migrateToSurfaces();
    this.migrateToPosts();
    this.migrateSurfaceIds();
    this.migrateToItems();
    this.migrateToVersions();
    this.createIndexes();
  }

  // Every past version used to live in a `history` JSON blob on the post row, so
  // reading a post — which `/s/:id` did on every iframe load — parsed up to
  // HISTORY_LIMIT copies of its surfaces, and each revision rewrote the whole
  // blob. Versions now live in `post_versions`, one row each.
  //
  // In place, behind a sentinel, because deployed Durable Objects can never be
  // reset: copy every history entry out, then blank the column. The column
  // itself STAYS (NOT NULL, written as '[]'), so an older build rolled back onto
  // this database still reads and writes a valid — if empty — history.
  private migrateToVersions() {
    const done = this.sql
      .exec("SELECT value FROM settings WHERE key = 'versionsMigrated'")
      .toArray();
    if (done.length > 0 && done[0]?.value === "1") return;
    for (const r of this.sql.exec("SELECT id, history FROM posts").toArray()) {
      let history: PostVersion[] = [];
      try {
        history = JSON.parse((r.history as string) || "[]") as PostVersion[];
      } catch {
        history = [];
      }
      if (!Array.isArray(history) || history.length === 0) continue;
      for (const h of history) this.insertVersion(r.id as string, h);
      this.sql.exec("UPDATE posts SET history = '[]' WHERE id = ?", r.id as string);
    }
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('versionsMigrated', '1')");
  }

  private insertVersion(postId: string, v: PostVersion) {
    this.sql.exec(
      "INSERT OR REPLACE INTO post_versions (postId, version, title, surfaces, at, fromVersion, prompt, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      postId,
      v.version,
      v.title,
      JSON.stringify(v.surfaces ?? []),
      v.at,
      v.from ?? null,
      v.prompt ?? null,
      v.author ?? null,
    );
  }

  private rowToVersion(r: Record<string, SqlStorageValue>): PostVersion {
    return {
      version: r.version as number,
      title: r.title as string,
      surfaces: JSON.parse(r.surfaces as string) as Surface[],
      at: r.at as string,
      // Absent stays absent: an entry archived before these fields existed must
      // not grow `from: null` keys (the store contract compares entries whole).
      ...(r.fromVersion == null ? {} : { from: r.fromVersion as number }),
      ...(r.prompt == null ? {} : { prompt: r.prompt as string }),
      ...(r.author == null ? {} : { author: r.author as string }),
    };
  }

  private historyFor(postId: string): PostVersion[] {
    return this.sql
      .exec("SELECT * FROM post_versions WHERE postId = ? ORDER BY version ASC", postId)
      .toArray()
      .map((r) => this.rowToVersion(r));
  }

  // One query for a whole page of posts instead of one per row. `ids === null`
  // reads every version in the workspace (the whole-workspace listPosts path,
  // which used to parse every history blob anyway).
  private historiesFor(ids: string[] | null): Map<string, PostVersion[]> {
    const out = new Map<string, PostVersion[]>();
    if (ids && ids.length === 0) return out;
    const rows = ids
      ? this.sql
          .exec(
            `SELECT * FROM post_versions WHERE postId IN (${ids.map(() => "?").join(",")}) ORDER BY version ASC`,
            ...ids,
          )
          .toArray()
      : this.sql.exec("SELECT * FROM post_versions ORDER BY version ASC").toArray();
    for (const r of rows) {
      const id = r.postId as string;
      let list = out.get(id);
      if (!list) out.set(id, (list = []));
      list.push(this.rowToVersion(r));
    }
    return out;
  }

  // rowToPost needs each post's versions; this is the shared "read rows, attach
  // their histories" step every multi-row query goes through.
  private rowsToPosts(rows: Record<string, SqlStorageValue>[], all = false): Post[] {
    const histories = this.historiesFor(all ? null : rows.map((r) => r.id as string));
    return rows.map((r) => this.rowToPost(r, histories.get(r.id as string) ?? []));
  }

  // Deployed Durable Objects can never be reset, so the project › item ›
  // variant columns are added in place (probe + ALTER) and existing rows are
  // backfilled once, behind a settings sentinel.
  private migrateToItems() {
    const addMissing = (table: string, columns: Record<string, string>) => {
      const have = new Set(
        this.sql
          .exec(`SELECT name FROM pragma_table_info('${table}')`)
          .toArray()
          .map((c) => c.name as string),
      );
      for (const [name, decl] of Object.entries(columns)) {
        if (!have.has(name)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
      }
    };
    addMissing("sessions", { project: "TEXT" });
    addMissing("posts", {
      project: "TEXT NOT NULL DEFAULT 'workspace'",
      slug: "TEXT NOT NULL DEFAULT ''",
      kind: "TEXT NOT NULL DEFAULT 'component'",
      variant: "TEXT NOT NULL DEFAULT 'default'",
      status: "TEXT NOT NULL DEFAULT 'open'",
      ask: "TEXT",
      slots: "TEXT NOT NULL DEFAULT '[]'",
      curFrom: "INTEGER",
      curPrompt: "TEXT",
      curAuthor: "TEXT",
    });
    addMissing("comments", {
      kind: "TEXT NOT NULL DEFAULT 'comment'",
      anchors: "TEXT NOT NULL DEFAULT '[]'",
      draft: "INTEGER NOT NULL DEFAULT 0",
      postVersion: "INTEGER",
      viewport: "INTEGER",
    });

    const done = this.sql.exec("SELECT value FROM settings WHERE key = 'itemsMigrated'").toArray();
    if (done.length > 0 && done[0]?.value === "1") return;

    const sessions = new Map<string, { project: string | null; cwd: string | null }>();
    for (const r of this.sql.exec("SELECT id, project, cwd FROM sessions").toArray()) {
      sessions.set(r.id as string, {
        project: (r.project as string) ?? null,
        cwd: (r.cwd as string) ?? null,
      });
    }
    const taken = new Map<string, Set<string>>();
    for (const r of this.sql
      .exec("SELECT id, sessionId, title, slug, history FROM posts ORDER BY createdAt ASC")
      .toArray()) {
      if (((r.slug as string) ?? "") !== "") continue;
      const session = sessions.get(r.sessionId as string);
      const project = session?.project || projectFromCwd(session?.cwd ?? null) || DEFAULT_PROJECT;
      let used = taken.get(project);
      if (!used) taken.set(project, (used = new Set<string>()));
      const slug = uniqueSlug(r.title as string, r.id as string, used);
      used.add(slug);
      const history = (JSON.parse(r.history as string) as PostVersion[]).map((h, i, all) => ({
        ...h,
        from: h.from ?? (i > 0 ? all[i - 1].version : undefined),
        prompt: h.prompt ?? "",
      }));
      this.sql.exec(
        "UPDATE posts SET project = ?, slug = ?, kind = 'component', variant = ?, status = 'open', ask = NULL, slots = '[]', history = ? WHERE id = ?",
        project,
        slug,
        DEFAULT_VARIANT,
        JSON.stringify(history),
        r.id as string,
      );
    }
    for (const r of this.sql.exec("SELECT seq, anchor FROM comments").toArray()) {
      const raw = r.anchor;
      if (typeof raw !== "string" || !raw) continue;
      let anchors: Anchor[] = [];
      try {
        anchors = anchorFromLegacy(JSON.parse(raw) as CommentAnchor);
      } catch {
        anchors = [];
      }
      this.sql.exec(
        "UPDATE comments SET anchors = ? WHERE seq = ?",
        JSON.stringify(anchors),
        r.seq as number,
      );
    }
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('itemsMigrated', '1')");
  }

  // Add indexes after the column/table migrations above: older workspaces may
  // still call comments' post columns snippetId/surfaceId when the base schema
  // is first opened. IF NOT EXISTS makes this an in-place, idempotent migration
  // for deployed Durable Objects as well as local SQLite databases.
  private createIndexes() {
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS mockpit_posts_session_created_at_idx
        ON posts (sessionId, createdAt);
      CREATE INDEX IF NOT EXISTS mockpit_posts_updated_at_idx
        ON posts (updatedAt DESC);
      CREATE INDEX IF NOT EXISTS mockpit_comments_session_seq_idx
        ON comments (sessionId, seq);
      CREATE INDEX IF NOT EXISTS mockpit_comments_post_seq_idx
        ON comments (postId, seq);
      CREATE INDEX IF NOT EXISTS mockpit_comments_id_idx
        ON comments (id);
      CREATE INDEX IF NOT EXISTS mockpit_assets_session_idx
        ON assets (sessionId);
      CREATE INDEX IF NOT EXISTS mockpit_posts_variant_idx
        ON posts (project, slug, variant);
      CREATE INDEX IF NOT EXISTS mockpit_comments_post_draft_idx
        ON comments (postId, draft);
    `);
    // SQLite has no RENAME INDEX, so databases created before the rename would
    // otherwise keep a duplicate sideshow_* copy of every index above.
    this.sql.exec(`
      DROP INDEX IF EXISTS sideshow_posts_session_created_at_idx;
      DROP INDEX IF EXISTS sideshow_posts_updated_at_idx;
      DROP INDEX IF EXISTS sideshow_comments_session_seq_idx;
      DROP INDEX IF EXISTS sideshow_comments_post_seq_idx;
      DROP INDEX IF EXISTS sideshow_comments_id_idx;
      DROP INDEX IF EXISTS sideshow_assets_session_idx;
      DROP INDEX IF EXISTS sideshow_posts_variant_idx;
      DROP INDEX IF EXISTS sideshow_comments_post_draft_idx;
    `);
  }

  // Pre-0.5.0 workspaces stored a `snippets` table and `comments.snippetId`. Lift
  // them into the posts model in place — deployed DOs can never be reset.
  private migrateToSurfaces() {
    const commentCols = this.sql
      .exec("SELECT name FROM pragma_table_info('comments')")
      .toArray()
      .map((c) => c.name as string);
    if (commentCols.includes("snippetId") && !commentCols.includes("surfaceId")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN snippetId TO surfaceId");
    }
    if (commentCols.includes("snippetTitle") && !commentCols.includes("surfaceTitle")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN snippetTitle TO surfaceTitle");
    }

    const tables = this.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((t) => t.name as string);
    if (!tables.includes("snippets")) return;
    for (const r of this.sql.exec("SELECT * FROM snippets").toArray()) {
      const legacyHistory = JSON.parse((r.history as string) ?? "[]") as Array<{
        version: number;
        title: string;
        html: string;
        at: string;
      }>;
      const history: PostVersion[] = legacyHistory.map((h) => ({
        version: h.version,
        title: h.title,
        surfaces: [htmlSurface(h.html)],
        at: h.at,
      }));
      this.sql.exec(
        "INSERT OR IGNORE INTO posts (id, sessionId, title, surfaces, createdAt, updatedAt, version, history) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        r.id as string,
        r.sessionId as string,
        r.title as string,
        JSON.stringify([htmlSurface(r.html as string)]),
        r.createdAt as string,
        r.updatedAt as string,
        r.version as number,
        JSON.stringify(history),
      );
    }
    this.sql.exec("DROP TABLE snippets");
  }

  // 0.5.x workspaces stored a `surfaces` table with a `parts` column and
  // `comments.surfaceId/surfaceTitle`. Lift them into the posts model in place.
  private migrateToPosts() {
    const commentCols = this.sql
      .exec("SELECT name FROM pragma_table_info('comments')")
      .toArray()
      .map((c) => c.name as string);
    if (commentCols.includes("surfaceId") && !commentCols.includes("postId")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN surfaceId TO postId");
    }
    if (commentCols.includes("surfaceTitle") && !commentCols.includes("postTitle")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN surfaceTitle TO postTitle");
    }

    const tables = this.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((t) => t.name as string);
    if (!tables.includes("surfaces")) return;
    for (const r of this.sql.exec("SELECT * FROM surfaces").toArray()) {
      // Re-key the history blob: 0.5.x stored each version's blocks under
      // `parts`, but the posts model reads them as `surfaces`. Copying the blob
      // verbatim would leave inner `parts` keys that readers (older-version
      // views, asset GC) see as `undefined`. Mirror storage.ts liftPost so the
      // SQLite and JSON backends stay in lockstep.
      const history = (
        JSON.parse((r.history as string) ?? "[]") as Array<Record<string, unknown>>
      ).map(({ parts, ...rest }) => ({ ...rest, surfaces: parts ?? [] }));
      this.sql.exec(
        "INSERT OR IGNORE INTO posts (id, sessionId, title, surfaces, createdAt, updatedAt, version, history) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        r.id as string,
        r.sessionId as string,
        r.title as string,
        r.parts as string,
        r.createdAt as string,
        r.updatedAt as string,
        r.version as number,
        JSON.stringify(history),
      );
    }
    this.sql.exec("DROP TABLE surfaces");
  }

  // One-time migration: assign stable ids to surfaces in existing posts that
  // were written before surface ids existed. Gated on a settings sentinel so
  // it only runs once per workspace; idempotent and safe to retry.
  private migrateSurfaceIds() {
    const rows = this.sql
      .exec("SELECT value FROM settings WHERE key = 'surfaceIdsMigrated'")
      .toArray();
    if (rows.length > 0 && rows[0]?.value === "1") return;
    for (const r of this.sql.exec("SELECT id, surfaces, history FROM posts").toArray()) {
      const surfaces = normalizeSurfaceIds(JSON.parse(r.surfaces as string) as Surface[]);
      const history = (JSON.parse(r.history as string) as PostVersion[]).map((h) => ({
        ...h,
        surfaces: normalizeSurfaceIds(h.surfaces),
      }));
      this.sql.exec(
        "UPDATE posts SET surfaces = ?, history = ? WHERE id = ?",
        JSON.stringify(surfaces),
        JSON.stringify(history),
        r.id,
      );
    }
    this.sql.exec(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('surfaceIdsMigrated', '1')",
    );
  }

  private rowToSession(r: Record<string, SqlStorageValue>): Session {
    return {
      id: r.id as string,
      agent: r.agent as string,
      title: (r.title as string) ?? null,
      cwd: (r.cwd as string) ?? null,
      createdAt: r.createdAt as string,
      lastActiveAt: r.lastActiveAt as string,
      agentSeq: (r.agentSeq as number) ?? 0,
      project: (r.project as string) ?? null,
    };
  }

  private rowToPost(r: Record<string, SqlStorageValue>, history: PostVersion[]): Post {
    let ask: PostAsk | null = null;
    if (typeof r.ask === "string" && r.ask) {
      try {
        ask = JSON.parse(r.ask) as PostAsk;
      } catch {
        ask = null;
      }
    }
    return {
      id: r.id as string,
      sessionId: r.sessionId as string,
      title: r.title as string,
      surfaces: JSON.parse(r.surfaces as string) as Surface[],
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
      version: r.version as number,
      history,
      project: (r.project as string) || DEFAULT_PROJECT,
      slug: (r.slug as string) || slugify(r.title as string),
      kind: ((r.kind as string) || "component") as ItemKind,
      variant: (r.variant as string) || DEFAULT_VARIANT,
      status: ((r.status as string) || "open") as PostStatus,
      ask,
      slots: JSON.parse((r.slots as string) || "[]") as Slot[],
      ...(r.curFrom == null ? {} : { from: r.curFrom as number }),
      ...(r.curPrompt == null ? {} : { prompt: r.curPrompt as string }),
      ...(r.curAuthor == null ? {} : { author: r.curAuthor as string }),
    };
  }

  // The BLOB comes back as an ArrayBuffer (real DO) or a Uint8Array
  // (node:sqlite); `new Uint8Array(raw)` copies from either into a fresh array.
  private rowToAsset(r: Record<string, SqlStorageValue>): Asset {
    const raw = r.data as ArrayBuffer | Uint8Array;
    return {
      id: r.id as string,
      sessionId: r.sessionId as string,
      kind: r.kind as Asset["kind"],
      contentType: r.contentType as string,
      byteLength: r.byteLength as number,
      filename: (r.filename as string) ?? null,
      data: new Uint8Array(raw),
      createdAt: r.createdAt as string,
      lastAccessedAt: r.lastAccessedAt as string,
    };
  }

  private rowToComment(r: Record<string, SqlStorageValue>): Comment {
    let anchor: Comment["anchor"] | undefined;
    if (typeof r.anchor === "string" && r.anchor) {
      try {
        anchor = JSON.parse(r.anchor) as Comment["anchor"];
      } catch {
        anchor = undefined;
      }
    }
    return {
      id: r.id as string,
      seq: r.seq as number,
      sessionId: r.sessionId as string,
      postId: (r.postId as string) ?? null,
      postTitle: (r.postTitle as string) ?? null,
      author: r.author as string,
      text: r.text as string,
      createdAt: r.createdAt as string,
      ...(anchor && { anchor }),
      kind: ((r.kind as string) || "comment") as Comment["kind"],
      anchors: parseAnchors(r.anchors),
      draft: (r.draft as number) === 1,
      postVersion: r.postVersion == null ? null : (r.postVersion as number),
      viewport: r.viewport == null ? null : (r.viewport as number),
    };
  }

  // --- sessions ---

  async listSessions() {
    return this.sql
      .exec("SELECT * FROM sessions ORDER BY lastActiveAt DESC")
      .toArray()
      .map((r) => this.rowToSession(r));
  }

  async getSession(id: string) {
    const rows = this.sql.exec("SELECT * FROM sessions WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.rowToSession(rows[0]) : null;
  }

  async createSession(input: CreateSessionInput) {
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
    this.sql.exec(
      "INSERT INTO sessions (id, agent, title, cwd, createdAt, lastActiveAt, agentSeq, project) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
      session.id,
      session.agent,
      session.title,
      session.cwd,
      session.createdAt,
      session.lastActiveAt,
      session.project,
    );
    return session;
  }

  async renameSession(id: string, title: string) {
    const session = await this.getSession(id);
    if (!session) return null;
    session.title = stripNul(title).trim() || null;
    this.sql.exec("UPDATE sessions SET title = ? WHERE id = ?", session.title, id);
    return session;
  }

  async removeSession(id: string) {
    if (!(await this.getSession(id))) return false;
    this.sql.exec("DELETE FROM comments WHERE sessionId = ?", id);
    this.sql.exec(
      "DELETE FROM post_versions WHERE postId IN (SELECT id FROM posts WHERE sessionId = ?)",
      id,
    );
    this.sql.exec("DELETE FROM posts WHERE sessionId = ?", id);
    this.sql.exec("DELETE FROM trace_steps WHERE sessionId = ?", id);
    // Posts are gone, so referencedAssetIds now reflects survivors only:
    // drop this session's own assets except any a surviving surface still
    // points at (assets are content-addressed and may be shared across sessions).
    this.invalidateAssetRefs();
    const referenced = this.referencedAssetIds();
    for (const r of this.sql.exec("SELECT id FROM assets WHERE sessionId = ?", id).toArray()) {
      const aid = r.id as string;
      if (!referenced.has(aid)) this.sql.exec("DELETE FROM assets WHERE id = ?", aid);
    }
    this.sql.exec("DELETE FROM sessions WHERE id = ?", id);
    return true;
  }

  private touch(sessionId: string) {
    this.sql.exec(
      "UPDATE sessions SET lastActiveAt = ? WHERE id = ?",
      new Date().toISOString(),
      sessionId,
    );
  }

  async markAgentSeen(sessionId: string, seq: number) {
    this.sql.exec(
      "UPDATE sessions SET agentSeq = ? WHERE id = ? AND agentSeq < ?",
      seq,
      sessionId,
      seq,
    );
  }

  // --- settings ---

  async getSetting(key: string) {
    const rows = this.sql.exec("SELECT value FROM settings WHERE key = ?", key).toArray();
    return rows.length ? (rows[0].value as string) : null;
  }

  async setSetting(key: string, value: string) {
    this.sql.exec(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      stripNul(key),
      stripNul(value),
    );
  }

  // --- surfaces ---

  async listPosts(sessionId?: string) {
    const rows =
      sessionId === undefined
        ? this.sql.exec("SELECT * FROM posts ORDER BY createdAt ASC").toArray()
        : this.sql
            .exec("SELECT * FROM posts WHERE sessionId = ? ORDER BY createdAt ASC", sessionId)
            .toArray();
    return this.rowsToPosts(rows, sessionId === undefined);
  }

  async countPostsBySession() {
    const counts = new Map<string, number>();
    for (const row of this.sql
      .exec("SELECT sessionId, COUNT(*) AS count FROM posts GROUP BY sessionId")
      .toArray()) {
      counts.set(row.sessionId as string, row.count as number);
    }
    return counts;
  }

  async listRecentPosts(limit: number) {
    // ISO timestamps only have millisecond precision, so bulk writes frequently
    // tie. Make LIMIT membership deterministic across SQLite versions and match
    // JsonFileStore: among equal timestamps, the later insertion wins.
    const rows = this.sql
      .exec("SELECT * FROM posts ORDER BY updatedAt DESC, rowid DESC LIMIT ?", limit)
      .toArray();
    return this.rowsToPosts(rows);
  }

  async getPost(id: string) {
    const rows = this.sql.exec("SELECT * FROM posts WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.rowToPost(rows[0], this.historyFor(id)) : null;
  }

  async createPost(input: CreatePostInput) {
    const session = await this.getSession(input.sessionId);
    if (!session) return null;
    const now = new Date().toISOString();
    const title = stripNul(input.title)?.trim() || "Untitled";
    const post: Post = {
      id: newId(),
      sessionId: input.sessionId,
      title,
      surfaces: normalizeSurfaceIds(input.surfaces),
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
      slots: input.slots ?? [],
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.author === undefined ? {} : { author: stripNul(input.author) }),
    };
    this.sql.exec(
      "INSERT INTO posts (id, sessionId, title, surfaces, createdAt, updatedAt, version, history, project, slug, kind, variant, status, ask, slots, curFrom, curPrompt, curAuthor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
      post.id,
      post.sessionId,
      post.title,
      JSON.stringify(post.surfaces),
      post.createdAt,
      post.updatedAt,
      post.version,
      "[]",
      post.project,
      post.slug,
      post.kind,
      post.variant,
      post.status,
      JSON.stringify(post.slots),
      post.from ?? null,
      post.prompt ?? null,
      post.author ?? null,
    );
    this.touch(input.sessionId);
    this.addAssetRefs(input.surfaces);
    return post;
  }

  async updatePost(id: string, patch: UpdatePostInput) {
    // Compare-and-set: the expected-version guard makes two concurrent
    // updates serializable without a read-then-write gap. Only one UPDATE
    // can match the WHERE clause; the loser sees 0 rows affected and retries
    // with the now-current version.
    for (let attempt = 0; attempt < 4; attempt++) {
      const post = await this.getPost(id);
      if (!post) return null;
      const expectedVersion = post.version;
      const archived: PostVersion = {
        version: post.version,
        title: post.title,
        surfaces: post.surfaces,
        at: post.updatedAt,
        ...(post.from === undefined ? {} : { from: post.from }),
        ...(post.prompt === undefined ? {} : { prompt: post.prompt }),
        ...(post.author === undefined ? {} : { author: post.author }),
      };
      const history = [...post.history, archived];
      if (history.length > HISTORY_LIMIT) history.shift();
      const title =
        patch.title !== undefined ? stripNul(patch.title).trim() || post.title : post.title;
      const surfaces =
        patch.surfaces !== undefined ? normalizeSurfaceIds(patch.surfaces) : post.surfaces;
      const version = post.version + 1;
      const updatedAt = new Date().toISOString();
      // A revision may branch from any earlier version; default to the one it
      // replaces.
      const from = patch.from ?? post.version;
      const prompt = patch.prompt ?? "";
      const author = patch.author === undefined ? null : stripNul(patch.author);
      const slots = patch.slots !== undefined ? patch.slots : post.slots;
      // The post row no longer carries history; the archived version is written
      // to post_versions only after the compare-and-set below actually lands, so
      // a lost race leaves no orphan version row.
      this.sql.exec(
        "UPDATE posts SET title = ?, surfaces = ?, updatedAt = ?, version = ?, curFrom = ?, curPrompt = ?, curAuthor = ?, slots = ? WHERE id = ? AND version = ?",
        title,
        JSON.stringify(surfaces),
        updatedAt,
        version,
        from,
        prompt,
        author,
        JSON.stringify(slots),
        id,
        expectedVersion,
      );
      const affected = this.sql.exec("SELECT changes() AS n").one().n as number;
      if (affected > 0) {
        this.insertVersion(id, archived);
        // Roll the retained window: one row per revision, so the trim is a
        // delete rather than a rewrite of the whole blob.
        this.sql.exec(
          "DELETE FROM post_versions WHERE postId = ? AND version <= ?",
          id,
          version - 1 - HISTORY_LIMIT,
        );
        this.touch(post.sessionId);
        if (patch.surfaces !== undefined) this.addAssetRefs(patch.surfaces);
        return {
          ...post,
          title,
          surfaces,
          version,
          updatedAt,
          history,
          from,
          prompt,
          slots,
          ...(author === null ? {} : { author }),
        };
      }
      // Lost the race — retry with the now-current version.
    }
    return null;
  }

  async removePost(id: string) {
    if (!(await this.getPost(id))) return false;
    this.sql.exec("DELETE FROM comments WHERE postId = ?", id);
    this.sql.exec("DELETE FROM post_versions WHERE postId = ?", id);
    this.sql.exec("DELETE FROM posts WHERE id = ?", id);
    this.invalidateAssetRefs();
    return true;
  }

  // --- projects / items / variants ---

  async listProjects(): Promise<ProjectSummary[]> {
    const posts = await this.listPosts();
    const sessions = await this.listSessions();
    return summarizeProjects(posts, sessions);
  }

  private postsInProject(project: string): Post[] {
    const rows = this.sql
      .exec("SELECT * FROM posts WHERE project = ? ORDER BY createdAt ASC", project)
      .toArray();
    return this.rowsToPosts(rows);
  }

  async listItems(project: string): Promise<ItemSummary[]> {
    return summarizeItems(this.postsInProject(project));
  }

  async getItem(project: string, slug: string): Promise<ItemDetail | null> {
    const posts = this.sql
      .exec(
        "SELECT * FROM posts WHERE project = ? AND slug = ? ORDER BY createdAt ASC",
        project,
        slug,
      )
      .toArray();
    return detailForItem(this.rowsToPosts(posts));
  }

  async findVariant(project: string, slug: string, variant: string): Promise<Post | null> {
    const rows = this.sql
      .exec(
        "SELECT * FROM posts WHERE project = ? AND slug = ? AND variant = ? ORDER BY createdAt ASC LIMIT 1",
        project,
        slug,
        variant,
      )
      .toArray();
    return rows.length > 0 ? this.rowToPost(rows[0], this.historyFor(rows[0].id as string)) : null;
  }

  async setPostStatus(id: string, status: PostStatus): Promise<Post | null> {
    const post = await this.getPost(id);
    if (!post) return null;
    this.sql.exec("UPDATE posts SET status = ? WHERE id = ?", status, id);
    return { ...post, status };
  }

  async setPostAsk(id: string, ask: PostAsk | null): Promise<Post | null> {
    const post = await this.getPost(id);
    if (!post) return null;
    this.sql.exec("UPDATE posts SET ask = ? WHERE id = ?", ask ? JSON.stringify(ask) : null, id);
    return { ...post, ask };
  }

  async listDrafts(postId: string): Promise<Comment[]> {
    return this.sql
      .exec("SELECT * FROM comments WHERE postId = ? AND draft = 1 ORDER BY seq ASC", postId)
      .toArray()
      .map((r) => this.rowToComment(r));
  }

  async releaseDrafts(postId: string): Promise<Comment[]> {
    const drafts = await this.listDrafts(postId);
    if (drafts.length === 0) return [];
    // Fresh seqs, not an in-place flag flip: the session's agentSeq has already
    // stepped past the seqs the drafts were written with (the viewer's own reads
    // never advance it, but the agent's writes do), so reusing them would drop
    // the feedback on the floor. Delete + reinsert puts every released draft
    // above the cursor, where the one delivery stream picks it up exactly once.
    const released: Comment[] = [];
    for (const d of drafts) {
      this.sql.exec("DELETE FROM comments WHERE id = ?", d.id);
      this.sql.exec(
        "INSERT INTO comments (id, sessionId, postId, postTitle, author, text, createdAt, anchor, kind, anchors, draft, postVersion, viewport) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        d.id,
        d.sessionId,
        d.postId,
        d.postTitle,
        d.author,
        d.text,
        d.createdAt,
        d.anchor ? JSON.stringify(d.anchor) : null,
        d.kind,
        JSON.stringify(d.anchors),
        d.postVersion,
        d.viewport,
      );
      const seq = this.sql.exec("SELECT last_insert_rowid() AS seq").one().seq as number;
      released.push({ ...d, seq, draft: false });
    }
    return released;
  }

  // --- comments ---

  async listComments(query: CommentQuery) {
    const clauses: string[] = [];
    const params: SqlStorageValue[] = [];
    if (query.sessionId !== undefined) {
      clauses.push("sessionId = ?");
      params.push(query.sessionId);
    }
    if (query.postId !== undefined) {
      clauses.push("postId = ?");
      params.push(query.postId);
    }
    if (query.afterSeq !== undefined) {
      clauses.push("seq > ?");
      params.push(query.afterSeq);
    }
    // Drafts are the operator's unsent notes: agent-facing reads (the default)
    // must never see them.
    if (!query.includeDrafts) clauses.push("draft = 0");
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.sql
      .exec(`SELECT * FROM comments ${where} ORDER BY seq ASC`, ...params)
      .toArray()
      .map((r) => this.rowToComment(r));
  }

  async createComment(input: CreateCommentInput) {
    if (!(await this.getSession(input.sessionId))) return null;
    const post = input.postId ? await this.getPost(input.postId) : null;
    const id = newId();
    const createdAt = new Date().toISOString();
    const author = stripNul(input.author).trim() || "user";
    const text = stripNul(input.text);
    const kind = input.kind ?? "comment";
    const anchors = input.anchors ?? [];
    const draft = input.draft === true;
    const postVersion = input.postVersion ?? post?.version ?? null;
    const viewport = input.viewport ?? null;
    this.sql.exec(
      "INSERT INTO comments (id, sessionId, postId, postTitle, author, text, createdAt, anchor, kind, anchors, draft, postVersion, viewport) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      input.sessionId,
      post?.id ?? null,
      post?.title ?? null,
      author,
      text,
      createdAt,
      input.anchor ? JSON.stringify(input.anchor) : null,
      kind,
      JSON.stringify(anchors),
      draft ? 1 : 0,
      postVersion,
      viewport,
    );
    const seq = this.sql.exec("SELECT last_insert_rowid() AS seq").one().seq as number;
    this.touch(input.sessionId);
    return {
      id,
      seq,
      sessionId: input.sessionId,
      postId: post?.id ?? null,
      postTitle: post?.title ?? null,
      author,
      text,
      createdAt,
      ...(input.anchor && { anchor: input.anchor }),
      kind,
      anchors,
      draft,
      postVersion,
      viewport,
    };
  }

  async removeComment(id: string) {
    const rows = this.sql.exec("SELECT * FROM comments WHERE id = ?", id).toArray();
    if (rows.length === 0) return null;
    const comment = this.rowToComment(rows[0]);
    this.sql.exec("DELETE FROM comments WHERE id = ?", id);
    this.touch(comment.sessionId);
    return comment;
  }

  // --- trace ---

  private rowToTraceStep(r: Record<string, SqlStorageValue>): TraceStep {
    const step: TraceStep = { label: r.label as string };
    if (r.kind != null) step.kind = r.kind as string;
    if (r.detail != null) step.detail = r.detail as string;
    if (r.ts != null) step.ts = r.ts as string;
    return step;
  }

  async listTrace(sessionId: string) {
    return this.sql
      .exec(
        "SELECT kind, label, detail, ts FROM trace_steps WHERE sessionId = ? ORDER BY seq ASC",
        sessionId,
      )
      .toArray()
      .map((r) => this.rowToTraceStep(r));
  }

  async setTrace(sessionId: string, steps: TraceStep[]) {
    this.sql.exec("DELETE FROM trace_steps WHERE sessionId = ?", sessionId);
    let seq = 0;
    for (const raw of steps) {
      const s = stripNulStep(raw);
      this.sql.exec(
        "INSERT INTO trace_steps (sessionId, seq, kind, label, detail, ts) VALUES (?, ?, ?, ?, ?, ?)",
        sessionId,
        seq++,
        s.kind ?? null,
        s.label,
        s.detail ?? null,
        s.ts ?? null,
      );
    }
  }

  // --- assets ---

  private referencedAssetIds(): Set<string> {
    if (this.assetRefCache) return this.assetRefCache;
    const out = new Set<string>();
    for (const r of this.sql.exec("SELECT surfaces FROM posts").toArray()) {
      collectAssetIds(JSON.parse(r.surfaces as string) as Surface[], out);
    }
    for (const r of this.sql.exec("SELECT surfaces FROM post_versions").toArray()) {
      collectAssetIds(JSON.parse(r.surfaces as string) as Surface[], out);
    }
    this.assetRefCache = out;
    return out;
  }

  // Fold a freshly-written surfaces list into the cache. If the cache hasn't
  // been built yet, skip — the next referencedAssetIds() reads the post from
  // disk and picks it up. Only mutates a populated cache.
  private addAssetRefs(surfaces: Surface[]): void {
    if (this.assetRefCache) collectAssetIds(surfaces, this.assetRefCache);
  }

  private invalidateAssetRefs(): void {
    this.assetRefCache = undefined;
  }

  async putAsset(input: CreateAssetInput) {
    if (!(await this.getSession(input.sessionId))) return null;
    // Content-addressed: identical bytes dedupe to the existing blob (idempotent
    // upload), keeping its original session and createdAt; we just warm it.
    const id = await hashAssetId(input.data);
    if (await this.getAsset(id)) {
      await this.touchAsset(id);
      this.touch(input.sessionId);
      return (await this.getAsset(id))!;
    }
    const referenced = this.referencedAssetIds();
    const candidates = this.sql
      .exec("SELECT id, byteLength, lastAccessedAt FROM assets")
      .toArray()
      .map((r) => ({
        id: r.id as string,
        byteLength: r.byteLength as number,
        lastAccessedAt: r.lastAccessedAt as string,
        referenced: referenced.has(r.id as string),
      }));
    for (const id of selectEvictions(
      candidates,
      input.data.byteLength,
      MAX_WORKSPACE_ASSET_BYTES,
    )) {
      this.sql.exec("DELETE FROM assets WHERE id = ?", id);
    }
    const now = new Date().toISOString();
    const asset: Asset = {
      id,
      sessionId: input.sessionId,
      kind: input.kind,
      contentType: stripNul(input.contentType),
      byteLength: input.data.byteLength,
      filename: stripNul(input.filename ?? null),
      data: input.data,
      createdAt: now,
      lastAccessedAt: now,
    };
    // Bind the blob as an ArrayBuffer (the SqlStorageValue type); the shim
    // adapts it to a Uint8Array for node:sqlite.
    const buf = asset.data.buffer.slice(
      asset.data.byteOffset,
      asset.data.byteOffset + asset.data.byteLength,
    ) as ArrayBuffer;
    this.sql.exec(
      "INSERT INTO assets (id, sessionId, kind, contentType, byteLength, filename, data, createdAt, lastAccessedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      asset.id,
      asset.sessionId,
      asset.kind,
      asset.contentType,
      asset.byteLength,
      asset.filename,
      buf,
      asset.createdAt,
      asset.lastAccessedAt,
    );
    this.touch(input.sessionId);
    return asset;
  }

  async getAsset(id: string) {
    const rows = this.sql.exec("SELECT * FROM assets WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.rowToAsset(rows[0]) : null;
  }

  async touchAsset(id: string) {
    this.sql.exec(
      "UPDATE assets SET lastAccessedAt = ? WHERE id = ?",
      new Date().toISOString(),
      id,
    );
  }

  async listAssets(sessionId: string) {
    return this.sql
      .exec("SELECT * FROM assets WHERE sessionId = ?", sessionId)
      .toArray()
      .map((r) => this.rowToAsset(r));
  }

  async removeAsset(id: string) {
    if (!(await this.getAsset(id))) return false;
    this.sql.exec("DELETE FROM assets WHERE id = ?", id);
    return true;
  }

  async isAssetReferenced(id: string) {
    return this.referencedAssetIds().has(id);
  }

  // One-time bulk import to migrate another backend's data into this database
  // (see server/sqliteStorage.ts → migrateJsonToSqlite). The method name predates
  // the workspace terminology; keep it as public API. Every field is written
  // verbatim — ids, versions, history, the comment `seq` and `agentSeq` the
  // feedback cursor keys on, asset bytes — so identity survives the copy.
  // Wrapped in a transaction so a crash mid-copy rolls back to an empty db
  // rather than a half-migrated workspace. Intended for an empty database; the
  // caller gates on that. Only ever runs through the node:sqlite adapter.
  importBoard(snapshot: WorkspaceSnapshot): void {
    this.sql.exec("BEGIN");
    try {
      for (const s of snapshot.sessions) {
        this.sql.exec(
          "INSERT INTO sessions (id, agent, title, cwd, createdAt, lastActiveAt, agentSeq, project) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          s.id,
          s.agent,
          s.title,
          s.cwd,
          s.createdAt,
          s.lastActiveAt,
          s.agentSeq,
          s.project ?? null,
        );
      }
      // A snapshot from a pre-item workspace has no project/slug; derive them
      // the same way the in-place migration does (the sentinel it keys on is
      // already set on this fresh database, so it will not run over these rows).
      const sessionsById = new Map(snapshot.sessions.map((s) => [s.id, s]));
      const takenSlugs = new Map<string, Set<string>>();
      // `surfaces` is the retired spelling of `posts` on a snapshot; read it
      // through a structural cast so the back-compat fallback doesn't depend on
      // the deprecated field being kept on the type.
      const snapshotPosts = snapshot.posts ?? (snapshot as { surfaces?: Post[] }).surfaces ?? [];
      for (const post of snapshotPosts) {
        const session = sessionsById.get(post.sessionId);
        const project =
          post.project ||
          session?.project ||
          projectFromCwd(session?.cwd ?? null) ||
          DEFAULT_PROJECT;
        let slug = post.slug;
        if (!slug) {
          let used = takenSlugs.get(project);
          if (!used) takenSlugs.set(project, (used = new Set<string>()));
          slug = uniqueSlug(post.title, post.id, used);
          used.add(slug);
        }
        this.sql.exec(
          "INSERT INTO posts (id, sessionId, title, surfaces, createdAt, updatedAt, version, history, project, slug, kind, variant, status, ask, slots, curFrom, curPrompt, curAuthor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          post.id,
          post.sessionId,
          post.title,
          JSON.stringify(normalizeSurfaceIds(post.surfaces)),
          post.createdAt,
          post.updatedAt,
          post.version,
          // History lives in post_versions (see migrateToVersions); the column
          // stays, empty, for rollback safety.
          "[]",
          project,
          slug,
          post.kind ?? "component",
          post.variant ?? DEFAULT_VARIANT,
          post.status ?? "open",
          post.ask ? JSON.stringify(post.ask) : null,
          JSON.stringify(post.slots ?? []),
          post.from ?? null,
          post.prompt ?? null,
          post.author ?? null,
        );
        for (const h of post.history ?? []) {
          this.insertVersion(post.id, { ...h, surfaces: normalizeSurfaceIds(h.surfaces) });
        }
      }
      for (const c of snapshot.comments) {
        this.sql.exec(
          "INSERT INTO comments (seq, id, sessionId, postId, postTitle, author, text, createdAt, anchor, kind, anchors, draft, postVersion, viewport) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          c.seq,
          c.id,
          c.sessionId,
          c.postId ?? null,
          c.postTitle ?? null,
          c.author,
          c.text,
          c.createdAt,
          c.anchor ? JSON.stringify(c.anchor) : null,
          c.kind ?? "comment",
          JSON.stringify(c.anchors ?? anchorFromLegacy(c.anchor)),
          c.draft ? 1 : 0,
          c.postVersion ?? null,
          c.viewport ?? null,
        );
      }
      for (const t of snapshot.traces) {
        let seq = 0;
        for (const step of t.steps) {
          this.sql.exec(
            "INSERT INTO trace_steps (sessionId, seq, kind, label, detail, ts) VALUES (?, ?, ?, ?, ?, ?)",
            t.sessionId,
            seq++,
            step.kind ?? null,
            step.label,
            step.detail ?? null,
            step.ts ?? null,
          );
        }
      }
      for (const a of snapshot.assets) {
        const buf = a.data.buffer.slice(
          a.data.byteOffset,
          a.data.byteOffset + a.data.byteLength,
        ) as ArrayBuffer;
        this.sql.exec(
          "INSERT INTO assets (id, sessionId, kind, contentType, byteLength, filename, data, createdAt, lastAccessedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          a.id,
          a.sessionId,
          a.kind,
          a.contentType,
          a.byteLength,
          a.filename,
          buf,
          a.createdAt,
          a.lastAccessedAt,
        );
      }
      for (const { key, value } of snapshot.settings) {
        this.sql.exec(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          key,
          value,
        );
      }
      this.sql.exec("COMMIT");
      this.invalidateAssetRefs();
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
}
