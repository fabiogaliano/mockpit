// End-to-end proof of the `hideBrand` host flag: an embedder that supplies its own
// branding can suppress the engine's "mockpit" wordmark. With the flag off
// (self-hosted default) the wordmark renders as before, so parity holds.
import { expect, fixedRouter, mountEmbed, publishItem, test } from "./fixtures.ts";

const host = (hideBrand: boolean) => `{
  basePath: "",
  hideBrand: ${hideBrand},
  router: ${fixedRouter({ project: null, slug: null })},
}`;

test("hideBrand: true suppresses the engine wordmark", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    agent: "e2e",
  });
  await mountEmbed(page, server.url, { host: host(true), path: "/__embedtest-brand-off" });

  await expect(page.locator("aside.ss-side")).toBeVisible();
  await expect(page.locator(".ss-brand")).toHaveCount(0);
});

test("hideBrand off (self-hosted default): the wordmark renders", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    agent: "e2e",
  });
  await mountEmbed(page, server.url, { host: host(false), path: "/__embedtest-brand-on" });

  await expect(page.locator("aside .ss-brand")).toBeVisible();
});
