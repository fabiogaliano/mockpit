// End-to-end browser proof for the `ss:aside-empty` slot — the empty-sidebar
// affordance shown in the projects list when no projects exist. The fallback is
// the engine's own "no projects yet" line; an embedder projects a
// `slot="ss:aside-empty"` child to replace it.
import { expect, fixedRouter, mountEmbed, publishItem, test } from "./fixtures.ts";

const host = `{ basePath: "", router: ${fixedRouter({ project: null, slug: null })} }`;

test.describe("embedded engine: ss:aside-empty slot", () => {
  test("the native empty line renders when nothing is projected and there are no projects", async ({
    page,
    server,
  }) => {
    await mountEmbed(page, server.url, { host });

    await expect(page.locator("aside.ss-side")).toBeVisible();
    const row = page.locator(".ss-projects .ss-small-empty");
    await expect(row).toBeVisible();
    await expect(row).toContainText("no projects yet");
    await expect(page.locator("aside slot[name='ss:aside-empty']")).toHaveCount(1);
  });

  test("projected content replaces the fallback through the shadow boundary", async ({
    page,
    server,
  }) => {
    await mountEmbed(page, server.url, {
      host,
      body: '<div slot="ss:aside-empty" id="hostEmpty">host empty nudge</div>',
    });

    const hostEmpty = page.locator("#hostEmpty");
    await expect(hostEmpty).toBeVisible();
    await expect(hostEmpty).toContainText("host empty nudge");

    // The engine's fallback is present in the DOM (native <slot> default
    // content) but not rendered — the projection is what the user sees.
    await expect(page.locator(".ss-projects .ss-small-empty")).toBeHidden();
  });

  test("neither fallback nor projection renders once a project exists", async ({
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

    await mountEmbed(page, server.url, { host, path: "/__embedtest-filled" });

    await expect(page.locator("aside .ss-proj")).toBeVisible();
    // The empty-sidebar affordance is gone entirely (the gating <Show> removes
    // the slot and its fallback when projects exist).
    await expect(page.locator(".ss-projects .ss-small-empty")).toHaveCount(0);
    await expect(page.locator("aside slot[name='ss:aside-empty']")).toHaveCount(0);
  });
});
