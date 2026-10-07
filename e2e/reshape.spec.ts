// The reshape's own loop, end to end in the browser: comments queue as drafts
// until Revise releases them, Accept decides a variant and archives its
// siblings, markers put `@n` refs on the render, the viewport presets change
// what was reviewed, and the connection states stay honest.
import { expect, itemPath, publishItem, seedDemo, stage, test } from "./fixtures.ts";

const TALL = '<div style="height:500px;padding:20px">pricing body</div>';

async function seedVariants(serverUrl: string) {
  const quiet = await publishItem(serverUrl, {
    project: "acme/site",
    slug: "pricing-card",
    variant: "quiet",
    title: "Pricing card",
    html: TALL,
    agent: "designer",
    prompt: "initial exploration",
  });
  await publishItem(serverUrl, {
    project: "acme/site",
    slug: "pricing-card",
    variant: "loud",
    html: TALL,
    session: quiet.sessionId,
    prompt: "initial exploration",
  });
  return quiet;
}

test("a comment queues as a draft and Revise releases it to the agent", async ({
  page,
  server,
}) => {
  const post = await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: TALL,
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);

  await page.locator(".ss-compose textarea").fill("tighten the spacing");
  await page.locator(".ss-acts button", { hasText: "Add" }).click();

  // Queued, not delivered: the thread says so and Revise counts it.
  // The decision row is a user comment too, so scope to the first (the draft).
  const comment = page.locator(".ss-cmt.user").first();
  await expect(comment.locator(".ss-state")).toContainText("draft · sends with Revise");
  await expect(page.locator(".ss-acts button", { hasText: "Revise" })).toContainText("(1)");
  const beforeRevise = await (
    await fetch(`${server.url}/api/comments?surface=${post.id}&author=user`)
  ).json();
  expect(beforeRevise.comments ?? beforeRevise).toEqual([]);

  await page.locator(".ss-acts button", { hasText: "Revise" }).click();

  // Released in one request: the draft becomes a sent comment and the decision
  // is recorded in the thread.
  await expect(comment.locator(".ss-state")).not.toContainText("draft");
  await expect(page.locator(".ss-cmt", { hasText: "sent the drafts above" })).toBeVisible();
  await expect
    .poll(async () => {
      const res = await fetch(`${server.url}/api/comments?surface=${post.id}&author=user`);
      const body = (await res.json()) as { comments?: { text: string }[] } & {
        text?: string;
      }[];
      const rows = Array.isArray(body) ? body : (body.comments ?? []);
      return JSON.stringify(rows);
    })
    .toContain("tighten the spacing");
});

test("Accept decides the variant and archives its siblings", async ({ page, server }) => {
  await seedVariants(server.url);

  await page.goto(`${server.url}${itemPath("acme/site", "pricing-card")}?variant=quiet`);
  await expect(page.locator(".ss-tabs:not(.ss-vp) button")).toHaveCount(2);

  await page.locator(".ss-decide button", { hasText: "Accept" }).click();

  // One variant left, so the tabs collapse and the bar says which one was
  // picked; the sibling is behind the archived line.
  await expect(page.locator(".ss-tabs:not(.ss-vp)")).toHaveCount(0);
  await expect(page.locator(".ss-picked")).toHaveText("picked quiet");
  const archived = page.locator(".ss-archived > .link");
  await expect(archived).toHaveText("archived (1)");

  // …and restorable from there.
  await archived.click();
  await page.locator(".ss-archived-row button", { hasText: "Restore" }).click();
  await expect(page.locator(".ss-tabs:not(.ss-vp) button")).toHaveCount(2);
});

test("marking the stage mints @1 / @2 refs and shows the agent payload as text", async ({
  page,
  server,
}) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: TALL,
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);
  await expect(stage(page).locator("iframe")).toBeVisible();

  await page.locator(".ss-markbtn").click();
  await expect(page.locator(".ss-markbtn")).toHaveAttribute("aria-pressed", "true");

  const overlay = page.locator(".ss-overlay");
  const box = (await overlay.boundingBox())!;

  // A tap is a pin…
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(page.locator(".ss-mk.pin")).toHaveCount(1);

  // …and a drag is a box. The gesture picks the shape; there is no tool to arm.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".ss-mk.rect")).toHaveCount(1);

  // Both refs are in the comment text and in the chips, in order.
  await expect(page.locator(".ss-compose textarea")).toHaveValue(/@1 @2/);
  await expect(page.locator(".ss-chip .n")).toHaveText(["1", "2"]);

  // The payload panel previews exactly what the agent will receive. The
  // hit-test reply (path/text) came from the sandbox, so it is rendered as one
  // text node — never markup.
  const payload = page.locator(".ss-payload");
  await expect(payload).toContainText('"anchors"');
  await expect(payload).toContainText('"@1"');
  await expect(payload).toContainText('"@2"');
  expect(await payload.locator("*").count()).toBe(1); // just the <b> label

  // Removing a ref from the text removes its marker, so the two can't disagree.
  await page.locator(".ss-compose textarea").fill("make it wider @1");
  await expect(page.locator(".ss-mk")).toHaveCount(1);
});

