import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { SqlStore } from "../server/sqlStore.ts";
import type { SqlStorage } from "../server/types.ts";

// The schema a deployed Durable Object holds from the last pre-mock release:
// posts carry project/slug/variant/kind themselves, comments carry draft and
// decision kinds, and history already lives in post_versions.
function seedPreRebuild(sql: SqlStorage) {
  sql.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT, cwd TEXT,
      createdAt TEXT NOT NULL, lastActiveAt TEXT NOT NULL,
      agentSeq INTEGER NOT NULL DEFAULT 0, project TEXT
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, title TEXT NOT NULL,
      surfaces TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      version INTEGER NOT NULL, history TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT 'workspace', slug TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'component', variant TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL DEFAULT 'open', ask TEXT,
      slots TEXT NOT NULL DEFAULT '[]',
      curFrom INTEGER, curPrompt TEXT, curAuthor TEXT
    );
    CREATE TABLE post_versions (
      postId TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL,
      surfaces TEXT NOT NULL, at TEXT NOT NULL,
      fromVersion INTEGER, prompt TEXT, author TEXT,
      PRIMARY KEY (postId, version)
    );
    CREATE TABLE comments (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL,
      sessionId TEXT NOT NULL, postId TEXT, postTitle TEXT,
      author TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'comment', anchors TEXT NOT NULL DEFAULT '[]',
      draft INTEGER NOT NULL DEFAULT 0, postVersion INTEGER, viewport INTEGER,
      anchor TEXT
    );
    CREATE TABLE assets (
      id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, kind TEXT NOT NULL,
      contentType TEXT NOT NULL, byteLength INTEGER NOT NULL, filename TEXT,
      data BLOB NOT NULL, createdAt TEXT NOT NULL, lastAccessedAt TEXT NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE trace_steps (
      sessionId TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT,
      label TEXT NOT NULL, detail TEXT, ts TEXT,
      PRIMARY KEY (sessionId, seq)
    );
    CREATE INDEX mockpit_comments_post_draft_idx ON comments (postId, draft);
    CREATE INDEX mockpit_posts_updated_at_idx ON posts (updatedAt DESC);
    INSERT INTO settings VALUES ('surfaceIdsMigrated', '1'), ('itemsMigrated', '1'),
      ('versionsMigrated', '1'), ('theme', 'gruvbox');
    INSERT INTO sessions VALUES
      ('s1', 'claude', 'Card work', '/work/demo', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z', 3, 'demo'),
      ('s2', 'pi', NULL, NULL, '2025-01-01T00:00:00Z', '2025-01-03T00:00:00Z', 0, 'demo');
    INSERT INTO trace_steps VALUES ('s1', 1, 'run', 'built', NULL, NULL);
  `);
  const html = (id: string, body: string) => JSON.stringify([{ id, kind: "html", html: body }]);
  const post = (
    id: string,
    session: string,
    title: string,
    slug: string,
    variant: string,
    kind: string,
    created: string,
    updated: string,
    version: number,
    status = "open",
  ) =>
    sql.exec(
      "INSERT INTO posts (id, sessionId, title, surfaces, createdAt, updatedAt, version, history, project, slug, kind, variant, status, curPrompt) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'demo', ?, ?, ?, ?, ?)",
      id,
      session,
      title,
      html(`${id}-s`, `<p>${title} v${version}</p>`),
      created,
      updated,
      version,
      slug,
      kind,
      variant,
      status,
      version > 1 ? "tighter" : null,
    );
  post(
    "p1",
    "s1",
    "Card",
    "card",
    "default",
    "component",
    "2025-01-01T01:00:00Z",
    "2025-01-01T05:00:00Z",
    2,
    "accepted",
  );
  // Same slug and the same variant name: the two must stay distinct variants.
  post(
    "p2",
    "s2",
    "Card alt",
    "card",
    "default",
    "component",
    "2025-01-01T02:00:00Z",
    "2025-01-01T06:00:00Z",
    1,
  );
  post(
    "p3",
    "s1",
    "Landing",
    "landing",
    "hero",
    "page",
    "2025-01-01T03:00:00Z",
    "2025-01-01T04:00:00Z",
    1,
  );
  sql.exec(
    "INSERT INTO post_versions VALUES ('p1', 1, 'Card', ?, '2025-01-01T01:00:00Z', NULL, NULL, 'claude')",
    html("p1-s", "<p>Card v1</p>"),
  );
  const comment = (
    seq: number,
    id: string,
    session: string,
    postId: string | null,
    author: string,
    text: string,
    kind = "comment",
    draft = 0,
  ) =>
    sql.exec(
      "INSERT INTO comments (seq, id, sessionId, postId, postTitle, author, text, createdAt, kind, draft, postVersion) VALUES (?, ?, ?, ?, 'old title', ?, ?, ?, ?, ?, ?)",
      seq,
      id,
      session,
      postId,
      author,
      text,
      `2025-01-01T0${seq}:30:00Z`,
      kind,
      draft,
      postId ? 1 : null,
    );
  comment(1, "c1", "s1", "p1", "user", "bigger title");
  comment(2, "c2", "s1", "p1", "user", "ship it", "accept");
  comment(3, "c3", "s1", "p3", "user", "", "drop");
  comment(4, "c4", "s2", "p2", "user", "tighten", "comment", 1);
  comment(5, "c5", "s1", null, "agent", "session note");
  // A gap in seq (a deleted comment) must survive: cursors compare against it.
  comment(7, "c7", "s2", "p2", "user", "rethink", "revise");
}

const tmpDb = () => join(mkdtempSync(join(tmpdir(), "mockpit-migrate-")), "w.db");

test("a pre-rebuild workspace is lifted into mocks in place", async () => {
  const path = tmpDb();
  seedPreRebuild(createSqliteStorage(path));
  const store = new SqlStore(createSqliteStorage(path));

  const mocks = await store.listMocks("demo");
  assert.deepEqual(mocks.map((m) => m.slug).sort(), ["card", "landing"]);
  const card = mocks.find((m) => m.slug === "card")!;
  const landing = mocks.find((m) => m.slug === "landing")!;
  assert.equal(card.kind, "component");
  assert.equal(landing.kind, "page");
  assert.deepEqual(card.states, []);
  assert.equal(card.title, "Card");
  // The latest writer owns the mock, so a reply reaches the session still working on it.
  assert.equal(card.sessionId, "s2");
  assert.equal(card.updatedAt, "2025-01-01T06:00:00Z");

  const cardPosts = await store.listPosts({ mockId: card.id });
  assert.deepEqual(
    cardPosts.map((p) => [p.id, p.state, p.variant, p.status]),
    [
      ["p1", null, "default", "accepted"],
      ["p2", null, "default-2", "open"],
    ],
  );
  const p1 = cardPosts[0];
  assert.equal(p1.version, 2);
  assert.equal(p1.prompt, "tighter");
  assert.deepEqual(
    p1.history.map((h) => [h.version, h.author]),
    [[1, "claude"]],
  );
  assert.equal((p1.surfaces[0] as { html: string }).html, "<p>Card v2</p>");
  const [p3] = await store.listPosts({ mockId: landing.id });
  assert.equal(p3.variant, "hero");

  const comments = await store.listComments({});
  assert.deepEqual(
    comments.map((c) => c.seq),
    [1, 2, 3, 5, 7],
    "seqs preserved, the draft removed",
  );
  const byId = new Map(comments.map((c) => [c.id, c]));
  assert.equal(byId.get("c1")!.mockId, card.id);
  assert.equal(byId.get("c3")!.mockId, landing.id);
  assert.equal(byId.get("c5")!.mockId, null);
  // Decisions were already delivered, so they survive as plain comments.
  assert.deepEqual(
    ["c2", "c3", "c7"].map((id) => [byId.get(id)!.kind, byId.get(id)!.text]),
    [
      ["comment", "Accepted: ship it"],
      ["comment", "Dropped"],
      ["comment", "Revise: rethink"],
    ],
  );

  // The unsent draft is still there to send, now on the mock.
  assert.deepEqual(card.draft?.comments, [{ part: null, state: null, text: "tighten" }]);
  assert.equal(card.draft?.version, 1);
  assert.equal(landing.draft, null);

  assert.equal((await store.getSession("s1"))!.agentSeq, 3);
  assert.equal(await store.getSetting("theme"), "gruvbox");
  const next = await store.createComment({ sessionId: "s1", author: "user", text: "new" });
  assert.equal(next!.seq, 8, "AUTOINCREMENT continues past the highest migrated seq");
});

test("the legacy tables and indexes are dropped and the new indexes exist", () => {
  const path = tmpDb();
  seedPreRebuild(createSqliteStorage(path));
  new SqlStore(createSqliteStorage(path));
  const sql = createSqliteStorage(path);
  const names = (type: string) =>
    sql
      .exec("SELECT name FROM sqlite_master WHERE type = ?", type)
      .toArray()
      .map((r) => r.name as string);
  assert.ok(!names("table").includes("trace_steps"));
  assert.ok(!names("table").includes("posts_next"));
  assert.ok(names("table").includes("mocks"));
  const indexes = names("index");
  assert.ok(!indexes.includes("mockpit_comments_post_draft_idx"));
  assert.ok(!indexes.includes("mockpit_posts_updated_at_idx"));
  assert.ok(indexes.includes("mockpit_posts_mock_idx"));
  assert.ok(indexes.includes("mockpit_mocks_slug_idx"));
  const postCols = sql
    .exec("SELECT name FROM pragma_table_info('posts')")
    .toArray()
    .map((r) => r.name as string);
  assert.ok(postCols.includes("mockId"));
  assert.ok(!postCols.includes("slug"));
  assert.ok(!postCols.includes("history"));
});

test("reopening a migrated workspace changes nothing", async () => {
  const path = tmpDb();
  seedPreRebuild(createSqliteStorage(path));
  const first = new SqlStore(createSqliteStorage(path));
  const snapshot = async (store: SqlStore) => ({
    mocks: await store.listMocks(),
    posts: await store.listPosts(),
    comments: await store.listComments({}),
  });
  const before = await snapshot(first);
  const after = await snapshot(new SqlStore(createSqliteStorage(path)));
  assert.deepEqual(after, before);
});
