import {
  expect,
  expectNoHorizontalOverflow,
  frameHeight,
  itemPath,
  publish,
  publishItem,
  stage,
  test,
  update,
} from "./fixtures.ts";

test("the sidebar lists projects with their item and waiting counts", async ({ page, server }) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>hero</p>",
    agent: "designer",
  });
  const faq = await publishItem(server.url, {
    project: "acme/site",
    slug: "faq",
    title: "FAQ",
    html: "<p>faq</p>",
    agent: "designer",
  });
  await publishItem(server.url, {
    project: "loom",
    slug: "sidebar",
    title: "Sidebar",
    html: "<p>sidebar</p>",
    agent: "designer",
  });
  // An ask is what marks a project (and its item) as waiting on the operator.
  await fetch(`${server.url}/api/posts/${faq.id}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Which spacing?" }),
  });

  await page.goto(server.url);

  const projects = page.locator(".ss-proj");
  await expect(projects).toHaveCount(2);
  await expect(projects.filter({ hasText: "acme/site" })).toContainText("2 items");
  await expect(projects.filter({ hasText: "acme/site" })).toContainText("1 waiting");
  await expect(projects.filter({ hasText: "loom" })).toContainText("1 item");
  // The open project is the selected one.
  await expect(page.locator(".ss-proj.on")).toHaveCount(1);
});

test("the items column separates pages from components and marks what waits on you", async ({
  page,
  server,
}) => {
  const card = await publishItem(server.url, {
    project: "acme/site",
    slug: "pricing-card",
    title: "Pricing card",
    html: "<p>card</p>",
    agent: "designer",
  });
  await publishItem(server.url, {
    project: "acme/site",
    slug: "pricing-page",
    kind: "page",
    title: "Pricing page",
    html: "<p>page</p>",
    session: card.sessionId,
  });
  await fetch(`${server.url}/api/posts/${card.id}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Accept or revise?" }),
  });

  await page.goto(`${server.url}${itemPath("acme/site")}`);

  await expect(page.locator(".ss-items .sec").first()).toHaveText("Pages");
  const rows = page.locator(".ss-item-row");
  await expect(rows.nth(0)).toContainText("Pricing page");
  await expect(rows.nth(1)).toContainText("Pricing card");
  // The waiting mark rides the item that asked.
  await expect(rows.nth(1).locator(".w")).toHaveAttribute("title", "waiting on you");
  await expect(rows.nth(0).locator(".w")).toHaveCount(0);
  // The item the agent is waiting on is the one the workspace opens.
  await expect(page.locator(".ss-head h1")).toHaveText("Pricing card");
});

test("a publish over HTTP reaches the open item screen live, no reload", async ({
  page,
  server,
}) => {
  const first = await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>v1</p>",
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);
  await expect(page.locator(".ss-h")).toHaveCount(1);
  await expect(page.locator(".livedot")).toHaveClass(/on/);

  // A new version of the open item…
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    html: "<p>v2</p>",
    prompt: "you: tighter",
    session: first.sessionId,
  });

  await expect(page.locator(".ss-head .m").first()).toContainText("v2");
  await expect(page.locator(".ss-h")).toHaveCount(2);
  await expect(page.locator(".ss-h.on .why")).toContainText("tighter");
  await expect(stage(page).locator("iframe")).toHaveAttribute("src", /ver=2/);

  // …and a brand new item shows up in the column without a reload.
  await publishItem(server.url, {
    project: "acme/site",
    slug: "faq",
    title: "FAQ",
    html: "<p>faq</p>",
    session: first.sessionId,
  });
  await expect(page.locator(".ss-item-row", { hasText: "FAQ" })).toBeVisible();
});

test("a burst of live publishes coalesces into a bounded number of reloads", async ({
  page,
  server,
}) => {
  const first = await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>v1</p>",
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);
  await expect(page.locator(".ss-h")).toHaveCount(1);
  await expect(page.locator(".livedot")).toHaveClass(/on/);

  let itemReads = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.includes("/items/")) itemReads++;
  });

  // Ten writes land in one window; the viewer refetches on a debounce rather
  // than once per event, and still converges on the true state.
  for (let i = 2; i <= 11; i++) {
    await publishItem(server.url, {
      project: "acme/site",
      slug: "hero",
      html: `<p>v${i}</p>`,
      prompt: `you: pass ${i}`,
      session: first.sessionId,
    });
  }

  await expect(page.locator(".ss-head .m").first()).toContainText("v11");
  await expect(page.locator(".ss-h")).toHaveCount(11);
  await page.waitForTimeout(400);
  expect(itemReads).toBeLessThan(10);
});

