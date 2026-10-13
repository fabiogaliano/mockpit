// Designing from a phone: one-tap reactions travel in the reply and reach the
// agent as compact lines; the viewer installs to a home screen (manifest,
// icons, head tags) and a home-screen launch can sign itself back in.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import { reactionLine } from "../server/feedbackBatch.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

type App = ReturnType<typeof createApp>;

const makeApp = (authToken?: string, basePath?: string) =>
  createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html><head><title>mockpit</title></head><body>viewer</body></html>",
    topics: { html: "# guide" },
    setupText: "# setup",
    authToken,
    basePath,
  });

const CT = { "content-type": "application/json" };
const agent = (body: unknown, method = "POST", token?: string) => ({
  method,
  headers: { ...CT, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const viewer = (body: unknown, method = "POST") => ({
  method,
  headers: { ...CT, "sec-fetch-site": "same-origin" },
  body: JSON.stringify(body),
});

async function call(app: App, path: string, init?: RequestInit) {
  const res = await app.request(path, init);
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body, res };
}

// Two looks of one state, so both a part and a variant can be reacted to.
async function hero(app: App) {
  const pub = (variant: string, session?: string) =>
    call(
      app,
      "/api/mocks",
      agent({
        project: "demo",
        mock: "landing",
        variant,
        ...(session ? { session } : {}),
        html: `<section data-part="hero">${variant}</section>`,
      }),
    );
  const first = (await pub("A")).body;
  await pub("B", first.sessionId);
  return { mockId: first.mock.id as string, session: first.sessionId as string };
}

// --- reactions -----------------------------------------------------------------

test("a draft takes reactions without text and refuses unknown ones", async () => {
  const app = makeApp();
  const { mockId } = await hero(app);
  const put = (comments: unknown[]) =>
    call(app, `/api/mocks/${mockId}/draft`, viewer({ comments }, "PUT"));

  assert.equal((await put([{ part: "hero", reaction: "love", variant: "A" }])).status, 400);
  assert.equal((await put([{ part: "hero", reaction: "up", variant: "Z" }])).status, 400);
  // Text is still required on a plain comment.
  assert.equal((await put([{ part: "hero" }])).status, 400);

  const ok = await put([
    { part: "hero", reaction: "up", variant: "A" },
    { part: null, reaction: "more", variant: "B" },
  ]);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.draft.comments, [
    { part: "hero", state: null, text: "", reaction: "up", variant: "A" },
    { part: null, state: null, text: "", reaction: "more", variant: "B" },
  ]);
});

test("a later reaction on the same target replaces the earlier one", async () => {
  const app = makeApp();
  const { mockId } = await hero(app);
  const res = await call(
    app,
    `/api/mocks/${mockId}/draft`,
    viewer(
      {
        comments: [
          { part: "hero", reaction: "up", variant: "A" },
          { part: "hero", reaction: "up", variant: "B" },
          { part: "hero", reaction: "down", variant: "A" },
        ],
      },
      "PUT",
    ),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.draft.comments.map((c: { reaction: string; variant: string }) => [
      c.variant,
      c.reaction,
    ]),
    [
      ["B", "up"],
      ["A", "down"],
    ],
  );
});

test("reactions reach the agent as lines, apart from typed comments", async () => {
  const app = makeApp();
  const { mockId, session } = await hero(app);
  const sent = await call(
    app,
    `/api/mocks/${mockId}/reply`,
    viewer({
      comments: [
        { part: "hero", reaction: "up", variant: "B" },
        { part: null, reaction: "down", variant: "A" },
        { part: "hero", text: "tighter" },
      ],
    }),
  );
  assert.equal(sent.status, 201);
  const { feedback } = (await call(app, `/api/feedback?session=${session}`)).body;
  assert.equal(feedback.length, 1);
  const reply = feedback[0].reply;
  assert.deepEqual(reply.reactions, ['👍 part "hero" (variant B)', "👎 variant A"]);
  assert.deepEqual(reply.comments, [{ part: "hero", state: null, text: "tighter" }]);
  // Delivered once: the cursor moved past it.
  assert.deepEqual((await call(app, `/api/feedback?session=${session}`)).body.feedback, []);
});

test("a reply without reactions carries no reactions field", async () => {
  const app = makeApp();
  const { mockId, session } = await hero(app);
  await call(app, `/api/mocks/${mockId}/reply`, viewer({ text: "fine" }));
  const { feedback } = (await call(app, `/api/feedback?session=${session}`)).body;
  assert.equal("reactions" in feedback[0].reply, false);
});

test("reactionLine names the part, variant and state, and keeps a typed note", () => {
  assert.equal(
    reactionLine({ part: "hero", state: "Mobile", text: "", reaction: "more", variant: "B" }),
    'more like this: part "hero" (variant B, state Mobile)',
  );
  assert.equal(
    reactionLine({ part: null, state: "Mobile", text: "", reaction: "up", variant: "B" }),
    "👍 variant B (state Mobile)",
  );
  assert.equal(
    reactionLine({ part: null, state: null, text: "yes", reaction: "up" }),
    "👍 the page “yes”",
  );
});

// --- the installable app ---------------------------------------------------------

test("the manifest makes the viewer an installable standalone app", async () => {
  const app = makeApp();
  const res = await app.request("/manifest.webmanifest");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^application\/manifest\+json/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const m: any = await res.json();
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.theme_color, "#0f0f0f");
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));

  await call(app, "/api/theme", { ...viewer({ mode: "light" }, "PUT") });
  const light: any = await (await app.request("/manifest.webmanifest")).json();
  assert.equal(light.theme_color, "#fafafa");
});

test("icons are real PNGs and a sandboxed SVG, served without auth", async () => {
  const app = makeApp("secret");
  for (const path of ["/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"]) {
    const res = await app.request(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(Array.from(bytes.subarray(1, 4)), [0x50, 0x4e, 0x47], path);
  }
  const svg = await app.request("/icon.svg");
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.match(svg.headers.get("content-security-policy") ?? "", /default-src 'none'/);
});

test("on a tokened workspace only a signed-in caller gets the key in start_url", async () => {
  const app = makeApp("s3cret");
  const anon = await app.request("/manifest.webmanifest");
  assert.equal(anon.status, 200);
  assert.equal(((await anon.json()) as any).start_url, "./");

  const signed = await app.request("/manifest.webmanifest", {
    headers: { cookie: "mockpit_key=s3cret" },
  });
  assert.equal(((await signed.json()) as any).start_url, "./?key=s3cret");
  assert.match(signed.headers.get("cache-control") ?? "", /no-store/);
  // The launch URL signs in: ?key= sets the cookie the rest of the app reads.
  const launch = await app.request("/?key=s3cret");
  assert.equal(launch.status, 200);
  assert.match(launch.headers.get("set-cookie") ?? "", /mockpit_key=s3cret/);
});

test("the viewer page links the manifest with credentials and the Apple tags", async () => {
  const app = makeApp();
  const html = await (await app.request("/")).text();
  assert.match(
    html,
    /<link rel="manifest" href="\/manifest.webmanifest" crossorigin="use-credentials">/,
  );
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="theme-color" content="#0f0f0f">/);
  // Under a base path the links follow it.
  const prefixed = await (await makeApp(undefined, "/mp").request("/")).text();
  assert.ok(prefixed.includes('href="/mp/manifest.webmanifest"'));
  assert.ok(prefixed.includes('href="/mp/apple-touch-icon.png"'));
});
