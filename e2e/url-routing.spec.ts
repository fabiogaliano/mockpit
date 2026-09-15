import { expect, itemPath, publish, publishItem, test } from "./fixtures.ts";

// Navigation is project › item › variant › version, and every step of it is
// addressable: the item lives in the path, the variant and the browsed version
// in the query, so a copied link restores exactly what was on screen.

test("the workspace root opens the most recent project and its first item", async ({
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

  await page.goto(server.url);

  // "/" never lands on a chooser: it resolves to the live edge of the workspace.
  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site", "hero")}$`));
  await expect(page.locator(".ss-head h1")).toHaveText("Hero");
});

test("clicking a project switches the items column and the item screen", async ({
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
  await publishItem(server.url, {
    project: "loom",
    slug: "sidebar",
    title: "Sidebar",
    html: "<p>sidebar</p>",
    agent: "designer",
  });

  await page.goto(server.url);
  await expect(page.locator(".ss-proj")).toHaveCount(2);

  await page.locator(".ss-proj", { hasText: "acme/site" }).click();
  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site", "hero")}$`));
  await expect(page.locator(".ss-items h1")).toHaveText("acme/site");
  await expect(page.locator(".ss-head h1")).toHaveText("Hero");
});

test("clicking an item row writes /project/:name/:slug", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>hero</p>",
    agent: "designer",
  });
  await publishItem(server.url, {
    project: "acme/site",
    slug: "faq",
    title: "FAQ",
    html: "<p>faq</p>",
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site")}`);
  await page.locator(".ss-item-row", { hasText: "FAQ" }).click();

  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site", "faq")}$`));
  await expect(page.locator(".ss-head h1")).toHaveText("FAQ");
});

test("a variant tab and a history entry are addressable in the query", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "pricing-card",
    variant: "quiet",
    title: "Pricing card",
    html: "<p>quiet</p>",
    agent: "designer",
  });
  await publishItem(server.url, {
    project: "acme/site",
    slug: "pricing-card",
    variant: "loud",
    title: "Pricing card",
    html: "<p>loud v1</p>",
    agent: "designer",
  });
  await publishItem(server.url, {
    project: "acme/site",
    slug: "pricing-card",
    variant: "loud",
    html: "<p>loud v2</p>",
    prompt: "you: bigger",
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site", "pricing-card")}`);

  // Picking a variant keys the URL to it, so the tab survives a copy/paste.
  await page.locator(".ss-tabs:not(.ss-vp) button", { hasText: "quiet" }).click();
  await expect(page).toHaveURL(/[?&]variant=quiet/);

  await page.locator(".ss-tabs:not(.ss-vp) button", { hasText: "loud" }).click();
  await expect(page).toHaveURL(/[?&]variant=loud/);

  // Browsing history pins the version as well, and the stage says which one.
  await page.locator('.ss-h:has(.th:text-is("v1"))').click();
  await expect(page).toHaveURL(/[?&]v=1/);
  await expect(page.locator(".ss-badge")).toContainText("viewing v1");

  // A reload restores that exact view from the URL alone.
  await page.reload();
  await expect(page.locator(".ss-badge")).toContainText("viewing v1");
  await expect(page.locator(".ss-tabs:not(.ss-vp) button.on")).toHaveText("loud");
});

test("a deep link to /project/:name/:slug renders the item directly", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<h2>Hero body</h2>",
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);

  await expect(page).toHaveTitle("acme/site");
  await expect(page.locator(".ss-head h1")).toHaveText("Hero");
  await expect(page.frameLocator(".ss-stagewrap iframe").locator("h2")).toHaveText("Hero body");
});

// The pre-reshape permalinks stay alive: they resolve onto the item screen
// instead of a session stream that no longer exists.
test("/session/:id resolves to the session's item screen", async ({ page, server }) => {
  const post = await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>hero</p>",
    agent: "designer",
  });

  await page.goto(`${server.url}/session/${post.sessionId}`);

  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site", "hero")}`));
  await expect(page.locator(".ss-head h1")).toHaveText("Hero");
});

test("/session/:id/p/:postId resolves to that post's item and variant", async ({
  page,
  server,
}) => {
  const quiet = await publishItem(server.url, {
    project: "acme/site",
    slug: "pricing-card",
    variant: "quiet",
    title: "Pricing card",
    html: "<p>quiet</p>",
    agent: "designer",
  });
  await publishItem(server.url, {
    project: "acme/site",
    slug: "pricing-card",
    variant: "loud",
    title: "Pricing card",
    html: "<p>loud</p>",
    session: quiet.sessionId,
  });

  await page.goto(`${server.url}/session/${quiet.sessionId}/p/${quiet.id}`);

  await expect(page).toHaveURL(/variant=quiet/);
  await expect(page.locator(".ss-head h1")).toHaveText("Pricing card");
  await expect(page.locator(".ss-tabs:not(.ss-vp) button.on")).toHaveText("quiet");
});

