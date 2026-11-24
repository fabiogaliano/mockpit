// Automatic posters: a still of a page just published, taken with a local headless Chrome
// or Chromium, so the Board shows a picture without the agent doing anything. Built-ins
// only, like the rest of the CLI, and the stdio MCP server loads this same file.
//
// A publish only leaves a job here and returns. A detached worker does the rest, one page at
// a time through one browser, because an agent publishing thirty alternatives in a loop must not
// start thirty Chromes. Nothing in here may reach the agent: no browser, a timeout or a failed
// capture means the page runs live in the overviews, which is what it did before posters.
//
// The worker renders the served document and doesn't take a poster's place: one sent by the
// agent wins, and the server refuses a still of a version that has since changed. A system
// write retakes the project's stills: one taken under an older revision no longer shows.
//
// The same worker makes a sheet's stills (server/stills.ts), which the server asks for when a
// sheet shows cells that have none: a frame in some knob values, cropped to a part. Those
// come in dozens at once, so a few tabs take them side by side.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
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
const STILL_TABS = 4;
// A cell is small: past this width a still is only bytes.
const STILL_MAX_W = 480;
// Stills one system change retakes, latest alternatives first: the rest run live until then.
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

// The queue lives outside the server process, so jobs carry an attempt and deadline.
export function queueStills({ stills, ...base }) {
  try {
    if (!findBrowser()) return false;
    const dir = queueDir();
    const at = Date.now();
    const run = randomUUID();
    for (const [index, still] of stills.entries()) {
      const order = String(index).padStart(3, "0");
      const name = `${still.priority}-${at}-${run}-${order}-${still.postId}-still.job`;
      const file = join(dir, name);
      writeFileSync(`${file}.tmp`, JSON.stringify({ ...base, still, queuedAt: at }), {
        mode: 0o600,
      });
      renameSync(`${file}.tmp`, file);
    }
    if (!lockIsFresh(dir)) startWorker();
    return true;
  } catch {
    return false;
  }
}

// { base, token, client, session, project }: after a system write that changed something.
// The worker reads which alternatives need a new still, so this never waits either.
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
  let spawnFailed = false;
  proc.on("error", () => {
    spawnFailed = true;
  });
  const stop = () => {
    proc.kill();
    // The browser is still writing to its profile for a moment after the signal.
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  const portFile = join(profile, "DevToolsActivePort");
  const giveUp = Date.now() + BROWSER_START_MS;
  while (!existsSync(portFile) || !readFileSync(portFile, "utf8").includes("\n")) {
    if (spawnFailed || proc.exitCode !== null || Date.now() > giveUp) {
      stop();
      return null;
    }
    await sleep(50);
  }
  const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
  return { port, stop, alive: () => proc.exitCode === null };
}

