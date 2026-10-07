// End-to-end browser proof that an embedder can project content into the item
// header through the shadow boundary — the `ss:item-actions` region the mockpit
// cloud uses for its "Share" button, plus the DEPRECATED `ss:session-actions`
// name (the session header it used to mean is gone with the session screen; the
// engine still projects it into the item header so an older host keeps working).
import { expect, mountEmbed, navigatingRouter, publish, test } from "./fixtures.ts";

test("embedded engine: ss:item-actions projects host content into the item header", async ({
  page,
  server,
}) => {
  const post = await publish(
    server.url,
    { html: "<p>slot card</p>", title: "Slot card", agent: "e2e" },
    "",
  );

  await mountEmbed(page, server.url, {
    body: `<button slot="ss:item-actions" id="cloudShare">Share</button>`,
    host: `{ basePath: "", router: ${navigatingRouter({ sessionId: post.sessionId })} }`,
  });

  const head = page.locator(".ss-head");
  await expect(head).toBeVisible();
  await expect(head.locator("h1")).toHaveText("Slot card");

  // The host's light-DOM button projects into the item-actions slot, landing
  // inside the engine's header — and is the embedder's element, not the engine's.
  const share = page.locator("#cloudShare");
  await expect(share).toBeVisible();
  await expect(head.locator("slot[name='ss:item-actions']")).toHaveCount(1);
});

test("embedded engine: the retired ss:session-actions name still projects", async ({
  page,
  server,
}) => {
  const post = await publish(
    server.url,
    { html: "<p>slot card</p>", title: "Slot card", agent: "e2e" },
    "",
  );

  await mountEmbed(page, server.url, {
    path: "/__embedtest-legacy-slot",
    body: `<button slot="ss:session-actions" id="legacyShare">Share</button>`,
    host: `{ basePath: "", router: ${navigatingRouter({ sessionId: post.sessionId })} }`,
  });

  const head = page.locator(".ss-head");
  await expect(page.locator("#legacyShare")).toBeVisible();
  await expect(head.locator("slot[name='ss:session-actions']")).toHaveCount(1);
});

declare global {
  interface Window {
    __route?: Record<string, unknown>;
    __navigated?: Record<string, unknown>;
    __subs?: ((route: unknown) => void)[];
  }
}
