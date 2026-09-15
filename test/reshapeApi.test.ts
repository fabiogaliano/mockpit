import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { JsonFileStore } from "../server/storage.ts";
import type { Store } from "../server/types.ts";

// The reshape surface: project › item › variant › version, decisions, drafts,
// asks, exports, page slots, and the batched feedback an agent reads back.
// api.test.ts still owns the legacy post/snippet contract.

function makeApp(opts?: { authToken?: string; publicRead?: "session" | "full"; store?: Store }) {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-reshape-"));
  const { store = new JsonFileStore(join(dir, "data.json")), ...rest } = opts ?? {};
  return createApp({
    store,
    viewerHtml: "<html><body>viewer</body></html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    agentHowtoText: "# agent how-to",
    ...rest,
  });
}

// A viewer-origin POST (the only origin allowed to author as "user" or to
// write drafts).
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
  body: JSON.stringify(body),
});

const agentJson = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

type AnyJson = Record<string, any>;

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  const res = await app.request(path, json(body));
  return { status: res.status, body: (await res.json().catch(() => null)) as AnyJson };
}

async function get(app: ReturnType<typeof createApp>, path: string) {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json().catch(() => null)) as AnyJson };
}

const publishItem = (
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown> & { slug: string },
) =>
  post(app, "/api/posts", {
    project: "acme/site",
    surfaces: [{ kind: "html", html: `<p>${body.slug}</p>` }],
    ...body,
  });

// --- item identity -------------------------------------------------------

test("publishing the same (project, slug, variant) twice is a new version", async () => {
  const app = makeApp();
  const first = await publishItem(app, { slug: "pricing-card", title: "Pricing card" });
  assert.equal(first.status, 201);
  assert.equal(first.body.slug, "pricing-card");
  assert.equal(first.body.variant, "default");
  assert.equal(first.body.kind, "component");
  assert.equal(first.body.status, "open");
  assert.equal(first.body.version, 1);

  const second = await publishItem(app, {
    slug: "pricing-card",
    surfaces: [{ kind: "html", html: "<p>v2</p>" }],
    from: 1,
    prompt: "tighter spacing",
  });
  assert.equal(second.body.id, first.body.id, "same item, not a second card");
  assert.equal(second.body.version, 2);
  assert.equal(second.body.from, 1);
  assert.equal(second.body.prompt, "tighter spacing");

  // a different variant is a sibling, not a version
  const sibling = await publishItem(app, { slug: "pricing-card", variant: "highlighted" });
  assert.notEqual(sibling.body.id, first.body.id);
  assert.equal(sibling.body.version, 1);

  const item = await get(app, "/api/projects/acme%2Fsite/items/pricing-card");
  assert.deepEqual(item.body.variants.map((v: AnyJson) => v.variant).sort(), [
    "default",
    "highlighted",
  ]);
});

test("an unnamed publish always creates a new item, never a version", async () => {
  const app = makeApp();
  // The legacy flow: no slug, and every card carries the same default title.
  const a = await post(app, "/api/posts", { surfaces: [{ kind: "html", html: "<p>a</p>" }] });
  const b = await post(app, "/api/posts", { surfaces: [{ kind: "html", html: "<p>b</p>" }] });
  assert.notEqual(a.body.id, b.body.id);
  assert.equal(a.body.version, 1);
  assert.equal(b.body.version, 1);
  assert.notEqual(a.body.slug, b.body.slug, "identity stays unique inside the project");
});

test("GET /api/projects lists projects, items, and who is waiting", async () => {
  const app = makeApp();
  await publishItem(app, { slug: "pricing-card" });
  await publishItem(app, { slug: "pricing-card", variant: "highlighted" });
  await post(app, "/api/posts", {
    project: "acme/docs",
    slug: "nav",
    surfaces: [{ kind: "html", html: "<p>nav</p>" }],
  });

  const projects = await get(app, "/api/projects");
  const site = (projects.body as unknown as AnyJson[]).find((p) => p.name === "acme/site")!;
  assert.equal(site.items, 1, "two variants are one item");
  assert.equal(site.waiting, 0);
  assert.ok((projects.body as unknown as AnyJson[]).some((p) => p.name === "acme/docs"));

  const items = await get(app, "/api/projects/acme%2Fsite/items");
  assert.deepEqual(
    (items.body as unknown as AnyJson[]).map((i) => i.slug),
    ["pricing-card"],
  );
  assert.equal((items.body as unknown as AnyJson[])[0].waiting, false);

  assert.equal((await get(app, "/api/projects/acme%2Fsite/items/missing")).status, 404);
});

