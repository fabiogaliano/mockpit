import type { Page } from "@playwright/test";
import { agentCall, expect, test } from "./fixtures.ts";

// The mobile baseline (iPhone 13 Pro, iPad mini 6 portrait and landscape, on
// real WebKit): the viewer fits the screen, a finger scrolls a tall mock and
// taps a part, fields don't trigger iOS zoom, targets are finger-sized, the
// stage renders at a chosen device width, and Inspect pans at 100%.

const ROWS = 30;
const tall = `<style>body{margin:0;font:16px system-ui}section{padding:24px;border-bottom:1px solid #ddd}</style>
<header data-part="hero" data-part-label="Hero" style="padding:40px;background:#eef">Hero</header>
${Array.from(
  { length: ROWS },
  (_, i) =>
    `<section data-part="row-${i}" data-part-label="Row ${i}"><h2>Row ${i}</h2><p>Text for row ${i}.</p></section>`,
).join("")}`;

async function seed(server: string) {
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
    ],
  });
}

async function open(page: Page, server: string) {
  await seed(server);
  await page.goto(`${server}/project/m/tall`);
  await expect(page.locator(".frame.on .overlay[data-doc-width]")).toBeVisible();
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

test("a tall mock takes its full height and the stage scrolls", async ({ page, server }) => {
  await open(page, server.url);
  const iframe = page.locator(".frame.on iframe");
  // Uncapped: the frame is as tall as its page, not the screen.
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
  await page.locator('[data-mode="thread"]').tap();
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
      ".widthpick select",
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
  const phone = page.viewportSize()!.width < 600;
  await expect(iframe).toHaveAttribute("width", phone ? "390" : "820");

  // A mark remembers the width it was placed at.
  await page.locator(".markbtn").tap();
  const box = (await overlay.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 60);
  await page.locator(".markfield input").fill("too tight");
  await page.locator(".markfield-save").tap();
  await expect(page.locator(".pin.mark")).toHaveCount(1);
  await expect(page.locator(".pin.mark.elsewhere")).toHaveCount(0);

  await page.locator(".widthpick select").selectOption("744");
  await expect(iframe).toHaveAttribute("width", "744");
  await expect(overlay).toHaveAttribute("data-doc-width", "744");
  await expect(page.locator(".pin.mark.elsewhere")).toHaveCount(1);

  // Remembered per mock.
  await page.reload();
  await expect(page.locator(".frame.on iframe")).toHaveAttribute("width", "744");
});

test("Inspect at 100% pans, and a pinch zooms", async ({ page, server }) => {
  await open(page, server.url);
  await page.locator(".widthpick select").selectOption("1280");
  await page.locator(".inspectbtn").tap();
  await expect(page.locator(".top")).toBeHidden();
  await expect(page.locator(".up-shell")).toBeHidden();
  await expect(page.locator(".donebtn")).toBeFocused();
  await page.locator(".zoomseg button", { hasText: "100%" }).tap();
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
  await touch("pointerdown", 1, 300, 400);
  await touch("pointermove", 1, 200, 300);
  await touch("pointerup", 1, 200, 300);
  const pos = await layers.evaluate((l) => ({ x: l.scrollLeft, y: l.scrollTop }));
  expect(pos.x).toBe(100);
  expect(pos.y).toBe(100);
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

  await page.locator(".donebtn").tap();
  await expect(page.locator(".top")).toBeVisible();
  await expect(page.locator(".inspectbtn")).toBeFocused();
});
