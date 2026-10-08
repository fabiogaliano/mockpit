// Regenerates the README surface gallery (docs/surfaces/*.png): boots a fresh
// server, publishes one mock per surface kind from scripts/surface-examples/,
// and screenshots each mock's stage in a dark-mode Chromium at 2x. Run after
// changing a surface renderer or an example:
//
//   node scripts/shoot-surfaces.mjs
//
// The chart for the image example is rendered by Playwright itself (the example
// SVG, screenshotted to a PNG and uploaded as an asset) so there is no system
// image-conversion dependency. The experimental trace kind has no stage
// renderer; the old 05-trace.png was removed with the trace path.

import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EX = join(ROOT, "scripts", "surface-examples");
const OUT = join(ROOT, "docs", "surfaces");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => readFileSync(join(EX, f), "utf8");
const E = "\x1b["; // ANSI CSI

execFileSync("npm", ["run", "build:viewer"], { cwd: ROOT, stdio: "inherit" });

const dataDir = mkdtempSync(join(tmpdir(), "mockpit-shots-"));
const proc = spawn(process.execPath, [join(ROOT, "server", "index.ts")], {
  env: {
    ...process.env,
    PORT: "0",
    MOCKPIT_DB: join(dataDir, "db.sqlite"),
    MOCKPIT_TOKEN: "",
    MOCKPIT_VERSION: "",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
const base = await new Promise((resolve, reject) => {
  let out = "";
  proc.stdout.on("data", (c) => {
    out += c;
    const m = out.match(/listening on (http:\/\/localhost:\d+)/);
    if (m) resolve(m[1]);
  });
  setTimeout(() => reject(new Error("server did not boot")), 10_000);
});

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return r.json();
  });

const browser = await chromium.launch();
const context = await browser.newContext({
  // Wide enough for an unscaled 820px stage beside the panel, tall enough that
  // no stage is height-capped.
  viewport: { width: 1320, height: 1800 },
  colorScheme: "dark",
  deviceScaleFactor: 2,
});
const page = await context.newPage();

// Render the chart example: load the SVG, screenshot it to a PNG, upload it as
// an asset the image card references.
const chartSvg = read("chart.svg");
await page.setContent(chartSvg, { waitUntil: "networkidle" });
const chartPng = await page.locator("svg").screenshot();
const asset = await fetch(`${base}/api/assets?filename=chart.png&kind=image`, {
  method: "POST",
  headers: { "content-type": "image/png" },
  body: chartPng,
}).then((r) => r.json());

const terminal =
  `${E}1m$ npm test -- worker${E}0m\n\n` +
  `${E}90m  worker › retry policy${E}0m\n` +
  `  ${E}32m✓${E}0m re-enqueues a failed job with backoff ${E}90m(4 ms)${E}0m\n` +
  `  ${E}32m✓${E}0m gives up after MAX_ATTEMPTS ${E}90m(2 ms)${E}0m\n` +
  `  ${E}32m✓${E}0m jitter keeps delays within [0.5x, 1.0x] ${E}90m(11 ms)${E}0m\n` +
  `  ${E}33m●${E}0m dead-letter queue ${E}33m(todo)${E}0m\n\n` +
  `${E}42;30m PASS ${E}0m  ${E}32m3 passed${E}0m, ${E}33m1 todo${E}0m  ${E}90m(0.42s)${E}0m\n\n` +
  `${E}1m$ fly deploy --strategy rolling${E}0m\n` +
  `${E}36m==>${E}0m Building image\n` +
  `${E}36m==>${E}0m Pushing  ${E}32mdone${E}0m ${E}90msha256:9c3d8e1${E}0m\n` +
  `${E}36m==>${E}0m Rolling  [${E}32m####################${E}0m] 4/4 machines\n` +
  `${E}32m✓${E}0m Deployed ${E}1mworker${E}0m v231 → ${E}1mv232${E}0m\n`;

// One mock per kind; `n` and `file` name the screenshot (05 was trace).
const mocks = [
  {
    n: 1,
    file: "html",
    title: "html — an interactive UI you author",
    surfaces: [{ kind: "html", html: read("html.html") }],
  },
  {
    n: 2,
    file: "markdown",
    title: "markdown — prose, tables and code, rendered",
    surfaces: [{ kind: "markdown", markdown: read("tradeoff.md") }],
  },
  {
    n: 3,
    file: "diff",
    title: "diff — a patch rendered as code review",
    surfaces: [{ kind: "diff", patch: read("retry.patch"), layout: "unified" }],
  },
  {
    n: 4,
    file: "terminal",
    title: "terminal — shell output with ANSI color",
    surfaces: [{ kind: "terminal", text: terminal, cols: 76, title: "deploy.log" }],
  },
  {
    n: 6,
    file: "image",
    title: "image — an uploaded, content-addressed asset",
    surfaces: [
      {
        kind: "image",
        assetId: asset.id,
        alt: "Concept billboard ad for a fictional SaaS brand",
        caption: "Campaign concept — one of the billboard directions we mocked up for the launch.",
      },
    ],
  },
  {
    n: 7,
    file: "mermaid",
    title: "mermaid — a diagram from a few lines of text",
    surfaces: [{ kind: "mermaid", mermaid: read("loop.mmd") }],
  },
  {
    n: 8,
    file: "json",
    title: "json — a JSON value as a collapsible tree",
    surfaces: [{ kind: "json", data: JSON.parse(read("queue-stats.json")) }],
  },
  {
    n: 9,
    file: "code",
    title: "code — source highlighted with line numbers",
    surfaces: [
      {
        kind: "code",
        code: read("backoff.ts.txt"),
        language: "ts",
        title: "worker.ts",
        lineStart: 4,
      },
    ],
  },
  {
    n: 10,
    file: "combined",
    title: "markdown + diff — two surfaces in one version",
    surfaces: [
      { kind: "markdown", markdown: read("dlq.md") },
      { kind: "diff", patch: read("dlq.patch"), layout: "unified" },
    ],
  },
];

const PROJECT = "surfaces";
let session;
for (const m of mocks) {
  const res = await post("/api/mocks", {
    project: PROJECT,
    mock: m.file,
    title: m.title,
    surfaces: m.surfaces,
    ...(session ? { session } : { agent: "claude-opus", sessionTitle: "Surface kinds" }),
  });
  session = session ?? res.sessionId ?? res.post.sessionId;
}

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.evaluate(() => localStorage.setItem("mockpit-theme", "dark"));
await fetch(`${base}/api/theme`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "dark" }),
});

for (const m of mocks) {
  await page.goto(`${base}/project/${PROJECT}/${m.file}`, { waitUntil: "domcontentloaded" });
  await page.locator(".frame.on .surface").first().waitFor();
  if (m.surfaces.some((s) => s.kind === "image")) await page.locator(".frame.on img").waitFor();
  await sleep(2500); // let iframes report height, fonts settle, highlighting paint
  await page.mouse.move(0, 0);
  const path = join(OUT, `${m.n}`.padStart(2, "0") + `-${m.file}.png`);
  await page.locator(".stage").screenshot({ path });
  console.log(path);
}

await context.close();
await browser.close();
proc.kill();
