// End-to-end browser proof that an embedder can take over the engine's MAIN
// content pane through the shadow boundary via the `ss:main` slot — the seam the
// sideshow cloud uses to render its full-page "Settings" view in the main area
// while the engine's navigation columns stay put.
import { expect, itemPath, mountEmbed, navigatingRouter, publishItem, test } from "./fixtures.ts";

test("embedded engine: ss:main slot takes over the main pane while the sidebar stays", async ({
  page,
  server,
}) => {
  const post = await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>board card</p>",
    agent: "designer",
  });

  await mountEmbed(page, server.url, {
    body: `<div slot="ss:main" id="hostMain"><h2>Host settings pane</h2></div>`,
    host: `{ basePath: "", router: ${navigatingRouter({ sessionId: post.sessionId })} }`,
  });

  // The host's light-DOM pane projects into the main slot and is visible.
  const hostMain = page.locator("#hostMain");
  await expect(hostMain).toBeVisible();
  await expect(page.locator("main slot[name='ss:main']")).toHaveCount(1);

  // The navigation stays — the override is the main pane only, not the viewport.
  await expect(page.locator("aside.ss-side")).toBeVisible();
  await expect(page.locator(".ss-proj")).toHaveCount(1);

  // The engine's own item screen is replaced: with a child assigned to ss:main
  // the slot's fallback stays in the DOM — native <slot> mechanics — but is not
  // displayed, so the host pane is what the user sees.
  await expect(page.locator(".ss-item")).toBeHidden();
});

test("embedded engine: the phone drawer opens the projects sidebar", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Embedded mobile",
    html: "<p>embedded mobile card</p>",
    agent: "designer",
  });

  await page.setViewportSize({ width: 393, height: 852 });
  await mountEmbed(page, server.url, {
    path: "/__embedtest-mobile",
    host: `{ basePath: "", router: ${navigatingRouter({ project: "acme/site", slug: null })} }`,
  });

  // Phone layout: the items list is the screen, the sidebar is off-canvas.
  await expect(page.locator(".ss-item-row")).toBeVisible();
  await expect(page.locator("aside.ss-side")).not.toBeInViewport();

  await page.locator("button.m", { hasText: "projects" }).click();
  await expect(page.locator("aside.ss-side")).toBeInViewport();
  expect(itemPath("acme/site")).toContain("acme");
});

declare global {
  interface Window {
    __route?: Record<string, unknown>;
    __navigated?: Record<string, unknown>;
    __subs?: ((route: unknown) => void)[];
  }
}
