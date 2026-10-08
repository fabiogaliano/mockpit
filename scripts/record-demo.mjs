// Regenerates the README media: the hero stills (docs/mockpit-light.png,
// docs/mockpit-dark.png) and the animated loop (docs/mockpit-demo.gif). Boots a
// throwaway server per pass, publishes the Writer mock from bin/demoData.js
// through the agent's HTTP tier, and drives the viewer with Playwright:
//
//   node scripts/record-demo.mjs            # stills + gif
//   node scripts/record-demo.mjs --stills   # stills only
//   node scripts/record-demo.mjs --gif      # gif only
//
// The gif pass replays the decide loop live: the agent publishes three looks and
// its asks → the user previews the looks on the stage and picks one → answers a
// part question → Send → Thread shows ✓, then ✓✓ once the agent's wait reads it
// → the agent replies and publishes v2. ffmpeg turns the recorded webm into the
// gif: mpdecimate drops held frames (keeping one every two seconds, so the
// closing hold survives) and an undithered 128-colour palette suits flat UI; both
// keep the README gif small.

import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO } from "../bin/demoData.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const only = process.argv[2];

execFileSync("npm", ["run", "build:viewer"], { cwd: ROOT, stdio: "inherit" });

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-rec-"));
  const proc = spawn(process.execPath, [join(ROOT, "server", "index.ts")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: "0",
      MOCKPIT_DB: join(dir, "db.sqlite"),
      MOCKPIT_TOKEN: "",
      MOCKPIT_VERSION: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const base = await new Promise((resolve, reject) => {
    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk;
      const m = out.match(/listening on (http:\/\/localhost:\d+)/);
      if (m) resolve(m[1]);
    });
    setTimeout(() => reject(new Error("server did not boot")), 10_000);
  });
  // Node's fetch sends no Origin, so the server treats these calls as the agent.
  const api = async (path, body, method = body === undefined ? "GET" : "POST") => {
    const init = { method };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, init);
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  return { base, api, dir, stop: () => proc.kill() };
}

// Publishes the Writer mock the way `mockpit demo` does: one session, one publish
// per (state, look), then the asks.
async function publishWriter(api, asks = DEMO.asks) {
  const session = await api("/api/sessions", {
    agent: DEMO.agent,
    title: DEMO.sessionTitle,
    project: DEMO.project,
  });
  let mockId = "";
  for (const state of DEMO.states) {
    for (const variant of DEMO.variants) {
      const out = await api("/api/mocks", {
        session: session.id,
        project: DEMO.project,
        mock: DEMO.slug,
        title: DEMO.title,
        state: state.label,
        variant: variant.name,
        knobs: DEMO.knobs,
        surfaces: [{ kind: "html", html: DEMO.render(state, variant) }],
      });
      mockId = out.mock.id;
    }
  }
  await api(`/api/mocks/${mockId}/asks`, { session: session.id, asks });
  return { mockId, session: session.id };
}

const screenPath = `/project/${encodeURIComponent(DEMO.project)}/${DEMO.slug}`;

async function setTheme(page, api, base, mode) {
  await api("/api/theme", { mode }, "PUT");
  await page.goto(`${base}${screenPath}`);
  await page.evaluate((t) => localStorage.setItem("mockpit-theme", t), mode);
}

// --- stills ----------------------------------------------------------------------

async function stills() {
  const { base, api, stop } = await boot();
  try {
    await publishWriter(api);
    const browser = await chromium.launch();
    // 1184×736 CSS px at 1.25x = 1480×920: the README cell is half a page wide,
    // so the viewer is laid out a little narrow to keep its type legible there.
    const page = await browser.newPage({
      viewport: { width: 1184, height: 736 },
      deviceScaleFactor: 1.25,
    });
    page.on("pageerror", (e) => console.error("pageerror:", e.message));
    for (const mode of ["light", "dark"]) {
      await setTheme(page, api, base, mode);
      await page.goto(`${base}${screenPath}`);
      await page.locator('.opt[data-option="quiet"] iframe').waitFor();
      await page.locator(".frame.on iframe").waitFor();
      await sleep(1500); // thumbnails and the stage frame report their heights
      await page.mouse.move(0, 0);
      const path = join(DOCS, `mockpit-${mode}.png`);
      await page.screenshot({ path });
      console.log(path);
    }
    await browser.close();
  } finally {
    stop();
  }
}

// --- gif -------------------------------------------------------------------------

// Playwright's video has no pointer, and hovers over a picture option land in its
// iframe, so the recording draws its own cursor and moves it alongside the mouse.
const CURSOR = `(() => {
  const c = document.createElement("div");
  c.id = "rec-cursor";
  c.style.cssText = "position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(234,88,12,.85);box-shadow:0 0 0 3px rgba(255,255,255,.85),0 1px 6px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;transition:transform .12s";
  addEventListener("DOMContentLoaded", () => document.documentElement.append(c));
})()`;

