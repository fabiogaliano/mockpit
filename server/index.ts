import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { SqlStore } from "./sqlStore.ts";
import { createSqliteStorage } from "./sqliteStorage.ts";

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

// Storage: SQLite via node:sqlite, the same SqlStore the Cloudflare Durable
// Object runs, so local mirrors the deploy. MOCKPIT_DB names the file; the
// default lives in ~/.mockpit/, a user-owned dir that survives reinstalls and
// is writable however the package was installed.
const dbPath = process.env.MOCKPIT_DB ?? join(homedir(), ".mockpit", "mockpit.db");
const store = new SqlStore(createSqliteStorage(dbPath));
console.log(`mockpit store: SQLite at ${dbPath}`);

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
