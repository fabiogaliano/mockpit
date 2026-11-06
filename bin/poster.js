// Automatic posters: a still of a page just published, taken with a local headless Chrome
// or Chromium, so Studio and Home show a picture without the agent doing anything. Built-ins
// only, like the rest of the CLI, and the stdio MCP server loads this same file.
//
// A publish only leaves a job here and returns. A detached worker does the rest, one page at
// a time through one browser, because an agent publishing thirty variants in a loop must not
// start thirty Chromes. Nothing in here may reach the agent: no browser, a timeout or a failed
// capture means the page runs live in the overviews, which is what it did before posters.
//
// The worker renders the served document and doesn't take a poster's place: one sent by the
// agent wins, and the server refuses a still of a version that has since changed. A system
// write retakes the project's stills: one taken under an older revision no longer shows.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

// One page's whole capture. A page that hasn't drawn by then isn't worth a browser's time.
const CAPTURE_MS = 15_000;
const LOAD_MS = 8_000;
// A job this old describes a burst long past, and its version has likely moved on.
const JOB_MAX_AGE_MS = 2 * 60_000;
// Stills one system change retakes, latest variants first: the rest run live until then.
const RETAKE_MAX = 40;
// Stays up briefly for the next publish of a burst, which saves starting a browser again.
const WORKER_IDLE_MS = 3_000;
const WORKER_MAX_MS = 10 * 60_000;
// A lock not touched for longer than the longest capture belongs to a worker that died.
const LOCK_STALE_MS = CAPTURE_MS * 2;
const BROWSER_START_MS = 10_000;
// Overviews show a page small and whole; past this its top is what can be read anyway.
const MAX_HEIGHT_PER_WIDTH = 3;
const DEFAULT_WIDTH = 820;
const VIEWPORT_H = 800;
const JPEG_QUALITY = 80;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function browserCandidates() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  if (process.platform === "win32") {
    return [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return dirs.flatMap((dir) => names.map((name) => join(dir, name)));
}

// CHROME_PATH names the browser. Set to anything that isn't one, it means there is none.
export function findBrowser() {
  const chosen = process.env.CHROME_PATH;
  if (chosen !== undefined) return chosen && existsSync(chosen) ? chosen : null;
  return browserCandidates().find((path) => existsSync(path)) ?? null;
}

// --- the queue: a private directory, since a job holds the workspace's token ---

function queueDir() {
  const who = process.getuid?.() ?? userInfo().username;
  const dir = join(tmpdir(), `mockpit-posters-${who}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
const lockPath = (dir) => join(dir, "worker.lock");
const lockIsFresh = (dir) => {
  try {
    return Date.now() - statSync(lockPath(dir)).mtimeMs < LOCK_STALE_MS;
  } catch {
    return false;
  }
};
const jobsIn = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".job"))
    .sort();

const startWorker = () =>
  spawn(process.execPath, [SELF, "--work"], { detached: true, stdio: "ignore" }).unref();

// { base, token, client, session, design, postId, version }. Never throws, never waits.
export function queuePoster(job) {
  try {
    if (!findBrowser()) return;
    const dir = queueDir();
    const name = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.job`;
    writeFileSync(join(dir, name), JSON.stringify({ ...job, queuedAt: Date.now() }), {
      mode: 0o600,
    });
    if (!lockIsFresh(dir)) startWorker();
  } catch {
    // A poster is never worth a failed publish.
  }
}

// { base, token, client, session, project }: after a system write that changed something.
// The worker reads which variants need a new still, so this never waits either.
export function queueRetakes(job) {
  queuePoster({ ...job, retake: true });
}

// --- the browser, over the DevTools protocol on a local port ---

async function launchBrowser(path) {
  const profile = mkdtempSync(join(tmpdir(), "mockpit-poster-profile-"));
  const proc = spawn(
    path,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--hide-scrollbars",
      "--mute-audio",
      // Never a keychain prompt on the user's screen for a profile thrown away after.
      "--use-mock-keychain",
      // A machine with no GPU still draws a WebGL page, the kind that most needs a poster.
      "--enable-unsafe-swiftshader",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const stop = () => {
    proc.kill();
    // The browser is still writing to its profile for a moment after the signal.
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  const portFile = join(profile, "DevToolsActivePort");
  const giveUp = Date.now() + BROWSER_START_MS;
  while (!existsSync(portFile) || !readFileSync(portFile, "utf8").includes("\n")) {
    if (proc.exitCode !== null || Date.now() > giveUp) {
      stop();
      return null;
    }
    await sleep(50);
  }
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  return { port, stop, alive: () => proc.exitCode === null };
}

async function openPage(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const call = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) call?.reject(new Error(m.error.message));
      else call?.resolve(m.result);
    } else waiting.get(m.method)?.();
  };
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    event: (method) => new Promise((resolve) => waiting.set(method, resolve)),
    close: async () => {
      ws.close();
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
    },
  };
}

