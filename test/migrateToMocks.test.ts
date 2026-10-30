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
  // Nothing embeds the card or walks it in a flow, so it was never a component.
  assert.equal(card.kind, "sketch");
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
  assert.equal(p1.acceptedVersion, 2, "accepted meant its latest: that version is now in use");
  assert.equal(cardPosts[1].acceptedVersion, undefined);
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

test("a workspace from before the pin keeps each accepted variant at its latest", async () => {
  const path = tmpDb();
  const store = new SqlStore(createSqliteStorage(path));
  const session = await store.createSession({ agent: "pi" });
  const mock = await store.createMock({ project: "demo", slug: "card", sessionId: session.id });
  const html = (body: string) => [{ id: "s", kind: "html" as const, html: body }];
  const chosen = await store.createPost({
    sessionId: session.id,
    mock: mock.id,
    state: null,
    variant: "a",
    surfaces: html("<p>a1</p>"),
  });
  const other = await store.createPost({
    sessionId: session.id,
    mock: mock.id,
    state: null,
    variant: "b",
    surfaces: html("<p>b1</p>"),
  });
  assert.ok(chosen && other);
  await store.updatePost(chosen.id, { surfaces: html("<p>a2</p>") });
  await store.setPostStatus(chosen.id, "accepted");
  // The schema the previous release left: no acceptedVersion column.
  createSqliteStorage(path).exec("ALTER TABLE posts DROP COLUMN acceptedVersion");
  const reopened = new SqlStore(createSqliteStorage(path));
  assert.equal((await reopened.getPost(chosen.id))?.acceptedVersion, 2);
  assert.equal((await reopened.getPost(other.id))?.acceptedVersion, undefined);
});

test("a workspace from before hiding opens with no version hidden", async () => {
  const path = tmpDb();
  const store = new SqlStore(createSqliteStorage(path));
  const session = await store.createSession({ agent: "pi" });
  const mock = await store.createMock({ project: "demo", slug: "card", sessionId: session.id });
  const p = await store.createPost({
    sessionId: session.id,
    mock: mock.id,
    state: null,
    variant: "a",
    surfaces: [{ id: "s", kind: "html" as const, html: "<p>a1</p>" }],
  });
  assert.ok(p);
  // The schema the previous release left: no hiddenVersions column.
  createSqliteStorage(path).exec("ALTER TABLE posts DROP COLUMN hiddenVersions");
  const reopened = new SqlStore(createSqliteStorage(path));
  assert.equal((await reopened.getPost(p.id))?.hiddenVersions, undefined);
  assert.deepEqual((await reopened.setVersionHidden(p.id, 1, true))?.hiddenVersions, [1]);
});

test("a workspace from before flows opens with none and can declare one", async () => {
  const path = tmpDb();
  const store = new SqlStore(createSqliteStorage(path));
  await store.createMock({ project: "demo", slug: "home", states: ["rest"] });
  // The schema the previous release left: no flows table.
  createSqliteStorage(path).exec("DROP TABLE flows");
  const reopened = new SqlStore(createSqliteStorage(path));
  assert.deepEqual(await reopened.listFlows("demo"), []);
  const flow = await reopened.placeFlowStep("demo", "Morning", { mock: "home", state: "rest" }, 1);
  assert.deepEqual(flow?.steps, [{ mock: "home", state: "rest" }]);
  assert.equal((await reopened.findMock("demo", "home"))?.states[0], "rest");
});

test("a workspace from before areas opens with none and can set them", async () => {
  const path = tmpDb();
  const store = new SqlStore(createSqliteStorage(path));
  const mock = await store.createMock({ project: "demo", slug: "home", kind: "page" });
  // The schema the previous release left: no area or source column.
  const old = createSqliteStorage(path);
  old.exec("ALTER TABLE mocks DROP COLUMN area");
  old.exec("ALTER TABLE mocks DROP COLUMN source");
  const reopened = new SqlStore(createSqliteStorage(path));
  const read = await reopened.getMock(mock.id);
  assert.equal(read?.area, null);
  assert.equal(read?.source, null);
  assert.equal(read?.kind, "page");
  const set = await reopened.updateMock(mock.id, { area: "Shell", source: "apps/web/src" });
  assert.equal(set?.area, "Shell");
  assert.equal((await reopened.getMock(mock.id))?.source, "apps/web/src");
});

test("a workspace from before sketches keeps only the components in use", async () => {
  const path = tmpDb();
  const store = new SqlStore(createSqliteStorage(path));
  const session = await store.createSession({ agent: "pi" });
  const mock = (slug: string, kind: "page" | "component") =>
    store.createMock({ project: "demo", slug, kind, sessionId: session.id });
  const page = await mock("home", "page");
  await mock("chip", "component");
  await mock("step", "component");
  await mock("loose", "component");
  await store.createPost({
    sessionId: session.id,
    mock: page.id,
    state: null,
    variant: "a",
    surfaces: [{ id: "s", kind: "html" as const, html: '<mockpit-embed slug="chip">' }],
    embeds: [{ slug: "chip", variant: "default", version: 1 }],
  });
  await store.placeFlowStep("demo", "Morning", { mock: "step", state: null }, 1);
  // The state the previous release left: no marker, every undeclared mock a component.
  createSqliteStorage(path).exec("DELETE FROM settings WHERE key = 'sketchKind'");
  const reopened = new SqlStore(createSqliteStorage(path));
  const kinds = Object.fromEntries((await reopened.listMocks("demo")).map((m) => [m.slug, m.kind]));
  assert.deepEqual(kinds, { home: "page", chip: "component", step: "component", loose: "sketch" });
});

