import assert from "node:assert/strict";
import { test } from "node:test";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { runStoreContract } from "./storeContract.ts";

// Runs the shared store contract against SqlStore on node:sqlite (:memory:) —
// the same adapter the local server uses on disk, so the contract exercises the
// real Node SQLite path rather than a bespoke shim.
runStoreContract("SqlStore", () => new SqlStore(createSqliteStorage()));

const hotPathIndexes = {
  mockpit_assets_session_idx: ["sessionId"],
  mockpit_comments_id_idx: ["id"],
  mockpit_comments_mock_seq_idx: ["mockId", "seq"],
  mockpit_comments_post_seq_idx: ["postId", "seq"],
  mockpit_comments_session_seq_idx: ["sessionId", "seq"],
  mockpit_mocks_slug_idx: ["project", "slug"],
  mockpit_mocks_updated_at_idx: ["updatedAt"],
  mockpit_posts_mock_idx: ["mockId", "state", "variant"],
  mockpit_posts_session_created_at_idx: ["sessionId", "createdAt"],
  mockpit_sessions_key_idx: ["key"],
} as const;

test("SqlStore adds hot-path indexes to existing workspaces idempotently", () => {
  const storage = createSqliteStorage();
  new SqlStore(storage);

  // Model a database created by an older release, before these indexes existed.
  for (const name of Object.keys(hotPathIndexes)) storage.exec(`DROP INDEX ${name}`);

  new SqlStore(storage);
  new SqlStore(storage);

  const indexes = storage
    .exec(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE 'mockpit_%' ORDER BY name",
    )
    .toArray();
  assert.deepEqual(
    indexes.map((row) => row.name),
    Object.keys(hotPathIndexes),
  );
  for (const [name, columns] of Object.entries(hotPathIndexes)) {
    const actual = storage
      .exec(`SELECT name FROM pragma_index_info('${name}') ORDER BY seqno`)
      .toArray()
      .map((row) => row.name);
    assert.deepEqual(actual, columns, `${name} column order`);
  }
});

test("SqlStore hot queries use their covering or ordering indexes", () => {
  const storage = createSqliteStorage();
  new SqlStore(storage);

  const assertUsesIndex = (query: string, index: string, ...bindings: (string | number)[]) => {
    const plan = storage
      .exec(`EXPLAIN QUERY PLAN ${query}`, ...bindings)
      .toArray()
      .map((row) => row.detail)
      .join("\n");
    assert.match(plan, new RegExp(`\\b${index}\\b`), `${query}\n${plan}`);
  };

  assertUsesIndex(
    "SELECT * FROM posts WHERE sessionId = ? ORDER BY createdAt ASC",
    "mockpit_posts_session_created_at_idx",
    "session",
  );
  assertUsesIndex(
    "SELECT * FROM posts WHERE mockId = ? AND state IS ? AND variant = ? ORDER BY createdAt ASC LIMIT 1",
    "mockpit_posts_mock_idx",
    "mock",
    "Writing",
    "default",
  );
  assertUsesIndex(
    "SELECT * FROM mocks WHERE project = ? AND slug = ?",
    "mockpit_mocks_slug_idx",
    "demo",
    "writer",
  );
  assertUsesIndex(
    "SELECT * FROM comments WHERE mockId = ? AND seq > ? ORDER BY seq ASC",
    "mockpit_comments_mock_seq_idx",
    "mock",
    10,
  );
  assertUsesIndex(
    "SELECT * FROM comments WHERE sessionId = ? AND seq > ? ORDER BY seq ASC",
    "mockpit_comments_session_seq_idx",
    "session",
    10,
  );
  assertUsesIndex(
    "SELECT * FROM comments WHERE postId = ? AND seq > ? ORDER BY seq ASC",
    "mockpit_comments_post_seq_idx",
    "post",
    10,
  );
  assertUsesIndex("SELECT * FROM comments WHERE id = ?", "mockpit_comments_id_idx", "comment");
  assertUsesIndex(
    "SELECT * FROM assets WHERE sessionId = ?",
    "mockpit_assets_session_idx",
    "session",
  );
});
