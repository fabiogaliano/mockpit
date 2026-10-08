import { expect, test as base } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type ServerHandle = { url: string; stop: () => void };

// A real `node server/index.ts` on an ephemeral port with its own SQLite file,
// so every test starts from an empty workspace and tests run in parallel.
export async function startMockpitServer(
  env: Record<string, string | undefined> = {},
): Promise<ServerHandle> {
  const dataDir = mkdtempSync(join(tmpdir(), "mockpit-e2e-"));
  const proc: ChildProcess = spawn(process.execPath, ["server/index.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      PORT: "0",
      MOCKPIT_DB: join(dataDir, "mockpit.db"),
      // empty = no version = no update check: keeps tests off the network
      // and the update banner out of the DOM
      MOCKPIT_VERSION: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = out.match(/listening on (http:\/\/localhost:\d+)/);
      if (match) resolve(match[1]);
    });
    proc.on("exit", (code) => reject(new Error(`server exited early with code ${code}`)));
    setTimeout(() => reject(new Error(`server did not boot in time; output: ${out}`)), 15_000);
  });
  return { url, stop: () => proc.kill() };
}

export const test = base.extend<{ server: { url: string } }>({
  // oxlint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const server = await startMockpitServer({ MOCKPIT_TOKEN: "" });
    try {
      await use({ url: server.url });
    } finally {
      server.stop();
    }
  },
});

export { expect };

// The agent tier: plain HTTP without Fetch Metadata, as the CLI and curl send it.
export async function agentCall<T = any>(
  server: string,
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method }
      : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(`${server}${path}`, init);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
