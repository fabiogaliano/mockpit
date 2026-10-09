// Records a mockpit release/feature video in one real-time pass: boots a
// fresh server, loads the live viewer inside the 1920x1080 stage
// (stage.html: window chrome + captions + title cards), drives the storyboard
// below with Playwright while recording video, and prints the raw webm path.
//
//   node scripts/launch-video/record.mjs
//   # then encode (see skills/launch-video/SKILL.md):
//   ffmpeg -y -i .video-work/raw.webm -vf "fps=30,format=yuv420p" \
//     -c:v libx264 -preset slow -crf 18 -movflags +faststart .video-work/release.mp4
//
// The storyboard (SCENES below + the cards/captions) is editorial content for
// one video — rewrite it per release. The stage + boot/seed/record machinery
// is reusable.

import { chromium } from "@playwright/test";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { DEMO } from "../../bin/demoData.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = process.argv[2] ?? join(ROOT, ".video-work");
mkdirSync(WORK, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- viewer build + server boot ---------------------------------------------

if (!existsSync(join(ROOT, "viewer", "dist", "index.html"))) {
  execSync("npm run build:viewer", { cwd: ROOT, stdio: "inherit" });
}

const proc = spawn(process.execPath, [join(ROOT, "server", "index.ts")], {
  env: { ...process.env, PORT: "0", MOCKPIT_DB: join(WORK, `rec-${Date.now()}.db`) },
  stdio: ["ignore", "pipe", "inherit"],
});
// A failed step must not leave the server holding the terminal.
process.on("exit", () => proc.kill());
const base = await new Promise((resolve, reject) => {
  let out = "";
  proc.stdout.on("data", (chunk) => {
    out += chunk;
    const m = out.match(/listening on (http:\/\/localhost:\d+)/);
    if (m) resolve(m[1]);
  });
  setTimeout(() => reject(new Error("server did not boot")), 15_000);
});

const api = (path, body, init = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  }).then(async (r) => {
    const json = await r.json();
    if (!r.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
    return json;
  });

// --- seed --------------------------------------------------------------------

// The Writer mock is published on camera; this only names where it will live.
const projectUrl = `${base}/project/${encodeURIComponent(DEMO.project)}`;

async function publishWriter() {
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
  await api(`/api/mocks/${mockId}/asks`, { session: session.id, asks: DEMO.asks });
  return { mockId, session: session.id };
}

// --- stage + browser ---------------------------------------------------------

// Optional caption fonts (npm i @fontsource-variable/inter @fontsource/jetbrains-mono
// in the work dir); the stage falls back to system fonts when absent.
const font = (rel) => {
  const p = join(WORK, "node_modules", rel);
  return existsSync(p) ? pathToFileURL(p).href : "about:blank";
};
const stageHtml = readFileSync(join(ROOT, "scripts", "launch-video", "stage.html"), "utf8")
  .replaceAll("__INTER__", font("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"))
  .replaceAll(
    "__MONO__",
    font("@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2"),
  )
  .replaceAll("__APP_URL__", projectUrl)
  .replaceAll("__APP_HOST__", base.replace(/^https?:\/\//, ""));
const stagePath = join(WORK, "stage.resolved.html");
writeFileSync(stagePath, stageHtml);

const executablePath =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({
  executablePath,
  args: ["--allow-file-access-from-files"],
});
const size = { width: 1920, height: 1080 };
const context = await browser.newContext({
  viewport: size,
  recordVideo: { dir: WORK, size },
  colorScheme: "dark",
});
// The viewer document sends `frame-ancestors 'self'` (clickjacking hardening),
// which would refuse the file:// stage's iframe — strip CSP on the viewer's
// document responses for the recording. Never intercept /api/events (SSE would
// buffer).
await context.route(`${base}/project/**`, async (route) => {
  if (route.request().resourceType() !== "document") return route.fallback();
  const response = await route.fetch();
  const headers = { ...response.headers() };
  delete headers["content-security-policy"];
  await route.fulfill({ response, headers });
});

const page = await context.newPage();
await page.goto(pathToFileURL(stagePath).href);
const app = page.frameLocator("#app");
const stage = (fn, arg) => page.evaluate(([f, a]) => window.stage[f](a), [fn, arg]);

// --- storyboard --------------------------------------------------------------

// 1. Intro card (covers the viewer while it boots on the empty project Home).
await stage(
  "card",
  `
  <div class="badge">RELEASE</div>
  <h1>mockpit <span class="ver">1.0.0</span></h1>
  <p class="sub">a design-decision loop for your coding agents</p>`,
);
await app.locator(".home-lead").waitFor();
await sleep(3200);

// 2. Publish → the mock lands live on Home; open it.
await stage("hideCard");
await sleep(700);
await stage(
  "caption",
  `Agents publish a mock over <span class="hl">CLI, MCP, or plain HTTP</span> — every state, a few looks`,
);
await sleep(900);
const { mockId, session } = await publishWriter();
const row = app.locator(`.home-row[data-mock="${DEMO.slug}"]`);
await row.locator(".home-chip").waitFor();
await sleep(1600);
await row.click();
await app.locator('.opt[data-option="editorial"] iframe').waitFor();
await sleep(2400);

// 3. Questions: preview the looks on the stage, pick one, answer the rest.
await stage(
  "caption",
  `The agent asks — <span class="hl">you answer from pictures</span> of each option`,
);
await app.locator('.opt[data-option="dark"]').hover();
await sleep(1400);
await app.locator('.opt[data-option="editorial"]').hover();
await sleep(1400);
await app.locator('.opt[data-option="quiet"]').click();
await sleep(1400);
for (let i = 0; i < 6 && !(await app.locator("button.send").count()); i++) {
  await app.locator(".opt").first().click();
  await sleep(1000);
  const next = app.locator("button.primary", { hasText: "Next" });
  if (await next.count()) await next.click();
}

// 4. Send → the agent wakes once with the batch, replies and revises.
await stage(
  "caption",
  `Press <span class="hl">Send</span> — your agent wakes once with the whole batch`,
);
await sleep(800);
await app.locator("button.send").click();
const sent = app.locator(".trow.you");
await sent.waitFor();
await sleep(1500);
await api(`/api/feedback?session=${session}`, undefined, { method: "GET" });
await sent.locator(".tdelivered.ok").waitFor();
await sleep(1200);
await api(`/api/mocks/${mockId}/say`, { session, message: "Quiet it is. v2 coming up." });
await sleep(1400);
const writing = DEMO.states[0];
// The answers may have left another state on the stage; v2 lands on this one.
await app.locator(".strip [role=tab]", { hasText: writing.label }).click();
await sleep(600);
await api("/api/mocks", {
  mock: mockId,
  session,
  state: writing.label,
  variant: "quiet",
  prompt: "applied your answers",
  surfaces: [
    {
      kind: "html",
      html: DEMO.render(writing, { name: "quiet" }).replace(">The Pier<", ">The Pier, quieter<"),
    },
  ],
});
await app.locator(".vbtn", { hasText: "v2" }).waitFor();
await page.mouse.move(960, 720); // park the pointer so no hover state shows
await sleep(3000);

// 6. Outro card.
await stage("caption", ``);
await stage(
  "card",
  `
  <h1>mockpit <span class="ver">1.0.0</span></h1>
  <div class="cmds">
    <div class="cmd"><span class="p">$</span> npm i -g mockpit</div>
    <div class="cmd"><span class="p">$</span> mockpit serve --open</div>
  </div>
  <p class="foot">github.com/fabiogaliano/mockpit</p>`,
);
await sleep(4200);

// --- finish ------------------------------------------------------------------

const video = page.video();
await context.close();
await browser.close();
proc.kill();
const raw = await video.path();
console.log(raw);
