// End-to-end proof of the Host contract's `onThemeChange` push: the engine TELLS
// the host its resolved palette (on mount, and on every live theme switch) so an
// embedder mirrors the colors onto its own chrome WITHOUT scraping computed
// styles across the shadow boundary. This is the path the mockpit cloud chrome
// uses to stay aligned with the viewer.
//
// Harness mirrors embed-stream.spec.ts: serve a tiny embed page + the built
// dist-embed bundle on the server's own origin so the engine's same-origin
// /api/* calls hit real data. The injected host stashes each pushed palette on
// `window.__tokens` so the test can assert what the engine sent.
import { expect, mountEmbed, navigatingRouter, publish, stage, test } from "./fixtures.ts";

test("embedded engine pushes the resolved palette to the host on mount and on theme switch", async ({
  page,
  server,
}) => {
  const post = await publish(
    server.url,
    { html: "<p>themed embed card</p>", title: "Themed embed", agent: "e2e" },
    "",
  );

  // Default (full) layout so the engine's theme picker (#themeSel) is present.
  // The host records every onThemeChange payload and a call count on window.
  await mountEmbed(page, server.url, {
    prelude: `<script>window.__themeCalls = 0;</script>`,
    host: `{
      basePath: "",
      router: ${navigatingRouter({ sessionId: post.sessionId })},
      onThemeChange(tokens, meta) { window.__themeCalls++; window.__tokens = tokens; window.__meta = meta; },
    }`,
  });
  await expect(stage(page).locator("iframe")).toBeVisible();

  // On mount the engine resolves + pushes the default (github) light palette.
  await expect.poll(() => page.evaluate(() => window.__tokens?.["--bg"])).toBe("#f6f8fa");
  await expect.poll(() => page.evaluate(() => window.__tokens?.["--accent"])).toBe("#0969da");
  const callsAfterMount = await page.evaluate(() => window.__themeCalls);
  expect(callsAfterMount).toBeGreaterThan(0);
  // The same push names the resolved theme + scheme behind those tokens, so a
  // host can reproduce them out-of-band via /s/:id?theme=&mode=.
  expect(await page.evaluate(() => window.__meta)).toEqual({ theme: "github", mode: "light" });

  // Switching the theme via the engine's own picker pushes the new palette —
  // no host-side scraping involved.
  await page.locator("#themeSel").selectOption("gruvbox");
  await expect.poll(() => page.evaluate(() => window.__tokens?.["--bg"])).toBe("#f9f5d7");
  await expect.poll(() => page.evaluate(() => window.__meta?.theme)).toBe("gruvbox");
  expect(await page.evaluate(() => window.__themeCalls)).toBeGreaterThan(callsAfterMount);
});

declare global {
  interface Window {
    __route?: Record<string, unknown>;
    __navigated?: Record<string, unknown>;
    __subs?: ((route: unknown) => void)[];
    __themeCalls: number;
    __tokens?: Record<string, string>;
    __meta?: { theme: string; mode: "light" | "dark" };
  }
}
