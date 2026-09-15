// End-to-end browser proof for the `ss:aside-head` slot — the host-overridable
// region at the top of the sidebar, above the projects list. Empty by default
// (self-hosted shows nothing here); an embedder projects a `slot="ss:aside-head"`
// child to render its own sidebar header.
import { expect, fixedRouter, mountEmbed, publishItem, test } from "./fixtures.ts";

const host = `{ basePath: "", router: ${fixedRouter({ project: null, slug: null })} }`;

test.describe("embedded engine: ss:aside-head slot", () => {
  test("nothing is injected when no header is projected (self-hosted parity)", async ({
    page,
    server,
  }) => {
    await mountEmbed(page, server.url, { host });

    // The sidebar renders normally, with the Brand wordmark.
    await expect(page.locator("aside.ss-side")).toBeVisible();
    await expect(page.locator("aside .ss-brand")).toBeVisible();

    // The slot is mounted (so an embedder can project into it) but it carries no
    // fallback children — nothing is shown above the projects list by default.
    await expect(page.locator("aside slot[name='ss:aside-head']")).toHaveCount(1);
    await expect(page.locator("#hostHead")).toHaveCount(0);
  });

  test("projected header renders above the projects list through the shadow boundary", async ({
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
    await mountEmbed(page, server.url, {
      host,
      body: '<div slot="ss:aside-head" id="hostHead">host header</div>',
    });

    const hostHead = page.locator("#hostHead");
    await expect(hostHead).toBeVisible();
    await expect(hostHead).toContainText("host header");

    // It sits ABOVE the projects list — its top edge is above the list's top.
    const headBox = await hostHead.boundingBox();
    const listBox = await page.locator("aside .ss-projects").boundingBox();
    expect(headBox).not.toBeNull();
    expect(listBox).not.toBeNull();
    expect(headBox!.y).toBeLessThan(listBox!.y);
  });
});
