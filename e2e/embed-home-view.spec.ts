// End-to-end browser proof of the `homeView` host flag. An embedder that renders
// its own landing for a project-less route needs the engine NOT to auto-pick a
// project: it stays on the projects list with nothing selected, so nothing is
// highlighted behind the host's landing. With the flag OFF (the self-hosted
// default) "/" resolves to the most recent project and its first item, exactly
// as before — that parity is the second test.
import {
  expect,
  fixedRouter,
  itemPath,
  mountEmbed,
  navigatingRouter,
  publishItem,
  test,
} from "./fixtures.ts";

const host = (homeView: boolean) => `{
  basePath: "",
  homeView: ${homeView},
  router: ${fixedRouter({ project: null, slug: null })},
}`;

test("homeView: a project-less route lands with NO project selected", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>hero</p>",
    agent: "designer",
  });

  await mountEmbed(page, server.url, { host: host(true), path: "/__embedtest-home-on" });

  // The project loads into the sidebar…
  await expect(page.locator(".ss-proj")).toHaveCount(1);
  // …but none is selected, and the engine never opened an item behind the
  // host's own landing.
  await expect(page.locator(".ss-proj.on")).toHaveCount(0);
  await expect(page.locator(".ss-items")).toHaveCount(0);
  await expect(page.locator(".ss-item")).toHaveCount(0);
});

test("homeView OFF (self-hosted default): a project-less route opens the recent project", async ({
  page,
  server,
}) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>hero</p>",
    agent: "designer",
  });

  // The default host owns the URL, so this one records where the engine asked
  // to go instead of navigating for real.
  await mountEmbed(page, server.url, {
    path: "/__embedtest-home-off",
    host: `{
      basePath: "",
      homeView: false,
      router: ${navigatingRouter({ project: null, slug: null })},
    }`,
  });

  await expect.poll(() => page.evaluate(() => window.__navigated?.project)).toBe("acme/site");
  await expect(page.locator(".ss-proj.on")).toHaveCount(1);
  await expect(page.locator(".ss-head h1")).toHaveText("Hero");
  await expect(page).toHaveURL(new RegExp("/__embedtest-home-off$"));
  // Parity check on the shape the engine asked for: the item route, not a path.
  expect(await page.evaluate(() => window.__navigated?.slug)).toBe("hero");
  expect(itemPath("acme/site", "hero")).toContain("hero");
});

declare global {
  interface Window {
    __route?: Record<string, unknown>;
    __navigated?: { project?: string | null; slug?: string | null };
    __subs?: ((route: unknown) => void)[];
  }
}
