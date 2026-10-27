import { agentCall, expect, startMockpitServer, test } from "./fixtures.ts";

// Designing from a phone: a tap on a part, one more on 👍, and the Send
// carries it to the agent; and the viewer is installable to a home screen.

const page1 = `<style>body{margin:0;font:16px system-ui}</style>
<header data-part="hero" data-part-label="Hero" style="padding:60px 24px;background:#eef">Hero</header>
<section data-part="body" style="padding:24px;height:600px">Body</section>`;

async function seed(server: string) {
  const out = await agentCall<{ sessionId: string }>(server, "/api/mocks", {
    project: "go",
    mock: "landing",
    title: "Landing",
    agent: "e2e",
    html: page1,
  });
  return out.sessionId;
}

test("tap a part, 👍, Send: the agent's feedback has the reaction", async ({ page, server }) => {
  const session = await seed(server.url);
  await page.goto(`${server.url}/project/go/landing`);
  const overlay = page.locator(".frame.on .overlay[data-doc-width]");
  await expect(overlay).toBeVisible();

  const box = (await overlay.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 20);
  const bar = page.locator('.part-reactions[data-reactions="hero"]');
  await expect(bar).toBeVisible();
  const like = bar.locator('[data-reaction="up"]');
  // A finger-sized target, and a toggle that says it is on.
  const size = (await like.boundingBox())!;
  expect(size.width).toBeGreaterThanOrEqual(44);
  expect(size.height).toBeGreaterThanOrEqual(44);
  await like.tap();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[role="status"]', { hasText: "Liked Hero" })).toHaveCount(1);

  // No asks on a single look: New sends the verdict, with the reaction in it.
  await page.getByRole("button", { name: "New version" }).tap();
  await page.locator(".vlabel").tap();
  await page.getByRole("tab", { name: "Thread" }).tap();
  await expect(page.locator(".trow.you")).toBeVisible();

  const { feedback } = await agentCall<{ feedback: { reply: { reactions?: string[] } }[] }>(
    server.url,
    `/api/feedback?session=${session}`,
  );
  expect(feedback).toHaveLength(1);
  expect(feedback[0].reply.reactions).toEqual(['👍 part "hero"']);
});

test("?key= signs in, then leaves the address bar", async ({ page }) => {
  const tokened = await startMockpitServer({ MOCKPIT_TOKEN: "s3cret" });
  try {
    await page.goto(`${tokened.url}/?key=s3cret`);
    // The cookie carries on: the empty workspace loads, which needs auth.
    await expect(page.locator(".home-empty")).toBeVisible();
    expect(new URL(page.url()).searchParams.has("key")).toBe(false);
  } finally {
    tokened.stop();
  }
});

test("the viewer is installable: manifest, icons and Apple tags", async ({ page, server }) => {
  await seed(server.url);
  await page.goto(`${server.url}/project/go/landing`);
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  const manifest = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: "include" });
    return { type: res.headers.get("content-type"), body: await res.json() };
  }, href!);
  expect(manifest.type).toMatch(/application\/manifest\+json/);
  expect(manifest.body.display).toBe("standalone");
  for (const icon of manifest.body.icons as { src: string; type: string }[]) {
    const res = await page.request.get(new URL(icon.src, `${server.url}/`).toString());
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe(icon.type);
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect((await page.request.get(`${server.url}${touch}`)).status()).toBe(200);
});
