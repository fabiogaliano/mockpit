import {
  type Anchor,
  type Ask,
  type Asset,
  collectAssetIds,
  type Comment,
  type CommentQuery,
  type CommitReplyInput,
  type CreateAssetInput,
  type CreateCommentInput,
  type CreateMockInput,
  type CreatePostInput,
  type CreateSessionInput,
  DEFAULT_PROJECT,
  DEFAULT_VARIANT,
  type Draft,
  hashAssetId,
  HISTORY_LIMIT,
  htmlSurface,
  type Knobs,
  MAX_WORKSPACE_ASSET_BYTES,
  type Mock,
  type MockKind,
  newId,
  normalizeSurfaceIds,
  type Post,
  type PostQuery,
  type PostStatus,
  type PostVersion,
  projectFromCwd,
  type Reply,
  reservedAgent,
  selectEvictions,
  type Session,
  type Slot,
  slugify,
  type SqlStorage,
  type SqlStorageValue,
  stripNul,
  type Store,
  summarizeProjects,
  type Surface,
  type UpdateMockInput,
  type UpdatePostInput,
} from "./types.ts";

type Row = Record<string, SqlStorageValue>;

function parseJson<T>(raw: SqlStorageValue, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const POST_COLUMNS = `
  id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, mockId TEXT NOT NULL, state TEXT,
  variant TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', title TEXT NOT NULL,
  surfaces TEXT NOT NULL, knobs TEXT, slots TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL,
  curFrom INTEGER, curPrompt TEXT, curAuthor TEXT`;

// Store implementation on SQLite — a Durable Object's `ctx.storage.sql` in the
// Worker, or node:sqlite via an adapter on Node (see server/sqliteStorage.ts).
// One workspace = one database, so plain SQL with no tenant columns.
export class SqlStore implements Store {
  private sql: SqlStorage;
  // Cached set of asset ids referenced by any live surface (current or a
  // historical version of any post). Built lazily and maintained incrementally
  // — post writes add to it, removes invalidate it — so isAssetReferenced (hit
  // on every /a/:id miss) and putAsset's eviction scan don't re-parse every
  // post's surfaces on each call. Stays correct because history is append-only:
  // an asset id once referenced stays referenced until its post is deleted.
  private assetRefCache: Set<string> | undefined;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.atomic(() => this.migrate());
  }

  // On a Durable Object the synchronous writes of one event already commit as a
  // unit, so its SqlStorage has no transactionSync; node:sqlite provides one.
  private atomic<T>(fn: () => T): T {
    return this.sql.transactionSync ? this.sql.transactionSync(fn) : fn();
  }

  private tables(): Set<string> {
    return new Set(
      this.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((t) => t.name as string),
    );
  }

  private columns(table: string): Set<string> {
    return new Set(
      this.sql
        .exec(`SELECT name FROM pragma_table_info('${table}')`)
        .toArray()
        .map((c) => c.name as string),
    );
  }

  // SQLite has no ADD COLUMN IF NOT EXISTS, so probe and patch.
  private addMissing(table: string, columns: Record<string, string>) {
    const have = this.columns(table);
    for (const [name, decl] of Object.entries(columns)) {
      if (!have.has(name)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
    }
  }

  private migrate() {
    const before = this.tables();
    // Deployed Durable Objects can never be reset, so a workspace written by a
    // build from before mocks existed is lifted in place (see migrateLegacy).
    const legacy = before.has("posts") && !before.has("mocks");
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT, cwd TEXT,
        createdAt TEXT NOT NULL, lastActiveAt TEXT NOT NULL,
        agentSeq INTEGER NOT NULL DEFAULT 0, project TEXT
      );
      CREATE TABLE IF NOT EXISTS mocks (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'component', states TEXT NOT NULL DEFAULT '[]',
        asks TEXT NOT NULL DEFAULT '[]', knobs TEXT NOT NULL DEFAULT '{}', draft TEXT,
        sessionId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS posts (${POST_COLUMNS});
      CREATE TABLE IF NOT EXISTS post_versions (
        postId TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL,
        surfaces TEXT NOT NULL, at TEXT NOT NULL,
        fromVersion INTEGER, prompt TEXT, author TEXT,
        PRIMARY KEY (postId, version)
      );
      CREATE TABLE IF NOT EXISTS comments (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL,
        sessionId TEXT NOT NULL, mockId TEXT, postId TEXT,
        author TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'comment', anchor TEXT, anchors TEXT NOT NULL DEFAULT '[]',
        postVersion INTEGER, viewport INTEGER, payload TEXT
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, kind TEXT NOT NULL,
        contentType TEXT NOT NULL, byteLength INTEGER NOT NULL, filename TEXT,
        data BLOB NOT NULL, createdAt TEXT NOT NULL, lastAccessedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
    `);
    this.addMissing("sessions", {
      agentSeq: "INTEGER NOT NULL DEFAULT 0",
      project: "TEXT",
    });
    if (legacy) this.migrateLegacy();
    this.createIndexes();
  }

  private createIndexes() {
    this.sql.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS mockpit_mocks_slug_idx ON mocks (project, slug);
      CREATE INDEX IF NOT EXISTS mockpit_mocks_updated_at_idx ON mocks (updatedAt DESC);
      CREATE INDEX IF NOT EXISTS mockpit_posts_mock_idx ON posts (mockId, state, variant);
      CREATE INDEX IF NOT EXISTS mockpit_posts_session_created_at_idx ON posts (sessionId, createdAt);
      CREATE INDEX IF NOT EXISTS mockpit_comments_session_seq_idx ON comments (sessionId, seq);
      CREATE INDEX IF NOT EXISTS mockpit_comments_mock_seq_idx ON comments (mockId, seq);
      CREATE INDEX IF NOT EXISTS mockpit_comments_post_seq_idx ON comments (postId, seq);
      CREATE INDEX IF NOT EXISTS mockpit_comments_id_idx ON comments (id);
      CREATE INDEX IF NOT EXISTS mockpit_assets_session_idx ON assets (sessionId);
    `);
  }

  // --- in-place migration of a pre-mock workspace ---

  private migrateLegacy() {
    this.addMissing("comments", {
      anchor: "TEXT",
      kind: "TEXT NOT NULL DEFAULT 'comment'",
      anchors: "TEXT NOT NULL DEFAULT '[]'",
      draft: "INTEGER NOT NULL DEFAULT 0",
      postVersion: "INTEGER",
      viewport: "INTEGER",
      mockId: "TEXT",
      payload: "TEXT",
    });
    this.migrateToSurfaces();
    this.migrateToPosts();
    this.migrateSurfaceIds();
    this.migrateToItems();
    this.migrateToVersions();
    this.migrateToMocks();
    this.sql.exec(`
      DROP TABLE IF EXISTS trace_steps;
      DROP INDEX IF EXISTS mockpit_comments_post_draft_idx;
      DROP INDEX IF EXISTS mockpit_posts_updated_at_idx;
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

  // Pre-0.5.0 workspaces stored a `snippets` table and `comments.snippetId`.
  private migrateToSurfaces() {
    const commentCols = this.columns("comments");
    if (commentCols.has("snippetId") && !commentCols.has("surfaceId")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN snippetId TO surfaceId");
    }
    if (commentCols.has("snippetTitle") && !commentCols.has("surfaceTitle")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN snippetTitle TO surfaceTitle");
    }
    if (!this.tables().has("snippets")) return;
    for (const r of this.sql.exec("SELECT * FROM snippets").toArray()) {
      const legacyHistory = parseJson<
        Array<{ version: number; title: string; html: string; at: string }>
      >(r.history, []);
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
  // `comments.surfaceId/surfaceTitle`.
  private migrateToPosts() {
    const commentCols = this.columns("comments");
    if (commentCols.has("surfaceId") && !commentCols.has("postId")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN surfaceId TO postId");
    }
    if (commentCols.has("surfaceTitle") && !commentCols.has("postTitle")) {
      this.sql.exec("ALTER TABLE comments RENAME COLUMN surfaceTitle TO postTitle");
    }
    if (!this.tables().has("surfaces")) return;
    for (const r of this.sql.exec("SELECT * FROM surfaces").toArray()) {
      const history = parseJson<Array<Record<string, unknown>>>(r.history, []).map(
        ({ parts, ...rest }) => ({ ...rest, surfaces: parts ?? [] }),
      );
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

  // Assign stable ids to surfaces written before surface ids existed.
  private migrateSurfaceIds() {
    if (this.settingSync("surfaceIdsMigrated") === "1") return;
    for (const r of this.sql.exec("SELECT id, surfaces, history FROM posts").toArray()) {
      const surfaces = normalizeSurfaceIds(parseJson<Surface[]>(r.surfaces, []));
      const history = parseJson<PostVersion[]>(r.history, []).map((h) => ({
        ...h,
        surfaces: normalizeSurfaceIds(h.surfaces ?? []),
      }));
      this.sql.exec(
        "UPDATE posts SET surfaces = ?, history = ? WHERE id = ?",
        JSON.stringify(surfaces),
        JSON.stringify(history),
        r.id as string,
      );
    }
  }

  // Before items, posts had no project/slug/variant; derive them per post.
  private migrateToItems() {
    this.addMissing("posts", {
      project: "TEXT NOT NULL DEFAULT 'workspace'",
      slug: "TEXT NOT NULL DEFAULT ''",
      kind: "TEXT NOT NULL DEFAULT 'component'",
      variant: "TEXT NOT NULL DEFAULT 'default'",
      status: "TEXT NOT NULL DEFAULT 'open'",
      slots: "TEXT NOT NULL DEFAULT '[]'",
      curFrom: "INTEGER",
      curPrompt: "TEXT",
      curAuthor: "TEXT",
    });
    if (this.settingSync("itemsMigrated") === "1") return;
    const sessions = new Map<string, { project: string | null; cwd: string | null }>();
    for (const r of this.sql.exec("SELECT id, project, cwd FROM sessions").toArray()) {
      sessions.set(r.id as string, {
        project: (r.project as string) ?? null,
        cwd: (r.cwd as string) ?? null,
      });
    }
    const taken = new Map<string, Set<string>>();
    for (const r of this.sql
      .exec("SELECT id, sessionId, title, slug FROM posts ORDER BY createdAt ASC")
      .toArray()) {
      if (((r.slug as string) ?? "") !== "") continue;
      const session = sessions.get(r.sessionId as string);
      const project = session?.project || projectFromCwd(session?.cwd ?? null) || DEFAULT_PROJECT;
      let used = taken.get(project);
      if (!used) taken.set(project, (used = new Set<string>()));
      const base = slugify(r.title as string);
      const suffix = (r.id as string)
        .slice(0, 4)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "0");
      let slug = `${base}-${suffix}`;
      for (let n = 2; used.has(slug); n++) slug = `${base}-${suffix}-${n}`;
      used.add(slug);
      this.sql.exec(
        "UPDATE posts SET project = ?, slug = ? WHERE id = ?",
        project,
        slug,
        r.id as string,
      );
    }
  }

  // History used to live in a `history` JSON blob on the post row.
  private migrateToVersions() {
    if (this.settingSync("versionsMigrated") === "1") return;
    for (const r of this.sql.exec("SELECT id, history FROM posts").toArray()) {
      for (const h of parseJson<PostVersion[]>(r.history, [])) {
        this.insertVersion(r.id as string, {
          ...h,
          surfaces: normalizeSurfaceIds(h.surfaces ?? []),
        });
      }
    }
  }

  // Every (project, item slug) becomes one single-state mock; its posts become
  // the mock's variants with state null. Unsent operator drafts become the
  // mock's draft so they are still there to send; decisions become plain
  // comments (they were already delivered).
  private migrateToMocks() {
    const rows = this.sql.exec("SELECT * FROM posts ORDER BY createdAt ASC, rowid ASC").toArray();
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.project as string}\u0000${r.slug as string}`;
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
    const mockOf = new Map<string, string>();
    const variantOf = new Map<string, string>();
    for (const group of groups.values()) {
      const first = group[0];
      const latest = group.reduce((a, b) =>
        (b.updatedAt as string) > (a.updatedAt as string) ? b : a,
      );
      const id = newId();
      this.sql.exec(
        "INSERT INTO mocks (id, project, slug, title, kind, states, asks, knobs, draft, sessionId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, '[]', '[]', '{}', NULL, ?, ?, ?)",
        id,
        (first.project as string) || DEFAULT_PROJECT,
        (first.slug as string) || slugify(first.title as string),
        first.title as string,
        group.some((r) => r.kind === "page") ? "page" : "component",
        latest.sessionId as string,
        first.createdAt as string,
        latest.updatedAt as string,
      );
      const used = new Set<string>();
      for (const r of group) {
        const base = (r.variant as string) || DEFAULT_VARIANT;
        let variant = base;
        for (let n = 2; used.has(variant); n++) variant = `${base}-${n}`;
        used.add(variant);
        mockOf.set(r.id as string, id);
        variantOf.set(r.id as string, variant);
      }
    }

    this.sql.exec(`CREATE TABLE posts_next (${POST_COLUMNS})`);
    for (const r of rows) {
      const id = r.id as string;
      this.sql.exec(
        "INSERT INTO posts_next (id, sessionId, mockId, state, variant, status, title, surfaces, knobs, slots, createdAt, updatedAt, version, curFrom, curPrompt, curAuthor) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
        id,
        r.sessionId as string,
        mockOf.get(id)!,
        variantOf.get(id)!,
        (r.status as string) || "open",
        r.title as string,
        r.surfaces as string,
        (r.slots as string) || "[]",
        r.createdAt as string,
        r.updatedAt as string,
        r.version as number,
        r.curFrom ?? null,
        r.curPrompt ?? null,
        r.curAuthor ?? null,
      );
    }
    this.sql.exec("DROP TABLE posts");
    this.sql.exec("ALTER TABLE posts_next RENAME TO posts");

    this.sql.exec(
      "UPDATE comments SET mockId = (SELECT mockId FROM posts WHERE posts.id = comments.postId) WHERE mockId IS NULL",
    );
    this.sql.exec(
      "UPDATE comments SET text = (CASE kind WHEN 'accept' THEN 'Accepted' WHEN 'revise' THEN 'Revise' ELSE 'Dropped' END) || (CASE WHEN text = '' THEN '' ELSE ': ' || text END), kind = 'comment' WHERE kind IN ('accept', 'revise', 'drop')",
    );

    const drafts = new Map<string, Draft>();
    for (const c of this.sql
      .exec("SELECT * FROM comments WHERE draft = 1 AND mockId IS NOT NULL ORDER BY seq ASC")
      .toArray()) {
      const mockId = c.mockId as string;
      let draft = drafts.get(mockId);
      if (!draft) {
        draft = {
          version: 1,
          answers: {},
          mix: {},
          tuned: {},
          comments: [],
          updatedAt: c.createdAt as string,
        };
        drafts.set(mockId, draft);
      }
      draft.version = Math.max(draft.version, (c.postVersion as number) ?? 1);
      draft.comments.push({ part: null, state: null, text: c.text as string });
      draft.updatedAt = c.createdAt as string;
    }
    for (const [mockId, draft] of drafts) {
      this.sql.exec("UPDATE mocks SET draft = ? WHERE id = ?", JSON.stringify(draft), mockId);
    }
    this.sql.exec("DELETE FROM comments WHERE draft = 1");
  }

  private settingSync(key: string): string | null {
    const rows = this.sql.exec("SELECT value FROM settings WHERE key = ?", key).toArray();
    return rows.length ? (rows[0].value as string) : null;
  }

  // --- rows ---

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

  private rowToVersion(r: Row): PostVersion {
    return {
      version: r.version as number,
      title: r.title as string,
      surfaces: parseJson<Surface[]>(r.surfaces, []),
      at: r.at as string,
      // Absent stays absent: the store contract compares entries whole.
      ...(r.fromVersion == null ? {} : { from: r.fromVersion as number }),
      ...(r.prompt == null ? {} : { prompt: r.prompt as string }),
      ...(r.author == null ? {} : { author: r.author as string }),
    };
  }

  private historiesFor(ids: string[]): Map<string, PostVersion[]> {
    const out = new Map<string, PostVersion[]>();
    if (ids.length === 0) return out;
    const rows = this.sql
      .exec(
        `SELECT * FROM post_versions WHERE postId IN (${ids.map(() => "?").join(",")}) ORDER BY version ASC`,
        ...ids,
      )
      .toArray();
    for (const r of rows) {
      const id = r.postId as string;
      let list = out.get(id);
      if (!list) out.set(id, (list = []));
      list.push(this.rowToVersion(r));
    }
    return out;
  }

  private rowsToPosts(rows: Row[]): Post[] {
    const histories = this.historiesFor(rows.map((r) => r.id as string));
    return rows.map((r) => this.rowToPost(r, histories.get(r.id as string) ?? []));
  }

  private rowToSession(r: Row): Session {
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

  private rowToMock(r: Row): Mock {
    return {
      id: r.id as string,
      project: r.project as string,
      slug: r.slug as string,
      title: r.title as string,
      kind: ((r.kind as string) === "page" ? "page" : "component") as MockKind,
      states: parseJson<string[]>(r.states, []),
      asks: parseJson<Ask[]>(r.asks, []),
      knobs: parseJson<Knobs>(r.knobs, {}),
      draft: parseJson<Draft | null>(r.draft, null),
      sessionId: (r.sessionId as string) ?? null,
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
    };
  }

  private rowToPost(r: Row, history: PostVersion[]): Post {
    const knobs = parseJson<Knobs | null>(r.knobs, null);
    return {
      id: r.id as string,
      sessionId: r.sessionId as string,
      mock: r.mockId as string,
      state: (r.state as string) ?? null,
      variant: r.variant as string,
      status: ((r.status as string) || "open") as PostStatus,
      title: r.title as string,
      surfaces: parseJson<Surface[]>(r.surfaces, []),
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
      version: r.version as number,
      history,
      ...(knobs ? { knobs } : {}),
      slots: parseJson<Slot[]>(r.slots, []),
      ...(r.curFrom == null ? {} : { from: r.curFrom as number }),
      ...(r.curPrompt == null ? {} : { prompt: r.curPrompt as string }),
      ...(r.curAuthor == null ? {} : { author: r.curAuthor as string }),
    };
  }

  // The BLOB comes back as an ArrayBuffer (real DO) or a Uint8Array
  // (node:sqlite); `new Uint8Array(raw)` copies from either into a fresh array.
  private rowToAsset(r: Row): Asset {
    const raw = r.data as ArrayBuffer | Uint8Array;
    return {
      id: r.id as string,
      sessionId: r.sessionId as string,
      kind: r.kind === "image" ? "image" : "file",
      contentType: r.contentType as string,
      byteLength: r.byteLength as number,
      filename: (r.filename as string) ?? null,
      data: new Uint8Array(raw),
      createdAt: r.createdAt as string,
      lastAccessedAt: r.lastAccessedAt as string,
    };
  }

  private rowToComment(r: Row): Comment {
    const anchor = parseJson<Comment["anchor"] | null>(r.anchor, null);
    const payload = parseJson<Reply | null>(r.payload, null);
    return {
      id: r.id as string,
      seq: r.seq as number,
      sessionId: r.sessionId as string,
      mockId: (r.mockId as string) ?? null,
      postId: (r.postId as string) ?? null,
      author: r.author as string,
      text: r.text as string,
      createdAt: r.createdAt as string,
      ...(anchor ? { anchor } : {}),
      kind: ((r.kind as string) || "comment") as Comment["kind"],
      anchors: parseJson<Anchor[]>(r.anchors, []),
      postVersion: r.postVersion == null ? null : (r.postVersion as number),
      viewport: r.viewport == null ? null : (r.viewport as number),
      ...(payload ? { payload } : {}),
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
    this.atomic(() => {
      this.sql.exec("DELETE FROM comments WHERE sessionId = ?", id);
      this.sql.exec(
        "DELETE FROM post_versions WHERE postId IN (SELECT id FROM posts WHERE sessionId = ?)",
        id,
      );
      this.sql.exec("DELETE FROM posts WHERE sessionId = ?", id);
      // A mock left with no variants has nothing to show.
      this.sql.exec(
        "DELETE FROM comments WHERE mockId IN (SELECT id FROM mocks WHERE id NOT IN (SELECT mockId FROM posts))",
      );
      this.sql.exec("DELETE FROM mocks WHERE id NOT IN (SELECT mockId FROM posts)");
      this.sql.exec("UPDATE mocks SET sessionId = NULL WHERE sessionId = ?", id);
      // Posts are gone, so the referenced set reflects survivors only: drop this
      // session's own assets except any a surviving surface still points at
      // (assets are content-addressed and may be shared across sessions).
      this.invalidateAssetRefs();
      const referenced = this.referencedAssetIds();
      for (const r of this.sql.exec("SELECT id FROM assets WHERE sessionId = ?", id).toArray()) {
        const aid = r.id as string;
        if (!referenced.has(aid)) this.sql.exec("DELETE FROM assets WHERE id = ?", aid);
      }
      this.sql.exec("DELETE FROM sessions WHERE id = ?", id);
    });
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
    return this.settingSync(key);
  }

  async setSetting(key: string, value: string) {
    if (key.startsWith("design:")) this.invalidateAssetRefs();
    this.sql.exec(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      stripNul(key),
      stripNul(value),
    );
  }

  // --- projects / mocks ---

  async listProjects() {
    return summarizeProjects(
      await this.listMocks(),
      await this.listSessions(),
      await this.listPosts(),
    );
  }

  async listMocks(project?: string) {
    const rows =
      project === undefined
        ? this.sql.exec("SELECT * FROM mocks ORDER BY updatedAt DESC, rowid DESC").toArray()
        : this.sql
            .exec(
              "SELECT * FROM mocks WHERE project = ? ORDER BY updatedAt DESC, rowid DESC",
              project,
            )
            .toArray();
    return rows.map((r) => this.rowToMock(r));
  }

  async getMock(id: string) {
    const rows = this.sql.exec("SELECT * FROM mocks WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.rowToMock(rows[0]) : null;
  }

  async findMock(project: string, slug: string) {
    const rows = this.sql
      .exec("SELECT * FROM mocks WHERE project = ? AND slug = ?", project, slug)
      .toArray();
    return rows.length > 0 ? this.rowToMock(rows[0]) : null;
  }

  async createMock(input: CreateMockInput) {
    const now = new Date().toISOString();
    const mock: Mock = {
      id: newId(),
      project: stripNul(input.project).trim() || DEFAULT_PROJECT,
      slug: slugify(stripNul(input.slug)),
      title: stripNul(input.title)?.trim() || input.slug,
      kind: input.kind === "page" ? "page" : "component",
      states: (input.states ?? []).map((s) => stripNul(s)),
      asks: [],
      knobs: input.knobs ?? {},
      draft: null,
      sessionId: input.sessionId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.sql.exec(
      "INSERT INTO mocks (id, project, slug, title, kind, states, asks, knobs, draft, sessionId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, NULL, ?, ?, ?)",
      mock.id,
      mock.project,
      mock.slug,
      mock.title,
      mock.kind,
      JSON.stringify(mock.states),
      JSON.stringify(mock.knobs),
      mock.sessionId,
      mock.createdAt,
      mock.updatedAt,
    );
    return mock;
  }

  async updateMock(id: string, patch: UpdateMockInput) {
    const mock = await this.getMock(id);
    if (!mock) return null;
    const next: Mock = {
      ...mock,
      ...(patch.title !== undefined && { title: stripNul(patch.title).trim() || mock.title }),
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.states !== undefined && { states: patch.states.map((s) => stripNul(s)) }),
      ...(patch.asks !== undefined && { asks: patch.asks }),
      ...(patch.knobs !== undefined && { knobs: patch.knobs }),
      ...(patch.sessionId !== undefined && { sessionId: patch.sessionId }),
      updatedAt: new Date().toISOString(),
    };
    this.sql.exec(
      "UPDATE mocks SET title = ?, kind = ?, states = ?, asks = ?, knobs = ?, sessionId = ?, updatedAt = ? WHERE id = ?",
      next.title,
      next.kind,
      JSON.stringify(next.states),
      JSON.stringify(next.asks),
      JSON.stringify(next.knobs),
      next.sessionId,
      next.updatedAt,
      id,
    );
    return next;
  }

  async removeMock(id: string) {
    if (!(await this.getMock(id))) return false;
    this.atomic(() => {
      this.sql.exec("DELETE FROM comments WHERE mockId = ?", id);
      this.sql.exec(
        "DELETE FROM post_versions WHERE postId IN (SELECT id FROM posts WHERE mockId = ?)",
        id,
      );
      this.sql.exec("DELETE FROM posts WHERE mockId = ?", id);
      this.sql.exec("DELETE FROM mocks WHERE id = ?", id);
    });
    this.invalidateAssetRefs();
    return true;
  }

  async putDraft(mockId: string, draft: Draft | null) {
    const mock = await this.getMock(mockId);
    if (!mock) return null;
    this.sql.exec(
      "UPDATE mocks SET draft = ? WHERE id = ?",
      draft ? JSON.stringify(draft) : null,
      mockId,
    );
    return { ...mock, draft };
  }

  private touchMock(mockId: string, at: string) {
    this.sql.exec("UPDATE mocks SET updatedAt = ? WHERE id = ?", at, mockId);
  }

  // --- posts ---

  async listPosts(query: PostQuery = {}) {
    const clauses: string[] = [];
    const params: SqlStorageValue[] = [];
    if (query.mockId !== undefined) {
      clauses.push("mockId = ?");
      params.push(query.mockId);
    }
    if (query.sessionId !== undefined) {
      clauses.push("sessionId = ?");
      params.push(query.sessionId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sql
      .exec(`SELECT * FROM posts ${where} ORDER BY createdAt ASC, rowid ASC`, ...params)
      .toArray();
    return this.rowsToPosts(rows);
  }

  async countPostsBySession() {
    const counts = new Map<string, number>();
    for (const row of this.sql
      .exec("SELECT sessionId, COUNT(*) AS n FROM posts GROUP BY sessionId")
      .toArray()) {
      counts.set(row.sessionId as string, row.n as number);
    }
    return counts;
  }

  async getPost(id: string) {
    const rows = this.sql.exec("SELECT * FROM posts WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.rowsToPosts(rows)[0] : null;
  }

  async findPost(mockId: string, state: string | null, variant: string) {
    const rows = this.sql
      .exec(
        "SELECT * FROM posts WHERE mockId = ? AND state IS ? AND variant = ? ORDER BY createdAt ASC LIMIT 1",
        mockId,
        state,
        variant,
      )
      .toArray();
    return rows.length > 0 ? this.rowsToPosts(rows)[0] : null;
  }

  async createPost(input: CreatePostInput) {
    if (!(await this.getSession(input.sessionId))) return null;
    if (!(await this.getMock(input.mock))) return null;
    const now = new Date().toISOString();
    const post: Post = {
      id: newId(),
      sessionId: input.sessionId,
      mock: input.mock,
      state: input.state === null ? null : stripNul(input.state),
      variant: stripNul(input.variant)?.trim() || DEFAULT_VARIANT,
      status: "open",
      title: stripNul(input.title)?.trim() || "Untitled",
      surfaces: normalizeSurfaceIds(input.surfaces),
      createdAt: now,
      updatedAt: now,
      version: 1,
      history: [],
      ...(input.knobs ? { knobs: input.knobs } : {}),
      slots: input.slots ?? [],
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.prompt === undefined ? {} : { prompt: stripNul(input.prompt) }),
      ...(input.author === undefined ? {} : { author: stripNul(input.author) }),
    };
    this.sql.exec(
      "INSERT INTO posts (id, sessionId, mockId, state, variant, status, title, surfaces, knobs, slots, createdAt, updatedAt, version, curFrom, curPrompt, curAuthor) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
      post.id,
      post.sessionId,
      post.mock,
      post.state,
      post.variant,
      post.title,
      JSON.stringify(post.surfaces),
      post.knobs ? JSON.stringify(post.knobs) : null,
      JSON.stringify(post.slots),
      post.createdAt,
      post.updatedAt,
      post.from ?? null,
      post.prompt ?? null,
      post.author ?? null,
    );
    this.touch(input.sessionId);
    this.touchMock(post.mock, now);
    this.addAssetRefs(post.surfaces);
    return post;
  }

  async updatePost(id: string, patch: UpdatePostInput) {
    // Compare-and-set on the version: two concurrent updates serialize without
    // a read-then-write gap. The loser sees 0 rows changed and retries.
    for (let attempt = 0; attempt < 4; attempt++) {
      const post = await this.getPost(id);
      if (!post) return null;
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
      const knobs = patch.knobs === undefined ? post.knobs : (patch.knobs ?? undefined);
      const slots = patch.slots ?? post.slots;
      const state = patch.state === undefined ? post.state : patch.state;
      const version = post.version + 1;
      const updatedAt = new Date().toISOString();
      // A revision may branch from any earlier version; default to the one it replaces.
      const from = patch.from ?? post.version;
      const prompt = stripNul(patch.prompt ?? "");
      const author = patch.author === undefined ? null : stripNul(patch.author);
      this.sql.exec(
        "UPDATE posts SET title = ?, surfaces = ?, knobs = ?, slots = ?, state = ?, updatedAt = ?, version = ?, curFrom = ?, curPrompt = ?, curAuthor = ? WHERE id = ? AND version = ?",
        title,
        JSON.stringify(surfaces),
        knobs ? JSON.stringify(knobs) : null,
        JSON.stringify(slots),
        state,
        updatedAt,
        version,
        from,
        prompt,
        author,
        id,
        post.version,
      );
      const affected = this.sql.exec("SELECT changes() AS n").one().n as number;
      if (affected > 0) {
        this.insertVersion(id, archived);
        this.sql.exec(
          "DELETE FROM post_versions WHERE postId = ? AND version <= ?",
          id,
          version - 1 - HISTORY_LIMIT,
        );
        this.touch(post.sessionId);
        this.touchMock(post.mock, updatedAt);
        if (patch.surfaces !== undefined) this.addAssetRefs(surfaces);
        const { knobs: _knobs, author: _author, ...rest } = post;
        return {
          ...rest,
          title,
          surfaces,
          ...(knobs ? { knobs } : {}),
          slots,
          state,
          version,
          updatedAt,
          history,
          from,
          prompt,
          ...(author === null ? {} : { author }),
        };
      }
    }
    return null;
  }

  async removePost(id: string) {
    if (!(await this.getPost(id))) return false;
    this.atomic(() => {
      this.sql.exec("DELETE FROM comments WHERE postId = ?", id);
      this.sql.exec("DELETE FROM post_versions WHERE postId = ?", id);
      this.sql.exec("DELETE FROM posts WHERE id = ?", id);
    });
    this.invalidateAssetRefs();
    return true;
  }

  async setPostStatus(id: string, status: PostStatus) {
    const post = await this.getPost(id);
    if (!post) return null;
    this.sql.exec("UPDATE posts SET status = ? WHERE id = ?", status, id);
    return { ...post, status };
  }

  // --- comments ---

  async listComments(query: CommentQuery) {
    const clauses: string[] = [];
    const params: SqlStorageValue[] = [];
    if (query.sessionId !== undefined) {
      clauses.push("sessionId = ?");
      params.push(query.sessionId);
    }
    if (query.mockId !== undefined) {
      clauses.push("mockId = ?");
      params.push(query.mockId);
    }
    if (query.postId !== undefined) {
      clauses.push("postId = ?");
      params.push(query.postId);
    }
    if (query.afterSeq !== undefined) {
      clauses.push("seq > ?");
      params.push(query.afterSeq);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.sql
      .exec(`SELECT * FROM comments ${where} ORDER BY seq ASC`, ...params)
      .toArray()
      .map((r) => this.rowToComment(r));
  }

  private insertComment(input: CreateCommentInput): Comment {
    const createdAt = new Date().toISOString();
    const comment: Omit<Comment, "seq"> = {
      id: newId(),
      sessionId: input.sessionId,
      mockId: input.mockId ?? null,
      postId: input.postId ?? null,
      author: stripNul(input.author).trim() || "user",
      text: stripNul(input.text),
      createdAt,
      ...(input.anchor ? { anchor: input.anchor } : {}),
      kind: input.kind ?? "comment",
      anchors: input.anchors ?? [],
      postVersion: input.postVersion ?? null,
      viewport: input.viewport ?? null,
      ...(input.payload ? { payload: input.payload } : {}),
    };
    this.sql.exec(
      "INSERT INTO comments (id, sessionId, mockId, postId, author, text, createdAt, kind, anchor, anchors, postVersion, viewport, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      comment.id,
      comment.sessionId,
      comment.mockId,
      comment.postId,
      comment.author,
      comment.text,
      comment.createdAt,
      comment.kind,
      comment.anchor ? JSON.stringify(comment.anchor) : null,
      JSON.stringify(comment.anchors),
      comment.postVersion,
      comment.viewport,
      comment.payload ? JSON.stringify(comment.payload) : null,
    );
    const seq = this.sql.exec("SELECT last_insert_rowid() AS seq").one().seq as number;
    this.touch(input.sessionId);
    return { ...comment, seq };
  }

  async createComment(input: CreateCommentInput) {
    if (!(await this.getSession(input.sessionId))) return null;
    const post = input.postId ? await this.getPost(input.postId) : null;
    return this.insertComment({
      ...input,
      postId: post?.id ?? null,
      mockId: input.mockId ?? post?.mock ?? null,
      postVersion: input.postVersion ?? post?.version ?? null,
    });
  }

  async removeComment(id: string) {
    const rows = this.sql.exec("SELECT * FROM comments WHERE id = ?", id).toArray();
    if (rows.length === 0) return null;
    const comment = this.rowToComment(rows[0]);
    this.sql.exec("DELETE FROM comments WHERE id = ?", id);
    this.touch(comment.sessionId);
    return comment;
  }

  async commitReply(input: CommitReplyInput) {
    if (!(await this.getSession(input.sessionId))) return null;
    if (!(await this.getMock(input.mockId))) return null;
    return this.atomic(() => {
      const comment = this.insertComment({
        sessionId: input.sessionId,
        mockId: input.mockId,
        author: "user",
        text: input.text,
        kind: "reply",
        postVersion: input.payload.version,
        payload: input.payload,
      });
      this.sql.exec(
        "UPDATE mocks SET asks = ?, draft = NULL WHERE id = ?",
        JSON.stringify(input.asks),
        input.mockId,
      );
      for (const id of input.accept) {
        this.sql.exec(
          "UPDATE posts SET status = 'accepted' WHERE id = ? AND mockId = ?",
          id,
          input.mockId,
        );
      }
      for (const id of input.archive) {
        this.sql.exec(
          "UPDATE posts SET status = 'archived' WHERE id = ? AND mockId = ?",
          id,
          input.mockId,
        );
      }
      return comment;
    });
  }

  // --- assets ---

  private referencedAssetIds(): Set<string> {
    if (this.assetRefCache) return this.assetRefCache;
    const out = new Set<string>();
    for (const r of this.sql.exec("SELECT surfaces FROM posts").toArray()) {
      collectAssetIds(parseJson<Surface[]>(r.surfaces, []), out);
    }
    for (const r of this.sql.exec("SELECT surfaces FROM post_versions").toArray()) {
      collectAssetIds(parseJson<Surface[]>(r.surfaces, []), out);
    }
    // An installed icon set is referenced by its project's design, not by a
    // surface; evicting it would blank that project's icons.
    for (const r of this.sql
      .exec("SELECT value FROM settings WHERE key LIKE 'design:%'")
      .toArray()) {
      const sets = parseJson<{ iconSets?: { assetId?: unknown }[] } | null>(
        r.value,
        null,
      )?.iconSets;
      for (const ref of Array.isArray(sets) ? sets : []) {
        if (typeof ref?.assetId === "string") out.add(ref.assetId);
      }
    }
    this.assetRefCache = out;
    return out;
  }

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
    for (const evict of selectEvictions(
      candidates,
      input.data.byteLength,
      MAX_WORKSPACE_ASSET_BYTES,
    )) {
      this.sql.exec("DELETE FROM assets WHERE id = ?", evict);
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
    // Bind the blob as an ArrayBuffer (the SqlStorageValue type); the node
    // adapter turns it back into a Uint8Array for node:sqlite.
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
}