test("the viewport presets lay the stage out at phone, tablet and desktop", async ({
  page,
  server,
}) => {
  const post = await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: TALL,
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);
  const frame = page.locator(".ss-frame");
  await expect(frame).toHaveCSS("width", "1280px");

  await page.locator(".ss-vp button", { hasText: "phone" }).click();
  await expect(page.locator(".ss-vp button", { hasText: "phone" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(frame).toHaveCSS("width", "390px");

  await page.locator(".ss-vp button", { hasText: "tablet" }).click();
  await expect(frame).toHaveCSS("width", "820px");

  // The preset rides the comment, so the agent knows which layout was reviewed.
  await page.locator(".ss-compose textarea").fill("cramped here");
  await page.locator(".ss-acts button", { hasText: "Add" }).click();
  await expect(page.locator(".ss-cmt.user")).toContainText("cramped here");
  await expect
    .poll(async () => {
      const res = await fetch(`${server.url}/api/comments?surface=${post.id}&includeDrafts=1`);
      const body = (await res.json()) as { comments: { text: string; viewport: number }[] };
      return body.comments.find((c) => c.text === "cramped here")?.viewport ?? null;
    })
    .toBe(820);
});

test("an unreachable server shows the retry state over the last data", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: TALL,
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);
  await expect(page.locator(".ss-head h1")).toHaveText("Hero");

  // Every read now fails. The next live event refetches, that read fails, and
  // the banner comes up over the data that is already on screen.
  await page.route("**/api/projects**", (route) => route.abort());
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    html: TALL,
    prompt: "you: again",
  });
  await expect(page.locator(".ss-ban.err")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".ss-ban.err")).toContainText("Can’t reach mockpit");
  // The last loaded data stays on screen behind it, dimmed.
  await expect(page.locator(".ss-main-body.dim")).toBeVisible();
  await expect(page.locator(".ss-head h1")).toHaveText("Hero");

  // …and it recovers on its own once the reads succeed again.
  await page.unroute("**/api/projects**");
  await page.locator(".ss-ban.err a", { hasText: "retry now" }).click();
  await expect(page.locator(".ss-ban.err")).toHaveCount(0);
});

test("a dropped live stream shows the reconnecting bar, not an error", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: TALL,
    agent: "designer",
  });

  // The live stream never connects; reads still work, so this is a thin bar
  // rather than the full-screen offline state.
  await page.route("**/api/events**", (route) => route.abort());
  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);

  await expect(page.locator(".ss-ban.warn")).toBeVisible();
  await expect(page.locator(".ss-ban.warn")).toContainText("Live updates paused");
  await expect(page.locator(".ss-ban.err")).toHaveCount(0);
  // Writes still work while it reconnects, so the composer stays.
  await expect(page.locator(".ss-compose")).toBeVisible();
});

// The seeded demo workspace (`POST /api/demo/reshape`, what `mockpit demo`
// writes) is the shape the reshape was designed against: three projects, an item
// with three variants and a branched history, a page, a decided item, and an ask.
test("the demo seed renders the whole navigation", async ({ page, server }) => {
  const demo = await seedDemo(server.url);

  await page.goto(server.url);

  await expect(page.locator(".ss-proj")).toHaveCount(3);
  await expect(page.locator(".ss-proj.on")).toContainText(demo.project);
  // It opens on the item the agent is waiting on.
  await expect(page.locator(".ss-head h1")).toHaveText("Pricing card");
  await expect(page.locator(".ss-ask")).toContainText("Accept or revise?");
  await expect(page.locator(".ss-tabs:not(.ss-vp) button")).toHaveCount(3);
  await expect(page.locator(".ss-h")).toHaveCount(3);
  // The thread carries a delivered comment and an unsent draft with a marker.
  await expect(page.locator(".ss-cmt .ss-state.seen")).toBeVisible();
  await expect(page.locator(".ss-cmt", { hasText: "Make @1 wider" })).toBeVisible();

  // A decided item shows the accepted variant and its archived sibling.
  await page.locator(".ss-item-row", { hasText: "CTA button" }).click();
  await expect(page.locator(".ss-picked")).toHaveText("picked solid");
  await expect(page.locator(".ss-archived > .link")).toHaveText("archived (1)");

  // A page item lists the components it snapshotted.
  await page.locator(".ss-item-row", { hasText: "Pricing page" }).click();
  await expect(page.locator(".ss-head .m").first()).toContainText("page");
});