test("browser back/forward navigates between items", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>hero</p>",
    agent: "designer",
  });
  await publishItem(server.url, {
    project: "acme/site",
    slug: "faq",
    title: "FAQ",
    html: "<p>faq</p>",
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site")}`);
  await page.locator(".ss-item-row", { hasText: "Hero" }).click();
  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site", "hero")}$`));
  await page.locator(".ss-item-row", { hasText: "FAQ" }).click();
  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site", "faq")}$`));

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site", "hero")}$`));
  await expect(page.locator(".ss-head h1")).toHaveText("Hero");

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site", "faq")}$`));
  await expect(page.locator(".ss-head h1")).toHaveText("FAQ");
});

// On a phone the items list is a screen of its own: the item screen covers it
// and its back link returns, and the drawer's wordmark goes back to projects.
test("at phone width the item screen has a back link to the item list", async ({
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
  await page.setViewportSize({ width: 393, height: 852 });

  await page.goto(`${server.url}${itemPath("acme/site")}`);
  await expect(page.locator(".ss-item-row")).toBeVisible();

  await page.locator(".ss-item-row", { hasText: "Hero" }).click();
  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site", "hero")}$`));
  await expect(page.locator(".ss-item .ss-mtop h1")).toHaveText("Hero");

  await page.locator(".ss-item .ss-mtop .back").click();
  await expect(page).toHaveURL(new RegExp(`${itemPath("acme/site")}$`));
  await expect(page.locator(".ss-item-row")).toBeVisible();

  // The projects drawer is the way up from the item list.
  await page.locator("button.m", { hasText: "projects" }).click();
  await expect(page.locator(".ss-side .ss-proj")).toBeVisible();
});

test("/s/:id bare surface route shows the standalone full-page surface", async ({
  page,
  server,
}) => {
  const s = await publish(server.url, { html: "<h2>Standalone</h2>", title: "Solo" });
  await page.goto(`${server.url}/s/${s.id}`);

  // A bare direct link is the full-page standalone view: just that one post, no
  // navigation chrome, with a sideshow watermark beneath.
  await expect(page.locator("#standalone")).toHaveCount(1);
  await expect(page.locator(".ss-side")).toHaveCount(0);
  await expect(page.locator("#standalone .card[data-id]")).toHaveCount(1);
  await expect(page.locator(`.card[data-id="${s.id}"] .card-title`)).toHaveText("Solo");
  // No comment thread chrome in standalone mode.
  await expect(page.locator(".card .thread")).toHaveCount(0);
  await expect(page.locator(".standalone-foot a")).toHaveAttribute("href", "https://sideshow.sh");

  // It stays on the canonical share URL — it does not rewrite into the item
  // screen the way a session permalink does.
  await expect(page).toHaveURL(new RegExp(`/s/${s.id}$`));

  // The authored HTML is still rendered only inside the sandboxed part iframe.
  await expect(page.frameLocator(`.card[data-id="${s.id}"] iframe`).locator("h2")).toHaveText(
    "Standalone",
  );
});

test("/p/:id canonical post route shows the standalone full-page surface", async ({
  page,
  server,
}) => {
  // The canonical link shape agents hand out (publish_post, the CLI, copy-link).
  // Regression guard: in 0.11.0 the server resolved /p/:id but the viewer's
  // router didn't parse it, so the link landed on the workspace instead of the post.
  const s = await publish(server.url, { html: "<h2>Canonical</h2>", title: "Perma" });
  await page.goto(`${server.url}/p/${s.id}`);

  await expect(page.locator("#standalone")).toHaveCount(1);
  await expect(page.locator(".ss-side")).toHaveCount(0);
  await expect(page.locator(`.card[data-id="${s.id}"] .card-title`)).toHaveText("Perma");
  await expect(page).toHaveURL(new RegExp(`/p/${s.id}$`));
  await expect(page.frameLocator(`.card[data-id="${s.id}"] iframe`).locator("h2")).toHaveText(
    "Canonical",
  );
});

test("the standalone share page title uses the shared post title", async ({ page, server }) => {
  const post = await publish(server.url, {
    html: "<p>one</p>",
    title: "First post",
    agent: "a1",
    sessionTitle: "Auth refactor",
  });

  await page.goto(`${server.url}/p/${post.id}`);
  await expect(page).toHaveTitle("First post");

  // Another agent publishing elsewhere must not retitle this page.
  await publish(server.url, { html: "<p>two</p>", title: "Other work", agent: "a2" });
  await page.waitForTimeout(300);
  await expect(page).toHaveTitle("First post");
});
