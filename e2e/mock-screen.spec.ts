import { expect, test } from "./fixtures.ts";

// Smoke test of the mock screen: a 2-state mock in two looks with a Look ask and
// a part ask — flow bar, the question card's pictures, draft write, Send,
// Thread, Home.

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

  // Two states: the flow bar steps between them.
  await expect(page.locator(".flowbar .num")).toHaveText("1 of 2");
  const card = page.locator(".qcard");
  await expect(card.locator(".qt")).toHaveText("Which look?");
  const looks = card.locator('.opt:not([data-option="other"])');
  await expect(looks).toHaveCount(2);
  await expect(card.locator('.opt[data-option="other"]')).toHaveText("Other…");
  await expect(card.locator(".opt .thumb iframe")).toHaveCount(2);
  await expect(card.locator(".opt .thumb iframe").first()).toHaveAttribute(
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
  await expect(looks.first()).toHaveAttribute("aria-pressed", "true");

  // Send moves on while a question is still owed, and sends after the last.
  const send = card.locator(".qsend");
  await expect(send).toHaveText("Next");
  await send.click();
  await expect(card.locator(".qt")).toHaveText("Title size?");
  await card.locator(".opt", { hasText: "Big" }).click();
  await expect(send).toHaveText("Send");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await send.click();
  expect((await reply).status()).toBe(201);
  await expect(page.locator(".sentrow .pill")).toHaveText("Sent · Not seen yet");

  await page.locator(".vlabel").click();
  await page.getByRole("tab", { name: "Thread" }).click();
  const sent = page.locator(".trow.you");
  await expect(sent).toHaveCount(1);
  await expect(sent).toContainText("Sent · look quiet");
  await expect(sent.locator(".tdelivered")).toHaveText("✓Not seen yet");

  await page.goto(`${server.url}/project/e2e`);
  await expect(page.locator('.home-step[data-mock="card"]')).toHaveCount(1);
  await expect(page.locator(".home-lead")).toContainText("0 open");
});

test("the agent's pending.viewerOpen follows the mock on screen", async ({ page, server }) => {
  const mockId = await seed(server.url);
  const viewerOpen = async () =>
    (await (await fetch(`${server.url}/api/mocks/${mockId}`)).json()).pending.viewerOpen;

  await page.goto(`${server.url}/project/e2e`);
  const row = page.locator('.home-step[data-mock="card"]').first();
  await expect(row).toBeVisible();
  expect(await viewerOpen()).toBe(false);

  await row.click();
  await expect(page.locator(".flowbar .num")).toHaveText("1 of 2");
  await expect.poll(viewerOpen).toBe(true);

  // Back to Home in the same tab: the feed stays up, but no longer names the mock.
  await page.goBack();
  await expect(row).toBeVisible();
  await expect.poll(viewerOpen).toBe(false);
});
