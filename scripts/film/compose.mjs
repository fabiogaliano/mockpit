// Cuts the raw take (capture.mjs) into the product film: an edit list of cards and
// shots from the take, each shot with its camera moves and captions, timed off the
// take's own timeline so a new capture recuts itself. Renders every frame in headless
// Chromium (film.html) and pipes them to ffmpeg.
//
//   node scripts/film/compose.mjs [take dir] [--fast]
//
// Writes docs/tmp/film/mockpit-film.mp4 (1920×1080, 60 fps; too big for the repo, it goes
// to GitHub as an upload) and docs/mockpit-demo.gif (the first question, for the README).
// --fast renders 30 fps at half size to check the cut.

import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../demo-session.mjs";

const args = process.argv.slice(2);
const FAST = args.includes("--fast");
const TAKE = args.find((a) => !a.startsWith("--")) ?? join(ROOT, "docs", "tmp", "film", "take");
const FPS = FAST ? 30 : 60;
const frames = JSON.parse(readFileSync(join(TAKE, "frames.json"), "utf8"));
const { viewport, events } = JSON.parse(readFileSync(join(TAKE, "timeline.json"), "utf8"));

// --- the take -----------------------------------------------------------------------

// The window at rest: the take scaled so a little backdrop frames it.
const WIN = { w: 1620, h: Math.round((1620 * viewport.height) / viewport.width) };
WIN.x = (1920 - WIN.w) / 2;
WIN.y = (1080 - WIN.h) / 2;
const K = WIN.w / viewport.width; // window px per take CSS px

const find = (kind, pred = () => true) => {
  const e = events.find((x) => x.kind === kind && pred(x));
  if (!e) throw new Error(`no ${kind} in the timeline`);
  return e;
};
const nth = (kind, i) => events.filter((x) => x.kind === kind)[i];
const at = (kind, pred) => find(kind, pred).t;
const q = (id) => (kind) => find(kind, (x) => x.id === id);

const frameAt = (t) => {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return pathToFileURL(join(TAKE, "frames", frames[lo].file)).href;
};

// A point in the take (CSS px) or a box's centre, as a camera target.
const point = (x, y, z) => ({ x: x * K, y: y * K, z });
const centre = (box, z, dx = 0, dy = 0) => point(box.x + box.w / 2 + dx, box.y + box.h / 2 + dy, z);
const WIDE = point(viewport.width / 2, viewport.height / 2, 1);

// --- easing ---------------------------------------------------------------------------

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const out = (t) => 1 - Math.pow(1 - t, 3);
const mix = (a, b, e) => a + (b - a) * e;

// Camera keys are {at, x, y, z, dur}: from `at` (seconds into the shot) the camera eases
// to the key over `dur`. Zoom eases in log space, so a push feels even all the way.
function camera(keys, t) {
  let cam = { ...keys[0] };
  for (const k of keys.slice(1)) {
    if (t <= k.at) break;
    const e = inOut(clamp((t - k.at) / (k.dur ?? 1)));
    cam = {
      x: mix(cam.x, k.x, e),
      y: mix(cam.y, k.y, e),
      z: Math.exp(mix(Math.log(cam.z), Math.log(k.z), e)),
    };
  }
  return fill(cam);
}

// Once zoomed past the window's size, the frame stays filled: the point slides so no
// backdrop shows at the edges. Below that the window stays centred, so the two meet.
function fill(cam) {
  const hw = 960 / cam.z;
  const hh = 540 / cam.z;
  const keep = (v, half, size) => (half * 2 >= size ? size / 2 : clamp(v, half, size - half));
  return { ...cam, x: keep(cam.x, hw, WIN.w), y: keep(cam.y, hh, WIN.h) };
}

// A caption or a card fades in over 0.35 s and out over 0.25 s.
const fade = (t, from, to, inS = 0.35, outS = 0.25) =>
  t < from || t > to ? 0 : out(clamp((t - from) / inS)) * out(clamp((to - t) / outS));

// --- the edit -------------------------------------------------------------------------

const TITLE = `<div><h1>Your agent designs.<br>You decide.</h1></div>`;
const END = `<div><h1>mockpit</h1><p>Design decisions, answered in place.</p><code>npm i -g mockpit</code><small>github.com/fabiogaliano/mockpit</small></div>`;

const agent1 = nth("agent", 0);
const agent2 = nth("agent", 1);
const opened = find("open", (x) => x.what === "design");
const stage = opened.stage;
const grid = q("grid");
const tile = q("tile");
const kase = q("case");
const prices = q("prices");
const hovers = (id) => events.filter((x) => x.kind === "hover" && x.id === id);

