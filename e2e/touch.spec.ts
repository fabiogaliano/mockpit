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
  // A phone gets the panel as a bottom sheet, collapsed to its mode row.
  await page.getByRole("button", { name: "Expand panel" }).tap();

  // Q1, variant options: the first tap previews, the second picks. The tap
  // that opened the sheet must not land on the option that slid under it.
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
  await expect(header(page)).toContainText("Question 2 of 4");
  await option(page, "inline").tap();
  await expect(option(page, "inline")).toHaveAttribute("aria-pressed", "false");
  await tapAndSave(page, mockId, "inline");
  await expect(option(page, "inline")).toHaveAttribute("aria-pressed", "true");
  await next.tap();

  // Q3, plain options: nothing to preview, so one tap picks.
  await expect(header(page)).toContainText("Question 3 of 4");
  await expect(option(page, "inside")).toHaveClass(/pill/);
  await tapAndSave(page, mockId, "inside");
  await expect(option(page, "inside")).toHaveAttribute("aria-pressed", "true");
  await next.tap();

  // Every question answered: Send shows, and the reply is delivered.
  await expect(header(page)).toContainText("4 of 4");
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
