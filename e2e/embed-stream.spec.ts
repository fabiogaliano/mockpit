// End-to-end browser proof of the DEPRECATED `layout: "stream"` host flag and of
// `readonly`, driven THROUGH THE HOST CONTRACT — not the self-hosted window
// globals. This is the path the mockpit cloud's shared-link guest view uses.
//
// "stream" named the mixed post stream the reshape removed. It is still
// accepted and now means "the item screen alone": no projects sidebar, no items
// column, with the item resolved from the route's session/post rather than the
// project reads a session-scoped workspace does not expose.
import { expect, fixedRouter, mountEmbed, publish, stage, test } from "./fixtures.ts";

test("embedded engine: host layout:'stream' renders the item screen alone, readonly hides writes", async ({
  page,
  server,
}) => {
  // The `server` fixture runs tokenless, so the engine's same-origin /api/*
  // reads are open — this test is about layout, not auth.
  const post = await publish(
    server.url,
    { html: "<p>embedded stream card</p>", title: "Embedded stream", agent: "e2e" },
    "",
  );

  await mountEmbed(page, server.url, {
    host: `{
      basePath: "",
      layout: "stream",
      readonly: true,
      router: ${fixedRouter({ sessionId: post.sessionId })},
    }`,
  });

  // The shared session's item renders inside the engine's shadow root.
  await expect(page.locator(".ss-item")).toBeVisible();
  await expect(page.locator(".ss-head h1")).toHaveText("Embedded stream");
  await expect(stage(page).locator("iframe")).toBeVisible();

  // layout:"stream" via the host → no navigation chrome at all.
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.locator(".ss-items")).toHaveCount(0);
  await expect(page.locator("#app.stream")).toHaveCount(1);

  // readonly:true via the host → write controls gone, reads kept.
  await expect(page.locator(".ss-compose")).toHaveCount(0);
  await expect(page.locator(".ss-decide")).toHaveCount(0);
  await expect(page.locator(".ss-fab")).toHaveCount(0);
  await expect(page.locator(".ss-h")).toHaveCount(1);
});
