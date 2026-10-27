import type { Page } from "@playwright/test";
import { agentCall, expect, test } from "./fixtures.ts";

// The mobile baseline (iPhone 13 Pro, iPad mini 6 portrait and landscape, on
// real WebKit): the viewer fits the screen, a finger scrolls a tall mock and
// taps a part, fields don't trigger iOS zoom, targets are finger-sized, the
// stage renders at a chosen device width, a design wider than that width is
// shown whole, and the canvas pans and pinches. On the phone the design is one
// page the browser scrolls, and the question card floats above the bottom bar.

const ROWS = 30;
const tall = `<style>body{margin:0;font:16px system-ui}section{padding:24px;border-bottom:1px solid #ddd}</style>
<header data-part="hero" data-part-label="Hero" style="padding:40px;background:#eef">Hero</header>
${Array.from(
  { length: ROWS },
  (_, i) =>
    `<section data-part="row-${i}" data-part-label="Row ${i}"><h2>Row ${i}</h2><p>Text for row ${i}.</p></section>`,
).join("")}`;

async function seed(server: string, more: object[] = []) {
  const first = await agentCall<{ mock: { id: string }; sessionId?: string }>(
    server,
    "/api/mocks",
    { project: "m", mock: "tall", title: "Tall", state: "One", agent: "e2e", html: tall },
  );
  const session = first.sessionId;
  await agentCall(server, "/api/mocks", {
    project: "m",
    mock: "tall",
    state: "Two",
    html: tall,
    session,
  });
  await agentCall(server, `/api/mocks/${first.mock.id}/asks`, {
    session,
    asks: [
      {
        id: "hero",
        text: "Hero height?",
        scope: "part",
        part: "hero",
        options: [
          { id: "tall", label: "Tall" },
          { id: "short", label: "Short" },
        ],
      },
      ...more,
    ],
  });
}

async function open(page: Page, server: string, more: object[] = []) {
  await seed(server, more);
  await page.goto(`${server}/project/m/tall`);
  await expect(page.locator(".frame.on .overlay[data-doc-width]")).toBeVisible();
}

async function pickWidth(page: Page, w: string) {
  await page.locator('.mtop [aria-label^="Width"]').tap();
  await page.locator(`.wmenu button[data-w="${w}"]`).tap();
}
async function openThread(page: Page) {
  await page.locator(".vlabel").tap();
  await page.getByRole("tab", { name: "Thread" }).tap();
}
const markTool = (page: Page) => page.getByRole("button", { name: "Mark", exact: true });

// Too narrow for an artboard beside the design: one page and a bottom sheet.
const onPhone = (page: Page) => page.viewportSize()!.width <= 640;

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("fits the screen without horizontal scrolling", async ({ page, server }) => {
  await open(page, server.url);
  expect(await noOverflow(page)).toBe(true);
  await page.goto(`${server.url}/project/m`);
  await expect(page.locator(".home-step").first()).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

test("a tall mock shows at its full height, fitted to the width; the stage scrolls, not the page", async ({
  page,
  server,
}) => {
  await open(page, server.url);
  const vp = page.viewportSize()!;
  const iframe = page.locator(".frame.on iframe");
  await expect
    .poll(async () => Number(await iframe.getAttribute("height")))
    .toBeGreaterThan(vp.height);
  // Fitted to the width: the whole design is across the screen.
  const b = (await page.locator(".frame.on").boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
  const scrolled = await page.evaluate(() => {
    const l = document.querySelector<HTMLElement>(".layers")!;
    l.scrollTop = 600;
    return { top: l.scrollTop, room: l.scrollHeight - l.clientHeight };
  });
  expect(scrolled.room).toBeGreaterThan(600);
  expect(scrolled.top).toBe(600);
});

test("a tap on a part selects it", async ({ page, server }) => {
  await open(page, server.url);
  const overlay = page.locator(".frame.on .overlay");
  const box = (await overlay.boundingBox())!;
  // The hero is the page's first 100px or so; tap well inside it.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 12);
  await expect(page.locator('.box.sel[data-part="hero"]')).toBeVisible();
});

test("fields are 16px, so iOS never zooms into them", async ({ page, server }) => {
  await open(page, server.url);
  await openThread(page);
  await markTool(page).tap();
  const overlay = page.locator(".frame.on .overlay");
  const box = (await overlay.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 60);
  await expect(page.locator(".markfield input")).toBeVisible();
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("input, textarea, select")]
      .filter((e) => e.getClientRects().length > 0)
      .map((e) => parseFloat(getComputedStyle(e).fontSize)),
  );
  expect(sizes.length).toBeGreaterThan(1);
  for (const px of sizes) expect(px).toBeGreaterThanOrEqual(16);
});

test("touch targets take a 44px tap", async ({ page, server }) => {
  await open(page, server.url);
  const misses = await page.evaluate(() => {
    // The bottom bar packs a phone's width and is left out; everything else
    // a finger aims at is here.
    const sel = [".pin", ".mtop .ib", ".flowbar .fnav", ".qcard .opt", ".qcard .qsend", ".qtab"];
    const out: string[] = [];
    for (const s of sel) {
      for (const el of document.querySelectorAll<HTMLElement>(s)) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // Every point of a 44px square around the center must land on it.
        for (const [dx, dy] of [
          [-21, 0],
          [21, 0],
          [0, -21],
          [0, 21],
        ]) {
          const hit = document.elementFromPoint(cx + dx, cy + dy);
          if (!hit || !(hit === el || el.contains(hit))) out.push(`${s} @${dx},${dy}`);
        }
      }
    }
    return out;
  });
  expect(misses).toEqual([]);
});

