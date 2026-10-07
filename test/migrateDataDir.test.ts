import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateLegacyDataDir } from "../server/migrateDataDir.ts";

const tmpDir = () => mkdtempSync(join(tmpdir(), "mockpit-datadir-"));

test("migrates db, wal, shm, and json files from old dir to new dir", () => {
  const old = tmpDir();
  const neu = join(tmpDir(), "mockpit");
  writeFileSync(join(old, "mockpit.db"), "DB");
  writeFileSync(join(old, "mockpit.db-wal"), "WAL");
  writeFileSync(join(old, "mockpit.db-shm"), "SHM");
  writeFileSync(join(old, "mockpit.json"), "JSON");

  const moved = migrateLegacyDataDir(old, neu);

  assert.equal(moved, true);
  assert.equal(readFileSync(join(neu, "mockpit.db"), "utf8"), "DB");
  assert.equal(readFileSync(join(neu, "mockpit.db-wal"), "utf8"), "WAL");
  assert.equal(readFileSync(join(neu, "mockpit.db-shm"), "utf8"), "SHM");
  assert.equal(readFileSync(join(neu, "mockpit.json"), "utf8"), "JSON");
});

test("is idempotent — a second run does not overwrite the new dir", () => {
  const old = tmpDir();
  const neu = join(tmpDir(), "mockpit");
  writeFileSync(join(old, "mockpit.db"), "ORIGINAL");
  writeFileSync(join(old, "mockpit.json"), "ORIGINAL_JSON");

  migrateLegacyDataDir(old, neu);
  // Simulate the user having newer data at the new location on a later boot
  writeFileSync(join(neu, "mockpit.db"), "NEWER");
  const moved = migrateLegacyDataDir(old, neu);

  assert.equal(moved, false);
  assert.equal(readFileSync(join(neu, "mockpit.db"), "utf8"), "NEWER");
});

test("is a no-op when the old dir does not exist", () => {
  const neu = join(tmpDir(), "mockpit");
  const moved = migrateLegacyDataDir(join(tmpDir(), "nonexistent"), neu);
  assert.equal(moved, false);
  assert.equal(existsSync(neu), false);
});

test("is a no-op when the old dir has no mockpit files", () => {
  const old = tmpDir();
  const neu = join(tmpDir(), "mockpit");
  writeFileSync(join(old, "unrelated.txt"), "ignore me");
  const moved = migrateLegacyDataDir(old, neu);
  assert.equal(moved, false);
  assert.equal(existsSync(neu), false);
});

test("only migrates the mockpit files, leaving other files behind", () => {
  const old = tmpDir();
  const neu = join(tmpDir(), "mockpit");
  writeFileSync(join(old, "mockpit.db"), "DB");
  writeFileSync(join(old, "other.txt"), "stays");
  migrateLegacyDataDir(old, neu);
  assert.equal(existsSync(join(neu, "other.txt")), false);
  assert.equal(existsSync(join(old, "other.txt")), true);
});

test("handles a partially-populated new dir (migrates only missing files)", () => {
  const old = tmpDir();
  const neu = tmpDir();
  writeFileSync(join(old, "mockpit.db"), "OLD_DB");
  writeFileSync(join(old, "mockpit.json"), "OLD_JSON");
  // new dir already has a db — must not be overwritten
  mkdirSync(neu, { recursive: true });
  writeFileSync(join(neu, "mockpit.db"), "EXISTING_DB");

  migrateLegacyDataDir(old, neu);

  assert.equal(readFileSync(join(neu, "mockpit.db"), "utf8"), "EXISTING_DB");
  assert.equal(readFileSync(join(neu, "mockpit.json"), "utf8"), "OLD_JSON");
});