test("continuous live activity keeps refreshing the open item", async ({ page, server }) => {
  const first = await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>v1</p>",
    agent: "designer",
  });

  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);
  await expect(page.locator(".ss-h")).toHaveCount(1);
  await expect(page.locator(".livedot")).toHaveClass(/on/);

  // Writes spread over ~800 ms, well past the coalescing window: the screen
  // must update while the stream is still running, not only at its quiet edge.
  let published = 0;
  const writes = Array.from({ length: 12 }, (_, i) =>
    new Promise<void>((resolve) => setTimeout(resolve, i * 70)).then(async () => {
      await publishItem(server.url, {
        project: "acme/site",
        slug: "hero",
        html: `<p>v${i + 2}</p>`,
        session: first.sessionId,
      });
      published++;
    }),
  );

  await expect.poll(() => page.locator(".ss-h").count(), { timeout: 700 }).toBeGreaterThan(1);
  expect(published).toBeLessThan(12);

  await Promise.all(writes);
  await expect(page.locator(".ss-head .m").first()).toContainText("v13");
});

test("a surface kind this viewer doesn't know shows a refresh hint, not a broken diff", async ({
  page,
  server,
}) => {
  // Simulate a long-open tab that predates a newly shipped surface type: the
  // server returns a valid surface, but rewrite the surface kind to one THIS
  // viewer build has no Match for. It must degrade to a neutral hint, never
  // the diff fallback.
  await page.route(/\/api\/projects\/[^/]+\/items\/[^/?]+(\?|$)/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const variant of body.variants ?? []) {
      if (Array.isArray(variant.surfaces)) {
        variant.surfaces = variant.surfaces.map(() => ({ kind: "futurething" }));
      }
    }
    await route.fulfill({ response: res, json: body });
  });

  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>x</p>",
    agent: "designer",
  });
  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);

  await expect(stage(page).locator(".surface-unsupported")).toBeVisible();
  await expect(stage(page).locator(".diff-error")).toHaveCount(0);
});

test("opening an item shows a labelled skeleton while its detail loads", async ({
  page,
  server,
}) => {
  await publishItem(server.url, {
    project: "acme/site",
    slug: "hero",
    title: "Hero",
    html: "<p>slow</p>",
    agent: "designer",
  });

  await page.route(/\/api\/projects\/[^/]+\/items\/[^/?]+(\?|$)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto(`${server.url}${itemPath("acme/site", "hero")}`);

  // The list row already knows the title, so the loading screen is labelled.
  await expect(page.getByRole("status", { name: "Rendering" })).toBeVisible();
  await expect(stage(page).locator("iframe")).toBeVisible();
  await expect(page.getByRole("status", { name: "Rendering" })).toHaveCount(0);
});

test("opening an item reads one item detail, with no per-post fetches", async ({
  page,
  server,
}) => {
  const first = await publishItem(server.url, {
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
    html: "<p>loud</p>",
    session: first.sessionId,
  });

  const itemReads: string[] = [];
  const postDetailReads: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") return;
    const path = new URL(req.url()).pathname;
    if (path.includes("/items/")) itemReads.push(path);
    if (/^\/api\/posts\/[^/]+$/.test(path)) postDetailReads.push(path);
  });

  await page.goto(`${server.url}${itemPath("acme/site", "pricing-card")}`);
  await expect(page.locator(".ss-tabs:not(.ss-vp) button")).toHaveCount(2);

  // One read carries every variant, its surfaces and its history metadata.
  expect(itemReads).toHaveLength(1);
  expect(postDetailReads).toEqual([]);
});

test("a new version re-keys the stage frame and extends the history rail", async ({
  page,
  server,
}) => {
  const post = await publish(server.url, {
    html: "<p>v1</p>",
    title: "Versioned",
    agent: "e2e",
  });

  await page.goto(server.url);
  const frame = stage(page).locator("iframe");
  await expect(frame).toHaveAttribute("src", /ver=1/);
  await expect(page.locator(".ss-h")).toHaveCount(1);

  await update(server.url, post.id, { html: "<p>v2</p>", title: "Versioned v2" });

  await expect(page.locator(".ss-head h1")).toHaveText("Versioned v2");
  await expect(frame).toHaveAttribute("src", /ver=2/);
  const rows = page.locator(".ss-h .th");
  await expect(rows).toHaveText(["v2", "v1"]);
});

test("resize bridge grows the iframe beyond its 120px default", async ({ page, server }) => {
  const tall = `<div style="height: 600px">tall content</div>`;
  await publish(server.url, { html: tall, title: "Tall", agent: "e2e" });

  await page.goto(server.url);
  const iframe = stage(page).locator("iframe");
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute("loading", "lazy");
  // the sandboxed bridge must report content height via postMessage; this is
  // the WebKit-quirk regression test (see CLAUDE.md). The stage scales the frame
  // to fit, so read the layout height rather than the scaled bounding box.
  await expect.poll(() => frameHeight(iframe), { timeout: 15_000 }).toBeGreaterThan(300);
});

test("a comment typed in the item thread round-trips to the API", async ({ page, server }) => {
  const post = await publish(server.url, { html: "<p>v1</p>", title: "Doc", agent: "e2e" });

  await page.goto(server.url);
  await page.locator(".ss-compose textarea").fill("ship it");
  await page.locator(".ss-acts button", { hasText: "Add" }).click();

  // It renders in the thread as escaped Solid text nodes and is persisted.
  await expect(page.locator(".ss-cmt.user")).toContainText("ship it");
  await expect(page.locator(".ss-cmt.user b")).toHaveText("you");
  await expect
    .poll(async () => {
      const res = await fetch(`${server.url}/api/comments?surface=${post.id}&includeDrafts=1`);
      const data = (await res.json()) as { comments: { text: string }[] };
      return data.comments.map((c) => c.text);
    })
    .toContain("ship it");
});

