#!/usr/bin/env node

// `npm run dev` against a throwaway workspace, seeded with the demo content.
// Pointing MOCKPIT_DATA at a temp file isolates both stores: the SQLite path is
// derived from it, and the real ~/.mockpit is never read, migrated or written.
// The workspace is wiped on every start so the demo seed never duplicates.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = process.env.PORT ?? "8229";
const url = `http://localhost:${port}`;
const data = join(tmpdir(), "mockpit-sandbox.json");
const db = data.replace(/\.json$/, ".db");
for (const file of [data, db, `${db}-wal`, `${db}-shm`]) rmSync(file, { force: true });

const root = new URL("..", import.meta.url).pathname;
const env = { ...process.env, PORT: port, MOCKPIT_DATA: data, MOCKPIT_URL: url };
const dev = spawn("npm", ["run", "dev"], { cwd: root, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => dev.kill(signal));
}
dev.on("exit", (code) => process.exit(code ?? 0));

const deadline = Date.now() + 60_000;
while (
  !(await fetch(`${url}/api/version`).then(
    (r) => r.ok,
    () => false,
  ))
) {
  if (Date.now() > deadline) throw new Error(`sandbox server did not start on ${url}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const seed = spawn(process.execPath, ["bin/mockpit.js", "demo"], {
  cwd: root,
  env,
  stdio: "inherit",
});
seed.on("exit", () => {
  console.log(`\nsandbox ready: ${url}  (workspace: ${db}, wiped on restart)`);
  console.log(
    `play the agent from another terminal:\n  export MOCKPIT_URL=${url}\n  node bin/mockpit.js help\n`,
  );
});