async function openPage(port, signal) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: "PUT",
    signal,
  });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const close = async () => {
    ws.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`, {
      signal: AbortSignal.timeout(1000),
    }).catch(() => {});
  };
  try {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      ws.onclose = () => reject(new Error("tab closed"));
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      if (signal?.aborted) reject(signal.reason);
    });
  } catch (error) {
    await close();
    throw error;
  }
  let nextId = 0;
  const pending = new Map();
  const waiting = new Map();
  ws.onclose = () => {
    for (const call of pending.values()) call.reject(new Error("tab closed"));
    pending.clear();
    for (const event of waiting.values()) event();
    waiting.clear();
  };
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
    close,
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

// The part's box in document px, the first of that name drawn, or null.
const partBox = (name) => `(() => {
  for (const el of document.querySelectorAll('[data-part]')) {
    if (el.getAttribute("data-part").trim() !== ${JSON.stringify(name)}) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }
  return null;
})()`;

// `opts.page`: a tab kept open across stills, which is the caller's to close.
async function shoot(port, job, url, width, opts = {}) {
  const page = opts.page ?? (await openPage(port, opts.signal));
  const abort = () => void page.close().catch(() => {});
  opts.signal?.addEventListener("abort", abort, { once: true });
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
      width * (opts.heightRatio ?? MAX_HEIGHT_PER_WIDTH),
    );
    let clip = { x: 0, y: 0, width, height };
    if (opts.part) {
      const found = await page.send("Runtime.evaluate", {
        expression: partBox(opts.part),
        returnByValue: true,
      });
      const box = found.result?.value;
      if (box) {
        const x = Math.max(0, box.x - opts.partPad);
        const y = Math.max(0, box.y - opts.partPad);
        const right = Math.min(width, box.x + box.w + opts.partPad);
        const bottom = Math.min(height, box.y + box.h + opts.partPad);
        if (right > x && bottom > y) clip = { x, y, width: right - x, height: bottom - y };
      }
    }
    const scale = opts.maxWidth ? Math.min(1, opts.maxWidth / clip.width) : 1;
    const { data } = await page.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: JPEG_QUALITY,
      captureBeyondViewport: true,
      clip: { ...clip, scale },
    });
    return data;
  } finally {
    opts.signal?.removeEventListener("abort", abort);
    if (!opts.page) await page.close();
  }
}

// --- one job, end to end ---

const headersOf = (job) => ({
  "content-type": "application/json",
  "x-mockpit-client": job.client,
  ...(job.token ? { authorization: `Bearer ${job.token}` } : {}),
});

// A retake becomes one job per live alternative whose page shows no still now: the views
// already leave out one taken under another revision, and keep the agent's own.
async function expandRetake(dir, job) {
  const res = await fetch(`${job.base}/api/projects/${encodeURIComponent(job.project)}/tree`, {
    headers: headersOf(job),
    signal: AbortSignal.timeout(CAPTURE_MS),
  });
  if (!res.ok) return;
  const { tree } = await res.json();
  const wanted = (tree ?? [])
    .filter((d) => !d.archivedAt)
    .flatMap((d) =>
      // An agent's read names a variants design's entries `variants`.
      (d.variants ?? d.alternatives ?? [])
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

async function capture(port, job, signal) {
  const headers = headersOf(job);
  const get = async (path) => {
    const res = await fetch(`${job.base}${path}`, { headers, signal });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };
  const post = async (path, body) => {
    const res = await fetch(`${job.base}${path}`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };
  const route = `/api/designs/${encodeURIComponent(job.design)}/alternatives/${encodeURIComponent(job.postId)}/poster`;
  const { needed, surface, mode, rewrites, system, knobs, width } = await get(
    `${route}?version=${job.version}`,
  );
  if (!needed) return;
  const query = new URLSearchParams({
    surface: String(surface),
    ver: String(job.version),
    ...(mode ? { mode } : {}),
    ...(rewrites ? { w: String(rewrites) } : {}),
    ...(system ? { y: String(system) } : {}),
    ...(knobs ? { k: knobs } : {}),
  });
  const data = await shoot(
    port,
    job,
    `${job.base}/s/${encodeURIComponent(job.postId)}?${query}`,
    width ?? DEFAULT_WIDTH,
    { signal },
  );
  const asset = await post("/api/assets", {
    data,
    contentType: "image/jpeg",
    filename: "poster.jpg",
    session: job.session,
  });
  await post(route, {
    version: job.version,
    rewrites,
    poster: asset.id,
    mode,
    system,
    knobs,
    session: job.session,
  });
}

// One sheet still, sent back with the cell it is of. The server refuses it if the frame or the
// system moved on while it was being taken.
async function captureStill(port, job, page, signal) {
  const s = job.still;
  const query = new URLSearchParams({
    surface: String(s.surface),
    ver: String(s.version),
    mode: s.mode,
    ...(s.rewrites > 0 ? { w: String(s.rewrites) } : {}),
    ...(s.system ? { y: String(s.system) } : {}),
    ...(s.e ? { e: s.e } : {}),
    ...(s.palette ? { p: s.palette } : {}),
    ...(Object.keys(s.knobs).length ? { k: JSON.stringify(s.knobs) } : {}),
  });
  const data = await shoot(
    port,
    job,
    `${job.base}/s/${encodeURIComponent(s.postId)}?${query}`,
    s.width,
    {
      part: s.part,
      partPad: s.partPad,
      heightRatio: s.heightRatio,
      maxWidth: STILL_MAX_W,
      page,
    },
  );
  const res = await fetch(`${job.base}/api/designs/${encodeURIComponent(s.design)}/stills`, {
    method: "POST",
    headers: headersOf(job),
    body: JSON.stringify({ key: s.key, attempt: s.attempt, data, contentType: "image/jpeg" }),
    signal,
  });
  if (!res.ok) throw new Error(`still: ${res.status}`);
}

async function beforeDeadline(ms, run) {
  const deadline = new AbortController();
  let timer;
  try {
    return await Promise.race([
      run(deadline.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          deadline.abort();
          reject(new Error("capture timed out"));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// The job in `name`, taken off the queue once.
function takeJob(dir, name) {
  const file = join(dir, name);
  let job;
  try {
    job = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    job = null;
  }
  rmSync(file, { force: true });
  return job;
}

async function stillWork(job, failed, signal = AbortSignal.timeout(2000)) {
  const { design, key, attempt } = job.still;
  const res = await fetch(`${job.base}/api/designs/${encodeURIComponent(design)}/stills/work`, {
    method: "POST",
    headers: headersOf(job),
    body: JSON.stringify({ key, attempt, failed }),
    signal,
  });
  if (!res.ok) throw new Error(`still work: ${res.status}`);
  return (await res.json()).current === true;
}

const isStill = (name) => name.endsWith("-still.job");
const isLead = (name) => name.startsWith("lead-") && isStill(name);
const isVisible = (name) => (name.startsWith("visible-") || isLead(name)) && isStill(name);

async function stillShot(port, job, tab) {
  const remaining = job.still.expires - Date.now();
  if (remaining <= 0 || port === undefined) {
    await stillWork(job, true).catch(() => {});
    return;
  }
  try {
    await beforeDeadline(Math.min(remaining, CAPTURE_MS), async (signal) => {
      if (!(await stillWork(job, false, signal))) return;
      tab.page ??= await openPage(port, signal);
      await captureStill(port, job, tab.page, signal);
    });
  } catch {
    await tab.page?.close().catch(() => {});
    tab.page = null;
    await stillWork(job, true).catch(() => {});
  }
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
  const heartbeat = setInterval(() => {
    utimesSync(lockPath(dir), new Date(), new Date());
  }, LOCK_STALE_MS / 3);
  heartbeat.unref();
  const done = () => {
    clearInterval(heartbeat);
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

  let launching;
  let lastLaunchFailedAt = -Infinity;
  const browserPort = () => {
    if (browser?.alive()) return Promise.resolve(browser.port);
    if (!path || Date.now() - lastLaunchFailedAt < BROWSER_START_MS)
      return Promise.resolve(undefined);
    launching ??= launchBrowser(path)
      .catch(() => null)
      .then((launched) => {
        browser = launched;
        if (!browser) lastLaunchFailedAt = Date.now();
        launching = undefined;
        return browser?.port;
      });
    return launching;
  };

  let lastWork = Date.now();
  let busy = 0;
  let runningBoard = false;
  const lane = async () => {
    const tab = { page: null, port: undefined };
    let row;
    try {
      for (;;) {
        const names = jobsIn(dir);
        const board = !runningBoard && names.find((name) => !isStill(name));
        // What the user is choosing between goes first, ahead of a row already begun.
        const lead = names.filter(isLead);
        const foreground = lead.length ? lead : names.filter(isVisible);
        const stills = foreground.length ? foreground : names.filter(isStill);
        const inRow = row ? stills.find((name) => name.endsWith(`-${row}-still.job`)) : null;
        // A Board capture gets a lane whenever it is waiting. The other lanes take
        // visible Sheet work first and continue their current row at the same priority.
        const name = board || inRow || stills[0];
        if (!name) {
          if (!busy && Date.now() - lastWork > WORKER_IDLE_MS) break;
          await sleep(100);
          continue;
        }
        const job = takeJob(dir, name);
        if (!job) continue;
        busy++;
        lastWork = Date.now();
        utimesSync(lockPath(dir), new Date(), new Date());
        try {
          if (job.still) {
            row = job.still.postId;
            const port = await browserPort();
            if (port !== tab.port) {
              await tab.page?.close().catch(() => {});
              tab.page = null;
              tab.port = port;
            }
            await stillShot(port, job, tab);
          } else {
            if (Date.now() - job.queuedAt > JOB_MAX_AGE_MS) continue;
            runningBoard = true;
            await tab.page?.close().catch(() => {});
            tab.page = null;
            if (job.retake) {
              await expandRetake(dir, job);
            } else {
              const port = await browserPort();
              if (port !== undefined)
                await beforeDeadline(CAPTURE_MS, (signal) => capture(port, job, signal));
            }
          }
        } catch {
          // The next job still gets its turn.
        } finally {
          if (!job.still) runningBoard = false;
          busy--;
          lastWork = Date.now();
        }
      }
    } finally {
      await tab.page?.close().catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: STILL_TABS }, lane));
  done();
  // A publish that saw this worker's lock in its last moment still gets its poster.
  if (jobsIn(dir).length) startWorker();
  await sleep(600);
  process.exit(0);
}

if (process.argv[1] === SELF && process.argv[2] === "--work") {
  work().catch(() => process.exit(0));
}
