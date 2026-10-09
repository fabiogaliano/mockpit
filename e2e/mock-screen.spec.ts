import { expect, test } from "./fixtures.ts";

// Smoke test of the mock screen: a 2-state mock in two looks with a Look ask and
// a part ask — strip, picture options, draft write, Send, Thread, Home.

const html = (state: string, look: string) => `<style>
body{margin:0;font:16px system-ui;background:${look === "quiet" ? "#fbfaf7" : "#17181b"};color:${look === "quiet" ? "#222" : "#eee"}}
</style>
<div style="padding:32px">
  <h1 data-part="title" data-part-label="Title">Card · ${state}</h1>
  <p data-part="body" data-part-label="Body">The ${look} look, ${state.toLowerCase()}.</p>
</div>`;

async function api(server: string, path: string, body: unknown) {
  const res = await fetch(`${server}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function seed(server: string) {
  let mockId = "";
  let session: string | undefined;
  for (const state of ["At rest", "Open"]) {
    for (const look of ["quiet", "dark"]) {
      const out = await api(server, "/api/mocks", {
        project: "e2e",
        mock: "card",
        title: "Card",
        state,
        variant: look,
        html: html(state, look),
        ...(session ? { session } : { agent: "e2e" }),
      });
      mockId = out.mock.id;
      session = out.sessionId ?? out.post.sessionId;
    }
  }
  await api(server, `/api/mocks/${mockId}/asks`, {
    session,
    asks: [
      {
        id: "look",
        text: "Which look?",
        scope: "mock",
        options: [
          { id: "quiet", label: "Quiet", variant: "quiet" },
          { id: "dark", label: "Dark", variant: "dark" },
        ],
      },
      {
        id: "title",
        text: "Title size?",
        scope: "part",
        part: "title",
        options: [
          { id: "big", label: "Big" },
          { id: "small", label: "Small" },
        ],
      },
    ],
  });
  return mockId;
}

test("answer a mock's questions and send one reply", async ({ page, server }) => {
  const mockId = await seed(server.url);
  await page.goto(`${server.url}/project/e2e/card`);

  await expect(page.locator(".strip > button")).toHaveCount(2);
  await expect(page.locator(".qhd")).toContainText("Question 1 of");
  const looks = page.locator('.opt:not([data-option="other"])');
  await expect(looks).toHaveCount(2);
  await expect(page.locator('.opt[data-option="other"]')).toHaveText("Other…");
  await expect(page.locator(".opt .thumb iframe")).toHaveCount(2);
  await expect(page.locator(".opt .thumb iframe").first()).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );

  const draftWrite = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
  );
  await looks.first().click();
  const written = await draftWrite;
  expect(written.ok()).toBe(true);
  expect((await written.json()).draft.answers).toEqual({ look: "quiet" });

  // Hover devices move on to the next open question by themselves.
  await expect(page.locator('.pin[data-question="1"]')).toHaveText("✓");
  if (!(await page.evaluate(() => matchMedia("(hover: hover)").matches))) {
    await page.getByRole("button", { name: "Next question" }).click();
  }
  await expect(page.locator(".nm")).toHaveText("Title");
  await page.locator(".opt", { hasText: "Big" }).click();

  // The last question (Mix, once a look is picked) carries Send.
  const last = page.getByRole("button", { name: "Next question" });
  while (await last.isEnabled()) await last.click();
  const send = page.locator("button.send");
  await expect(send).toBeVisible();
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await send.click();
  expect((await reply).status()).toBe(201);

  const sent = page.locator(".trow.you");
  await expect(sent).toHaveCount(1);
  await expect(sent).toContainText("Sent · look quiet");
  await expect(sent.locator(".tdelivered")).toHaveText("✓Not seen yet");
  await expect(page.locator(".top .pill")).toHaveText("Sent · Not seen yet");

  await page.goto(`${server.url}/project/e2e`);
  const row = page.locator(".home-row", { hasText: "Card" });
  await expect(row).toContainText("2 states");
  await expect(row.locator(".home-done")).toHaveText("✓");
  await expect(page.locator(".home-lead")).toContainText("0 open");
});

test("the agent's pending.viewerOpen follows the mock on screen", async ({ page, server }) => {
  const mockId = await seed(server.url);
  const viewerOpen = async () =>
    (await (await fetch(`${server.url}/api/mocks/${mockId}`)).json()).pending.viewerOpen;

  await page.goto(`${server.url}/project/e2e`);
  const row = page.locator(".home-row", { hasText: "Card" });
  await expect(row).toBeVisible();
  expect(await viewerOpen()).toBe(false);

  await row.click();
  await expect(page.locator(".strip > button")).toHaveCount(2);
  await expect.poll(viewerOpen).toBe(true);

  // Back to Home in the same tab: the feed stays up, but no longer names the mock.
  await page.goBack();
  await expect(row).toBeVisible();
  await expect.poll(viewerOpen).toBe(false);
});