test("a failed comment send restores the text instead of losing the message", async ({
  page,
  server,
}) => {
  await publish(server.url, { html: "<p>x</p>", title: "Doc", agent: "e2e" });

  await page.goto(server.url);
  await expect(stage(page).locator("iframe")).toBeVisible();
  await page.route("**/api/comments", (route) =>
    route.request().method() === "POST" ? route.abort() : route.fallback(),
  );

  const box = page.locator(".ss-compose textarea");
  await box.fill("important feedback");
  await page.locator(".ss-acts button", { hasText: "Add" }).click();

  await expect(page.locator("#toast")).toContainText("Couldn't post");
  await expect(box).toHaveValue("important feedback");
  await expect(page.locator(".ss-cmt")).toHaveCount(0);

  // and once the network is back, the same send goes through
  await page.unroute("**/api/comments");
  await page.locator(".ss-acts button", { hasText: "Add" }).click();
  await expect(page.locator(".ss-cmt.user")).toContainText("important feedback");
});

test("a comment echoes immediately, before the POST confirms it", async ({ page, server }) => {
  await publish(server.url, { html: "<p>x</p>", title: "Doc", agent: "e2e" });

  await page.goto(server.url);
  await expect(stage(page).locator("iframe")).toBeVisible();
  // hold the POST open so only the optimistic echo can render
  await page.route("**/api/comments", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });

  await page.locator(".ss-compose textarea").fill("instant echo");
  await page.locator(".ss-acts button", { hasText: "Add" }).click();

  const comment = page.locator(".ss-cmt.user");
  await expect(comment).toContainText("instant echo");
  // settles into a confirmed comment, still exactly one copy
  await expect(comment.locator(".ss-state")).toContainText("draft", { timeout: 10_000 });
  await expect(page.locator(".ss-cmt")).toHaveCount(1);
});

test("a comment containing raw HTML is escaped, never a live node", async ({ page, server }) => {
  await publish(server.url, { html: "<p>x</p>", title: "Doc", agent: "e2e" });

  await page.goto(server.url);
  await page.locator(".ss-compose textarea").fill("<img src=x onerror=alert(1)> hi");
  await page.locator(".ss-acts button", { hasText: "Add" }).click();

  // the comment renders as Solid text nodes — the raw HTML is escaped to text,
  // never a live <img> (escapes by construction; no iframe needed for plain data)
  const comment = page.locator(".ss-cmt.user");
  await expect(comment).toContainText("<img src=x onerror=alert(1)> hi");
  await expect(comment.locator("img")).toHaveCount(0);
});

test("the item screen fits an iPhone 14 Pro viewport", async ({ page, server }) => {
  await publish(server.url, {
    html: '<div style="height:400px">phone body</div>',
    title: "Mobile",
    agent: "e2e",
  });

  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(server.url);

  // On a phone the item list is a screen of its own, so open the item first.
  await page.locator(".ss-item-row", { hasText: "Mobile" }).click();
  await expect(page.locator(".ss-item")).toBeVisible();
  // The phone screen is the item, with its own top bar; the columns are off.
  await expect(page.locator(".ss-item .ss-mtop h1")).toHaveText("Mobile");
  await expect(page.locator(".ss-side")).not.toBeInViewport();
  await expect(stage(page).locator("iframe")).toBeVisible();

  await expectNoHorizontalOverflow(page, "main");
  await expectNoHorizontalOverflow(page, ".ss-item");
});

test("the Connect an agent page shows the add-mcp logo picker", async ({ page, server }) => {
  await page.goto(server.url);

  await page.getByRole("link", { name: "connect agent" }).click();
  await expect(page).toHaveURL(`${server.url}/connect`);
  await expect(page.getByRole("heading", { name: "Connect an agent" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Connect an agent" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Choose how to connect" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Most agents" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator(".connect-page")).toContainText(`npx add-mcp ${server.url}/mcp`);

  await page.getByRole("radio", { name: "Other" }).click();
  await expect(page.locator(".connect-page")).toContainText('"mcpServers"');
  await expect(page.locator(".connect-page")).toContainText(`${server.url}/mcp`);
});

test("the Connect an agent page is reachable directly when projects already exist", async ({
  page,
  server,
}) => {
  await publish(server.url, { html: "<p>connected</p>", title: "Existing", agent: "e2e" });

  await page.goto(`${server.url}/connect`);

  await expect(page).toHaveURL(`${server.url}/connect`);
  await expect(page.getByRole("heading", { name: "Connect an agent" })).toBeVisible();
  await expect(page.locator(".connect-page")).toContainText(`npx add-mcp ${server.url}/mcp`);
});
