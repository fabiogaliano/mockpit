// Regenerates the README media: two stills (docs/mockpit-question.png,
// docs/mockpit-accent.png) and the animated loop (docs/mockpit-demo.gif), all dark.
// Boots a throwaway server per pass, publishes the Shop design from
// scripts/demo-store.mjs through the agent's HTTP tier, and drives the viewer with
// Playwright:
//
//   node scripts/record-demo.mjs            # stills + gif
//   node scripts/record-demo.mjs --stills   # stills only
//   node scripts/record-demo.mjs --gif      # gif only
//
// The gif replays the decide loop live: the agent publishes three card variants and its
// questions → the user previews and picks a card, a button style, an accent and whether
// ratings show → Send → Not seen yet, then Delivered once the agent's feedback read takes
// it → the agent replies and publishes v2. ffmpeg turns the recorded webm into the gif:
// mpdecimate drops held frames (keeping one every two seconds, so the closing hold
// survives) and an undithered 96-colour palette suits flat UI; both keep the gif small.

import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STORE as DEMO } from "./demo-store.mjs";

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

// Publishes the Shop design the way `mockpit demo` publishes its own: one session, one publish
// per (state, variant), then the questions.
async function publishShop(api, asks = DEMO.asks) {
  const session = await api("/api/sessions", {
    agent: DEMO.agent,
    title: DEMO.sessionTitle,
    project: DEMO.project,
  });
  let designId = "";
  for (const state of DEMO.states) {
    for (const variant of DEMO.variants) {
      const out = await api("/api/designs", {
        session: session.id,
        project: DEMO.project,
        design: DEMO.slug,
        kind: "screen",
        title: DEMO.title,
        state: state.label,
        variant: variant.name,
        knobs: DEMO.knobs,
        surfaces: [{ kind: "html", html: DEMO.render(state, variant) }],
      });
      designId = out.design.id;
    }
  }
  await api(`/api/designs/${designId}/asks`, { session: session.id, asks });
  return { designId, session: session.id };
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
    await publishShop(api);
    const browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1.5,
      colorScheme: "dark",
    });
    page.on("pageerror", (e) => console.error("pageerror:", e.message));
    await setTheme(page, api, base, "dark");

    // The first question on the stage, its answers as pictures.
    await page.goto(`${base}${screenPath}`);
    await page.locator('.opt[data-option="minimal"] iframe').waitFor();
    await page.locator(".frame.on iframe").waitFor();
    await sleep(1800); // thumbnails and the stage frame report their heights
    await page.mouse.move(0, 0);
    await shoot(page, "question");

    // The quick view, two answers in, previewing an accent before picking it.
    await page.getByText("Quick view", { exact: true }).first().click();
    await sleep(1200);
    const answer = (label) => page.locator(".opt:visible", { hasText: label }).first();
    for (const label of ["Overlay", "Pill"]) {
      await answer(label).click();
      await sleep(500);
      await page.locator("button.qsend").click();
      await sleep(900);
    }
    await answer("Violet").locator("iframe").waitFor();
    await sleep(1500);
    // The still is about the preview, so the pointer's card actions stay out of it.
    await page.addStyleTag({ content: ".optic,.holdtimer{visibility:hidden!important}" });
    await answer("Lime").hover();
    await sleep(1500);
    await shoot(page, "accent");
    await browser.close();
  } finally {
    stop();
  }
}

async function shoot(page, name) {
  const path = join(DOCS, `mockpit-${name}.png`);
  await page.screenshot({ path });
  console.log(path);
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
      colorScheme: "dark",
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
    await api("/api/theme", { mode: "dark" }, "PUT");
    await page.goto(`${base}/project/${encodeURIComponent(DEMO.project)}`);
    await sleep(900);

    // The agent publishes three card variants in two states, and its questions.
    const { designId, session } = await publishShop(api);
    const homeRow = page.locator(`.home-step[data-design="${DEMO.slug}"]`).first();
    await homeRow.waitFor();
    await sleep(1200);
    await click(homeRow);
    await page.locator('.opt[data-option="minimal"] iframe').waitFor();
    await page.locator(".frame.on iframe").waitFor();
    await sleep(1600);

    // Hovering an answer previews it on the stage; a click picks it. Each pick is
    // followed by Next, and the last by Send.
    const answer = (label) => page.locator(".opt:visible", { hasText: label }).first();
    const qsend = page.locator("button.qsend");
    const decide = async (look, pick) => {
      for (const label of look) {
        await hover(answer(label), 16);
        await sleep(1000);
      }
      await click(answer(pick));
      await sleep(1000);
      await click(qsend);
      await sleep(1100);
    };
    await decide(["Overlay", "Minimal"], "Overlay");
    await decide(["Outline"], "Pill");
    await decide(["Lime", "Violet"], "Lime");
    await decide(["Hide"], "Hide");
    // The last answer's button was Send.
    const sent = page.locator(".sentrow .pill.count");
    await sent.waitFor();
    await sleep(1600);

    // The agent's feedback read takes the batch: Not seen yet turns Delivered.
    await api(`/api/feedback?session=${session}`);
    await page.locator(".sentrow .pill.count:not(.waiting)").waitFor();
    await sleep(1300);

    // The agent answers in the thread and publishes the next version of the picked card.
    await api(`/api/designs/${designId}/say`, {
      session,
      message: "Overlay cards, pill buttons in lime, no ratings. v2 adds a sale badge.",
    });
    await sleep(1400);
    const grid = DEMO.states[0];
    await api("/api/designs", {
      design: designId,
      session,
      state: grid.label,
      variant: "overlay",
      prompt: "overlay, pill, lime, no ratings",
      surfaces: [
        {
          kind: "html",
          html: DEMO.render(grid, { name: "overlay" }).replace(
            /<article class="card overlay"[^>]*>/,
            '$&<span style="position:absolute;top:12px;left:12px;z-index:1;background:#0c0c0e;color:var(--accent);font:600 11px/1 system-ui;letter-spacing:.04em;padding:6px 8px;border-radius:999px">SALE −20%</span>',
          ),
        },
      ],
    });
    await page.getByText("Overlay #2 is on stage").waitFor();
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
        "fps=10,scale=900:-1:flags=lanczos,mpdecimate=max=20,split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
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
