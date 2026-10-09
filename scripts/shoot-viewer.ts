// Screenshots of the viewer for review: boots a throwaway server, seeds the
// demo Writer mock through the CLI, and saves 1600×1000 PNGs to
// docs/tmp/phase4-shots/. Run after `npm run build:viewer`:
//   node scripts/shoot-viewer.ts

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "docs", "tmp", "phase4-shots");
mkdirSync(out, { recursive: true });

function boot(): Promise<{ url: string; proc: ChildProcess }> {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-shots-"));
  const proc = spawn(process.execPath, ["server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "0",
      MOCKPIT_DB: join(dir, "db.sqlite"),
      MOCKPIT_TOKEN: "",
      MOCKPIT_VERSION: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    let buf = "";
    proc.stdout?.on("data", (c: Buffer) => {
      buf += c.toString();
      const m = buf.match(/listening on (http:\/\/localhost:\d+)/);
      if (m) resolve({ url: m[1], proc });
    });
    proc.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
}

async function call(url: string, path: string, method = "GET", body?: unknown) {
  const init: RequestInit = { method };
  if (body) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${url}${path}`, init);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`saved ${join(out, `${name}.png`)}`);
}

const { url, proc } = await boot();
try {
  execFileSync(process.execPath, ["bin/mockpit.js", "demo"], {
    cwd: root,
    env: { ...process.env, MOCKPIT_URL: url },
    stdio: "inherit",
  });
  const list = await call(url, "/api/mocks?project=demo%2Fwriter");
  const mock = list.mocks[0];
  // A second version of the at-rest quiet look, so the versions popover has history.
  const detail = await call(url, `/api/mocks/${mock.id}?body=1`);
  const rest = detail.variants.find(
    (v: { state: string; variant: string }) => v.state === "Writing" && v.variant === "quiet",
  );
  await call(url, "/api/mocks", "POST", {
    mock: mock.id,
    session: mock.sessionId,
    state: "Writing",
    variant: "quiet",
    prompt: "tightened the title",
    html: rest.surfaces[0].html.replace("The Pier", "The Pier, again"),
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  const home = `${url}/project/${encodeURIComponent("demo/writer")}`;
  const screen = `${home}/writer`;

  for (const theme of ["dark", "light"] as const) {
    await page.goto(home);
    await page.evaluate((t) => {
      localStorage.setItem("mockpit-theme", t);
    }, theme);
    await call(url, "/api/theme", "PUT", { mode: theme });
    await page.goto(home);
    await page.locator(".home-row").first().waitFor();
    await shot(page, `home-${theme}`);
    await page.goto(screen);
    await page.locator(".opt").first().waitFor();
    await shot(page, `q1-${theme}`);
  }

  await call(url, "/api/theme", "PUT", { mode: "dark" });
  await page.evaluate(() => localStorage.setItem("mockpit-theme", "dark"));
  await page.goto(screen);
  await page.locator(".opt").first().waitFor();
  // Answer every question (hover devices auto-advance), then send.
  for (let i = 0; i < 6; i++) {
    const send = page.locator("button.send");
    if (await send.count()) break;
    await page.locator(".opt").first().click();
    await page.waitForTimeout(700);
    const next = page.locator("button.primary", { hasText: "Next" });
    if (await next.count()) await next.click();
  }
  await page.locator("button.send").click();
  await page.locator(".trow.you").waitFor();
  // The agent reads the reply (its cursor passes it) and answers.
  await call(url, `/api/feedback?session=${mock.sessionId}`);
  await call(url, `/api/mocks/${mock.id}/say`, "POST", {
    session: mock.sessionId,
    message: "Going with that. I'll fold the trim into the page header in the next version.",
  });
  await page.locator(".tdelivered.ok").waitFor();
  await shot(page, "thread");

  // The at-rest quiet look is the one with a second version.
  await page.locator(".strip > button", { hasText: "Writing" }).click();
  await page.locator(".vbtn").click();
  await page.locator(".vpop").waitFor();
  await shot(page, "versions-popover");
  await page.keyboard.press("Escape");

  // The Mark tool: one mark left, a second one being written.
  await page.goto(screen);
  await page.locator(".opt").first().waitFor();
  await page.locator(".markbtn").click();
  const overlay = page.locator(".frame.on .overlay");
  await overlay.click({ position: { x: 220, y: 120 } });
  await page.locator(".markfield input").fill("This heading could carry more weight");
  await page.locator(".markfield input").press("Enter");
  await page.locator('.pin.mark[data-mark="1"]').waitFor();
  await overlay.click({ position: { x: 520, y: 300 } });
  await page.locator(".markfield input").fill("Less air between these");
  await shot(page, "mark");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Tune with the body part selected, in both themes, with one knob moved so
  // the panel shows a tuned value.
  for (const theme of ["dark", "light"] as const) {
    await call(url, "/api/theme", "PUT", { mode: theme });
    await page.evaluate((t) => localStorage.setItem("mockpit-theme", t), theme);
    await page.goto(screen);
    await page.locator(".opt").first().waitFor();
    await page.locator('.up-mode[data-mode="tune"]').click();
    await page.locator(".up-comp-trigger").click();
    await page.locator('.up-select-option[data-part="body"]').click();
    // tunekit's controls live in its open shadow root; Playwright's CSS
    // locators pierce it, so the size slider is driven like a user would.
    const size = page.locator('.tune-pane [role="slider"]').first();
    await size.focus();
    await size.press("ArrowRight");
    await size.press("ArrowRight");
    await page.locator(".tcount.on").waitFor();
    await page.mouse.move(0, 0);
    await shot(page, theme === "dark" ? "tune-body" : "tune-light");
    // Back to the default: the value leaves the draft and the count drops.
    await size.press("ArrowLeft");
    await size.press("ArrowLeft");
    await page.locator(".tcount:not(.on)").waitFor();
  }

  // A phone: the panel is a bottom sheet over the stage; tap a mode to open it.
  await call(url, "/api/theme", "PUT", { mode: "dark" });
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await phone.newPage();
  mobile.on("pageerror", (e) => console.error("pageerror:", e.message));
  await mobile.goto(screen);
  await mobile.evaluate(() => localStorage.setItem("mockpit-theme", "dark"));
  await mobile.goto(screen);
  await mobile.locator('.up-mode[data-mode="questions"]').tap();
  await mobile.locator(".up-shell.sheet.open .opt").first().waitFor();
  // Touch: the first tap previews on the stage, the second confirms.
  const second = mobile.locator(".opt").nth(1);
  await second.tap();
  await mobile.locator(".opt.previewing").waitFor();
  if ((await second.getAttribute("aria-pressed")) === "true") {
    throw new Error("touch: the first tap picked instead of previewing");
  }
  await second.tap();
  await mobile.locator('.opt[aria-pressed="true"]').waitFor();
  await mobile.locator(".opt").first().tap();
  await shot(mobile, "mobile-questions");
  await browser.close();
} finally {
  proc.kill();
}
