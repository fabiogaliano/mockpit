import { devices, type Page } from "@playwright/test";
import { PROJECT, seedWriter } from "./decideSeed.ts";
import { agentCall, expect, test } from "./fixtures.ts";

// Answering from a phone: a tap puts an option on the stage as the pick, the
// same option again (or Send) moves on, and the last question sends the reply.

// The device's browser type is the project's to choose, so both engines run it.
const { defaultBrowserType: _engine, ...iPhone } = devices["iPhone 13 Pro"];
test.use(iPhone);

const mockPath = `/project/${PROJECT}/writer`;
const card = (page: Page) => page.locator(".qcard");
const option = (page: Page, id: string) => page.locator(`.qcard .opt[data-option="${id}"]`);
const onStage = (page: Page) => page.locator(".frame.on");

async function tapAndSave(page: Page, mockId: string, id: string) {
  const write = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
  );
  await option(page, id).tap();
  expect((await write).ok()).toBe(true);
}

test("on touch, a tap picks, the same tap again moves on, and the reply reaches the agent", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);

  // Q1, variant options: a tap puts the look on the stage as the pick; the
  // same option again moves on. The question is in view from the start.
  await expect(card(page).locator(".qcount")).toHaveText("1 of 2");
  await expect(onStage(page)).toHaveAttribute("data-variant", "quiet");
  await tapAndSave(page, mockId, "dark");
  await expect(onStage(page)).toHaveAttribute("data-variant", "dark");
  await expect(option(page, "dark")).toHaveAttribute("aria-pressed", "true");
  await option(page, "dark").tap();

  // Q2, knob-set options: picked, then Send says Next.
  await expect(card(page).locator(".qcount")).toHaveText("2 of 2");
  await tapAndSave(page, mockId, "inline");
  await expect(option(page, "inline")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page).locator(".qsend")).toHaveText("Next");
  await card(page).locator(".qsend").tap();

  // Q3 is on Lab open: plain options pick the same way.
  await expect(page.locator(".mcrumb b")).toHaveText("Lab open");
  await expect(card(page).locator(".qcount")).toHaveText("3 of 3");
  await expect(option(page, "inside")).toHaveClass(/pill/);
  await tapAndSave(page, mockId, "inside");
  await expect(option(page, "inside")).toHaveAttribute("aria-pressed", "true");

  // The last question owed: Send sends, and the reply is delivered.
  const send = card(page).locator(".qsend");
  await expect(send).toHaveText("Send");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await send.tap();
  expect((await reply).status()).toBe(201);
  await page.locator(".vlabel").tap();
  await page.getByRole("tab", { name: "Thread" }).tap();
  await expect(page.locator(".trow.you")).toContainText(
    "variant dark · versions inline · trim inside the lab",
  );

  const read = await agentCall(server.url, `/api/feedback?session=${session}`);
  expect(read.feedback).toHaveLength(1);
  await expect(page.locator(".trow.you .tdelivered")).toHaveText("✓✓Delivered");
});

// A finger travelling across the element. WebKit has no Touch constructor, so
// each event is a plain one carrying the touch lists a real swipe fires.
async function swipe(page: Page, selector: string, dx: number) {
  await page.locator(selector).evaluate((el, dx) => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const fire = (type: string, clientX: number) => {
      const t = { identifier: 1, target: el, clientX, clientY: y, pageX: clientX, pageY: y };
      const live = type === "touchend" ? [] : [t];
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(e, {
        touches: { value: live },
        targetTouches: { value: live },
        changedTouches: { value: [t] },
      });
      el.dispatchEvent(e);
    };
    fire("touchstart", x);
    fire("touchmove", x + dx / 2);
    fire("touchend", x + dx);
  }, dx);
}

test("on touch, the card's arrows walk the questions; a swipe across the design moves a step", async ({
  page,
  server,
}) => {
  await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  await expect(card(page).locator(".qcount")).toHaveText("1 of 2");
  await expect(page.locator(".flowbar .num")).toHaveText("1 of 4");

  // Each state shows its own questions: At rest has two, then Lab open adds
  // Trim, and going back stays on Lab open, where the shared ones show too.
  const next = page.getByRole("button", { name: "Next question" });
  await next.tap();
  await expect(card(page).locator(".qcount")).toHaveText("2 of 2");
  await next.tap();
  await expect(page.locator(".mcrumb b")).toHaveText("Lab open");
  await expect(card(page).locator(".qcount")).toHaveText("3 of 3");
  await page.getByRole("button", { name: "Previous question" }).tap();
  await expect(card(page).locator(".qcount")).toHaveText("2 of 3");
  // The card's Send sits inside the screen.
  const box = (await card(page).locator(".qsend").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);

  // A sideways swipe across the design moves between the steps.
  await swipe(page, ".frame.on .overlay", -140);
  await expect(page.locator(".flowbar .num")).toHaveText("3 of 4");
  await expect(page.locator(".mcrumb b")).toHaveText("Panel");
  await swipe(page, ".frame.on .overlay", 140);
  await expect(page.locator(".mcrumb b")).toHaveText("Lab open");
});
