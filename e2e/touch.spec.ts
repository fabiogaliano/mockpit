import { devices, type Page } from "@playwright/test";
import { PROJECT, seedWriter } from "./decideSeed.ts";
import { agentCall, expect, test } from "./fixtures.ts";

// Answering from a phone: no hover, so a tap on an option that can preview
// previews and a second tap picks, while a plain option (no variant, no knob
// set) has nothing to preview and must pick on the first tap — otherwise its
// question can never be answered and Send never shows.

// The device's browser type is the project's to choose, so both engines run it.
const { defaultBrowserType: _engine, ...iPhone } = devices["iPhone 13 Pro"];
test.use(iPhone);

const mockPath = `/project/${PROJECT}/writer`;
const header = (page: Page) => page.locator(".qhd");
const option = (page: Page, id: string) => page.locator(`.opt[data-option="${id}"]`);
const onStage = (page: Page) => page.locator(".frame.on");

async function tapAndSave(page: Page, mockId: string, id: string) {
  const write = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
  );
  await option(page, id).tap();
  expect((await write).ok()).toBe(true);
}

test("on touch, plain options pick on one tap and the reply reaches the agent", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
  const next = page.getByRole("button", { name: "Next question" });

  // Q1, variant options: the first tap previews, the second picks. The
  // questions are in view from the start: nothing to open first.
  await expect(header(page)).toContainText("Question 1 of 3");
  await expect(onStage(page)).toHaveAttribute("data-variant", "quiet");
  await expect(page.locator(".opt.previewing")).toHaveCount(0);
  await option(page, "dark").tap();
  await expect(onStage(page)).toHaveAttribute("data-variant", "dark");
  await expect(option(page, "dark")).toHaveAttribute("aria-pressed", "false");
  await tapAndSave(page, mockId, "dark");
  await expect(option(page, "dark")).toHaveAttribute("aria-pressed", "true");
  await next.tap();

  // Q2, knob-set options: the same two taps.
  await expect(header(page)).toContainText("Question 2 of 3");
  await option(page, "inline").tap();
  await expect(option(page, "inline")).toHaveAttribute("aria-pressed", "false");
  await tapAndSave(page, mockId, "inline");
  await expect(option(page, "inline")).toHaveAttribute("aria-pressed", "true");
  await next.tap();

  // Q3, plain options: nothing to preview, so one tap picks.
  await expect(header(page)).toContainText("Question 3 of 3");
  await expect(option(page, "inside")).toHaveClass(/pill/);
  await tapAndSave(page, mockId, "inside");
  await expect(option(page, "inside")).toHaveAttribute("aria-pressed", "true");

  // Every question answered: the review holds Send, and the reply is delivered.
  await expect(header(page)).toContainText("3 of 3");
  await page.getByRole("button", { name: "Review ›" }).tap();
  await expect(header(page)).toContainText("Review");
  const send = page.locator("button.send");
  await expect(send).toHaveText("Send 3");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await send.tap();
  expect((await reply).status()).toBe(201);
  await expect(page.locator(".trow.you")).toContainText(
    "look dark · versions inline · trim inside the lab",
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

test("on touch, the arrows move between questions and on to the review; a swipe does not", async ({
  page,
  server,
}) => {
  await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  await expect(header(page)).toContainText("Question 1 of 3");

  // A sideways swipe is left to the page: it never steps questions.
  await swipe(page, ".qblock .ask", -120);
  await expect(header(page)).toContainText("Question 1 of 3");
  await expect(page.getByRole("button", { name: "Shortcuts" })).toHaveCount(0);

  const next = page.getByRole("button", { name: "Next question" });
  for (const n of [2, 3]) {
    await next.tap();
    await expect(header(page)).toContainText(`Question ${n} of 3`);
  }
  await page.getByRole("button", { name: "Previous question" }).tap();
  await expect(header(page)).toContainText("Question 2 of 3");
  await next.tap();
  await next.tap();
  await expect(header(page)).toContainText("Review · 3 questions");
  // The review's Send sits pinned at the bottom of the card, inside the screen.
  const actions = page.locator(".qactions");
  await expect(actions).toHaveCount(1);
  const box = await actions.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
});
