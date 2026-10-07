import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { migrateLegacyDataDir } from "./migrateDataDir.ts";
import { SqlStore } from "./sqlStore.ts";
import { createSqliteStorage, migrateJsonToSqlite } from "./sqliteStorage.ts";
import { JsonFileStore } from "./storage.ts";
import type { Store } from "./types.ts";

// Source layout puts this file at server/index.ts; the published package runs
// the compiled copy at dist/server/index.js. viewer/ and guide/ live at the
// package root either way.
let root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (basename(root) === "dist") root = join(root, "..");

const [viewerHtml, guideMarkdown, setupText, agentHowtoText, pkgJson] = await Promise.all([
  readFile(join(root, "viewer", "dist", "index.html"), "utf8").catch(() => {
    console.error("viewer build missing — run `npm run build:viewer` first");
    return process.exit(1);
  }),
  readFile(join(root, "guide", "DESIGN_GUIDE.md"), "utf8"),
  readFile(join(root, "guide", "AGENT_SETUP.md"), "utf8"),
  readFile(join(root, "guide", "AGENT_HOWTO.md"), "utf8"),
  readFile(join(root, "package.json"), "utf8"),
]);

const pr = process.env.MOCKPIT_PUBLIC_READ;
const publicRead = pr === "session" || pr === "full" ? pr : undefined;

// Storage backend. SQLite (via node:sqlite) is the default so the local server
// mirrors the Cloudflare Durable Object deploy — both run the same SqlStore.
// MOCKPIT_STORE=json selects the legacy single-file JSON store instead.
// MOCKPIT_DATA names the JSON file (and the one-time migration source);
// MOCKPIT_DB names the SQLite file. Both default to ~/.mockpit/ — a
// user-owned dir that survives reinstalls and is writable regardless of how
// the package was installed (a package-relative default is read-only under
// `sudo npm i -g` and wiped on upgrade).
const dataDir = join(homedir(), ".mockpit");
const jsonPath = process.env.MOCKPIT_DATA ?? join(dataDir, "mockpit.json");
// The SQLite file defaults next to the JSON one (same dir, `.db` suffix) so a
// deploy that only sets MOCKPIT_DATA still gets an isolated, co-located db —
// and the migration source sits right beside it.
const dbPath = process.env.MOCKPIT_DB ?? `${jsonPath.replace(/\.json$/, "")}.db`;
// Migrate from the legacy package-relative `<root>/data/` location to the
// user-owned home dir, but only when using default paths — a user who set
// MOCKPIT_DATA or MOCKPIT_DB is managing their own location.
if (!process.env.MOCKPIT_DATA && !process.env.MOCKPIT_DB) {
  if (migrateLegacyDataDir(join(root, "data"), dataDir)) {
    console.log(`[mockpit] migrated existing data from ${join(root, "data")} to ${dataDir}`);
  }
}
let store: Store;
if (process.env.MOCKPIT_STORE === "json") {
  store = new JsonFileStore(jsonPath);
  console.log(`mockpit store: JSON file at ${jsonPath}`);
} else {
  const sqlite = new SqlStore(createSqliteStorage(dbPath));
  // First SQLite boot with a legacy JSON file present copies it in once.
  await migrateJsonToSqlite(sqlite, jsonPath);
  store = sqlite;
  // Announce the backend so an existing MOCKPIT_DATA deploy isn't surprised by
  // the silent switch to SQLite (set MOCKPIT_STORE=json to keep the old store).
  console.log(`mockpit store: SQLite at ${dbPath} (MOCKPIT_STORE=json for the legacy JSON store)`);
}

const app = createApp({
  store,
  viewerHtml,
  guideMarkdown,
  setupText,
  agentHowtoText,
  authToken: process.env.MOCKPIT_TOKEN,
  publicRead,
  // MOCKPIT_VERSION fakes the running version (manual testing of the
  // notice); set it to the empty string to disable the update check
  version: process.env.MOCKPIT_VERSION ?? (JSON.parse(pkgJson) as { version: string }).version,
  upgradeCommand: "npm install -g mockpit",
});

const port = Number(process.env.PORT ?? 8228);
// MOCKPIT_HOST (or `serve --host`) restricts the listener to one address.
// Unset keeps the previous behaviour — node's default, every interface — because
// that is what a container or a LAN-shared instance needs. Set it to 127.0.0.1
// when the server shares a host with anything you don't want reaching it; that
// is stronger than the token, which is a single shared secret by design.
const hostname = process.env.MOCKPIT_HOST || undefined;

serve({ fetch: app.fetch, port, hostname }, (info) => {
  // Report the address actually bound. Printing "localhost" unconditionally hid
  // the fact that the default listens on every interface.
  const shown = hostname ?? "localhost";
  const authority = shown.includes(":") ? `[${shown}]` : shown;
  console.log(
    `mockpit listening on http://${authority}:${info.port}` +
      (hostname ? "" : " (all interfaces — set MOCKPIT_HOST to restrict)"),
  );
});