// Shots: a card, or a stretch of the take [from, to], with camera keys, captions and
// an optional title or terminal over it, all in seconds into the shot. Cuts, never speed
// ramps, take out waiting. Captions arrive once the camera has settled.
const sentBox = find("sent").box;
const drift = (box, z0, z1, dur, dx = 0, dy = 0) => [
  { ...centre(box, z0, dx, dy) },
  { at: 0, ...centre(box, z1, dx, dy), dur },
];
// Where both the design and the answers are in view.
const both = {
  x: stage.x + stage.w * 0.2,
  y: stage.y,
  w: viewport.width - stage.x * 2 - stage.w * 0.2,
  h: stage.h,
};

const shots = [
  // Hook: the app from the first frame, the line over it.
  {
    take: [grid("question").t + 0.4, grid("question").t + 2.8],
    cam: drift({ x: 0, y: 0, w: viewport.width, h: viewport.height }, 1.0, 1.04, 2.6),
    title: { html: TITLE, from: 0, to: 2.3 },
    dim: 0.45,
  },
  // The agent publishes; the design arrives; a click opens it.
  {
    take: [agent1.t - 0.1, opened.t + 1.4],
    cam: [
      { ...point(viewport.width / 2, viewport.height / 2, 1.03) },
      { at: 0, ...WIDE, dur: 1.2 },
    ],
    term: { lines: agent1.lines, from: 0.1, to: at("focus") - agent1.t - 0.5, x: 430, y: 320 },
    caps: [
      {
        text: "Your agent publishes designs and asks.",
        from: 1.3,
        to: at("focus") - agent1.t - 0.4,
      },
      {
        text: "You answer in your browser.",
        from: opened.t - agent1.t - 0.1,
        to: opened.t - agent1.t + 1.4,
      },
    ],
  },
  // Which grid: three hovers preview on the stage, a click chooses.
  {
    take: [grid("question").t + 0.2, grid("next").t + 0.5],
    cam: drift(both, 1.0, 1.08, 9),
    caps: [
      {
        text: "Hover to preview. Click to choose.",
        from: hovers("grid")[0].t - grid("question").t - 0.6,
        to: grid("pick").t - grid("question").t + 0.6,
      },
    ],
  },
  // The tile colour: push in on the design while the answers are tried.
  {
    take: [tile("question").t + 0.2, tile("next").t + 0.5],
    cam: [
      { ...centre(both, 1.04) },
      {
        at: hovers("tile")[0].t - tile("question").t - 0.9,
        ...centre(stage, 1.5, -40, -60),
        dur: 1.0,
      },
      { at: tile("pick").t - tile("question").t - 0.9, ...centre(both, 1.04), dur: 1.2 },
    ],
    caps: [
      {
        text: "Colour, type, layout. All in pictures.",
        from: hovers("tile")[0].t - tile("question").t + 0.3,
        to: tile("pick").t - tile("question").t - 1.0,
      },
    ],
  },
  // Name case: a question on one part, so the push goes to the names.
  {
    take: [kase("question").t + 0.2, kase("next").t + 0.4],
    cam: [
      { ...centre(both, 1.04) },
      {
        at: hovers("case")[0].t - kase("question").t - 0.9,
        ...centre(stage, 1.8, -250, 30),
        dur: 1.0,
      },
      { at: kase("pick").t - kase("question").t - 0.7, ...centre(both, 1.04), dur: 1.0 },
    ],
    caps: [
      {
        text: "A question can point at one part.",
        from: hovers("case")[0].t - kase("question").t + 0.3,
        to: kase("pick").t - kase("question").t - 0.8,
      },
    ],
  },
  // Prices: straight to the answer and Send.
  {
    // Ends on the Send click: the stage blinks while it reloads just after.
    take: [prices("pick").t - 0.9, prices("next").t + 0.06],
    cam: drift(both, 1.04, 1.06, 3),
  },
  // Not seen yet, then Delivered.
  {
    take: [prices("next").t + 0.22, at("delivered") + 1.3],
    cam: [{ ...centre(both, 1.06) }, { at: 0, ...centre(sentBox, 2.4, 40, 30), dur: 1.0 }],
    caps: [
      {
        text: "One Send. Your agent gets everything.",
        from: 1.2,
        to: at("delivered") - prices("next").t + 1.0,
        top: true,
      },
    ],
  },
  // The agent revises: its two calls, then the new version on the stage.
  {
    take: [agent2.t - 0.1, agent2.t + 1.7],
    cam: [{ ...WIDE }],
    term: { lines: agent2.lines, from: 0.05, to: 1.6, x: 430, y: 330 },
    dim: 0.35,
  },
  {
    take: [at("revised") - 0.5, at("end")],
    cam: drift(stage, 1.0, 1.08, at("end") - at("revised")),
    caps: [
      { text: "It revises. You decide again.", from: 0.9, to: at("end") - at("revised") + 0.3 },
    ],
  },
  { card: END, dur: 3.6 },
];