// --- ask -----------------------------------------------------------------

test("POST /api/posts/:id/ask marks the item waiting and lands in its thread", async () => {
  const app = makeApp();
  const item = await publishItem(app, { slug: "pricing-card" });

  assert.equal((await post(app, `/api/posts/${item.body.id}/ask`, { text: "  " })).status, 400);
  assert.equal((await post(app, "/api/posts/nope/ask", { text: "hi" })).status, 404);

  const asked = await post(app, `/api/posts/${item.body.id}/ask`, {
    text: "tighter or roomier?",
  });
  assert.equal(asked.body.ask.text, "tighter or roomier?");

  const items = await get(app, "/api/projects/acme%2Fsite/items");
  assert.equal((items.body as unknown as AnyJson[])[0].waiting, true);
  assert.equal(
    ((await get(app, "/api/projects")).body as unknown as AnyJson[]).find(
      (p) => p.name === "acme/site",
    )!.waiting,
    1,
  );

  // the question is a comment with kind "ask", so the operator reads it where
  // they answer it
  const thread = await get(app, `/api/comments?surface=${item.body.id}`);
  assert.deepEqual(
    thread.body.comments.map((c: AnyJson) => ({ kind: c.kind, text: c.text })),
    [{ kind: "ask", text: "tighter or roomier?" }],
  );
});

// --- decisions and drafts ------------------------------------------------

test("drafts reach the agent only when a decision releases them", async () => {
  const app = makeApp();
  const item = await publishItem(app, { slug: "pricing-card", title: "Pricing card" });

  const draft = await post(app, "/api/comments", {
    surface: item.body.id,
    text: "make @1 wider",
    author: "user",
    draft: true,
    anchors: [{ ref: "@1", shape: "pin", box: [0.5, 0.25], surfaceIndex: 0, postVersion: 1 }],
    postVersion: 1,
    viewport: 1280,
  });
  assert.equal(draft.body.draft, true);

  // the viewer sees its own draft (and the per-comment delivery state)...
  const viewerRead = await get(app, `/api/comments?surface=${item.body.id}`);
  assert.deepEqual(
    viewerRead.body.comments.map((c: AnyJson) => ({ text: c.text, draft: c.draft, seen: c.seen })),
    [{ text: "make @1 wider", draft: true, seen: false }],
  );
  assert.deepEqual(
    ((await get(app, `/api/posts/${item.body.id}/drafts`)).body as unknown as AnyJson[]).map(
      (c) => c.text,
    ),
    ["make @1 wider"],
  );

  // ...but no agent channel does
  const wait = await get(app, `/api/comments?session=${item.body.sessionId}&author=user`);
  assert.deepEqual(wait.body.comments, []);
  const write = await publishItem(app, { slug: "pricing-card" });
  assert.equal(write.body.userFeedback, undefined);

  // Revise releases them, together with the decision, in one batch
  const decision = await post(app, `/api/posts/${item.body.id}/decision`, {
    kind: "revise",
    text: "another pass please",
  });
  assert.equal(decision.body.released, 1);
  assert.equal(decision.body.ask, null);

  const batches = (await get(app, `/api/comments?session=${item.body.sessionId}&author=user`)).body
    .userFeedback as AnyJson[];
  assert.equal(batches.length, 1);
  assert.equal(batches[0].postId, item.body.id);
  assert.equal(batches[0].slug, "pricing-card");
  assert.equal(batches[0].variant, "default");
  assert.deepEqual(batches[0].decision, { kind: "revise", text: "another pass please" });
  assert.deepEqual(
    batches[0].comments.map((c: AnyJson) => ({
      text: c.text,
      viewport: c.viewport,
      version: c.version,
      anchors: c.anchors.map((a: AnyJson) => a.ref),
    })),
    [{ text: "make @1 wider", viewport: 1280, version: 1, anchors: ["@1"] }],
  );

  // exactly once: the same cursor is shared by wait and piggyback
  const after = await publishItem(app, { slug: "pricing-card" });
  assert.equal(after.body.userFeedback, undefined);
  assert.deepEqual(
    (await get(app, `/api/comments?session=${item.body.sessionId}&author=user`)).body.comments,
    [],
  );
});

