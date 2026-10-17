import type { Page } from "@playwright/test";
import { agentCall, expect, test } from "./fixtures.ts";

// The mobile baseline (iPhone 13 Pro, iPad mini 6 portrait and landscape, on
// real WebKit): the viewer fits the screen, a finger scrolls a tall mock and
// taps a part, fields don't trigger iOS zoom, targets are finger-sized, the
// stage renders at a chosen device width (behind More over a bottom sheet), a
// design wider than that width is shown whole, and Inspect pans at 100%.

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

// On the canvas the widths are the header's chips (a menu on a phone); beside
// the panel, the stage head's picker.
const onCanvas = async (page: Page) => (await page.locator(".chead").count()) > 0;
async function pickWidth(page: Page, w: string) {
  if (!(await onCanvas(page))) return page.locator(".widthpick select").selectOption(w);
  const chip = page.locator(`.chead-seg button[title="${w} px"]`);
  if (await chip.count()) await chip.tap();
  else await page.locator(".chead-widths select").selectOption(w);
}
async function openThread(page: Page) {
  if (!(await onCanvas(page))) return page.locator('[data-mode="thread"]').tap();
  await page.locator(".chead .morebtn").tap();
  await page.locator(".chead-menu button", { hasText: "Thread" }).tap();
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("fits the screen without horizontal scrolling", async ({ page, server }) => {
  await open(page, server.url);
  expect(await noOverflow(page)).toBe(true);
  await page.goto(`${server.url}/project/m`);
  await expect(page.locator(".home-row")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

test("a tall mock opens as one whole screen on the canvas, at full height beside the panel", async ({
  page,
  server,
}) => {
  await open(page, server.url);
  if (!(await onCanvas(page))) {
    // Uncapped: the frame is as tall as its page, and the stage scrolls.
    const iframe = page.locator(".frame.on iframe");
    await expect
      .poll(async () => Number(await iframe.getAttribute("height")))
      .toBeGreaterThan(page.viewportSize()!.height);
    const scrolled = await page.evaluate(() => {
      const l = document.querySelector<HTMLElement>(".layers")!;
      l.scrollTop = 600;
      return { top: l.scrollTop, room: l.scrollHeight - l.clientHeight };
    });
    expect(scrolled.room).toBeGreaterThan(600);
    expect(scrolled.top).toBe(600);
    return;
  }
  const vp = page.viewportSize()!;
  // The artboard shows a whole screen of its device, all of it on this screen.
  await expect
    .poll(async () => {
      const b = (await page.locator(".frame.on").boundingBox())!;
      return b.x >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height;
    })
    .toBe(true);
  // The page below that screen is read by scrolling the page itself.
  const scrolled = await page
    .frameLocator(".frame.on iframe")
    .locator("html")
    .evaluate((el) => {
      window.scrollTo(0, 600);
      return { top: window.scrollY, room: el.scrollHeight - window.innerHeight };
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
  await page.locator(".markbtn").tap();
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
    const sel = [
      ".pin",
      ".vbtn",
      ".markbtn",
      ".inspectbtn",
      ".morebtn",
      ".widthpick select",
      ".chead-seg button",
      ".chead-widths select",
      ".chead .zoomval",
      ".strip > button",
      ".up-mode",
      ".sheet-handle",
      ".crumb .home",
      ".themebtn",
    ];
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
  await page.locator(".markbtn").tap();
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

test("Inspect, or the canvas, at 100% pans, and a pinch zooms", async ({ page, server }) => {
  await open(page, server.url);
  await pickWidth(page, "1280");
  const canvas = await onCanvas(page);
  if (canvas) {
    // The canvas is Inspect already: the scale in the header flips to true size.
    await page.locator(".chead .zoomval").tap();
  } else {
    await page.locator(".inspectbtn").tap();
    await expect(page.locator(".top")).toBeHidden();
    await expect(page.locator(".up-shell")).toBeHidden();
    await expect(page.locator(".donebtn")).toBeFocused();
    await page.locator(".zoomseg button", { hasText: "100%" }).tap();
  }
  const layers = page.locator(".layers");
  await expect
    .poll(() => layers.evaluate((l) => l.scrollWidth - l.clientWidth))
    .toBeGreaterThan(100);

  // One finger pans both axes (touch-action: none on the overlay hands the
  // gesture to the viewer's own Pointer Events handling).
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

  // Two fingers apart: the zoom leaves 100% and shows its number, at most 200%.
  await touch("pointerdown", 1, 200, 400);
  await touch("pointerdown", 2, 300, 400);
  await touch("pointermove", 2, 600, 400);
  await touch("pointerup", 2, 600, 400);
  await touch("pointerup", 1, 200, 400);
  await expect(page.locator(".zoomval")).toHaveText("200%");

  if (!canvas) {
    await page.locator(".donebtn").tap();
    await expect(page.locator(".top")).toBeVisible();
    await expect(page.locator(".inspectbtn")).toBeFocused();
  }
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

test("without room for the panel: a two-row header, the questions in view, notes, artboards", async ({
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
  if (!(await onCanvas(page))) {
    await expect(page.locator(".pins .pin")).toHaveCount(1);
    await expect(page.locator(".qcard")).toHaveCount(0);
    return;
  }
  await expect(page.locator(".chead .crow")).toHaveCount(2);
  // Answering never starts with a drag: the card is open and on screen.
  const card = (await page.locator(".qcard").boundingBox())!;
  expect(card.y + card.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(page.locator(".qcard .qhd")).toBeVisible();
  await expect(page.locator(".pins .pin")).toHaveCount(0);
  await expect(page.locator(".chead-note")).toContainText("Rows in one column");
  // The mock's other width is a picture beside the live one.
  await expect(page.locator(".board")).toHaveCount(1);
  await expect(page.locator(".board iframe")).toHaveAttribute("width", "1280");
});
