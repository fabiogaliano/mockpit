// Captures the raw take for the product film: one continuous run of the loop on the
// HALDE shop, as frames from Chrome's screencast at 2x (sharper and steadier than
// Playwright's video), plus a timeline of what happened where, which compose.mjs uses to
// aim the camera and time the cards.
//
//   node scripts/film/capture.mjs [out dir]     # default docs/tmp/film/take
//
// Writes <out>/frames/NNNNN.jpg, <out>/frames.json ([{file, t}], t in seconds from the
// start) and <out>/timeline.json ({viewport, scale, events: [{t, kind, …}]}).

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOOKBOOK } from "../demo-store.mjs";
import { boot, DEMO, POINTER, pointer, publishShop, ROOT, sleep } from "../demo-session.mjs";

const OUT = process.argv[2] ?? join(ROOT, "docs", "tmp", "film", "take");
const FRAMES = join(OUT, "frames");
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

execFileSync("npm", ["run", "build:viewer"], { cwd: ROOT, stdio: "inherit" });

const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

const { base, api, stop } = await boot();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
  });
  await context.addInitScript(POINTER);
  // The film is about picking; the card's keep/hide icons and the hold ring are noise in it.
  await context.addInitScript(() =>
    addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = ".optic,.holdtimer{visibility:hidden!important}";
      document.head.append(s);
    }),
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await api("/api/theme", { mode: "dark" }, "PUT");
  const earlier = await api("/api/sessions", {
    agent: DEMO.agent,
    title: "Lookbook",
    project: DEMO.project,
  });
  await api("/api/designs", {
    session: earlier.id,
    project: DEMO.project,
    design: LOOKBOOK.slug,
    title: LOOKBOOK.title,
    widths: [1200],
    surfaces: [{ kind: "html", html: LOOKBOOK.html() }],
  });
  await page.goto(`${base}/project/${encodeURIComponent(DEMO.project)}`);
  await sleep(800);

  const frames = [];
  const events = [];
  let t0 = 0;
  const now = () => Date.now() / 1000 - t0;
  const mark = (kind, data = {}) => events.push({ t: now(), kind, ...data });
  const boxOf = async (locator) => {
    const b = await locator.first().boundingBox();
    return b && { x: b.x, y: b.y, w: b.width, h: b.height };
  };

  const cdp = await context.newCDPSession(page);
  let n = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const file = `${String(n++).padStart(5, "0")}.jpg`;
    writeFileSync(join(FRAMES, file), Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata.timestamp - t0 });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  t0 = Date.now() / 1000;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });

  const hand = pointer(page);
  await hand.place(VIEWPORT.width * 0.55, VIEWPORT.height * 0.82);
  mark("open", { what: "home" });
  await sleep(1500);

  // The agent publishes three grids in two states and asks four questions.
  mark("agent", {
    lines: [
      "mockpit publish --design shop --state Grid --alternative index …",
      "mockpit publish --design shop --state Grid --alternative gallery …",
      "mockpit publish --design shop --state Grid --alternative editorial …",
      'mockpit ask --design shop "Which grid?" …',
    ],
  });
  const { designId, session } = await publishShop(api);
  const row = page.locator(`.home-step[data-design="${DEMO.slug}"]`).first();
  await row.waitFor();
  await sleep(1400);
  mark("focus", { what: "home-row", box: await boxOf(row) });
  await hand.click(row);
  await page.locator('.opt[data-option="editorial"] iframe').waitFor();
  await page.locator(".frame.on iframe").waitFor();
  await sleep(1800);
  mark("open", { what: "design", stage: await boxOf(page.locator(".frame.on")) });

  const answer = (label) => page.locator(".opt:visible", { hasText: label }).first();
  const qsend = page.locator("button.qsend");
  const panel = page.locator(".qpanel, .questions, aside").filter({ has: qsend }).first();
  const decide = async (id, look, pick) => {
    const question = await boxOf(panel);
    mark("question", { id, box: question });
    await sleep(500);
    for (const label of look) {
      const box = await hand.hover(answer(label));
      mark("hover", { id, label, box: { x: box.x, y: box.y, w: box.width, h: box.height } });
      await sleep(1100);
    }
    const box = await hand.click(answer(pick));
    mark("pick", { id, label: pick, box: { x: box.x, y: box.y, w: box.width, h: box.height } });
    await sleep(1100);
    const send = await hand.click(qsend);
    mark("next", { id, box: { x: send.x, y: send.y, w: send.width, h: send.height } });
    await sleep(1200);
  };
  await decide("grid", ["Gallery", "Editorial"], "Gallery");
  await decide("tile", ["Bone"], "Bone");
  await decide("case", ["Sentence case"], "Sentence case");
  await decide("prices", ["Hide"], "Show");

  // The last answer's button was Send.
  const sent = page.locator(".sentrow .pill.count");
  await sent.waitFor();
  mark("sent", { box: await boxOf(page.locator(".sentrow")) });
  await sleep(1800);
  await api(`/api/feedback?session=${session}`);
  await page.locator(".sentrow .pill.count:not(.waiting)").waitFor();
  mark("delivered", { box: await boxOf(page.locator(".sentrow")) });
  await sleep(1600);

  // The agent replies and publishes the next version of the grid in use.
  const say = "Gallery on bone, sentence case, prices kept. v2 adds the new-season row.";
  mark("agent", {
    lines: [
      `mockpit say --design shop "${say}"`,
      "mockpit publish --design shop --state Grid --alternative gallery …",
    ],
  });
  await api(`/api/designs/${designId}/say`, { session, message: say });
  await sleep(1200);
  const grid = DEMO.states[0];
  await api("/api/designs", {
    design: designId,
    session,
    state: grid.label,
    alternative: "gallery",
    prompt: "gallery, bone, sentence case, prices",
    surfaces: [
      {
        kind: "html",
        html: DEMO.render(grid, { name: "gallery" }).replace(
          '<h1 class="title">Products</h1>',
          '<h1 class="title">Products</h1><p style="margin:14px 0 0 120px;font-size:11px;text-transform:uppercase;letter-spacing:.06em">New season · Fall Winter 26 — 8 pieces</p>',
        ),
      },
    ],
  });
  await page.getByText("Gallery #2 is on stage").waitFor();
  mark("revised", { stage: await boxOf(page.locator(".frame.on")) });
  await sleep(2600);
  mark("end");

  await cdp.send("Page.stopScreencast");
  await sleep(300);
  writeFileSync(join(OUT, "frames.json"), JSON.stringify(frames));
  writeFileSync(
    join(OUT, "timeline.json"),
    JSON.stringify({ viewport: VIEWPORT, scale: SCALE, events }, null, 1),
  );
  const span = frames.at(-1).t - frames[0].t;
  console.log(
    `${frames.length} frames over ${span.toFixed(1)}s (${(frames.length / span).toFixed(1)} fps) → ${OUT}`,
  );
  await context.close();
} finally {
  await browser.close();
  stop();
}