test("accept archives sibling variants and reports them in the batch", async () => {
  const app = makeApp();
  const chosen = await publishItem(app, { slug: "pricing-card", variant: "highlighted" });
  const quiet = await publishItem(app, { slug: "pricing-card", variant: "quiet" });

  // a note written before the decision is still feedback, so accept releases it
  await post(app, "/api/comments", {
    surface: chosen.body.id,
    text: "this one, but check the padding",
    author: "user",
    draft: true,
  });
  const accepted = await post(app, `/api/posts/${chosen.body.id}/decision`, { kind: "accept" });
  assert.equal(accepted.body.status, "accepted");
  assert.equal(accepted.body.released, 1);

  const item = await get(app, "/api/projects/acme%2Fsite/items/pricing-card");
  const byVariant = Object.fromEntries(
    item.body.variants.map((v: AnyJson) => [v.variant, v.status]),
  );
  assert.deepEqual(byVariant, { highlighted: "accepted", quiet: "archived" });

  const batches = (await get(app, `/api/comments?session=${chosen.body.sessionId}&author=user`))
    .body.userFeedback as AnyJson[];
  const batch = batches.find((b) => b.postId === chosen.body.id)!;
  assert.equal(batch.decision.kind, "accept");
  assert.deepEqual(batch.archived, ["quiet"]);
  assert.deepEqual(
    batch.comments.map((c: AnyJson) => c.text),
    ["this one, but check the padding"],
  );

  // drop archives one variant; restore brings it back
  const dropped = await post(app, `/api/posts/${quiet.body.id}/decision`, { kind: "drop" });
  assert.equal(dropped.body.status, "archived");
  assert.equal((await post(app, `/api/posts/${quiet.body.id}/restore`, {})).body.status, "open");
  assert.equal((await post(app, "/api/posts/nope/restore", {})).status, 404);
  assert.equal(
    (await post(app, `/api/posts/${quiet.body.id}/decision`, { kind: "bogus" })).status,
    400,
  );
  assert.equal((await post(app, "/api/posts/nope/decision", { kind: "accept" })).status, 404);
});

test("a programmatic caller cannot write a draft", async () => {
  const app = makeApp();
  const item = await publishItem(app, { slug: "pricing-card" });
  const res = await app.request(
    "/api/comments",
    agentJson({ surface: item.body.id, text: "not a draft", draft: true }),
  );
  assert.equal(((await res.json()) as AnyJson).draft, false);
});

// --- export --------------------------------------------------------------

test("export returns the chosen variant's html and its prompt history", async () => {
  const app = makeApp();
  const item = await publishItem(app, {
    slug: "pricing-card",
    variant: "highlighted",
    surfaces: [{ kind: "html", html: "<p>v1</p>" }],
  });
  await publishItem(app, {
    slug: "pricing-card",
    variant: "highlighted",
    surfaces: [{ kind: "html", html: "<p>v2</p>" }],
    from: 1,
    prompt: "tighter spacing",
  });
  await post(app, `/api/posts/${item.body.id}/decision`, { kind: "accept" });

  const exported = await get(
    app,
    "/api/projects/acme%2Fsite/items/pricing-card/export?variant=highlighted",
  );
  assert.equal(exported.body.version, 2);
  assert.equal(exported.body.status, "accepted");
  assert.equal(exported.body.html, "<p>v2</p>");
  assert.deepEqual(
    exported.body.prompts.map((p: AnyJson) => ({ version: p.version, prompt: p.prompt })),
    [
      { version: 2, prompt: "tighter spacing" },
      { version: 1, prompt: "" },
    ],
  );
  // no screenshot service configured locally
  assert.equal(exported.body.screenshotUrl, null);

  assert.equal((await get(app, "/api/projects/acme%2Fsite/items/nope/export")).status, 404);
});

// --- page slots ----------------------------------------------------------

test("a page inlines the referenced variant version at /s and snapshots it", async () => {
  const app = makeApp();
  await publishItem(app, {
    slug: "pricing-card",
    surfaces: [{ kind: "html", html: "<p>card v1</p>" }],
  });
  const page = await publishItem(app, {
    slug: "landing",
    kind: "page",
    surfaces: [
      { kind: "html", html: `<main><sideshow-slot slug="pricing-card"></sideshow-slot></main>` },
    ],
  });
  assert.equal(page.body.kind, "page");
  // publish pinned the slot to the component's current version
  assert.deepEqual(page.body.slots, [{ slug: "pricing-card", variant: "default", version: 1 }]);

  const doc = await (await app.request(`/s/${page.body.id}?part=0`)).text();
  assert.ok(doc.includes("<p>card v1</p>"), "the component body is inlined server-side");
  assert.ok(doc.includes('data-sideshow-slot="pricing-card"'));
  assert.ok(!doc.includes("<sideshow-slot"), "the tag itself is replaced");

  // the component moves on; the page keeps rendering the version it snapshotted
  await publishItem(app, {
    slug: "pricing-card",
    surfaces: [{ kind: "html", html: "<p>card v2</p>" }],
  });
  const again = await (await app.request(`/s/${page.body.id}?part=0`)).text();
  assert.ok(again.includes("<p>card v1</p>"), "snapshot semantics");
  assert.ok(!again.includes("<p>card v2</p>"));

  // an unresolvable slot stays visible as an empty placeholder
  const broken = await publishItem(app, {
    slug: "broken-page",
    kind: "page",
    surfaces: [{ kind: "html", html: `<sideshow-slot slug="nothing-here"></sideshow-slot>` }],
  });
  const brokenDoc = await (await app.request(`/s/${broken.body.id}?part=0`)).text();
  assert.ok(brokenDoc.includes('data-sideshow-missing="1"'));
});