// Run in the page. Waits for what's drawing itself in and doesn't wait for what loops.
const SETTLE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await Promise.race([document.fonts ? document.fonts.ready : 0, wait(2000)]);
  await wait(400);
  const finite = document.getAnimations().filter((a) => {
    const t = a.effect && a.effect.getComputedTiming();
    return t && Number.isFinite(t.endTime) && a.playState === "running";
  });
  await Promise.race([Promise.allSettled(finite.map((a) => a.finished)), wait(3000)]);
  await wait(300);
  return document.body ? document.body.scrollHeight : 0;
})()`;

async function shoot(port, job, url, width) {
  const page = await openPage(port);
  try {
    // A cookie and not `?key=` or a header: the page is the agent's, and a script can read
    // its own URL, while extra headers would go to every CDN it loads from too.
    if (job.token) {
      await page.send("Network.setCookie", {
        name: "mockpit_key",
        value: job.token,
        url,
        httpOnly: true,
        sameSite: "Lax",
      });
    }
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: VIEWPORT_H,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    const loaded = page.event("Page.loadEventFired");
    await page.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(LOAD_MS)]);
    const measured = await page.send("Runtime.evaluate", {
      expression: SETTLE,
      awaitPromise: true,
      returnByValue: true,
    });
    const height = Math.min(
      Math.max(Number(measured.result?.value) || VIEWPORT_H, 1),
      width * MAX_HEIGHT_PER_WIDTH,
    );
    const { data } = await page.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: JPEG_QUALITY,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return data;
  } finally {
    await page.close();
  }
}

// --- one job, end to end ---

const headersOf = (job) => ({
  "content-type": "application/json",
  "x-mockpit-client": job.client,
  ...(job.token ? { authorization: `Bearer ${job.token}` } : {}),
});

// A retake becomes one job per live variant whose page shows no still now: the views
// already leave out one taken under another revision, and keep the agent's own.
async function expandRetake(dir, job) {
  const res = await fetch(`${job.base}/api/projects/${encodeURIComponent(job.project)}/tree`, {
    headers: headersOf(job),
  });
  if (!res.ok) return;
  const { tree } = await res.json();
  const wanted = (tree ?? [])
    .filter((d) => !d.archivedAt)
    .flatMap((d) =>
      (d.variants ?? [])
        .filter((v) => v.status !== "archived" && v.surface >= 0 && !v.poster)
        .map((v) => ({ design: d.id, postId: v.postId, version: v.version, at: v.updatedAt })),
    )
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, RETAKE_MAX);
  const { retake: _r, project: _p, ...base } = job;
  for (const [i, v] of wanted.entries()) {
    const name = `${Date.now()}-${String(i).padStart(3, "0")}-retake.job`;
    writeFileSync(
      join(dir, name),
      JSON.stringify({
        ...base,
        design: v.design,
        postId: v.postId,
        version: v.version,
        queuedAt: Date.now(),
      }),
      { mode: 0o600 },
    );
  }
}

async function capture(port, job) {
  const headers = headersOf(job);
  const get = async (path) => {
    const res = await fetch(`${job.base}${path}`, { headers });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };
  const post = async (path, body) => {
    const res = await fetch(`${job.base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };
  const design = await get(`/api/designs/${encodeURIComponent(job.design)}`);
  const variant = design.variants?.find((v) => v.postId === job.postId);
  const page = variant?.surfaces?.find((s) => s.kind === "html");
  // Moved on already, or the agent's own still arrived: nothing to add.
  const { mode } = await get("/api/theme");
  if (!page || page.poster || variant.version !== job.version) return;
  const rewrites = variant.rewrites ?? 0;
  const query = new URLSearchParams({
    surface: String(page.index),
    ver: String(job.version),
    ...(mode ? { mode } : {}),
    ...(rewrites ? { w: String(rewrites) } : {}),
    ...(design.systemRev ? { y: String(design.systemRev) } : {}),
  });
  const width = design.widths?.[0] ?? DEFAULT_WIDTH;
  const data = await shoot(
    port,
    job,
    `${job.base}/s/${encodeURIComponent(job.postId)}?${query}`,
    width,
  );
  const asset = await post("/api/assets", {
    data,
    contentType: "image/jpeg",
    filename: "poster.jpg",
    session: job.session,
  });
  await post(
    `/api/designs/${encodeURIComponent(job.design)}/variants/${encodeURIComponent(job.postId)}/poster`,
    {
      version: job.version,
      rewrites,
      poster: asset.id,
      mode,
      system: design.systemRev ?? 0,
      session: job.session,
    },
  );
}

async function work() {
  const dir = queueDir();
  if (lockIsFresh(dir)) return;
  try {
    rmdirSync(lockPath(dir));
  } catch {
    // Not there, which is the usual case.
  }
  try {
    mkdirSync(lockPath(dir));
  } catch {
    return; // Another worker got there first.
  }
  const path = findBrowser();
  let browser = null;
  const done = () => {
    browser?.stop();
    try {
      rmdirSync(lockPath(dir));
    } catch {
      // Already gone; nothing depends on it.
    }
  };
  setTimeout(() => {
    done();
    setTimeout(() => process.exit(0), 600);
  }, WORKER_MAX_MS).unref();

  let idleSince = Date.now();
  for (;;) {
    const name = jobsIn(dir)[0];
    if (!name) {
      if (Date.now() - idleSince > WORKER_IDLE_MS) break;
      await sleep(100);
      continue;
    }
    idleSince = Date.now();
    utimesSync(lockPath(dir), new Date(), new Date());
    const file = join(dir, name);
    let job;
    try {
      job = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      job = null;
    }
    rmSync(file, { force: true });
    if (!job || !path || Date.now() - job.queuedAt > JOB_MAX_AGE_MS) continue;
    if (job.retake) {
      await expandRetake(dir, job).catch(() => {});
      continue;
    }
    try {
      if (!browser?.alive()) browser = await launchBrowser(path);
      if (browser) {
        await Promise.race([
          capture(browser.port, job),
          sleep(CAPTURE_MS).then(() => {
            throw new Error("timed out");
          }),
        ]);
      }
    } catch {
      // This page stays live; the next one still gets its try.
    }
    idleSince = Date.now();
  }
  done();
  // A publish that saw this worker's lock in its last moment still gets its poster.
  if (jobsIn(dir).length) startWorker();
  await sleep(600);
  process.exit(0);
}

if (process.argv[1] === SELF && process.argv[2] === "--work") {
  work().catch(() => process.exit(0));
}