for (const s of shots) if (s.take) s.dur = s.take[1] - s.take[0];
let T = 0;
for (const s of shots) {
  s.start = T;
  T += s.dur;
}
const TOTAL = T;
let last = { cam: WIDE, src: "" };

function stateAt(t) {
  const s = shots.findLast((x) => x.start <= t) ?? shots[0];
  const local = t - s.start;
  if (s.card) {
    return {
      ...last,
      take: 1 - 0.8 * out(clamp(local / 0.5)),
      card: { html: s.card, a: fade(local, 0.15, s.dur + 1, 0.5, 0.4) },
    };
  }
  const src = frameAt(s.take[0] + local);
  const cam = camera(s.cam, local);
  last = { cam, src };
  const cap = (s.caps ?? []).find((c) => local >= c.from && local <= c.to);
  let term;
  if (s.term && local >= s.term.from && local <= s.term.to + 0.3) {
    term = {
      lines: s.term.lines,
      chars: Math.round((local - s.term.from) * 90),
      caret: Math.floor(local * 2.5) % 2 === 0,
      a: fade(local, s.term.from, s.term.to + 0.3, 0.3, 0.3),
      x: s.term.x,
      y: s.term.y,
    };
  }
  const title = s.title && {
    html: s.title.html,
    a: fade(local, s.title.from, s.title.to, 0.5, 0.3),
  };
  // The take dims under a title or a terminal, so the words carry.
  const under = Math.max(title?.a ?? 0, term?.a ?? 0);
  const take = 1 - (s.dim ?? 0.4) * under;
  return {
    src,
    cam,
    take,
    cap: cap && { text: cap.text, top: cap.top, a: fade(local, cap.from, cap.to, 0.4, 0.25) },
    term,
    card: title,
  };
}

// --- render ---------------------------------------------------------------------------

const size = FAST ? { w: 960, h: 540, scale: 0.5 } : { w: 1920, h: 1080, scale: 1 };
const film = join(ROOT, "docs", "tmp", "film", "mockpit-film.mp4");
const ff = spawn(
  "ffmpeg",
  [
    ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg"],
    ["-i", "-", "-c:v", "libx264", "-preset", FAST ? "veryfast" : "slow", "-crf", "17"],
    ["-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", String(FPS), film],
  ].flat(),
  { stdio: ["pipe", "inherit", "inherit"] },
);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: size.scale,
});
await page.goto(pathToFileURL(join(ROOT, "scripts", "film", "film.html")).href);
await page.evaluate((win) => window.setup(win), WIN);

const count = Math.round(TOTAL * FPS);
const t0 = Date.now();
for (let i = 0; i < count; i++) {
  await page.evaluate((s) => window.draw(s), stateAt(i / FPS));
  const jpg = await page.screenshot({ type: "jpeg", quality: 94 });
  if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % (FPS * 5) === 0) {
    process.stdout.write(`\r${(i / FPS).toFixed(0)}s / ${TOTAL.toFixed(1)}s`);
  }
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(
  `\n${film} (${TOTAL.toFixed(1)}s, ${(statSync(film).size / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s to render)`,
);

// The README gif: the first question, hover to pick, cut from the film itself. gifski
// keeps the product photos from banding at a size GitHub plays without stalling.
if (!FAST) {
  const shot = shots[2];
  const dir = join(TAKE, "gif");
  execFileSync("rm", ["-rf", dir]);
  execFileSync("mkdir", ["-p", dir]);
  execFileSync(
    "ffmpeg",
    [
      ["-loglevel", "error", "-ss", shot.start.toFixed(3), "-t", shot.dur.toFixed(3)],
      ["-i", film, "-vf", "fps=20,scale=900:-1:flags=lanczos", join(dir, "f%04d.png")],
    ].flat(),
  );
  const gif = join(ROOT, "docs", "mockpit-demo.gif");
  const pngs = readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => join(dir, f));
  execFileSync("gifski", [
    "--quiet",
    "--fps",
    "20",
    "--quality",
    "88",
    "--width",
    "900",
    "-o",
    gif,
    ...pngs,
  ]);
  console.log(`${gif} (${shot.dur.toFixed(1)}s, ${(statSync(gif).size / 1e6).toFixed(1)} MB)`);
}