test("a workspace from before the contract renames reads in the new names", async () => {
  const path = tmpDb();
  const store = new SqlStore(createSqliteStorage(path));
  const session = await store.createSession({ agent: "pi" });
  const mock = await store.createMock({ project: "demo", slug: "card", sessionId: session.id });
  const html = (body: string) => [{ id: "s", kind: "html" as const, html: body }];
  const post = (variant: string, body: string) =>
    store.createPost({
      sessionId: session.id,
      mock: mock.id,
      state: null,
      variant,
      surfaces: html(body),
    });
  const kept = await post("kept", "<p>kept</p>");
  const gone = await post("gone", "<p>gone</p>");
  const page = await post("page", `<main><mockpit-slot slug="chip"></mockpit-slot></main>`);
  assert.ok(kept && gone && page);
  await store.updatePost(page.id, { surfaces: html(`<mockpit-SLOT slug='chip'/><p>v2</p>`) });
  // A code surface may quote the tag as text; only html is markup.
  const code = await store.createPost({
    sessionId: session.id,
    mock: mock.id,
    state: null,
    variant: "code",
    surfaces: [{ id: "c", kind: "code", code: "<mockpit-slot slug='x'>" }],
  });
  assert.ok(code);
  // Replies and a draft as the previous release stored them.
  const reply = (payload: Record<string, unknown>) =>
    store.createComment({
      sessionId: session.id,
      mockId: mock.id,
      author: "user",
      text: "",
      kind: "reply",
      payload: { mockId: mock.id, version: 1, answers: {}, tuned: {}, comments: [], ...payload },
    } as never);
  const accept = await reply({
    mix: { body: "gone" },
    decision: { kind: "accept", state: null, variant: "kept", version: 1 },
  });
  const revise = await reply({
    mix: {},
    decision: { kind: "revise", state: null, variant: "kept" },
  });
  const drop = await reply({ mix: {}, decision: { kind: "drop", state: null, variant: "gone" } });
  const closed = await reply({ mix: {}, resolved: { dismissed: ["tone"] } });
  const edited = await reply({ mix: {}, edited: { kind: "page" } });
  assert.ok(accept && revise && drop && closed && edited);
  await store.putDraft(mock.id, {
    version: 1,
    answers: {},
    mix: { body: "kept" },
    tuned: {},
    comments: [],
    updatedAt: "t",
  } as never);
  // The schema and values the previous release left.
  const old = createSqliteStorage(path);
  old.exec("ALTER TABLE mocks RENAME COLUMN closedAt TO resolvedAt");
  old.exec("UPDATE mocks SET resolvedAt = '2026-10-01T00:00:00.000Z' WHERE id = ?", mock.id);
  old.exec("UPDATE posts SET status = 'dropped' WHERE id = ?", gone.id);
  old.exec("UPDATE posts SET status = 'accepted', acceptedVersion = 1 WHERE id = ?", kept.id);
  old.exec("DELETE FROM settings WHERE key = 'contractTerms'");

  const reopened = new SqlStore(createSqliteStorage(path));
  const after = await reopened.getMock(mock.id);
  assert.equal(after?.closedAt, "2026-10-01T00:00:00.000Z", "the close survives the rename");
  assert.deepEqual(after?.draft?.borrowed, { body: "kept" });
  assert.equal("mix" in (after?.draft ?? {}), false);
  assert.equal((await reopened.getPost(gone.id))?.status, "archived", "dropped is archived");
  assert.equal((await reopened.getPost(kept.id))?.status, "accepted");
  assert.equal((await reopened.getPost(kept.id))?.acceptedVersion, 1);

  const payloads = new Map(
    (await reopened.listComments({ mockId: mock.id })).map((c) => [c.id, c.payload!]),
  );
  assert.deepEqual(payloads.get(accept.id), {
    mockId: mock.id,
    version: 1,
    answers: {},
    tuned: {},
    comments: [],
    borrowed: { body: "gone" },
    verdict: { kind: "use", state: null, variant: "kept", version: 1 },
  });
  assert.deepEqual(payloads.get(revise.id)?.verdict, {
    kind: "revise",
    state: null,
    variant: "kept",
  });
  const dropped = payloads.get(drop.id)!;
  assert.equal("verdict" in dropped || "decision" in dropped, false, "a drop keeps no verdict");
  assert.deepEqual(payloads.get(closed.id)?.closed, { dismissed: ["tone"] });
  assert.equal("resolved" in payloads.get(closed.id)!, false);
  assert.deepEqual(payloads.get(edited.id)?.edited, { kind: "page" });
  for (const p of payloads.values()) assert.equal("mix" in p, false);

  const current = (await reopened.getPost(page.id))!;
  assert.equal(
    (current.surfaces[0] as { html: string }).html,
    `<mockpit-embed slug='chip'/><p>v2</p>`,
  );
  assert.equal(
    (current.history[0].surfaces[0] as { html: string }).html,
    `<main><mockpit-embed slug="chip"></mockpit-embed></main>`,
    "every stored version still names its embeds",
  );
  assert.equal(
    ((await reopened.getPost(code.id))!.surfaces[0] as { code: string }).code,
    "<mockpit-slot slug='x'>",
  );

  // Once only: reopening the lifted workspace changes nothing.
  const snapshot = {
    mock: await reopened.getMock(mock.id),
    posts: await reopened.listPosts({ mockId: mock.id }),
    comments: await reopened.listComments({ mockId: mock.id }),
  };
  const again = new SqlStore(createSqliteStorage(path));
  assert.deepEqual(
    {
      mock: await again.getMock(mock.id),
      posts: await again.listPosts({ mockId: mock.id }),
      comments: await again.listComments({ mockId: mock.id }),
    },
    snapshot,
  );
});
