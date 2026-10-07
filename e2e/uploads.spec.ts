import {
  expect,
  expectIframesNoHorizontalOverflow,
  expectNoHorizontalOverflow,
  itemPath,
  publish,
  publishParts,
  serveEmbedBundle,
  stage,
  test,
  TINY_PNG_B64,
  upload,
} from "./fixtures.ts";

// The engine mounted on a post permalink route: the standalone full-page post,
// which is the one screen that still renders every native surface (including the
// experimental trace) as a card.
const embedHtml = (postId: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}#m{position:fixed;inset:0}</style></head>
<body><div id="m"></div>
<script type="module">
  import { mountViewer } from "/__embed/engine.js";
  mountViewer(document.getElementById("m"), {
    basePath: "/u/alice",
    readonly: true,
    router: {
      get: () => ({ surfaceId: ${JSON.stringify(postId)} }),
      navigate() {},
      subscribe() { return () => {}; },
    },
  });
</script></body></html>`;

test("an image surface renders an <img> served from /a/:id", async ({ page, server }) => {
  const asset = await upload(server.url, {
    data: TINY_PNG_B64,
    contentType: "image/png",
    filename: "pixel.png",
    kind: "image",
  });
  await publishParts(server.url, {
    title: "A screenshot",
    agent: "e2e",
    session: asset.sessionId,
    parts: [{ kind: "image", assetId: asset.id, caption: "one pixel" }],
  });

  await page.goto(server.url);
  const img = stage(page).locator(".asset-img");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", `/a/${asset.id}`);
  // the bytes actually loaded (not a broken image)
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator(".asset-caption")).toHaveText("one pixel");
});

test("embedded native image and trace assets use the host base path", async ({ page, server }) => {
  const image = await upload(server.url, {
    data: TINY_PNG_B64,
    contentType: "image/png",
    filename: "pixel.png",
    kind: "image",
  });
  const jsonl = '{"label":"from prefixed asset","kind":"shell"}';
  const trace = await upload(server.url, {
    data: Buffer.from(jsonl).toString("base64"),
    contentType: "application/x-ndjson",
    filename: "trace.jsonl",
    kind: "trace",
    session: image.sessionId,
  });
  const post = await publishParts(server.url, {
    title: "Prefixed assets",
    agent: "e2e",
    session: image.sessionId,
    parts: [
      { kind: "image", assetId: image.id, caption: "prefixed image" },
      { kind: "trace", assetId: trace.id },
    ],
  });

  await page.route("**/__embedtest", (route) =>
    route.fulfill({ contentType: "text/html", body: embedHtml(post.id) }),
  );
  await serveEmbedBundle(page);
  await page.route("**/u/alice/**", (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/u\/alice(?=\/|$)/, "") || "/";
    route.continue({ url: url.toString() });
  });

  await page.goto(`${server.url}/__embedtest`);

  const card = page.locator(".card:not(#whatsNew)");
  const img = card.locator(".asset-img");
  await expect(img).toHaveAttribute("src", `/u/alice/a/${image.id}`);
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await expect(card.locator(".trace-dl")).toHaveAttribute("href", `/u/alice/a/${trace.id}`);
  await expect(card.locator(".trace-label")).toHaveText("from prefixed asset");
});

// Trace stays an experimental, card-only surface: it renders on the standalone
// post page (/p/:id), not on the item stage.
test("a trace surface renders a step timeline with expandable detail", async ({ page, server }) => {
  const post = await publishParts(server.url, {
    title: "Run trace",
    agent: "e2e",
    parts: [
      {
        kind: "trace",
        title: "What I did",
        steps: [
          { label: "read server/app.ts", kind: "tool", detail: "opened the file at line 1" },
          { label: "thinking about the fix" },
        ],
      },
    ],
  });

  await page.goto(`${server.url}/p/${post.id}`);
  const card = page.locator(".card:not(#whatsNew)");
  await expect(card.locator(".trace-title")).toHaveText("What I did");
  await expect(card.locator(".trace-step")).toHaveCount(2);
  await expect(card.locator(".trace-kind").first()).toHaveText("tool");

  // the step with a detail expands on click; the label-only one has no detail
  await expect(card.locator(".trace-detail")).toHaveCount(0);
  await card.locator(".trace-row.clickable").first().click();
  await expect(card.locator(".trace-detail")).toHaveText("opened the file at line 1");
});

test("a trace surface backed by an uploaded file offers a download and renders steps", async ({
  page,
  server,
}) => {
  const jsonl = '{"label":"step one","kind":"shell"}\n{"label":"step two"}';
  const asset = await upload(server.url, {
    data: Buffer.from(jsonl).toString("base64"),
    contentType: "application/x-ndjson",
    filename: "trace.jsonl",
    kind: "trace",
  });
  const post = await publishParts(server.url, {
    title: "Uploaded trace",
    agent: "e2e",
    session: asset.sessionId,
    parts: [{ kind: "trace", assetId: asset.id }],
  });

  await page.goto(`${server.url}/p/${post.id}`);
  const card = page.locator(".card:not(#whatsNew)");
  await expect(card.locator(".trace-dl")).toHaveAttribute("href", `/a/${asset.id}`);
  // steps are fetched from the asset and rendered
  await expect(card.locator(".trace-step")).toHaveCount(2);
  await expect(card.locator(".trace-label").first()).toHaveText("step one");
});

test("a trace surface stays readable on an iPhone-sized viewport", async ({ page, server }) => {
  const post = await publishParts(server.url, {
    title: "Trace on mobile",
    agent: "e2e",
    parts: [
      {
        kind: "trace",
        title: "Long trace heading that should truncate cleanly on mobile",
        steps: [
          {
            label:
              "ran a very long shell command with flags --workspace=/tmp/mockpit-mobile --include-traces --verify-sidebar",
            kind: "shell",
            ts: "2026-06-25T12:00:00Z",
            detail:
              "stdout: a-long-token-that-should-wrap-instead-of-forcing-horizontal-scroll ".repeat(
                6,
              ),
          },
          {
            label: "noted how the sidebar drawer and trace card read together on a phone",
            kind: "say",
            ts: "2026-06-25T12:00:03Z",
          },
        ],
      },
    ],
  });

  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(`${server.url}/p/${post.id}`);

  const card = page.locator(".card:not(#whatsNew)");
  await expect(card.locator(".trace-title")).toBeVisible();
  await expect(card.locator(".trace-step")).toHaveCount(2);
  await card.locator(".trace-row.clickable").first().click();
  await expect(card.locator(".trace-detail")).toBeVisible();

  await expectNoHorizontalOverflow(page, "main");
  await expectNoHorizontalOverflow(page, ".card");
  await expectNoHorizontalOverflow(page, ".trace-surface");
});

test("all native surface primitives fit the iPhone 14 Pro viewer", async ({ page, server }) => {
  const asset = await upload(server.url, {
    data: TINY_PNG_B64,
    contentType: "image/png",
    filename: "mobile-primitive.png",
    kind: "image",
  });
  const post = await publishParts(server.url, {
    title: "Every primitive on mobile",
    agent: "e2e",
    session: asset.sessionId,
    parts: [
      { kind: "html", html: "<section><h2>HTML</h2><p>Interactive surface shell.</p></section>" },
      { kind: "markdown", markdown: "## Markdown\n\n- readable prose\n- list item" },
      {
        kind: "diff",
        patch:
          "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old mobile spacing\n+new mobile spacing\n",
      },
      {
        kind: "terminal",
        text: "\u001b[32mPASS\u001b[0m mobile primitive check\n$ mockpit trace-sync --all",
        title: "terminal",
      },
      { kind: "image", assetId: asset.id, caption: "uploaded image primitive" },
      { kind: "mermaid", mermaid: "flowchart LR\n  A[Agent] --> B[mockpit]\n  B --> C[Phone]" },
      {
        kind: "json",
        data: {
          status: "ok",
          primitives: [
            "html",
            "markdown",
            "diff",
            "terminal",
            "image",
            "mermaid",
            "json",
            "code",
            "trace",
          ],
        },
      },
      {
        kind: "code",
        language: "ts",
        title: "mobile.ts",
        code: "export const mobilePrimitive = (kind: string) => `${kind}: ok`;\n",
      },
      {
        kind: "trace",
        title: "Trace primitive",
        steps: [
          {
            kind: "tool",
            label: "verified every native primitive on iPhone 14 Pro",
            detail: "html markdown diff terminal image mermaid json code trace",
          },
        ],
      },
    ],
  });

  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(`${server.url}/p/${post.id}`);

  const card = page.locator(".card:not(#whatsNew)");
  await expect(card).toBeVisible();
  await expect(card.locator("iframe").first()).toBeVisible();
  await expectIframesNoHorizontalOverflow(page, card);
  await expect(card.locator(".asset-img")).toBeVisible();
  await expect(card.locator(".json-surface")).toContainText("primitives");
  await expect(card.locator(".trace-step")).toHaveCount(1);
  await card.locator(".trace-row.clickable").click();
  await expect(card.locator(".trace-detail")).toBeVisible();

  await expectNoHorizontalOverflow(page, "main");
  await expectNoHorizontalOverflow(page, ".card");
  await expectNoHorizontalOverflow(page, ".trace-surface");
});

test("an uploaded image embeds by URL inside an html surface under the CSP", async ({
  page,
  server,
}) => {
  const asset = await upload(server.url, {
    data: TINY_PNG_B64,
    contentType: "image/png",
    kind: "image",
  });
  await publish(server.url, {
    html: `<img id="embed" src="/a/${asset.id}">`,
    title: "Embedded",
    agent: "e2e",
    session: asset.sessionId,
  });

  // The sandboxed iframe runs at an opaque origin; the surface CSP now allows
  // the server origin, so the <img> request goes out. If the CSP blocked it the
  // request would never be made and this would time out.
  const assetResponse = page.waitForResponse(
    (r) => r.url().endsWith(`/a/${asset.id}`) && r.status() === 200,
  );
  await page.goto(server.url);
  await expect(stage(page).locator("iframe")).toBeVisible();
  await assetResponse;
});

test("a missing/evicted image shows a placeholder, not a broken image", async ({
  page,
  server,
}) => {
  const snip = await publish(server.url, { html: "<p>x</p>", title: "Doc", agent: "e2e" });
  await publishParts(server.url, {
    title: "Gone",
    session: snip.sessionId,
    parts: [{ kind: "image", assetId: "does-not-exist" }],
  });

  // Two posts in the session are two items, so address the one under test
  // rather than whichever the workspace auto-opens.
  await page.goto(`${server.url}${itemPath("workspace", "gone")}`);
  await expect(stage(page).locator(".asset-gone")).toContainText("evicted");
});
