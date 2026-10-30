import type { Page } from "@playwright/test";
import { PROJECT, seedAsked } from "./decideSeed.ts";
import { agentCall, expect, test } from "./fixtures.ts";

// On a phone, the waiting mocks (Home's open count, tapped) swipe left to
// close a mock whose questions aren't worth answering: it leaves the open
// list for a folded Closed one, the agent hears it once, and Undo or Reopen
// bring it back.

// A finger pulling a row sideways, as the Pointer Events a real swipe fires.
async function swipeRow(page: Page, slug: string, dx: number) {
  await page.locator(`.home-list .home-row[data-mock="${slug}"]`).evaluate(async (el, dx) => {
    const box = el.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const x0 = box.right - 40;
    const fire = (type: string, x: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      );
    fire("pointerdown", x0);
    for (let i = 1; i <= 8; i++) {
      fire("pointermove", x0 + (dx * i) / 8);
      await new Promise((r) => requestAnimationFrame(r));
    }
    fire("pointerup", x0 + dx);
    // The click a lifted finger makes on the link it started on.
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, dx);
}

test("a swipe left closes a mock; the agent hears it once; Undo and Reopen bring it back", async ({
  page,
  server,
}) => {
  const card = await seedAsked(server.url, "card", "Card");
  await seedAsked(server.url, "list", "List", card.session);
  await page.goto(`${server.url}/project/${PROJECT}`);
  const lead = page.locator(".home-lead");
  await expect(lead).toContainText("2 open across 2 mocks");
  await page.locator(".home-count").tap();
  const home = new RegExp(`/project/${PROJECT}$`);

  // A short pull springs back and opens nothing.
  await swipeRow(page, "card", -50);
  await expect(page).toHaveURL(home);
  await expect(page.locator(".home-list .home-row")).toHaveCount(2);

  // Past the threshold the row closes, into the folded Closed list.
  await swipeRow(page, "card", -240);
  await expect(page.locator(".home-toast")).toContainText("Closed “Card”");
  await expect(lead).toContainText("1 open across 1 mock");
  await expect(page.locator(".home-list .home-row")).toHaveCount(1);
  await expect(page.locator(".home-resolved-hd")).toContainText("Closed · 1");
  await expect(page).toHaveURL(home);
  const read = await agentCall(server.url, `/api/feedback?session=${card.session}`);
  expect(read.feedback).toEqual([
    expect.objectContaining({
      mock: "card",
      resolved: true,
      dismissed: [{ ask: "tone", text: "Which tone?" }],
    }),
  ]);
  const again = await agentCall(server.url, `/api/feedback?session=${card.session}`);
  expect(again.feedback).toEqual([]);

  // Undo puts it back where it was.
  await page.locator(".home-toast").getByRole("button", { name: "Undo" }).tap();
  await expect(lead).toContainText("2 open across 2 mocks");
  await expect(page.locator(".home-resolved")).toHaveCount(0);

  // Reopen in the Closed list does too, from a finger-sized button.
  await swipeRow(page, "list", -240);
  await expect(page.locator(".home-resolved-hd")).toContainText("Closed · 1");
  await page.locator(".home-resolved-hd").tap();
  const reopen = page.getByRole("button", { name: "Reopen List" });
  const box = (await reopen.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  await reopen.tap();
  await expect(page.locator(".home-resolved")).toHaveCount(0);
  await expect(lead).toContainText("2 open across 2 mocks");
});
