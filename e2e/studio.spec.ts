import type { Page } from "@playwright/test";
import { PROJECT } from "./decideSeed.ts";
import { agentCall, expect, test } from "./fixtures.ts";

const html = (name: string) =>
  `<div style="padding:40px"><h1 data-part="title" style="margin:0">${name}</h1></div>`;

// a (one version), b (two), and c forked from a#1: a riff under it.
async function seed(server: string) {
  const a = await agentCall(server, "/api/mocks", {
    project: PROJECT,
    mock: "orb",
    title: "Orb",
    agent: "e2e",
    variant: "a",
    html: html("a"),
  });
  const base = { mock: a.mock.id, session: a.sessionId };
  await agentCall(server, "/api/mocks", { ...base, variant: "b", html: html("b1") });
  await agentCall(server, "/api/mocks", { ...base, variant: "b", html: html("b2") });
  await agentCall(server, "/api/mocks", { ...base, variant: "c", fork: "a@1", html: html("c") });
  return { session: a.sessionId as string };
}

const col = (page: Page, variant: string) => page.locator(`.studio-col[aria-label="${variant}"]`);

test("Studio: step out, steer one version alone, hide and archive with Undo", async ({
  page,
  server,
}) => {
  const { session } = await seed(server.url);
  await page.goto(`${server.url}/project/${PROJECT}/orb`);

  // A pick still being composed on Stage: no steer may send or decide it.
  await page.locator('.qcard .opt[data-option="b"]').click();
  await expect(page.locator('.qcard .opt[data-option="b"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "3 variants" }).click();
  await expect(page.locator(".studio")).toBeVisible();
  await expect(page).toHaveURL(/view=studio/);
  await expect(col(page, "b").locator(".sk-n")).toHaveText(["#2", "#1"]);
  await expect(col(page, "a").locator(".studio-riffs .sk")).toHaveCount(1);

  await col(page, "b").locator(".sk").first().hover();
  await col(page, "b").getByRole("button", { name: "More like B #2" }).click();
  await expect(page.locator(".toast")).toContainText("More like B #2, sent");
  const read = await agentCall(server.url, `/api/feedback?session=${session}`);
  const reply = read.feedback[0].reply;
  expect(reply.reactions).toEqual(["more like this: variant b@2"]);
  expect(reply.verdict).toBeUndefined();
  expect(reply.asks).toEqual([]);
  expect(reply.answers).toEqual({});

  // b has two versions: the × hides one.
  const newest = col(page, "b").locator(".sk").first();
  await newest.hover();
  await newest.getByRole("button", { name: "Hide B #2" }).click();
  await expect(page.locator(".toast")).toContainText("Hid B #2");
  await expect(col(page, "b").locator(".sk")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(col(page, "b").locator(".sk")).toHaveCount(2);

  // The riff is c's only version: the × archives c, and Undo restores it.
  const riff = col(page, "a").locator(".studio-riffs .sk");
  await riff.hover();
  await riff.getByRole("button", { name: "Archive c" }).click();
  const archived = page.getByRole("button", { name: "1 archived" });
  await archived.click();
  await expect(page.getByRole("button", { name: "Restore c" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(archived).toHaveCount(0);

  // Opening a version steps back in to Stage, and the pick is still there.
  await col(page, "a").locator(".sk-art").first().click();
  await expect(page.locator(".studio")).toHaveCount(0);
  await expect(page.locator('.qcard .opt[data-option="b"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The step out is remembered for this mock.
  await page.getByRole("button", { name: "3 variants" }).click();
  await page.goto(`${server.url}/project/${PROJECT}/orb`);
  await expect(page.locator(".studio")).toBeVisible();
});

test("the mock's name opens what's around it; the path is the way up", async ({ page, server }) => {
  await seed(server.url);
  await page.goto(`${server.url}/project/${PROJECT}/orb`);
  const path = page.getByRole("navigation", { name: "Path" });
  await path.getByRole("button", { name: "Orb" }).click();
  const about = page.getByRole("dialog", { name: "Orb" });
  await expect(about).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
  await path.getByRole("link", { name: PROJECT }).click();
  await expect(page).toHaveURL(new RegExp(`/project/${PROJECT}(\\?|$)`));
});
