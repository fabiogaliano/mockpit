import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqlStorage, SqlStorageCursor, SqlStorageValue } from "./types.ts";

// node:sqlite emits a one-time ExperimentalWarning when the builtin loads. It's
// stable enough for us (the store-contract suite runs SqlStore against it), so
// drop just that line while loading it, then restore the default handler. The
// import is dynamic so the patch is in place first — a static `import` is
// instantiated before any module body runs, too early to intercept. Every other
// warning is untouched.
const defaultEmitWarning = process.emitWarning;
process.emitWarning = function patched(warning: string | Error, ...rest: unknown[]) {
  const message = typeof warning === "string" ? warning : warning.message;
  if (/\bSQLite is an experimental feature\b/.test(message)) return;
  (defaultEmitWarning as (w: string | Error, ...r: unknown[]) => void)(warning, ...rest);
} as typeof process.emitWarning;
// finally so the original handler is restored even if the import rejects (e.g.
// a Node build without node:sqlite) — otherwise the patch would leak and
// silently swallow later SQLite warnings from elsewhere.
let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} finally {
  process.emitWarning = defaultEmitWarning;
}

function makeCursor(rows: Record<string, SqlStorageValue>[]): SqlStorageCursor {
  return {
    toArray: () => rows,
    one: () => {
      if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`);
      return rows[0];
    },
  };
}

// A `SqlStorage` (the slice of a Durable Object's SQL API that SqlStore uses)
// backed by Node's built-in node:sqlite. Lets the SAME SqlStore run locally
// that runs on the Worker DO, so the two deploys exercise one storage code
// path. `:memory:` (the default) backs the store-contract suite; a file path is
// the real local store.
export function createSqliteStorage(path = ":memory:"): SqlStorage {
  if (path !== ":memory:") {
    // node:sqlite won't create missing parent directories — it just fails with
    // "unable to open database file", so a first run would always crash.
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  if (path !== ":memory:") {
    // WAL + NORMAL: durable across a crash, far fewer fsyncs than the default
    // — the right tradeoff for a single-process local server.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  return {
    exec(query, ...bindings) {
      // Schema DDL (multi-statement) and transaction control can't be run as a
      // bound prepared statement — hand them to db.exec() directly. Everything
      // else is a single prepared statement, matching the DO's exec(). The
      // `bindings.length === 0` guard relies on SqlStore never issuing a
      // zero-binding query that contains a literal `;` (it inlines no values —
      // every dynamic value is a bound `?`), so a semicolon only ever means DDL.
      const control =
        bindings.length === 0 &&
        (/;\s*\S/.test(query) || /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(query));
      if (control) {
        db.exec(query);
        return makeCursor([]);
      }
      // node:sqlite binds blobs as Uint8Array; the SqlStorage contract passes
      // them as ArrayBuffer — adapt so BLOB columns round-trip.
      const params = bindings.map((b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : b)) as (
        | string
        | number
        | null
        | Uint8Array
      )[];
      const rows = db.prepare(query).all(...params) as Record<string, SqlStorageValue>[];
      return makeCursor(rows);
    },
    transactionSync<T>(fn: () => T): T {
      // Already inside one (a store method composing another): join it.
      if (db.isTransaction) return fn();
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