test("the width control renders the design at a device width", async ({ page, server }) => {
  await open(page, server.url);
  const iframe = page.locator(".frame.on iframe");
  const overlay = page.locator(".frame.on .overlay");
  // Each screen opens at the device width it can show at true size.
  const screenW = page.viewportSize()!.width;
  const start = screenW <= 600 ? "390" : screenW <= 900 ? "744" : "820";
  const other = start === "744" ? "390" : "744";
  await expect(iframe).toHaveAttribute("width", start);
  if (start !== "820") {
    // Fitted to one whole screen: never wider than this one.
    const b = (await page.locator(".frame.on").boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(screenW);
  }

  // A mark remembers the width it was placed at.
  await markTool(page).tap();
  const box = (await overlay.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 60);
  await page.locator(".markfield input").fill("too tight");
  await page.locator(".markfield-save").tap();
  await expect(page.locator(".pin.mark")).toHaveCount(1);
  await expect(page.locator(".pin.mark.elsewhere")).toHaveCount(0);

  await pickWidth(page, other);
  await expect(iframe).toHaveAttribute("width", other);
  await expect(overlay).toHaveAttribute("data-doc-width", other);
  await expect(page.locator(".pin.mark.elsewhere")).toHaveCount(1);

  // Remembered per mock.
  await page.reload();
  await expect(page.locator(".frame.on iframe")).toHaveAttribute("width", other);
});

test("the canvas pans with one finger and zooms with two", async ({ page, server }) => {
  await open(page, server.url);
  await pickWidth(page, "1280");
  const layers = page.locator(".layers");
  if (onPhone(page)) {
    // A phone's stage is the browser's to scroll, both ways, and never to zoom:
    // its pinch comes from touch events, which WebKit here can't synthesize.
    const style = await layers.evaluate((l) => {
      const cs = getComputedStyle(l);
      return { x: cs.overflowX, y: cs.overflowY, touch: cs.touchAction };
    });
    expect(style).toEqual({ x: "auto", y: "auto", touch: "pan-x pan-y" });
    expect(
      await page.locator(".frame.on .overlay").evaluate((el) => getComputedStyle(el).touchAction),
    ).toBe("pan-x pan-y");
    return;
  }
  const touch = (type: string, id: number, x: number, y: number) =>
    page.locator(".frame.on .overlay").evaluate(
      (el, a) =>
        el.dispatchEvent(
          new PointerEvent(a.type, {
            pointerId: a.id,
            pointerType: "touch",
            clientX: a.x,
            clientY: a.y,
            bubbles: true,
          }),
        ),
      { type, id, x, y },
    );
  // Two fingers apart: the design grows, at most to twice its size.
  const fitted = (await page.locator(".frame.on").boundingBox())!.width;
  await touch("pointerdown", 1, 200, 300);
  await touch("pointerdown", 2, 300, 300);
  await touch("pointermove", 2, 900, 300);
  await touch("pointerup", 2, 900, 300);
  await touch("pointerup", 1, 200, 300);
  await expect
    .poll(async () => (await page.locator(".frame.on").boundingBox())!.width)
    .toBeGreaterThan(fitted * 1.5);
  expect((await page.locator(".frame.on").boundingBox())!.width).toBeLessThanOrEqual(1280 * 2 + 1);
  await expect
    .poll(() => layers.evaluate((l) => l.scrollWidth - l.clientWidth))
    .toBeGreaterThan(100);

  // One finger pans both axes (touch-action: none on the overlay hands the
  // gesture to the viewer's own Pointer Events handling).
  await layers.evaluate((l) => l.scrollTo(200, 200));
  const before = await layers.evaluate((l) => ({ x: l.scrollLeft, y: l.scrollTop }));
  await touch("pointerdown", 1, 300, 400);
  await touch("pointermove", 1, 200, 300);
  await touch("pointerup", 1, 200, 300);
  const pos = await layers.evaluate((l) => ({ x: l.scrollLeft, y: l.scrollTop }));
  expect(pos.x - before.x).toBe(100);
  expect(pos.y - before.y).toBe(100);
  expect(
    await page.locator(".frame.on .overlay").evaluate((el) => getComputedStyle(el).touchAction),
  ).toBe("none");
});

// A board laid out for a desktop (a 360px phone beside 300px of notes, 732px in
// all, centered) overflows a phone-width frame on both sides.
const board = `<style>body{margin:0}.st{display:flex;gap:24px;padding:24px;justify-content:center}</style>
<div class="st"><div data-part="phone" style="width:360px;flex:none;height:600px;background:#eef">Phone</div>
<div style="width:300px;flex:none">Notes</div></div>`;

test("a design wider than its width steps up until it fits; a picked width holds", async ({
  page,
  server,
}) => {
  await agentCall(server.url, "/api/mocks", {
    project: "m",
    mock: "board",
    title: "Board",
    agent: "e2e",
    html: board,
  });
  await page.goto(`${server.url}/project/m/board`);
  const iframe = page.locator(".frame.on iframe");
  // A phone opens at 390 and steps to 744; the iPads open at a width it fits.
  const fits = page.viewportSize()!.width <= 900 ? "744" : "820";
  await expect(iframe).toHaveAttribute("width", fits);
  expect(await noOverflow(page)).toBe(true);

  await pickWidth(page, "390");
  await expect(iframe).toHaveAttribute("width", "390");
  await expect(page.locator(".frame.on .overlay")).toHaveAttribute("data-doc-width", "390");
  await page.reload();
  await expect(page.locator(".frame.on iframe")).toHaveAttribute("width", "390");
});

test("the question card floats above the bar, in view; the look's note; other widths beside", async ({
  page,
  server,
}) => {
  const tone = {
    id: "tone",
    text: "Tone?",
    scope: "mock",
    options: [{ id: "calm", label: "Calm" }],
  };
  await open(page, server.url, [tone]);
  await agentCall(server.url, "/api/mocks", {
    project: "m",
    mock: "tall",
    state: "One",
    html: tall,
    note: "Rows in one column, the hero on top.",
    widths: [390, 1280],
  });
  await page.reload();
  // Answering never starts with a drag: the card is open, above the bar, on screen.
  const card = (await page.locator(".qcard").boundingBox())!;
  const bar = (await page.locator(".vbar").boundingBox())!;
  const vp = page.viewportSize()!;
  expect(card.y + card.height).toBeLessThanOrEqual(bar.y);
  expect(bar.y + bar.height).toBeLessThanOrEqual(vp.height);
  await expect(page.locator(".qcard .qt")).toHaveText("Hero height?");
  await expect(page.locator(".vlabel .note")).toContainText("Rows in one column");
  // × tucks it into its tab; the tab brings it back.
  await page.getByRole("button", { name: "Minimise the question" }).tap();
  await expect(page.locator(".qcard")).toHaveCount(0);
  await page.getByRole("button", { name: /^Show the question/ }).tap();
  await expect(page.locator(".qcard .qt")).toHaveText("Hero height?");
  if (onPhone(page)) {
    // One page, no artboards beside it; the card spans the screen.
    await expect(page.locator(".board")).toHaveCount(0);
    expect(card.width).toBeGreaterThanOrEqual(vp.width - 24);
    return;
  }
  // The mock's other width is a picture beside the live one.
  await expect(page.locator(".board")).toHaveCount(1);
  await expect(page.locator(".board iframe")).toHaveAttribute("width", "1280");
});
