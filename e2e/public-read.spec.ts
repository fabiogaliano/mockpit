import { expect, publicReadTest as test, publish, stage, startMockpitServer } from "./fixtures.ts";

// A session-scoped public workspace exposes its posts but NOT the project/item
// reads (those are addressed by name, so they would let a shared link enumerate
// the whole workspace). The viewer therefore renders such a link in the
// item-screen-only "stream" layout, resolving the item from the session's posts.

async function postComment(
  serverUrl: string,
  token: string,
  body: { surface: string; text: string },
) {
  const res = await fetch(`${serverUrl}/api/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...body, author: "user" }),
  });
  if (!res.ok) throw new Error(`comment failed: ${res.status}`);
}

test("public read viewer globals are visible to the browser", async ({
  page,
  publicReadServer,
}) => {
  await page.goto(publicReadServer.url);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as Window & {
          __MOCKPIT_READONLY__?: boolean;
          __MOCKPIT_PUBLIC_READ__?: "session" | "full";
        };
        return { readonly: w.__MOCKPIT_READONLY__, mode: w.__MOCKPIT_PUBLIC_READ__ };
      }),
    )
    .toEqual({ readonly: true, mode: publicReadServer.mode });
});

test("readonly session-mode viewer loads without fetching the session or project lists", async ({
  page,
}) => {
  const token = "secret";
  const server = await startMockpitServer({
    MOCKPIT_TOKEN: token,
    MOCKPIT_PUBLIC_READ: "session",
  });
  try {
    const post = await publish(
      server.url,
      {
        html: "<p>session scoped</p>",
        title: "Session scoped",
        agent: "e2e",
        sessionTitle: "Auth refactor",
      },
      token,
    );
    const forbiddenReads: string[] = [];
    const eventUrls: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (req.method() !== "GET") return;
      // Neither the session list nor any project read is available here, so the
      // engine must not ask for them (each would answer 401 and blank the page).
      if (url.pathname === "/api/sessions" || url.pathname.startsWith("/api/projects")) {
        forbiddenReads.push(url.pathname);
      }
      if (url.pathname === "/api/events") eventUrls.push(req.url());
    });

    await page.goto(`${server.url}/session/${post.sessionId}`);

    await expect(page).toHaveTitle("Auth refactor · mockpit");
    await expect(page.locator(".ss-head h1")).toHaveText("Session scoped");
    await expect(stage(page).locator("iframe")).toBeVisible();
    expect(forbiddenReads).toEqual([]);
    await expect
      .poll(() =>
        eventUrls.some((url) => new URL(url).searchParams.get("session") === post.sessionId),
      )
      .toBe(true);
  } finally {
    server.stop();
  }
});

test("readonly session-mode viewer receives live posts without refreshing the list", async ({
  page,
}) => {
  const token = "secret";
  const server = await startMockpitServer({
    MOCKPIT_TOKEN: token,
    MOCKPIT_PUBLIC_READ: "session",
  });
  try {
    const first = await publish(
      server.url,
      { html: "<p>first</p>", title: "First live card", agent: "e2e" },
      token,
    );
    const sessionListRequests: string[] = [];
    let liveStreams = 0;
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (req.method() !== "GET") return;
      if (url.pathname === "/api/sessions") sessionListRequests.push(req.url());
      if (url.pathname === "/api/events") liveStreams++;
    });

    await page.goto(`${server.url}/session/${first.sessionId}`);

    await expect(page.locator(".ss-head h1")).toHaveText("First live card");
    // The stream layout has no wordmark to carry the live dot, so wait on the
    // SSE connection itself before publishing into it.
    await expect.poll(() => liveStreams).toBeGreaterThan(0);

    // A newer post in the shared session becomes the item on screen, live.
    await publish(
      server.url,
      { html: "<p>second</p>", title: "Second live card", agent: "e2e", session: first.sessionId },
      token,
    );

    await expect(page.locator(".ss-head h1")).toHaveText("Second live card");
    expect(sessionListRequests).toEqual([]);
  } finally {
    server.stop();
  }
});

test("readonly session-mode viewer renders without navigation chrome", async ({ page }) => {
  const token = "secret";
  const server = await startMockpitServer({
    MOCKPIT_TOKEN: token,
    MOCKPIT_PUBLIC_READ: "session",
  });
  try {
    const post = await publish(
      server.url,
      { html: "<p>single session</p>", title: "Single session", agent: "e2e" },
      token,
    );

    await page.goto(`${server.url}/session/${post.sessionId}`);

    await expect(page.locator(".ss-item")).toBeVisible();
    // The item screen alone: no projects sidebar, no items column, no drawer.
    await expect(page.locator(".ss-side")).toHaveCount(0);
    await expect(page.locator(".ss-items")).toHaveCount(0);
    await expect(page.locator("#app.stream")).toHaveCount(1);
    // ...and no write affordances, since the link is read-only.
    await expect(page.locator(".ss-compose")).toHaveCount(0);
    await expect(page.locator(".ss-decide")).toHaveCount(0);
  } finally {
    server.stop();
  }
});

test("readonly full-mode chrome hides write controls", async ({ page, publicReadServer }) => {
  await publish(
    publicReadServer.url,
    { html: "<p>controls</p>", title: "Readonly chrome", agent: "e2e" },
    publicReadServer.token,
  );

  await page.goto(publicReadServer.url);

  // The whole navigation is there (full mode reads projects), but nothing that
  // writes: no theme switch, no connect action, no composer, no decisions.
  await expect(page.locator(".ss-proj")).toHaveCount(1);
  await expect(page.locator(".theme-picker")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "connect agent" })).toHaveCount(0);
  await expect(page.locator(".ss-compose")).toHaveCount(0);
  await expect(page.locator(".ss-decide")).toHaveCount(0);
  await expect(page.locator(".ss-fab")).toHaveCount(0);
});

test("readonly empty workspace shows a simple empty state", async ({ page, publicReadServer }) => {
  await page.goto(publicReadServer.url);

  await expect(page.locator(".ss-empty h2")).toHaveText("Nothing here yet");
  await expect(page.getByRole("link", { name: "design guide" })).toBeVisible();
  await expect(page.getByRole("link", { name: "setup" })).toBeVisible();
  await expect(page.getByRole("link", { name: "connect agent" })).toHaveCount(0);
});

test("readonly iframe send-prompt bridge messages do not write comments", async ({
  page,
  publicReadServer,
}) => {
  await publish(
    publicReadServer.url,
    {
      html: `<script>parent.postMessage({__mockpit:true,type:"send-prompt",text:"please write"},"*")</script>`,
      title: "Prompt bridge",
      agent: "e2e",
    },
    publicReadServer.token,
  );
  let commentPosts = 0;
  await page.route("**/api/comments", async (route) => {
    if (route.request().method() === "POST") commentPosts += 1;
    await route.continue();
  });

  await page.goto(publicReadServer.url);
  await expect(stage(page).locator("iframe")).toBeVisible();
  await page.waitForTimeout(500);

  expect(commentPosts).toBe(0);
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
});

test("readonly item screen shows the thread but no way to add to it", async ({
  page,
  publicReadServer,
}) => {
  const post = await publish(
    publicReadServer.url,
    { html: "<p>readable</p>", title: "Readonly card", agent: "e2e" },
    publicReadServer.token,
  );
  await postComment(publicReadServer.url, publicReadServer.token, {
    surface: post.id,
    text: "existing feedback",
  });

  await page.goto(publicReadServer.url);

  await expect(page.locator(".ss-cmt")).toContainText("existing feedback");
  await expect(page.locator(".ss-compose")).toHaveCount(0);
  await expect(page.locator(".ss-decide")).toHaveCount(0);
  // Reading a version's history stays available — it is a read.
  await expect(page.locator(".ss-h")).toHaveCount(1);
});