// --- static assets and CSP ----------------------------------------------

test("/asset serves the content-hashed bridge and stylesheets immutably", async () => {
  const app = makeApp();
  const item = await publishItem(app, { slug: "pricing-card" });
  const doc = await (await app.request(`/s/${item.body.id}?part=0`)).text();

  const refs = [...doc.matchAll(/(?:src|href)="http:\/\/localhost(\/asset\/[^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(refs.length >= 2, "bridge js + base css are external");
  for (const ref of refs) {
    const res = await app.request(ref);
    assert.equal(res.status, 200, ref);
    assert.match(res.headers.get("cache-control") ?? "", /immutable/);
    assert.match(
      res.headers.get("content-type") ?? "",
      ref.endsWith(".js") ? /text\/javascript/ : /text\/css/,
    );
    assert.ok((await res.text()).length > 0);
  }
  assert.equal((await app.request("/asset/bridge.deadbeef.js")).status, 404);

  // the CSP allows exactly that same-origin prefix, and nothing else same-origin
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(doc)![1];
  const scriptSrc = /script-src([^;]*)/.exec(csp)![1].trim().split(/\s+/);
  assert.ok(scriptSrc.includes("http://localhost/asset/"));
  assert.ok(!scriptSrc.includes("'self'"));
  assert.ok(!scriptSrc.includes("http://localhost"), "only the asset directory, not the origin");
});

// --- auth ----------------------------------------------------------------

test("project reads are not public on a session-scoped workspace", async () => {
  const app = makeApp({ authToken: "secret", publicRead: "session" });
  for (const path of [
    "/api/projects",
    "/api/projects/acme%2Fsite/items",
    "/api/projects/acme%2Fsite/items/pricing-card",
    "/api/projects/acme%2Fsite/design",
  ]) {
    assert.equal((await app.request(path)).status, 401, path);
  }
  // `publicRead: "full"` is the opt-in that exposes them
  const open = makeApp({ authToken: "secret", publicRead: "full" });
  assert.equal((await open.request("/api/projects")).status, 200);
});

// --- design settings ------------------------------------------------------

test("project design round-trips and normalizes unknown values", async () => {
  const app = makeApp();
  // a project that never ran `sideshow init` has no design at all
  const empty = await get(app, "/api/projects/acme%2Fsite/design");
  assert.equal(empty.status, 200);
  assert.equal(empty.body, null);

  const saved = await app.request(
    "/api/projects/acme%2Fsite/design",
    json(
      {
        kit: "tailwind",
        detected: { tailwind: true, shadcn: "yes", cssVars: "12", fonts: ["Inter", 7] },
        cssVars: ":root{--brand:#0af}",
        iconsAssetId: "asset1",
        palette: { light: { bg: "#fff" }, dark: { bg: "#000" } },
      },
      "PUT",
    ),
  );
  const design = (await saved.json()) as AnyJson;
  assert.equal(design.kit, "tailwind");
  assert.deepEqual(design.detected, {
    tailwind: true,
    shadcn: false,
    cssVars: 12,
    fonts: ["Inter"],
  });
  assert.equal(design.cssVars, ":root{--brand:#0af}");
  assert.equal(design.iconsAssetId, "asset1");
  assert.deepEqual((await get(app, "/api/projects/acme%2Fsite/design")).body, design);

  assert.equal(
    (await app.request("/api/projects/acme%2Fsite/design", { method: "PUT", body: "{" })).status,
    400,
  );

  // the design is injected into the project's html surfaces
  const item = await publishItem(app, { slug: "pricing-card" });
  const doc = await (await app.request(`/s/${item.body.id}?part=0`)).text();
  assert.ok(doc.includes("--brand:#0af"), "the repo's css vars ride into the frame");
});

// --- demo seed ------------------------------------------------------------

test("POST /api/demo/reshape seeds three projects of items", async () => {
  const app = makeApp();
  const seeded = await post(app, "/api/demo/reshape", {});
  assert.equal(seeded.status, 201);

  const projects = (await get(app, "/api/projects")).body as unknown as AnyJson[];
  assert.deepEqual(projects.map((p) => p.name).sort(), ["acme/app", "acme/site", "loom"]);
  for (const project of projects) {
    const items = (await get(app, `/api/projects/${encodeURIComponent(project.name)}/items`))
      .body as unknown as AnyJson[];
    assert.equal(items.length, project.items, `${project.name} item count`);
  }
  // "loom" is the connected-but-silent project: the viewer's "waiting for the
  // first publish" state needs one.
  assert.equal(projects.find((p) => p.name === "loom")!.items, 0);

  const site = (await get(app, "/api/projects/acme%2Fsite/items")).body as unknown as AnyJson[];
  const card = site.find((i) => i.slug === "pricing-card")!;
  assert.deepEqual(card.variants.map((v: AnyJson) => v.variant).sort(), [
    "highlighted",
    "quiet",
    "stacked",
  ]);
  assert.ok(
    site.some((i) => i.kind === "page"),
    "a composed page is seeded",
  );
  const decided = site.find((i) => i.slug === "cta-button")!;
  assert.deepEqual(decided.variants.map((v: AnyJson) => v.status).sort(), ["accepted", "archived"]);

  // seeding twice is a no-op, not a duplicate workspace
  const again = await post(app, "/api/demo/reshape", {});
  assert.equal(again.body.alreadySent, true);
  assert.equal(
    ((await get(app, "/api/projects")).body as unknown as AnyJson[]).length,
    projects.length,
  );
});

// --- the SQLite path ------------------------------------------------------

test("the reshape loop behaves identically on SqlStore", async () => {
  const app = makeApp({ store: new SqlStore(createSqliteStorage()) });
  const item = await publishItem(app, { slug: "pricing-card", title: "Pricing card" });
  await publishItem(app, {
    slug: "pricing-card",
    surfaces: [{ kind: "html", html: "<p>v2</p>" }],
    prompt: "tighter",
  });
  await post(app, "/api/comments", {
    surface: item.body.id,
    text: "ship it",
    author: "user",
    draft: true,
  });
  const decision = await post(app, `/api/posts/${item.body.id}/decision`, { kind: "accept" });
  assert.equal(decision.body.released, 1);

  const batches = (await get(app, `/api/comments?session=${item.body.sessionId}&author=user`)).body
    .userFeedback as AnyJson[];
  assert.equal(batches[0].decision.kind, "accept");
  assert.deepEqual(
    batches[0].comments.map((c: AnyJson) => c.text),
    ["ship it"],
  );
  assert.equal(
    (await get(app, "/api/projects/acme%2Fsite/items/pricing-card")).body.variants[0].status,
    "accepted",
  );
});

// --- the item tools over HTTP MCP ----------------------------------------

const mcpCall = (id: number, method: string, params?: unknown) =>
  json({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

async function tool(
  app: ReturnType<typeof createApp>,
  name: string,
  args: Record<string, unknown> = {},
  id = 1,
) {
  const res = (await (
    await app.request("/mcp", mcpCall(id, "tools/call", { name, arguments: args }))
  ).json()) as AnyJson;
  const text = res.result.content[0].text as string;
  if (res.result.isError) return { error: text };
  return { value: JSON.parse(text) as AnyJson };
}

test("publish_item / revise_item address an item by name across calls", async () => {
  const app = makeApp();
  const first = await tool(app, "publish_item", {
    project: "acme/site",
    slug: "pricing-card",
    variant: "highlighted",
    title: "Pricing card",
    html: "<p>v1</p>",
  });
  assert.equal(first.value!.slug, "pricing-card");
  assert.equal(first.value!.variant, "highlighted");
  assert.equal(first.value!.kind, "component");
  assert.equal(first.value!.status, "open");
  assert.match(first.value!.url, /\/p\//);

  const second = await tool(app, "revise_item", {
    project: "acme/site",
    slug: "pricing-card",
    variant: "highlighted",
    html: "<p>v2</p>",
    from: 1,
    prompt: "tighter",
  });
  assert.equal(second.value!.id, first.value!.id);
  assert.equal(second.value!.version, 2);
  assert.equal(second.value!.prompt, "tighter");

  // surfaces instead of html, and a page keeps being a page on revise
  const page = await tool(app, "publish_item", {
    project: "acme/site",
    slug: "landing",
    kind: "page",
    surfaces: [{ kind: "html", html: "<main>page</main>" }],
  });
  assert.equal(page.value!.kind, "page");
  const revisedPage = await tool(app, "revise_item", {
    project: "acme/site",
    slug: "landing",
    html: "<main>page v2</main>",
  });
  assert.equal(revisedPage.value!.kind, "page");

  assert.match((await tool(app, "publish_item", { slug: "" })).error!, /slug is required/);
  assert.match(
    (await tool(app, "publish_item", { slug: "empty", surfaces: [] })).error!,
    /needs html or surfaces/,
  );
});

test("ask_user, list_items, get_item and export_item read one project", async () => {
  const app = makeApp();
  await tool(app, "publish_item", {
    project: "acme/site",
    slug: "pricing-card",
    variant: "highlighted",
    html: "<p>v1</p>",
  });
  await tool(app, "revise_item", {
    project: "acme/site",
    slug: "pricing-card",
    variant: "highlighted",
    html: "<p>v2</p>",
    prompt: "tighter",
  });

  const asked = await tool(app, "ask_user", {
    project: "acme/site",
    slug: "pricing-card",
    text: "tighter or roomier?",
  });
  assert.equal(asked.value!.ask, "tighter or roomier?");
  assert.equal(asked.value!.variant, "highlighted");
  assert.match(
    (await tool(app, "ask_user", { slug: "pricing-card", text: "" })).error!,
    /needs text/,
  );
  assert.match(
    (await tool(app, "ask_user", { slug: "ghost", text: "hi" })).error!,
    /no item "ghost"/,
  );

  const listed = await tool(app, "list_items", { project: "acme/site" });
  assert.equal(listed.value!.project, "acme/site");
  assert.deepEqual(
    listed.value!.items.map((i: AnyJson) => i.slug),
    ["pricing-card"],
  );

  // bodies and history are opt-in
  const lean = await tool(app, "get_item", { project: "acme/site", slug: "pricing-card" });
  assert.equal(lean.value!.variants[0].variant, "highlighted");
  assert.equal(lean.value!.variants[0].ask.text, "tighter or roomier?");
  assert.equal(lean.value!.variants[0].html, undefined);
  assert.equal(lean.value!.variants[0].history, undefined);

  const full = await tool(app, "get_item", {
    project: "acme/site",
    slug: "pricing-card",
    body: true,
    history: true,
  });
  assert.equal(full.value!.variants[0].html, "<p>v2</p>");
  assert.deepEqual(
    full.value!.variants[0].history.map((h: AnyJson) => h.version),
    [2, 1],
  );

  const exported = await tool(app, "export_item", {
    project: "acme/site",
    slug: "pricing-card",
    variant: "highlighted",
  });
  assert.equal(exported.value!.html, "<p>v2</p>");
  assert.equal(exported.value!.version, 2);
  assert.match(
    (await tool(app, "export_item", { project: "acme/site", slug: "ghost" })).error!,
    /no item "ghost"/,
  );
});

test("an item tool with no project resolves one instead of failing", async () => {
  const app = makeApp();
  const created = await post(app, "/api/posts", {
    project: "acme/site",
    slug: "pricing-card",
    surfaces: [{ kind: "html", html: "<p>x</p>" }],
  });
  // ...from the session it was told about
  const bySession = await tool(app, "list_items", { session: created.body.sessionId });
  assert.equal(bySession.value!.project, "acme/site");
  // ...or from the workspace's only project
  const byWorkspace = await tool(app, "get_item", { slug: "pricing-card" });
  assert.equal(byWorkspace.value!.slug, "pricing-card");
  // an ambiguous item names its variants rather than guessing
  await tool(app, "publish_item", {
    project: "acme/site",
    slug: "pricing-card",
    variant: "quiet",
    html: "<p>q</p>",
  });
  assert.match(
    (await tool(app, "ask_user", { project: "acme/site", slug: "pricing-card", text: "?" })).error!,
    /has 2 variants; pass variant: default\|quiet/,
  );
  assert.match(
    (
      await tool(app, "export_item", {
        project: "acme/site",
        slug: "pricing-card",
        variant: "nope",
      })
    ).error!,
    /has no variant "nope"/,
  );
});

test("wait_for_feedback over MCP returns the decision batch", async () => {
  const app = makeApp();
  const item = await publishItem(app, { slug: "pricing-card", title: "Pricing card" });
  await post(app, "/api/comments", {
    surface: item.body.id,
    text: "wider",
    author: "user",
    draft: true,
  });
  await post(app, `/api/posts/${item.body.id}/decision`, { kind: "revise", text: "one more" });

  const batch = await tool(app, "wait_for_feedback", {
    session: item.body.sessionId,
    timeoutSeconds: 0,
  });
  assert.equal(batch.value!.slug, "pricing-card");
  assert.deepEqual(batch.value!.decision, { kind: "revise", text: "one more" });
  assert.deepEqual(
    batch.value!.comments.map((c: AnyJson) => c.text),
    ["wider"],
  );

  // delivered exactly once, whichever channel asked
  const again = await tool(app, "wait_for_feedback", {
    session: item.body.sessionId,
    timeoutSeconds: 0,
  });
  assert.deepEqual(again.value!.comments, []);
  assert.match(again.value!.note, /no user feedback yet/);
});

test("tools/list hides the retired spellings unless SIDESHOW_MCP_LEGACY=1", async () => {
  const app = makeApp();
  const names = async () => {
    const res = (await (await app.request("/mcp", mcpCall(1, "tools/list"))).json()) as AnyJson;
    return (res.result.tools as AnyJson[]).map((t) => t.name);
  };
  assert.ok(!(await names()).includes("publish_surface"));

  const previous = process.env.SIDESHOW_MCP_LEGACY;
  process.env.SIDESHOW_MCP_LEGACY = "1";
  try {
    const legacy = await names();
    for (const name of ["publish_surface", "update_surface", "publish_snippet", "list_surfaces"]) {
      assert.ok(legacy.includes(name), `${name} is advertised under the flag`);
    }
    assert.ok(legacy.includes("publish_item"), "the canonical tools are still there");
  } finally {
    if (previous === undefined) delete process.env.SIDESHOW_MCP_LEGACY;
    else process.env.SIDESHOW_MCP_LEGACY = previous;
  }
});

test("item reads pick the variant the agent means", async () => {
  const app = makeApp();
  const solid = await publishItem(app, { slug: "cta-button", variant: "solid" });
  await publishItem(app, { slug: "cta-button", variant: "ghost" });
  await post(app, `/api/posts/${solid.body.id}/decision`, { kind: "accept" });

  // the HTTP export with no variant falls back to the accepted one
  const accepted = await get(app, "/api/projects/acme%2Fsite/items/cta-button/export");
  assert.equal(accepted.body.variant, "solid");
  assert.equal(accepted.body.status, "accepted");
  // the tool never guesses between siblings; it names them instead
  assert.match(
    (await tool(app, "export_item", { project: "acme/site", slug: "cta-button" })).error!,
    /has 2 variants; pass variant: /,
  );

  // get_item filters to one variant when asked
  const one = await tool(app, "get_item", {
    project: "acme/site",
    slug: "cta-button",
    variant: "ghost",
  });
  assert.deepEqual(
    one.value!.variants.map((v: AnyJson) => v.variant),
    ["ghost"],
  );
  assert.equal(one.value!.variants[0].status, "archived");
});

test("publish_item threads a named session and title through", async () => {
  const app = makeApp();
  const created = await tool(app, "publish_item", {
    project: "acme/site",
    slug: "pricing-card",
    title: "Pricing card",
    sessionTitle: "Design pass",
    html: "<p>x</p>",
  });
  const sessions = (await get(app, "/api/sessions")).body as unknown as AnyJson[];
  assert.equal(sessions[0].title, "Design pass");
  assert.equal(created.value!.sessionId, sessions[0].id);

  const second = await tool(app, "publish_item", {
    project: "acme/site",
    slug: "hero",
    session: created.value!.sessionId,
    html: "<p>hero</p>",
  });
  assert.equal(second.value!.sessionId, created.value!.sessionId);
  assert.equal(((await get(app, "/api/sessions")).body as unknown as AnyJson[]).length, 1);
});

test("get_design_guide renders the project's stored design", async () => {
  const app = makeApp();
  await app.request(
    "/api/projects/acme%2Fsite/design",
    json({ kit: "builtin", cssVars: ":root{--brand:#0af}" }, "PUT"),
  );
  const res = (await (
    await app.request(
      "/mcp",
      mcpCall(1, "tools/call", {
        name: "get_design_guide",
        arguments: { project: "acme/site" },
      }),
    )
  ).json()) as AnyJson;
  const guide = res.result.content[0].text as string;
  assert.match(guide, /Kit: builtin/);
  assert.match(guide, /injected verbatim/);
});

test("an item tool names what is wrong instead of failing silently", async () => {
  const app = makeApp();
  assert.match((await tool(app, "publish_item", { html: "<p>x</p>" })).error!, /slug is required/);
  assert.match(
    (await tool(app, "publish_item", { slug: "empty" })).error!,
    /an item needs html or surfaces/,
  );
  await tool(app, "publish_item", { project: "acme/site", slug: "card", html: "<p>a</p>" });

  assert.match(
    (await tool(app, "ask_user", { project: "acme/site", slug: "nope", text: "?" })).error!,
    /acme\/site has no item "nope"/,
  );
  assert.match(
    (await tool(app, "ask_user", { project: "acme/site", slug: "card" })).error!,
    /ask_user needs text/,
  );
  assert.match(
    (await tool(app, "get_item", { project: "acme/site", slug: "nope" })).error!,
    /has no item "nope"/,
  );
  assert.match(
    (await tool(app, "export_item", { project: "acme/site", slug: "nope" })).error!,
    /has no item "nope"/,
  );
  // an unknown variant is named, so the agent can correct itself in one turn
  assert.match(
    (await tool(app, "export_item", { project: "acme/site", slug: "card", variant: "ghost" }))
      .error!,
    /card has no variant "ghost"/,
  );

  // and an ambiguous address lists the choices rather than guessing
  await tool(app, "publish_item", {
    project: "acme/site",
    slug: "card",
    variant: "ghost",
    html: "<p>b</p>",
  });
  const ambiguous = await tool(app, "ask_user", {
    project: "acme/site",
    slug: "card",
    text: "which?",
  });
  assert.match(ambiguous.error!, /card has 2 variants; pass variant: default\|ghost/);
});

test("a tool call without a project resolves one from the session or the workspace", async () => {
  const app = makeApp();
  // nothing published yet: the workspace default, not a crash
  assert.equal((await tool(app, "list_items", {})).value!.project, "workspace");

  const first = await tool(app, "publish_item", {
    project: "acme/site",
    slug: "card",
    html: "<p>a</p>",
  });
  // the session the publish opened carries the project, so a later call that
  // names only the session lands in the same place
  const bySession = await tool(app, "list_items", { session: first.value!.sessionId });
  assert.equal(bySession.value!.project, "acme/site");
  assert.deepEqual(
    bySession.value!.items.map((i: AnyJson) => i.slug),
    ["card"],
  );
  // an unknown session falls back to the only project there is
  assert.equal((await tool(app, "list_items", { session: "gone" })).value!.project, "acme/site");
});

test("get_item returns bodies and history only when asked", async () => {
  const app = makeApp();
  await tool(app, "publish_item", { project: "acme/site", slug: "card", html: "<p>a</p>" });
  await tool(app, "revise_item", {
    project: "acme/site",
    slug: "card",
    html: "<p>b</p>",
    prompt: "tighter",
    from: 1,
  });

  const lean = (await tool(app, "get_item", { project: "acme/site", slug: "card" })).value!;
  assert.equal(lean.kind, "component");
  assert.equal(lean.variants[0].version, 2);
  assert.equal(lean.variants[0].html, undefined, "a list read never carries bodies");
  assert.equal(lean.variants[0].history, undefined);

  const rich = (
    await tool(app, "get_item", {
      project: "acme/site",
      slug: "card",
      body: true,
      history: true,
    })
  ).value!;
  assert.equal(rich.variants[0].html, "<p>b</p>");
  // the variant's own rail: newest first, each revision carrying its provenance
  assert.deepEqual(rich.variants[0].history, [
    { version: 2, from: 1, prompt: "tighter" },
    { version: 1 },
  ]);

  const exported = (await tool(app, "export_item", { project: "acme/site", slug: "card" })).value!;
  assert.equal(exported.html, "<p>b</p>");
  assert.equal(exported.version, 2);
});

test("publish_item accepts a surfaces array and carries the revision's provenance", async () => {
  const app = makeApp();
  const published = (
    await tool(app, "publish_item", {
      project: "acme/site",
      slug: "deck",
      kind: "page",
      title: "The deck",
      sessionTitle: "deck work",
      surfaces: [{ kind: "markdown", markdown: "# hi" }],
    })
  ).value!;
  assert.equal(published.kind, "page");
  assert.equal(published.title, "The deck");

  const revised = (
    await tool(app, "revise_item", {
      project: "acme/site",
      slug: "deck",
      surfaces: [{ kind: "markdown", markdown: "# ho" }],
      from: 1,
      prompt: "warmer",
      session: published.sessionId,
    })
  ).value!;
  assert.equal(revised.from, 1);
  assert.equal(revised.prompt, "warmer");
  // a page stays a page across revisions, so its slot tags keep re-snapshotting
  assert.equal(revised.kind, "page");
  assert.equal(revised.sessionId, published.sessionId);
});
