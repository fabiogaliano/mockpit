import assert from "node:assert/strict";
import { test } from "node:test";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { SqlStore } from "../server/sqlStore.ts";
import type { SqlStorage } from "../server/types.ts";

// A 0.14-shaped database: the posts model, but before the project › item ›
// variant columns and before history moved out of the post row. Deployed
// Durable Objects can never be reset, so constructing a SqlStore over this must
// migrate it in place — add the columns, backfill identity, and move every
// history entry into post_versions.
function seedPreItemsWorkspace(storage: SqlStorage): void {
  storage.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT, cwd TEXT,
      createdAt TEXT NOT NULL, lastActiveAt TEXT NOT NULL,
      agentSeq INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, title TEXT NOT NULL,
      surfaces TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      version INTEGER NOT NULL, history TEXT NOT NULL
    );
    CREATE TABLE comments (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL,
      sessionId TEXT NOT NULL, postId TEXT, postTitle TEXT,
      author TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL,
      anchor TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const now = "2026-01-01T00:00:00.000Z";
  const session = (id: string, cwd: string | null) =>
    storage.exec(
      "INSERT INTO sessions (id, agent, title, cwd, createdAt, lastActiveAt, agentSeq) VALUES (?, ?, ?, ?, ?, ?, 0)",
      id,
      "pi",
      "Sess",
      cwd,
      now,
      now,
    );
  session("sess1", "/work/acme-site");
  session("sess2", null);

  const post = (
    id: string,
    sessionId: string,
    title: string,
    version: number,
    history: unknown[],
  ) =>
    storage.exec(
      "INSERT INTO posts (id, sessionId, title, surfaces, createdAt, updatedAt, version, history) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      sessionId,
      title,
      JSON.stringify([{ kind: "html", html: `<p>${id} current</p>` }]),
      now,
      now,
      version,
      JSON.stringify(history),
    );
  post("p1", "sess1", "Pricing Card", 3, [
    { version: 1, title: "Pricing Card", surfaces: [{ kind: "html", html: "<p>v1</p>" }], at: now },
    { version: 2, title: "Pricing Card", surfaces: [{ kind: "html", html: "<p>v2</p>" }], at: now },
  ]);
  // Same title, different post: the two must stay distinct items.
  post("p2", "sess1", "Pricing Card", 1, []);
  post("p3", "sess2", "Nav", 1, []);

  storage.exec(
    "INSERT INTO comments (id, sessionId, postId, postTitle, author, text, createdAt, anchor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    "c1",
    "sess1",
    "p1",
    "Pricing Card",
    "user",
    "make it wider",
    now,
    JSON.stringify({ kind: "point", surfaceIndex: 0, postVersion: 2, x: 0.5, y: 0.25 }),
  );
  storage.exec(
    "INSERT INTO comments (id, sessionId, postId, postTitle, author, text, createdAt, anchor) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
    "c2",
    "sess1",
    "p1",
    "Pricing Card",
    "pi",
    "on it",
    now,
  );
}

test("migrateToItems backfills project/slug/variant from the session in place", async () => {
  const storage = createSqliteStorage();
  seedPreItemsWorkspace(storage);
  const store = new SqlStore(storage);

  // project: the session's cwd basename when it declared none
  const p1 = (await store.getPost("p1"))!;
  assert.equal(p1.project, "acme-site");
  assert.equal(p1.kind, "component");
  assert.equal(p1.variant, "default");
  assert.equal(p1.status, "open");
  assert.equal(p1.ask, null);
  assert.deepEqual(p1.slots, []);

  // a session with no project and no cwd falls back to the single workspace
  assert.equal((await store.getPost("p3"))!.project, "workspace");

  // two posts with the same title become two distinct items
  const p2 = (await store.getPost("p2"))!;
  assert.notEqual(p1.slug, p2.slug);
  assert.match(p1.slug, /^pricing-card-/);
  assert.equal((await store.findVariant("acme-site", p1.slug, "default"))?.id, "p1");
  assert.deepEqual(
    (await store.listItems("acme-site")).map((i) => i.slug).sort(),
    [p1.slug, p2.slug].sort(),
  );

  // history entries gain `from` (the previous version) and an empty prompt
  assert.deepEqual(
    p1.history.map((h) => ({ version: h.version, from: h.from, prompt: h.prompt })),
    [
      { version: 1, from: undefined, prompt: "" },
      { version: 2, from: 1, prompt: "" },
    ],
  );

  // comments gain the reshape fields; a legacy point anchor becomes an Anchor
  const comments = await store.listComments({ postId: "p1" });
  assert.deepEqual(
    comments.map((c) => ({ kind: c.kind, draft: c.draft })),
    [
      { kind: "comment", draft: false },
      { kind: "comment", draft: false },
    ],
  );
  assert.equal(comments[0].anchors.length, 1);
  assert.equal(comments[0].anchors[0].shape, "pin");
  assert.deepEqual(comments[0].anchors[0].box, [0.5, 0.25]);
  assert.equal(comments[0].anchors[0].postVersion, 2);
  assert.deepEqual(comments[1].anchors, []);
});

test("migrateToVersions moves history into post_versions and blanks the column", async () => {
  const storage = createSqliteStorage();
  seedPreItemsWorkspace(storage);
  const store = new SqlStore(storage);

  const rows = storage
    .exec("SELECT postId, version, fromVersion, prompt FROM post_versions ORDER BY version")
    .toArray();
  assert.deepEqual(
    rows.map((r) => ({ postId: r.postId, version: r.version })),
    [
      { postId: "p1", version: 1 },
      { postId: "p1", version: 2 },
    ],
  );
  // The post row keeps a valid — empty — history column, so an older build
  // rolled back onto this database still reads and writes it.
  assert.deepEqual(
    storage.exec("SELECT history FROM posts WHERE id = 'p1'").toArray()[0].history,
    "[]",
  );
  assert.equal(
    storage.exec("SELECT value FROM settings WHERE key = 'versionsMigrated'").toArray()[0].value,
    "1",
  );
  // Reads still return a fully populated history.
  assert.deepEqual(
    (await store.getPost("p1"))!.history.map((h) => h.version),
    [1, 2],
  );
});

test("the reshape migrations are idempotent across reopens", async () => {
  const storage = createSqliteStorage();
  seedPreItemsWorkspace(storage);
  const first = new SqlStore(storage);
  const slug = (await first.getPost("p1"))!.slug;

  const second = new SqlStore(storage);
  const again = (await second.getPost("p1"))!;
  assert.equal(again.slug, slug, "a second boot must not re-slug an existing item");
  assert.deepEqual(
    again.history.map((h) => h.version),
    [1, 2],
    "history is not duplicated by a second migration",
  );
  assert.equal((await second.listComments({ postId: "p1" })).length, 2);
  assert.equal((await second.listPosts()).length, 3);
});