async function gif() {
  const { base, api, dir, stop } = await boot();
  try {
    const size = { width: 1180, height: 740 };
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: size,
      recordVideo: { dir, size },
      colorScheme: "light",
    });
    await context.addInitScript(CURSOR);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("pageerror:", e.message));

    let at = { x: size.width / 2, y: size.height - 60 };
    const glide = async (x, y, steps = 14) => {
      for (let i = 1; i <= steps; i++) {
        const p = { x: at.x + ((x - at.x) * i) / steps, y: at.y + ((y - at.y) * i) / steps };
        await page.mouse.move(p.x, p.y);
        await page.evaluate(({ x, y }) => {
          const c = document.getElementById("rec-cursor");
          if (c) Object.assign(c.style, { left: `${x}px`, top: `${y}px` });
        }, p);
        await sleep(16);
      }
      at = { x, y };
    };
    const center = async (locator) => {
      const b = await locator.boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const hover = async (locator, steps) => {
      const c = await center(locator);
      await glide(c.x, c.y, steps);
    };
    const click = async (locator, steps) => {
      await hover(locator, steps);
      await page.evaluate(() => {
        const c = document.getElementById("rec-cursor");
        if (!c) return;
        c.style.transform = "scale(.7)";
        setTimeout(() => (c.style.transform = ""), 140);
      });
      await locator.click();
    };

    // The project's Home, empty, so the publish lands on camera.
    await api("/api/theme", { mode: "light" }, "PUT");
    await page.goto(`${base}/project/${encodeURIComponent(DEMO.project)}`);
    await sleep(900);

    // The agent publishes: a Look question over three looks, and a part question.
    const asks = DEMO.asks.filter((a) => a.id !== "versions-layout");
    const { mockId, session } = await publishWriter(api, asks);
    const homeRow = page.locator(`.home-row[data-mock="${DEMO.slug}"]`);
    await homeRow.locator(".home-chip").waitFor();
    await sleep(1200);
    await click(homeRow);
    await page.locator('.opt[data-option="editorial"] iframe').waitFor();
    await page.locator(".frame.on iframe").waitFor();
    await sleep(1600);

    // Hovering a look previews it on the stage; picking one moves on.
    const option = (id) => page.locator(`.opt[data-option="${id}"]`);
    await hover(option("dark"), 18);
    await sleep(1100);
    await hover(option("editorial"));
    await sleep(1100);
    await click(option("quiet"));
    await sleep(1300);

    // The part question: Trim, pinned on its part on the stage. If the looks
    // differ enough for Mix to join, it comes last and "all quiet" closes it.
    await page.locator(".opt").first().waitFor();
    await click(page.locator(".opt").nth(1));
    await sleep(1100);
    if (!(await page.locator("button.send").count())) {
      const next = page.locator("button.primary", { hasText: "Next" });
      if (await next.count()) await click(next);
      await page.locator('.opt[data-option="none"]').waitFor();
      await click(page.locator('.opt[data-option="none"]'));
      await sleep(900);
    }

    // Send: the panel flips to Thread with the Sent row at ✓.
    const send = page.locator("button.send");
    await send.waitFor();
    await click(send);
    const row = page.locator(".trow.you");
    await row.waitFor();
    // Rest the pointer beside the row, clear of the tick that is about to change.
    const rb = await row.boundingBox();
    await glide(rb.x - 40, rb.y + rb.height / 2);
    await sleep(1600);

    // The agent's blocking wait reads the batch: ✓ turns ✓✓ seen.
    await api(`/api/comments?session=${session}&author=user&wait=10`);
    await row.locator(".tseen.ok").waitFor();
    await sleep(1300);

    // The agent answers in the thread and publishes v2 of the picked look.
    await api("/api/comments", {
      mock: mockId,
      session,
      text: "Quiet it is, with the trim below the page. v2 moves it.",
    });
    await sleep(1400);
    const writing = DEMO.states[0];
    await api(`/api/mocks/${mockId}/revise`, {
      session,
      state: writing.label,
      variant: "quiet",
      prompt: "trim below the page",
      surfaces: [
        {
          kind: "html",
          html: DEMO.render(writing, { name: "quiet" }).replace(
            "The Pier</h1>",
            "The Pier</h1><!-- v2 -->",
          ),
        },
      ],
    });
    await page.locator(".vbtn", { hasText: "v2" }).waitFor();
    await sleep(900);
    await click(page.locator(".vbtn"));
    await page.locator(".vpop").waitFor();
    await sleep(2400);

    const video = page.video();
    await context.close();
    await browser.close();
    const raw = await video.path();
    const out = join(DOCS, "mockpit-demo.gif");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        raw,
        "-vf",
        "fps=10,scale=880:-1:flags=lanczos,mpdecimate=max=20,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
        "-fps_mode",
        "vfr",
        out,
      ],
      { stdio: "inherit" },
    );
    console.log(`${out} (${statSync(out).size} bytes, from ${raw})`);
  } finally {
    stop();
  }
}

if (only !== "--gif") await stills();
if (only !== "--stills") await gif();
