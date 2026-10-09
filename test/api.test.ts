import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { createApp } from "../server/app.ts";
import { STDIO_MCP_CATALOG, STDIO_MCP_TOOLS } from "../server/mcpSpec.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import type { Store } from "../server/types.ts";

type App = ReturnType<typeof createApp>;

function makeApp(
  authToken?: string,
  opts: {
    publicRead?: "session" | "full";
    basePath?: string;
    viewerHtml?: string;
    screenshots?: boolean;
    version?: string;
    maxHoldConnections?: number;
    onEvent?: Parameters<typeof createApp>[0]["onEvent"];
    authenticate?: Parameters<typeof createApp>[0]["authenticate"];
    store?: Store;
  } = {},
) {
  const {
    viewerHtml = "<html><head></head><body>viewer</body></html>",
    store = new SqlStore(createSqliteStorage()),
    ...rest
  } = opts;
  return createApp({
    store,
    viewerHtml,
    topics: { html: "# guide" },
    setupText: "# setup",
    authToken,
    ...rest,
  });
}

const CT = { "content-type": "application/json" };

// An agent (CLI, MCP over stdio, curl) never sends Fetch Metadata.
const agent = (body: unknown, method = "POST") => ({
  method,
  headers: CT,
  body: JSON.stringify(body),
});

// The trusted viewer is same-origin, which is what lets it act as the user.
const viewer = (body?: unknown, method = "POST") => ({
  method,
  headers: { ...CT, "sec-fetch-site": "same-origin" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const authed = (body: unknown, method = "POST", token = "secret") => ({
  method,
  headers: { ...CT, authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

async function call(app: App, path: string, init?: RequestInit) {
  const res = await app.request(path, init);
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON — keep the text
  }
  return { status: res.status, body, res };
}

async function publish(app: App, body: Record<string, unknown>, init = agent) {
  const { status, body: out } = await call(app, "/api/mocks", init({ project: "demo", ...body }));
  assert.ok(status === 200 || status === 201, `publish failed ${status}: ${JSON.stringify(out)}`);
  return out;
}

const html = (inner: string) => ({ html: inner });

// A two-state, two-variant mock: the shape most decision tests need.
async function writer(app: App) {
  const first = await publish(app, {
    mock: "writer",
    state: "Writing",
    variant: "quiet",
    knobs: { "body.size": [17, 14, 22, 1] },
    ...html('<h1 data-part="title">T</h1>'),
  });
  const session = first.sessionId;
  const pub = (state: string, variant: string) =>
    publish(app, {
      mock: "writer",
      state,
      variant,
      session,
      ...html(`<p>${state} ${variant}</p>`),
    });
  await pub("Writing", "dark");
  await pub("Lab open", "quiet");
  await pub("Lab open", "dark");
  const mockId: string = first.mock.id;
  return { mockId, session, first };
}

async function variants(app: App, mockId: string) {
  const { body } = await call(app, `/api/mocks/${mockId}`);
  return Object.fromEntries(
    body.variants.map((v: any) => [`${v.state ?? ""}/${v.variant}`, v.status]),
  ) as Record<string, string>;
}

const mcpCall = (id: number, method: string, params?: unknown) =>
  agent({ jsonrpc: "2.0", id, method, params });

async function tool(app: App, name: string, args: Record<string, unknown>) {
  const { body } = await call(app, "/mcp", mcpCall(1, "tools/call", { name, arguments: args }));
  const text = body.result.content[0].text as string;
  if (body.result.isError) return { error: text };
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readSseUntil(res: Response, needle: string, abort?: () => void): Promise<string> {
  assert.ok(res.body);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    await Promise.race([
      (async () => {
        while (!text.includes(needle)) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += decoder.decode(chunk.value, { stream: true });
        }
      })(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out waiting for ${needle}`)), 1000),
      ),
    ]);
  } finally {
    abort?.();
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

// --- publish ---------------------------------------------------------------

test("publish creates session, mock and variant, and answers with parts per state", async () => {
  const app = makeApp();
  const out = await publish(app, {
    mock: "Writer",
    state: "Writing",
    variant: "quiet",
    agent: "pi",
    ...html('<h1 data-part="title" data-part-label="Title">T</h1><p data-part="body">x</p>'),
  });
  assert.equal(out.mock.slug, "writer");
  assert.equal(out.mock.title, "Writer");
  assert.deepEqual(out.mock.states, ["Writing"]);
  assert.equal(out.post.state, "Writing");
  assert.equal(out.post.variant, "quiet");
  assert.equal(out.post.version, 1);
  assert.equal(out.post.status, "open");
  // The write response is lean: surface refs, never the bodies.
  assert.deepEqual(Object.keys(out.post.surfaces[0]).sort(), ["id", "index", "kind"]);
  assert.match(out.url, /\/project\/demo\/writer\?state=Writing&variant=quiet$/);
  assert.deepEqual(out.parts, [
    {
      state: "Writing",
      parts: [{ name: "title", label: "Title" }, { name: "body" }],
    },
  ]);
  assert.equal(out.partChanges, undefined);
  assert.match(out.mock.id, /^[A-Za-z0-9_-]{11}$/);
  assert.match(out.sessionId, /^[A-Za-z0-9_-]{11}$/);

  const sessions = (await call(app, "/api/sessions")).body;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].agent, "pi");
  assert.equal(sessions[0].postCount, 1);
});

test("a second state and variant land on the same mock; parts are listed per state", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  const out = await publish(app, {
    mock: "writer",
    state: "Ghost text",
    variant: "quiet",
    ...html('<span data-part="ghost">g</span>'),
  });
  assert.equal(out.mock.id, mockId);
  assert.deepEqual(out.mock.states, ["Writing", "Lab open", "Ghost text"]);
  assert.deepEqual(
    out.parts.map((s: any) => [s.state, s.parts.map((p: any) => p.name)]),
    [
      ["Writing", ["title"]],
      ["Lab open", []],
      ["Ghost text", ["ghost"]],
    ],
  );
});

test("re-publishing the same (mock, state, variant) is a new version, not a new variant", async () => {
  const app = makeApp();
  const a = await publish(app, { mock: "card", ...html("<p>1</p>") });
  const b = await publish(app, { mock: "card", ...html("<p>2</p>"), prompt: "bigger" });
  assert.equal(b.post.id, a.post.id);
  assert.equal(b.post.version, 2);
  const detail = (await call(app, `/api/mocks/${a.mock.id}?history=1`)).body;
  assert.equal(detail.variants.length, 1);
  assert.equal(detail.variants[0].variant, "default");
  assert.equal(detail.variants[0].state, null);
  assert.deepEqual(
    detail.variants[0].history.map((h: any) => h.version),
    [2, 1],
  );
  assert.equal(detail.variants[0].prompt, "bigger");
});

test("sessionTitle names a session only when the publish creates it", async () => {
  const app = makeApp();
  const a = await publish(app, { mock: "a", sessionTitle: "Cache design", ...html("<p/>") });
  await publish(app, {
    mock: "b",
    session: a.sessionId,
    sessionTitle: "Other",
    ...html("<p/>"),
  });
  const sessions = (await call(app, "/api/sessions")).body;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, "Cache design");
});

test("publish validates its input before anything is stored", async () => {
  const app = makeApp();
  assert.equal((await call(app, "/api/mocks", agent({ html: "<p/>" }))).status, 400);
  assert.equal((await call(app, "/api/mocks", agent({ mock: "x" }))).status, 400);
  assert.equal(
    (await call(app, "/api/mocks", agent({ mock: "x", html: "x".repeat(2 * 1024 * 1024 + 1) })))
      .status,
    413,
  );
  assert.equal(
    (await call(app, "/api/mocks", agent({ mock: "x", session: "nope", html: "<p/>" }))).status,
    404,
  );
  const badKit = await call(
    app,
    "/api/mocks",
    agent({ mock: "x", surfaces: [{ kind: "html", html: "<p/>", kits: ["nope"] }] }),
  );
  assert.equal(badKit.status, 400);
  const badMermaid = await call(
    app,
    "/api/mocks",
    agent({
      mock: "x",
      surfaces: [{ kind: "mermaid", mermaid: 'pie title Pets\n  "Dogs" : broken !!@@' }],
    }),
  );
  assert.equal(badMermaid.status, 400);
  assert.ok(badMermaid.body.code);
  assert.equal((await call(app, "/api/mocks")).body.mocks.length, 0);
});

test("publish refuses a blank html body rather than storing an empty variant", async () => {
  const app = makeApp();
  for (const blank of ["", "   "]) {
    const res = await call(app, "/api/mocks", agent({ mock: "x", html: blank }));
    assert.equal(res.status, 400, JSON.stringify(blank));
  }
  assert.equal((await call(app, "/api/mocks")).body.mocks.length, 0);
});

test("titles and comment text are capped before they ride the feedback channel", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "t", title: "T".repeat(1000), ...html("<p/>") });
  assert.equal(out.mock.title.length, 500);
  await call(
    app,
    "/api/comments",
    viewer({ mock: out.mock.id, text: "x".repeat(20000), author: "user" }),
  );
  const all = (await call(app, `/api/comments?session=${out.sessionId}`)).body;
  assert.equal(all.comments[0].text.length, 8000);
});

// --- state and variant rules ------------------------------------------------

test("a single-state mock with variants refuses a named state (409)", async () => {
  const app = makeApp();
  await publish(app, { mock: "card", ...html("<p/>") });
  const res = await call(
    app,
    "/api/mocks",
    agent({ project: "demo", mock: "card", state: "Open", html: "<p/>" }),
  );
  assert.equal(res.status, 409);
  assert.match(res.body.error, /single-state/);
});

test("omitting the state on a multi-state mock is a 400 that lists the states", async () => {
  const app = makeApp();
  await writer(app);
  const res = await call(
    app,
    "/api/mocks",
    agent({ project: "demo", mock: "writer", html: "<p/>" }),
  );
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.states, ["Writing", "Lab open"]);
});

test("an ambiguous variant is a 400 that lists the choices", async () => {
  const app = makeApp();
  await writer(app);
  const pub = await call(
    app,
    "/api/mocks",
    agent({ project: "demo", mock: "writer", state: "Writing", html: "<p/>" }),
  );
  assert.equal(pub.status, 400);
  assert.deepEqual(pub.body.variants, ["Writing/quiet", "Writing/dark"]);
});

// --- versions ------------------------------------------------------------------

test("a new version flags parts that vanished or were renamed (matched by key)", async () => {
  const app = makeApp();
  const out = await publish(app, {
    mock: "card",
    ...html('<h1 data-part="title">T</h1><p data-part="body" data-part-key="b">x</p>'),
  });
  const rev = await call(
    app,
    "/api/mocks",
    agent({ mock: out.mock.id, html: '<p data-part="copy" data-part-key="b">y</p>' }),
  );
  assert.equal(rev.status, 200);
  assert.equal(rev.body.post.version, 2);
  assert.deepEqual(rev.body.partChanges, {
    vanished: ["title"],
    renamed: [{ from: "body", to: "copy" }],
  });
});

test("publish versions a mock by id or slug; parts and kept ids need an existing variant", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html("<p>1</p>") });
  const bySlug = await call(
    app,
    "/api/mocks",
    agent({ project: "demo", mock: "card", html: "<p>2</p>" }),
  );
  assert.equal(bySlug.status, 200);
  assert.equal(bySlug.body.post.version, 2);
  const byId = await call(app, "/api/mocks", agent({ mock: out.mock.id, html: "<p>3</p>" }));
  assert.equal(byId.body.post.version, 3);
  const parts = await call(
    app,
    "/api/mocks",
    agent({ project: "demo", mock: "nope", parts: { a: "<p/>" } }),
  );
  assert.equal(parts.status, 404);
  const kept = await call(
    app,
    "/api/mocks",
    agent({ project: "demo", mock: "card", variant: "other", surfaces: [{ id: "x" }] }),
  );
  assert.equal(kept.status, 404);
  assert.equal((await call(app, "/api/mocks")).body.mocks.length, 1);
  const two = await call(
    app,
    "/api/mocks",
    agent({ project: "demo", mock: "card", html: "<p/>", parts: { a: "<p/>" } }),
  );
  assert.equal(two.status, 400);
  assert.match(two.body.error, /one of "html", "surfaces" or "parts"/);
});

// --- parts -------------------------------------------------------------------

const CARD =
  '<main><h1 data-part="title">T</h1><ul><li data-part="row" data-part-key="a">A</li>' +
  '<li data-part="row" data-part-key="b">B</li></ul><p data-part="body">old</p></main>';

const currentHtml = async (app: App, mockId: string) =>
  (await call(app, `/api/mocks/${mockId}?body=1`)).body.variants[0].surfaces[0].html as string;

test("publish with parts splices into the current html and diffs against it", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html(CARD), kits: ["builtin"] });
  const rev = await call(
    app,
    "/api/mocks",
    agent({
      mock: out.mock.id,
      parts: {
        body: '<section data-part="copy">new</section>',
        "row#b": '<li data-part="row" data-part-key="b">B2</li>',
      },
    }),
  );
  assert.equal(rev.status, 200, JSON.stringify(rev.body));
  assert.equal(rev.body.post.version, 2);
  assert.deepEqual(rev.body.applied, ["body", "row#b"]);
  assert.deepEqual(rev.body.partChanges, { vanished: ["body"], renamed: [] });
  assert.deepEqual(
    rev.body.parts[0].parts.map((p: any) => p.name),
    ["title", "row", "copy"],
  );
  const full = (await call(app, `/api/mocks/${out.mock.id}?body=1`)).body.variants[0];
  assert.equal(
    full.surfaces[0].html,
    '<main><h1 data-part="title">T</h1><ul><li data-part="row" data-part-key="a">A</li>' +
      '<li data-part="row" data-part-key="b">B2</li></ul><section data-part="copy">new</section></main>',
  );
  assert.deepEqual(full.surfaces[0].kits, ["builtin"]);

  // A plain version answers without `applied`.
  const plain = await call(app, "/api/mocks", agent({ mock: out.mock.id, html: CARD }));
  assert.equal(plain.body.applied, undefined);
});

test("publish with parts reports what is wrong and writes nothing", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html(CARD) });
  const version = (body: object) => call(app, "/api/mocks", agent({ mock: out.mock.id, ...body }));
  const cases: [object, RegExp][] = [
    [{ parts: { nav: "<nav/>" } }, /no part "nav"; parts present: title, row, body/],
    [{ parts: { row: "<li/>" } }, /2 instances; target one: row#a, row#b/],
    [{ parts: { "row#z": "<li/>" } }, /no key "z"; instances: row#a, row#b/],
    [{ parts: { body: "<p/>" }, html: "<p/>" }, /one of "html", "surfaces" or "parts"/],
    [{ parts: {} }, /"parts" is empty/],
    [{ parts: ["<p/>"] }, /"parts" must be an object/],
    [{ parts: { body: 3 } }, /must be the html string/],
  ];
  for (const [body, error] of cases) {
    const res = await version(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, error);
  }
  assert.equal(await currentHtml(app, out.mock.id), CARD);
});

test("publish with parts and from splices into that earlier version", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html(CARD) });
  await call(app, "/api/mocks", agent({ mock: out.mock.id, html: "<p>v2</p>" }));
  const rev = await call(
    app,
    "/api/mocks",
    agent({ mock: out.mock.id, from: 1, parts: { title: '<h1 data-part="title">T3</h1>' } }),
  );
  assert.equal(rev.status, 200, JSON.stringify(rev.body));
  assert.equal(rev.body.post.version, 3);
  assert.equal(await currentHtml(app, out.mock.id), CARD.replace(">T<", ">T3<"));
  const missing = await call(
    app,
    "/api/mocks",
    agent({ mock: out.mock.id, from: 9, parts: { title: "<h1/>" } }),
  );
  assert.equal(missing.status, 404);
});

test("parts across several html surfaces: unique names splice, shared names are ambiguous", async () => {
  const app = makeApp();
  const out = await publish(app, {
    mock: "page",
    surfaces: [
      { kind: "html", html: '<h1 data-part="title">T</h1><i data-part="dup">1</i>' },
      { kind: "markdown", markdown: "# notes" },
      { kind: "html", html: '<p data-part="foot">F</p><i data-part="dup">2</i>' },
    ],
  });
  const ok = await call(
    app,
    "/api/mocks",
    agent({ mock: out.mock.id, parts: { foot: '<p data-part="foot">F2</p>' } }),
  );
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const surfaces = (await call(app, `/api/mocks/${out.mock.id}?body=1`)).body.variants[0].surfaces;
  assert.equal(surfaces[2].html, '<p data-part="foot">F2</p><i data-part="dup">2</i>');
  assert.equal(surfaces[1].markdown, "# notes");
  const dup = await call(app, "/api/mocks", agent({ mock: out.mock.id, parts: { dup: "" } }));
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /part "dup" is in several html surfaces \(0, 2\)/);
});

test("publish takes parts over MCP HTTP", async () => {
  const app = makeApp();
  const out = await publish(app, {
    mock: "card",
    surfaces: [
      { kind: "html", html: CARD },
      { kind: "markdown", markdown: "# notes" },
    ],
  });
  const rev = await tool(app, "publish", {
    project: "demo",
    mock: "card",
    parts: { title: '<h2 data-part="title">MCP</h2>' },
  });
  assert.equal(rev.post.version, 2);
  assert.deepEqual(rev.applied, ["title"]);
  assert.equal(
    await currentHtml(app, out.mock.id),
    CARD.replace('<h1 data-part="title">T</h1>', '<h2 data-part="title">MCP</h2>'),
  );
  const missing = await tool(app, "publish", {
    project: "demo",
    mock: "card",
    parts: { nope: "<p/>" },
  });
  assert.match(missing.error, /no part "nope"; parts present: title, row, body/);
});

// --- knobs -------------------------------------------------------------------

test("knob configs are validated and merged onto the mock by path", async () => {
  const app = makeApp();
  const bad = await call(
    app,
    "/api/mocks",
    agent({ project: "demo", mock: "k", knobs: { "1bad": 3 }, html: "<p/>" }),
  );
  assert.equal(bad.status, 400);
  const out = await publish(app, { mock: "k", knobs: { size: [16, 8, 48, 1] }, ...html("<p/>") });
  assert.equal(out.nudges, undefined);
  await publish(app, {
    mock: "k",
    knobs: { "body.weight": [400, 300, 700, 100] },
    ...html("<p/>"),
  });
  const detail = (await call(app, `/api/mocks/${out.mock.id}`)).body;
  assert.deepEqual(Object.keys(detail.knobs).sort(), ["body.weight", "size"]);
});

test("a knob with three or fewer discrete options earns a nudge toward asking", async () => {
  const app = makeApp();
  const out = await publish(app, {
    mock: "k",
    knobs: {
      "trim.position": { type: "select", options: ["top", "bottom"] },
      "toast.show": true,
      size: [16, 8, 48, 1],
    },
    ...html("<p/>"),
  });
  assert.equal(out.nudges.length, 2);
  assert.match(out.nudges[0], /trim\.position/);
  assert.match(out.nudges[1], /toast\.show/);
});

// --- reads -------------------------------------------------------------------

test("GET /api/mocks lists summaries with open counts; ?project scopes it", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  await publish(app, { project: "other", mock: "card", ...html("<p/>") });
  await call(
    app,
    `/api/mocks/${mockId}/asks`,
    agent({ asks: [{ text: "Which look?", options: ["Quiet", "Dark"] }] }),
  );
  const all = (await call(app, "/api/mocks")).body;
  assert.equal(all.mocks.length, 2);
  // The agent's ask binds no variants, so the viewer also shows its built-in
  // "Which one?": both count as open.
  assert.equal(all.open, 2);
  assert.equal(all.openMocks, 1);
  const demo = (await call(app, "/api/mocks?project=demo")).body;
  assert.equal(demo.project, "demo");
  assert.equal(demo.mocks.length, 1);
  const row = demo.mocks[0];
  assert.equal(row.slug, "writer");
  assert.equal(row.stateCount, 2);
  assert.equal(row.variants, 4);
  assert.equal(row.open, 2);
  assert.ok(row.thumbnail.postId);
});

test("GET /api/mocks/:id resolves an id, a slug in a project, or a unique slug", async () => {
  const app = makeApp();
  const a = await publish(app, { project: "one", mock: "card", ...html("<p>1</p>") });
  await publish(app, { project: "two", mock: "card", ...html("<p>2</p>") });
  await publish(app, { project: "two", mock: "solo", ...html("<p>3</p>") });

  assert.equal((await call(app, `/api/mocks/${a.mock.id}`)).body.project, "one");
  assert.equal((await call(app, "/api/mocks/card?project=two")).body.project, "two");
  assert.equal((await call(app, "/api/mocks/solo")).body.project, "two");
  const ambiguous = await call(app, "/api/mocks/card");
  assert.equal(ambiguous.status, 400);
  assert.deepEqual(ambiguous.body.projects.sort(), ["one", "two"]);
  assert.equal((await call(app, "/api/mocks/nope")).status, 404);
  assert.equal((await call(app, "/api/mocks/nope?project=one")).status, 404);
});

test("mock detail keeps bodies opt-in and never exposes the draft", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html("<p>body</p>") });
  const lean = (await call(app, `/api/mocks/${out.mock.id}`)).body;
  assert.equal(lean.variants[0].surfaces[0].html, undefined);
  assert.equal(lean.draft, undefined);
  assert.deepEqual(lean.tuned, {});
  const full = (await call(app, `/api/mocks/${out.mock.id}?body=1`)).body;
  assert.equal(full.variants[0].surfaces[0].html, "<p>body</p>");
});

test("GET /api/sessions/:id and /api/projects summarize the workspace", async () => {
  const app = makeApp();
  const { session } = await writer(app);
  const row = (await call(app, `/api/sessions/${session}`)).body;
  assert.equal(row.id, session);
  assert.equal(row.postCount, 4);
  assert.equal((await call(app, "/api/sessions/nope")).status, 404);
  const projects = (await call(app, "/api/projects")).body;
  const demo = projects.find((p: any) => p.name === "demo");
  assert.equal(demo.mocks, 1);
  assert.equal(demo.sessions, 1);
});

test("sessions: a harness key hands back the session it created", async () => {
  const app = makeApp();
  const first = await call(app, "/api/sessions", agent({ agent: "cc", title: "A", key: "k1" }));
  assert.equal(first.status, 201);
  const again = await call(app, "/api/sessions", agent({ agent: "cc", title: "B", key: "k1" }));
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.equal(again.body.title, "A");
  const other = await call(app, "/api/sessions", agent({ agent: "cc", key: "k2" }));
  assert.notEqual(other.body.id, first.body.id);
  const unkeyed = await call(app, "/api/sessions", agent({ agent: "cc" }));
  const unkeyedAgain = await call(app, "/api/sessions", agent({ agent: "cc" }));
  assert.notEqual(unkeyed.body.id, unkeyedAgain.body.id);
});

test("sessions: create resolves a project, rename, delete cascades", async () => {
  const app = makeApp();
  const created = await call(app, "/api/sessions", agent({ agent: "pi", cwd: "/work/acme" }));
  assert.equal(created.status, 201);
  assert.equal(created.body.project, "acme");
  const renamed = await call(
    app,
    `/api/sessions/${created.body.id}`,
    agent({ title: "Auth" }, "PATCH"),
  );
  assert.equal(renamed.body.title, "Auth");
  assert.equal(
    (await call(app, `/api/sessions/${created.body.id}`, agent({}, "PATCH"))).status,
    400,
  );

  const out = await publish(app, { mock: "card", ...html("<p/>") });
  await call(app, `/api/mocks/${out.mock.id}/say`, agent({ message: "hi" }));
  assert.equal(
    (await call(app, `/api/sessions/${out.sessionId}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal((await call(app, `/api/mocks/${out.mock.id}`)).status, 404);
  assert.equal((await app.request(`/s/${out.post.id}`)).status, 404);
  assert.equal((await call(app, "/api/sessions/nope", { method: "DELETE" })).status, 404);
});

// --- asks --------------------------------------------------------------------

test("asks are upserted by id and land in the thread", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  const first = await call(
    app,
    `/api/mocks/${mockId}/asks`,
    agent({
      asks: [
        {
          id: "look",
          text: "Which look?",
          options: [
            { label: "Quiet", variant: "quiet" },
            { label: "Dark", variant: "dark" },
          ],
        },
      ],
    }),
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.asks[0].scope, "mock");
  assert.deepEqual(
    first.body.asks[0].options.map((o: any) => o.id),
    ["quiet", "dark"],
  );
  await call(
    app,
    `/api/mocks/${mockId}/asks`,
    agent({ asks: [{ id: "look", text: "Pick a look", options: ["Quiet"] }] }),
  );
  const detail = (await call(app, `/api/mocks/${mockId}`)).body;
  assert.equal(detail.asks.length, 1);
  assert.equal(detail.asks[0].text, "Pick a look");
  assert.equal(detail.open, 2); // plus the built-in "Which one?" for the unbound variants
  const thread = (await call(app, `/api/comments?mock=${mockId}`)).body.comments;
  assert.deepEqual(
    thread.map((c: any) => [c.kind, c.text, c.sessionId]),
    [
      ["ask", "Which look?", session],
      ["ask", "Pick a look", session],
    ],
  );
});

test("ask options must name real variants and valid knob values", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  const ask = (asks: unknown) => call(app, `/api/mocks/${mockId}/asks`, agent({ asks }));
  assert.equal(
    (await ask([{ text: "x", options: [{ label: "A", variant: "loud" }] }])).status,
    400,
  );
  assert.equal(
    (await ask([{ text: "x", options: [{ label: "A", set: { "body.size": 99 } }] }])).status,
    400,
  );
  assert.equal(
    (await ask([{ text: "x", options: [{ label: "A", set: { nope: 1 } }] }])).status,
    400,
  );
  assert.equal((await ask([{ text: "x", options: [] }])).status, 400);
  assert.equal(
    (await ask([{ text: "x", scope: "state", state: "Nope", options: ["A"] }])).status,
    400,
  );
  assert.equal((await ask([{ text: "x", scope: "part", options: ["A"] }])).status, 400);
  assert.equal((await ask([])).status, 400);
  const ok = await ask([{ text: "Size?", options: [{ label: "Big", set: { "body.size": 20 } }] }]);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.asks[0].options[0].set, { "body.size": 20 });
});

// --- drafts --------------------------------------------------------------------

test("drafts are viewer-only, validated, and survive until cleared", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  await call(
    app,
    `/api/mocks/${mockId}/asks`,
    agent({ asks: [{ id: "look", text: "Look?", options: [{ label: "Dark", variant: "dark" }] }] }),
  );
  const path = `/api/mocks/${mockId}/draft`;
  assert.equal((await call(app, path)).status, 403);
  assert.equal((await call(app, path, agent({ answers: {} }, "PUT"))).status, 403);
  assert.equal((await call(app, path, { method: "DELETE" })).status, 403);

  const put = (body: unknown) => call(app, path, viewer(body, "PUT"));
  assert.equal((await put({ answers: { nope: "dark" } })).status, 400);
  assert.equal((await put({ answers: { look: "loud" } })).status, 400);
  assert.equal((await put({ mix: { body: "loud" } })).status, 400);
  assert.equal((await put({ tuned: { "body.size": 99 } })).status, 400);
  assert.equal((await put({ tuned: { nope: 1 } })).status, 400);
  assert.equal((await put({ comments: [{ part: "title" }] })).status, 400);
  assert.equal((await put({ comments: [{ text: "x", state: "Nope" }] })).status, 400);

  const draft = {
    answers: { look: "dark" },
    mix: { title: "quiet" },
    tuned: { "body.size": 19 },
    comments: [{ part: "title", state: "Writing", text: "bigger", anchor: { quote: "T" } }],
  };
  const saved = await put(draft);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.draft.version, 1);
  const read = (await call(app, path, viewer(undefined, "GET"))).body.draft;
  assert.deepEqual(
    { answers: read.answers, mix: read.mix, tuned: read.tuned, comments: read.comments },
    draft,
  );
  assert.equal((await call(app, path, viewer(undefined, "DELETE"))).body.draft, null);
  assert.equal((await call(app, path, viewer(undefined, "GET"))).body.draft, null);
});

// --- reply ---------------------------------------------------------------------

async function lookAsk(app: App, mockId: string, scope = "mock", extra: object = {}) {
  await call(
    app,
    `/api/mocks/${mockId}/asks`,
    agent({
      asks: [
        {
          id: "look",
          text: "Which look?",
          scope,
          ...extra,
          options: [
            { label: "Quiet", variant: "quiet" },
            { label: "Dark", variant: "dark" },
          ],
        },
      ],
    }),
  );
}

test("reply is viewer-only and refuses to send nothing", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  assert.equal((await call(app, `/api/mocks/${mockId}/reply`, agent({ text: "hi" }))).status, 403);
  const empty = await call(app, `/api/mocks/${mockId}/reply`, viewer({}));
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /nothing to send/);
});

test("reply sends the draft as one reply comment, clears it, and flips statuses", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  await lookAsk(app, mockId);
  await call(
    app,
    `/api/mocks/${mockId}/draft`,
    viewer({ answers: { look: "dark" }, tuned: { "body.size": 19 } }, "PUT"),
  );
  const sent = await call(app, `/api/mocks/${mockId}/reply`, viewer({ text: "go dark" }));
  assert.equal(sent.status, 201);
  const reply = sent.body.reply;
  assert.equal(reply.kind, "reply");
  assert.equal(reply.author, "user");
  assert.equal(reply.sessionId, session);
  assert.equal(reply.delivered, false);
  assert.deepEqual(reply.payload.answers, { look: "dark" });
  assert.deepEqual(reply.payload.tuned, { "body.size": 19 });
  assert.equal(reply.payload.text, "go dark");
  assert.deepEqual(sent.body.accepted, [
    { state: "Writing", variant: "dark" },
    { state: "Lab open", variant: "dark" },
  ]);
  assert.deepEqual(await variants(app, mockId), {
    "Writing/quiet": "archived",
    "Writing/dark": "accepted",
    "Lab open/quiet": "archived",
    "Lab open/dark": "accepted",
  });
  assert.equal(
    (await call(app, `/api/mocks/${mockId}/draft`, viewer(undefined, "GET"))).body.draft,
    null,
  );
  const detail = (await call(app, `/api/mocks/${mockId}`)).body;
  assert.equal(detail.asks[0].answer, "dark");
  assert.equal(detail.open, 0);
  assert.deepEqual(detail.tuned, { "body.size": 19 });
});

test("a state-scoped answer flips only its state; a part-scoped one flips nothing", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  await lookAsk(app, mockId, "state", { state: "Lab open" });
  await call(app, `/api/mocks/${mockId}/reply`, viewer({ answers: { look: "quiet" } }));
  assert.deepEqual(await variants(app, mockId), {
    "Writing/quiet": "open",
    "Writing/dark": "open",
    "Lab open/quiet": "accepted",
    "Lab open/dark": "archived",
  });

  const other = makeApp();
  const w = await writer(other);
  await lookAsk(other, w.mockId, "part", { part: "title" });
  const sent = await call(
    other,
    `/api/mocks/${w.mockId}/reply`,
    viewer({ answers: { look: "dark" } }),
  );
  assert.deepEqual(sent.body.accepted, []);
  assert.deepEqual(sent.body.archived, []);
});

test("a drop decision archives the variant; restore brings it back", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  const sent = await call(
    app,
    `/api/mocks/${mockId}/reply`,
    viewer({ decision: { kind: "drop", state: "Writing", variant: "quiet" } }),
  );
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.body.archived, [{ state: "Writing", variant: "quiet" }]);
  assert.equal((await variants(app, mockId))["Writing/quiet"], "archived");
  const bad = await call(app, `/api/mocks/${mockId}/reply`, viewer({ decision: { kind: "nope" } }));
  assert.equal(bad.status, 400);

  const restored = await call(
    app,
    `/api/mocks/${mockId}/restore`,
    agent({ state: "Writing", variant: "quiet" }),
  );
  assert.deepEqual(restored.body, { state: "Writing", variant: "quiet", status: "open" });
  assert.equal((await variants(app, mockId))["Writing/quiet"], "open");
});

test("restore as vN writes an older version back as a new user-authored version", async () => {
  const events: any[] = [];
  const app = makeApp(undefined, { onEvent: (e) => events.push(e) });
  const first = await publish(app, { mock: "card", title: "One", ...html("<p>one</p>") });
  const mockId: string = first.mock.id;
  const postId: string = first.post.id;
  await call(
    app,
    "/api/mocks",
    agent({ mock: mockId, title: "Two", prompt: "tighter", ...html("<p>two</p>") }),
  );
  const path = `/api/mocks/${mockId}/variants/${postId}/restore`;
  assert.equal((await call(app, path, agent({ version: 1 }))).status, 403);
  assert.equal((await call(app, path, viewer({ version: 0 }))).status, 400);
  assert.equal((await call(app, path, viewer({ version: 9 }))).status, 404);
  assert.equal((await call(app, path, viewer({ version: 2 }))).status, 409);
  assert.equal(
    (await call(app, `/api/mocks/${mockId}/variants/nope/restore`, viewer({ version: 1 }))).status,
    404,
  );

  events.length = 0;
  const restored = await call(app, path, viewer({ version: 1 }));
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body, { state: null, variant: "default", version: 3, from: 1 });
  assert.deepEqual(
    events.map((e) => e.type),
    ["mock-updated", "post-updated"],
  );
  assert.equal(events[1].version, 3);
  assert.equal(events[1].by, "user");

  const detail = (await call(app, `/api/mocks/${mockId}?history=1&body=1`)).body;
  const v = detail.variants[0];
  assert.equal(v.version, 3);
  assert.equal(v.title, "One");
  assert.equal(v.surfaces[0].html, "<p>one</p>");
  assert.deepEqual(
    v.history.map((h: any) => [h.version, h.from ?? null, h.prompt ?? "", h.author ?? null]),
    [
      [3, 1, "restored v1", "user"],
      [2, 1, "tighter", null],
      [1, null, "", null],
    ],
  );
  const doc = await call(app, `/s/${postId}?surface=0&ver=3`);
  assert.match(doc.body, /<p>one<\/p>/);
});

test("a reply drafted on an older version is accepted and keeps that version", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  await lookAsk(app, mockId);
  await call(
    app,
    `/api/mocks/${mockId}/draft`,
    viewer({ version: 1, answers: { look: "dark" } }, "PUT"),
  );
  await call(
    app,
    "/api/mocks",
    agent({ mock: mockId, state: "Writing", variant: "dark", ...html("<p>Writing dark v2</p>") }),
  );
  const sent = await call(app, `/api/mocks/${mockId}/reply`, viewer({}));
  assert.equal(sent.status, 201);
  assert.equal(sent.body.reply.payload.version, 1);
  const read = (await call(app, `/api/comments?session=${session}&author=user`)).body;
  assert.equal(read.feedback[0].reply.version, 1);
});

test("an accept decision accepts the variant and archives its siblings", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  await call(
    app,
    `/api/mocks/${mockId}/reply`,
    viewer({ decision: { kind: "accept", state: "Lab open", variant: "dark" } }),
  );
  const v = await variants(app, mockId);
  assert.equal(v["Lab open/dark"], "accepted");
  assert.equal(v["Lab open/quiet"], "archived");
  assert.equal(v["Writing/quiet"], "open");
});

// --- feedback delivery -------------------------------------------------------------

test("a reply reaches the agent exactly once, with the asks resolved", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  await lookAsk(app, mockId);
  await call(app, `/api/mocks/${mockId}/reply`, viewer({ answers: { look: "dark" } }));
  const read = (await call(app, `/api/comments?session=${session}&author=user`)).body;
  assert.deepEqual(Object.keys(read).sort(), ["comments", "feedback", "lastSeq"]);
  assert.equal(read.feedback.length, 1);
  const batch = read.feedback[0];
  assert.equal(batch.mock, "writer");
  assert.equal(batch.project, "demo");
  assert.equal(batch.reply.asks[0].text, "Which look?");
  assert.equal(batch.reply.asks[0].chosen[0].variant, "dark");
  assert.equal(batch.accepted.length, 2);
  const again = (await call(app, `/api/comments?session=${session}&author=user`)).body;
  assert.deepEqual(again.feedback, []);
  assert.equal(again.lastSeq, read.lastSeq);
  // The viewer's unfiltered read never touches the cursor and reports delivery.
  const thread = (await call(app, `/api/comments?mock=${mockId}`)).body.comments;
  assert.equal(thread.find((c: any) => c.kind === "reply").delivered, true);
});

test("notes and write-ins draft, validate, reach the agent in one reply, and clear", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  await call(
    app,
    `/api/mocks/${mockId}/asks`,
    agent({
      asks: [
        {
          id: "look",
          text: "Which look?",
          options: [
            { label: "Quiet", variant: "quiet" },
            { label: "Dark", variant: "dark" },
          ],
        },
        { id: "lang", text: "Which language?", options: ["English", "Portuguese"] },
        { id: "list", text: "Which list?", multi: true, options: ["Table", "Cards"] },
      ],
    }),
  );
  const path = `/api/mocks/${mockId}/draft`;
  const put = (body: unknown) => call(app, path, viewer(body, "PUT"));
  assert.equal((await put({ notes: { nope: "x" } })).status, 400);
  assert.equal((await put({ others: { lang: 3 } })).status, 400);
  assert.equal((await put({ others: [] })).status, 400);
  const both = await put({ answers: { lang: "english" }, others: { lang: "Both" } });
  assert.equal(both.status, 400, "a single ask takes an option or a write-in, not both");
  assert.match(both.body.error, /takes one answer/);
  assert.equal(
    (await put({ answers: { list: ["table"] }, others: { list: "a map" } })).status,
    200,
    "a multi ask takes both",
  );

  const long = "x".repeat(9000);
  const saved = await put({
    others: { lang: " Both, side by side ", list: "  " },
    notes: { list: "Table on desktop, Cards on mobile", look: long },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.draft.others, { lang: "Both, side by side" });
  assert.equal(saved.body.draft.notes.look.length, 8000);
  const read = (await call(app, path, viewer(undefined, "GET"))).body.draft;
  assert.equal(read.notes.list, "Table on desktop, Cards on mobile");
  // Never delivered before Send.
  const early = (await call(app, `/api/comments?session=${session}&author=user`)).body;
  assert.deepEqual(early.feedback, []);

  await put({ others: { lang: "Both, side by side" }, notes: { list: "Table on desktop" } });
  const sent = await call(app, `/api/mocks/${mockId}/reply`, viewer({}));
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.body.accepted, [], "a write-in flips no variant");
  assert.equal((await call(app, path, viewer(undefined, "GET"))).body.draft, null);
  const batch = (await call(app, `/api/comments?session=${session}&author=user`)).body.feedback[0];
  assert.deepEqual(batch.reply.asks, [
    {
      ask: "lang",
      text: "Which language?",
      chosen: [{ id: "other", label: "Both, side by side", other: true }],
    },
    { ask: "list", text: "Which list?", chosen: [], note: "Table on desktop" },
  ]);
  assert.equal(batch.reply.others, undefined);
  const detail = (await call(app, `/api/mocks/${mockId}`)).body;
  const byId = Object.fromEntries(detail.asks.map((a: any) => [a.id, a]));
  assert.equal(byId.lang.other, "Both, side by side");
  assert.equal(byId.list.note, "Table on desktop");
  assert.equal(detail.open, 1, "a write-in or a note answers its ask; look stays open");
});

test("the option id `other` is reserved for the viewer's write-in", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  const ask = (options: unknown[]) =>
    call(app, `/api/mocks/${mockId}/asks`, agent({ asks: [{ text: "Lang?", options }] }));
  const bad = await ask([{ id: "other", label: "Something else" }]);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /"other" is reserved/);
  const ok = await ask(["English", "Other"]);
  assert.equal(ok.status, 200);
  assert.deepEqual(
    ok.body.asks[0].options.map((o: any) => o.id),
    ["english", "other-2"],
  );
});

test("user feedback piggybacks on the agent's next write, once", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html("<p>1</p>") });
  assert.deepEqual(out.feedback, []);
  await call(app, "/api/comments", viewer({ mock: out.mock.id, text: "wider", author: "user" }));
  const next = await publish(app, { mock: "card", session: out.sessionId, ...html("<p>2</p>") });
  assert.deepEqual(
    next.feedback.flatMap((b: any) => b.comments.map((c: any) => c.text)),
    ["wider"],
  );
  const third = await publish(app, { mock: "card", session: out.sessionId, ...html("<p>3</p>") });
  assert.deepEqual(third.feedback, []);
  const read = (await call(app, `/api/feedback?session=${out.sessionId}`)).body;
  assert.deepEqual(read.feedback, []);
});

test("long-poll resolves when a comment arrives", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html("<p/>") });
  const pending = app.request(`/api/comments?session=${out.sessionId}&author=user&wait=5`);
  setTimeout(() => {
    void app.request(
      "/api/comments",
      viewer({ mock: out.mock.id, text: "feedback!", author: "user" }),
    );
  }, 50);
  const start = Date.now();
  const result = (await (await pending).json()) as any;
  assert.equal(result.comments.length, 1);
  assert.equal(result.feedback[0].comments[0].text, "feedback!");
  assert.ok(Date.now() - start < 4000);
});

test("GET /api/feedback never blocks, needs a session, and reads share its cursor", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  assert.equal((await call(app, "/api/feedback")).status, 400);
  assert.equal((await call(app, "/api/feedback?session=nope")).status, 404);
  await call(app, "/api/comments", viewer({ mock: mockId, text: "hi", author: "user" }));
  // Reads report pending and never take feedback.
  await call(app, "/api/mocks?project=demo");
  await call(app, `/api/mocks/${mockId}`);
  const started = Date.now();
  const read = (await call(app, `/api/feedback?session=${session}`)).body;
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(Object.keys(read).sort(), ["feedback", "pending"]);
  assert.deepEqual(
    read.feedback.flatMap((b: any) => b.comments.map((c: any) => c.text)),
    ["hi"],
  );
  assert.deepEqual((await call(app, `/api/feedback?session=${session}`)).body.feedback, []);
});

test("pending reports draft progress and whether a viewer has that mock on screen", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  await lookAsk(app, mockId);
  await call(
    app,
    `/api/mocks/${mockId}/asks`,
    agent({ asks: [{ id: "size", text: "Size?", options: ["S", "L"] }] }),
  );
  const pending = async () => (await call(app, `/api/feedback?session=${session}`)).body.pending;
  assert.deepEqual(await pending(), [{ mock: "writer", viewerOpen: false, draft: null }]);

  await call(
    app,
    `/api/mocks/${mockId}/draft`,
    viewer(
      { answers: { look: "dark" }, comments: [{ part: "title", state: "Writing", text: "x" }] },
      "PUT",
    ),
  );
  // A tab on Home (no `viewing`) or on another mock isn't looking at this one.
  const home = new AbortController();
  const homeSse = await app.request("/api/events", { signal: home.signal });
  const other = new AbortController();
  const otherSse = await app.request("/api/events?viewing=elsewhere", { signal: other.signal });
  assert.equal((await pending())[0].viewerOpen, false);
  const ac = new AbortController();
  const sse = await app.request(`/api/events?viewing=${mockId}`, { signal: ac.signal });
  const [entry] = await pending();
  assert.equal(entry.viewerOpen, true);
  assert.deepEqual(
    { ...entry.draft, touchedAt: typeof entry.draft.touchedAt },
    { answered: 1, of: 2, comments: 1, touchedAt: "string" },
  );
  const list = (await call(app, "/api/mocks?project=demo")).body;
  assert.equal(list.pending[0].draft.answered, 1);
  const detail = (await call(app, `/api/mocks/${mockId}`)).body;
  assert.equal(detail.pending.mock, "writer");
  assert.equal(detail.pending.draft.of, 2);

  for (const [c, r] of [
    [ac, sse],
    [home, homeSse],
    [other, otherSse],
  ] as const) {
    c.abort();
    await r.body!.cancel().catch(() => undefined);
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await pending())[0].viewerOpen, false);
  await call(app, `/api/mocks/${mockId}/reply`, viewer({}));
  assert.equal((await pending())[0].draft, null, "Send clears the draft");
});

test("two variants no ask binds earn a nudge and a ready ask; a binding ask silences it", async () => {
  const app = makeApp();
  const one = await publish(app, { mock: "card", variant: "calm", ...html("<p/>") });
  assert.equal(one.nudges, undefined);
  assert.equal(one.suggestedAsk, undefined);
  const two = await publish(app, {
    mock: "card",
    variant: "bold",
    session: one.sessionId,
    ...html("<p/>"),
  });
  assert.match(two.nudges[0], /2 variants and no ask binds them: call ask with suggestedAsk/);
  assert.deepEqual(two.suggestedAsk, {
    id: "variant",
    text: "Which one?",
    scope: "mock",
    options: [
      { label: "calm", variant: "calm" },
      { label: "bold", variant: "bold" },
    ],
  });
  // The suggestion is ready to send as is.
  const asked = await call(
    app,
    `/api/mocks/${one.mock.id}/asks`,
    agent({ asks: [two.suggestedAsk] }),
  );
  assert.equal(asked.status, 200);
  const again = await publish(app, { mock: "card", variant: "bold", ...html("<p>2</p>") });
  assert.equal(again.nudges, undefined);
  assert.equal(again.suggestedAsk, undefined);
  // A third variant the ask does not bind brings it back.
  const third = await publish(app, { mock: "card", variant: "loud", ...html("<p/>") });
  assert.equal(third.suggestedAsk.options.length, 3);
});

test("the suggested ask is mock-wide when variants line up across states, else per state", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  const wide = await publish(app, {
    mock: mockId,
    state: "Lab open",
    variant: "dark",
    ...html("<p>2</p>"),
  });
  assert.equal(wide.suggestedAsk.scope, "mock");
  await publish(app, {
    mock: mockId,
    state: "Lab open",
    variant: "loud",
    session,
    ...html("<p/>"),
  });
  const narrow = await publish(app, {
    mock: mockId,
    state: "Lab open",
    variant: "dark",
    ...html("<p>3</p>"),
  });
  assert.equal(narrow.suggestedAsk.scope, "state");
  assert.equal(narrow.suggestedAsk.state, "Lab open");
  assert.equal(narrow.suggestedAsk.id, "variant-lab-open");
  assert.deepEqual(
    narrow.suggestedAsk.options.map((o: any) => o.variant),
    ["quiet", "dark", "loud"],
  );
  assert.match(narrow.nudges[0], /writer state "Lab open" has 3 variants/);
  const sent = await call(app, `/api/mocks/${mockId}/asks`, agent({ asks: [narrow.suggestedAsk] }));
  assert.equal(sent.status, 200);
  const quiet = await publish(app, {
    mock: mockId,
    state: "Lab open",
    variant: "dark",
    ...html("<p>4</p>"),
  });
  assert.equal(quiet.suggestedAsk, undefined, "a state ask binds its own state");
});

test("a reply to the built-in variant ask flips per state and reads like any ask", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  await call(app, `/api/mocks/${mockId}/draft`, viewer({ answers: { variant: "dark" } }, "PUT"));
  const sent = await call(app, `/api/mocks/${mockId}/reply`, viewer({}));
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.deepEqual(await variants(app, mockId), {
    "Writing/quiet": "archived",
    "Writing/dark": "accepted",
    "Lab open/quiet": "archived",
    "Lab open/dark": "accepted",
  });
  const read = (await call(app, `/api/feedback?session=${session}`)).body;
  assert.deepEqual(read.feedback[0].reply.asks, [
    {
      ask: "variant",
      text: "Which one?",
      chosen: [{ id: "dark", label: "dark", variant: "dark" }],
    },
  ]);
  // Nothing is stored as an ask.
  assert.deepEqual((await call(app, `/api/mocks/${mockId}`)).body.asks, []);

  const other = makeApp();
  const w = await writer(other);
  const perState = await call(
    other,
    `/api/mocks/${w.mockId}/reply`,
    viewer({ answers: { "variant:Lab open": "quiet" }, notes: { "variant:Lab open": "calmer" } }),
  );
  assert.equal(perState.status, 201, JSON.stringify(perState.body));
  assert.deepEqual(await variants(other, w.mockId), {
    "Writing/quiet": "open",
    "Writing/dark": "open",
    "Lab open/quiet": "accepted",
    "Lab open/dark": "archived",
  });
  const fb = (await call(other, `/api/feedback?session=${w.session}`)).body.feedback[0];
  assert.equal(fb.reply.asks[0].ask, "variant:Lab open");
  assert.equal(fb.reply.asks[0].chosen[0].label, "quiet");
  assert.equal(fb.reply.asks[0].note, "calmer");
  for (const answers of [
    { variant: "nope" },
    { "variant:Nope": "dark" },
    { variant: ["dark", "quiet"] },
  ]) {
    const bad = await call(other, `/api/mocks/${w.mockId}/reply`, viewer({ answers }));
    assert.equal(bad.status, 400, JSON.stringify(answers));
  }
});

// --- comments ------------------------------------------------------------------------

test("POST /api/comments is the viewer's; an agent writes with say, as its own agent", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", agent: "pi", ...html("<p/>") });
  const forged = await call(
    app,
    "/api/comments",
    agent({ mock: out.mock.id, text: "x", author: "user" }),
  );
  assert.equal(forged.status, 403);
  assert.match(forged.body.error, /say/);
  const said = await call(app, `/api/mocks/card/say`, agent({ project: "demo", message: "done" }));
  assert.equal(said.status, 201);
  assert.deepEqual(said.body, { feedback: [] });
  assert.equal(
    (await call(app, `/api/mocks/card/say`, agent({ project: "demo", message: { html: "<b>" } })))
      .status,
    400,
  );
  const user = await call(
    app,
    "/api/comments",
    viewer({ mock: out.mock.id, text: "x", author: "user" }),
  );
  assert.equal(user.body.author, "user");
  assert.equal(user.body.delivered, false);
  const thread = (await call(app, `/api/comments?mock=${out.mock.id}`)).body.comments;
  assert.deepEqual(
    thread.map((c: any) => [c.author, c.text, typeof c.delivered]),
    [
      ["pi", "done", "boolean"],
      ["user", "x", "boolean"],
    ],
  );
});

test("say piggybacks the user's feedback and can address a variant", async () => {
  const app = makeApp();
  const { mockId, session } = await writer(app);
  await call(app, "/api/comments", viewer({ mock: mockId, text: "hello", author: "user" }));
  const said = await call(
    app,
    `/api/mocks/${mockId}/say`,
    agent({ session, state: "Writing", variant: "dark", message: "on it" }),
  );
  assert.equal(said.status, 201);
  assert.deepEqual(
    said.body.feedback.flatMap((b: any) => b.comments.map((c: any) => c.text)),
    ["hello"],
  );
  const thread = (await call(app, `/api/comments?mock=${mockId}`)).body.comments;
  const mine = thread.find((c: any) => c.text === "on it");
  assert.ok(mine.postId);
  assert.equal(
    (await call(app, `/api/mocks/${mockId}/say`, agent({ state: "Writing", message: "x" }))).status,
    400,
  );
});

test("comments target a mock, a state/variant, or a post, and carry sanitized anchors", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  assert.equal((await call(app, "/api/comments", viewer({ text: "x" }))).status, 400);
  assert.equal((await call(app, "/api/comments", viewer({ mock: mockId }))).status, 400);
  assert.equal((await call(app, "/api/comments", viewer({ post: "nope", text: "x" }))).status, 404);

  const onPart = await call(
    app,
    "/api/comments",
    viewer({
      mock: mockId,
      text: "bigger",
      author: "user",
      anchor: { kind: "part", part: "title", state: "Writing", quote: "T", junk: "<script>" },
    }),
  );
  assert.equal(onPart.status, 201);
  assert.deepEqual(onPart.body.anchor, {
    kind: "part",
    part: "title",
    state: "Writing",
    quote: "T",
  });
  assert.equal(onPart.body.mockId, mockId);
  assert.equal(onPart.body.postId, null);

  const onVariant = await call(
    app,
    "/api/comments",
    viewer({
      mock: mockId,
      state: "Writing",
      variant: "dark",
      text: "here",
      author: "user",
      anchor: { kind: "rect", surfaceIndex: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      viewport: 820,
    }),
  );
  assert.ok(onVariant.body.postId);
  assert.equal(onVariant.body.anchor.kind, "rect");
  assert.equal(onVariant.body.viewport, 820);
  // Out-of-range geometry is dropped, not stored.
  const bad = await call(
    app,
    "/api/comments",
    viewer({
      mock: mockId,
      state: "Writing",
      variant: "dark",
      text: "x",
      anchor: { kind: "point", surfaceIndex: 0, x: 5, y: 0 },
    }),
  );
  assert.equal(bad.body.anchor, undefined);

  const del = await call(app, `/api/comments/${onPart.body.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.equal(
    (await call(app, `/api/comments/${onPart.body.id}`, { method: "DELETE" })).status,
    404,
  );
});

// --- the full surface list --------------------------------------------------------------

test("publish with the full surface list adds, edits, removes and reorders by id", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html("<p>a</p>") });
  const [htmlId] = out.post.surfaces.map((s: any) => s.id);
  const version = (surfaces: unknown[]) =>
    call(app, "/api/mocks", agent({ mock: out.mock.id, surfaces }));

  const added = await version([{ id: htmlId }, { kind: "markdown", markdown: "# hi" }]);
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.post.version, 2);
  assert.deepEqual(
    added.body.post.surfaces.map((s: any) => [s.kind, s.id === htmlId]),
    [
      ["html", true],
      ["markdown", false],
    ],
  );
  const mdId = added.body.post.surfaces[1].id;
  const before = await version([
    { kind: "code", code: "x", language: "ts" },
    { id: htmlId },
    { id: mdId },
  ]);
  assert.deepEqual(
    before.body.post.surfaces.map((s: any) => s.kind),
    ["code", "html", "markdown"],
  );
  const codeId = before.body.post.surfaces[0].id;

  const edited = await version([
    { id: codeId },
    { id: htmlId },
    { id: mdId, kind: "markdown", markdown: "# changed" },
  ]);
  assert.equal(edited.status, 200);
  const body = (await call(app, `/api/mocks/${out.mock.id}?body=1`)).body.variants[0].surfaces;
  assert.equal(body[2].markdown, "# changed");
  assert.equal(body[2].id, mdId, "an edited surface keeps its id");
  assert.equal(body[1].html, "<p>a</p>", "a kept surface keeps its content");

  const reordered = await version([{ id: mdId }, { id: htmlId }, { id: codeId }]);
  assert.deepEqual(
    reordered.body.post.surfaces.map((s: any) => s.kind),
    ["markdown", "html", "code"],
  );
  const removed = await version([{ id: htmlId }, { id: codeId }]);
  assert.deepEqual(
    removed.body.post.surfaces.map((s: any) => s.kind),
    ["html", "code"],
  );

  assert.equal((await version([])).status, 400);
  assert.equal((await version([{ id: "nope" }])).status, 404);
  assert.equal((await version([{ id: htmlId }, { id: htmlId }])).status, 400);
  const invalid = await version([{ id: htmlId }, { kind: "markdown" }]);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.issues[0].requestPath, "surfaces[1].markdown");
});

test("the full surface list on a multi-variant mock needs state and variant", async () => {
  const app = makeApp();
  const { mockId } = await writer(app);
  const surfaces = [{ kind: "markdown", markdown: "x" }];
  assert.equal(
    (await call(app, "/api/mocks", agent({ mock: mockId, state: "Lab open", surfaces }))).status,
    400,
  );
  const ok = await call(
    app,
    "/api/mocks",
    agent({ mock: mockId, state: "Lab open", variant: "dark", surfaces }),
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.post.state, "Lab open");
  assert.equal(ok.body.post.version, 2);
});

// --- export and delete -----------------------------------------------------------------

test("export returns the accepted variant per state, with history and the last reply", async () => {
  const app = makeApp(undefined, { screenshots: true });
  const { mockId } = await writer(app);
  await lookAsk(app, mockId);
  await call(
    app,
    `/api/mocks/${mockId}/reply`,
    viewer({ answers: { look: "dark" }, tuned: { "body.size": 18 } }),
  );
  const out = (await call(app, `/api/mocks/${mockId}/export`)).body;
  assert.equal(out.mock, "writer");
  assert.deepEqual(
    out.states.map((s: any) => [s.state, s.variant, s.status]),
    [
      ["Writing", "dark", "accepted"],
      ["Lab open", "dark", "accepted"],
    ],
  );
  assert.equal(out.states[0].html, "<p>Writing dark</p>");
  assert.match(out.states[0].screenshotUrl, /\/s\/[^/]+\.png\?v=1$/);
  assert.equal(out.states[0].history.length, 1);
  assert.deepEqual(out.reply.tuned, { "body.size": 18 });

  const one = (await call(app, `/api/mocks/${mockId}/export?state=Writing&variant=quiet`)).body;
  assert.deepEqual(
    one.states.map((s: any) => s.variant),
    ["quiet"],
  );
  assert.equal((await call(app, `/api/mocks/${mockId}/export?state=Nope`)).status, 404);
});

test("DELETE /api/mocks/:id removes the mock, its variants and documents", async () => {
  const events: any[] = [];
  const app = makeApp(undefined, { onEvent: (e) => events.push(e) });
  const out = await publish(app, { mock: "card", ...html("<p/>") });
  assert.equal((await call(app, `/api/mocks/${out.mock.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await call(app, `/api/mocks/${out.mock.id}`)).status, 404);
  assert.equal((await app.request(`/s/${out.post.id}`)).status, 404);
  assert.deepEqual(events.at(-1), { type: "mock-deleted", id: out.mock.id, project: "demo" });
});

test("deleted routes are gone", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html("<p/>") });
  for (const [method, path] of [
    ["POST", "/api/posts"],
    ["POST", "/api/surfaces"],
    ["POST", "/api/snippets"],
    ["POST", "/api/test-post"],
    ["POST", `/api/mocks/${out.mock.id}/revise`],
    ["POST", `/api/mocks/${out.mock.id}/surfaces`],
    ["PATCH", `/api/mocks/${out.mock.id}/surfaces`],
    ["PATCH", `/api/mocks/${out.mock.id}/surfaces/0`],
    ["DELETE", `/api/mocks/${out.mock.id}/surfaces/0`],
    ["GET", "/api/posts/recent"],
    ["GET", `/api/posts/${out.post.id}`],
    ["GET", `/p/${out.post.id}`],
    ["GET", `/session/${out.sessionId}`],
    ["GET", `/api/sessions/${out.sessionId}/posts`],
    ["GET", `/api/sessions/${out.sessionId}/trace`],
    ["GET", "/api/projects/demo/items"],
    ["POST", "/api/demo/reshape"],
  ]) {
    const res = await app.request(path, method === "GET" ? undefined : agent({}, method));
    assert.equal(res.status, 404, `${method} ${path}`);
  }
});

// --- events --------------------------------------------------------------------------

test("onEvent receives feed events; a throwing listener never fails the write", async () => {
  const events: any[] = [];
  const app = makeApp(undefined, { onEvent: (e) => events.push(e) });
  const out = await publish(app, { mock: "card", ...html("<p/>") });
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["session-created", "mock-created", "mock-updated", "post-created"]);
  assert.deepEqual(events[3], {
    type: "post-created",
    id: out.post.id,
    mockId: out.mock.id,
    sessionId: out.sessionId,
    version: 1,
    by: "agent",
  });

  const warn = console.warn;
  console.warn = () => {};
  try {
    const failing = makeApp(undefined, {
      onEvent: () => {
        throw new Error("fanout failed");
      },
    });
    await publish(failing, { mock: "card", ...html("<p/>") });
    assert.equal((await call(failing, "/api/mocks")).body.mocks.length, 1);
  } finally {
    console.warn = warn;
  }
});

test("SSE ?mock= only streams that mock's events", async () => {
  const app = makeApp();
  const a = await publish(app, { mock: "a", ...html("<p/>") });
  const b = await publish(app, { mock: "b", ...html("<p/>") });
  const ac = new AbortController();
  const stream = await app.request(`/api/events?mock=${a.mock.id}`, { signal: ac.signal });
  assert.equal(stream.status, 200);
  const other = await publish(app, { mock: "b", session: b.sessionId, ...html("<p>2</p>") });
  const mine = await publish(app, { mock: "a", session: a.sessionId, ...html("<p>2</p>") });
  const text = await readSseUntil(stream, `"version":2,"by":"agent"}`, () => ac.abort());
  assert.ok(text.includes(mine.post.id));
  assert.ok(!text.includes(other.post.id));
});

// --- connection caps ---------------------------------------------------------------------

test("SSE connections are capped; a released slot lets a new one in", async () => {
  const app = makeApp(undefined, { maxHoldConnections: 2 });
  const controllers = [new AbortController(), new AbortController()];
  const streams = await Promise.all(
    controllers.map((ac) => app.request("/api/events", { signal: ac.signal })),
  );
  assert.ok(streams.every((s) => s.status === 200));
  assert.equal((await app.request("/api/events")).status, 503);
  controllers[0].abort();
  await streams[0].body!.cancel().catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const again = await app.request("/api/events", { signal: new AbortController().signal });
  assert.equal(again.status, 200);
  controllers[1].abort();
  await streams[1].body!.cancel().catch(() => undefined);
  await again.body!.cancel().catch(() => undefined);
});

test("long-poll waits share the hold cap with SSE; instant reads do not count", async () => {
  const app = makeApp(undefined, { maxHoldConnections: 2 });
  const out = await publish(app, { mock: "card", ...html("<p/>") });
  const wait = `/api/comments?session=${out.sessionId}&wait=5`;
  const sse = await app.request("/api/events", { signal: new AbortController().signal });
  const poll = app.request(wait);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await app.request("/api/events")).status, 503);
  assert.equal((await app.request(wait)).status, 503);
  assert.equal((await app.request(`/api/comments?session=${out.sessionId}`)).status, 200);
  await app.request(`/api/mocks/${out.mock.id}/say`, agent({ message: "release" }));
  assert.equal((await poll).status, 200);
  const sseAgain = await app.request("/api/events", { signal: new AbortController().signal });
  assert.equal(sseAgain.status, 200);
  await sse.body!.cancel().catch(() => undefined);
  await sseAgain.body!.cancel().catch(() => undefined);
});

// --- rendering ---------------------------------------------------------------------------

test("/s/:id?surface=N serves each surface opaque-sandboxed; native kinds 404", async () => {
  const app = makeApp();
  const out = await publish(app, {
    mock: "review",
    surfaces: [
      { kind: "html", html: "<script>window.x=1</script><p>diagram</p>" },
      { kind: "diff", patch: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b", layout: "split" },
      { kind: "markdown", markdown: "## Plan\n\n- step one" },
      { kind: "mermaid", mermaid: "graph TD; A-->B" },
      { kind: "json", data: { ok: true } },
    ],
  });
  const id = out.post.id;
  const docs = await Promise.all([0, 1, 2, 3].map((n) => app.request(`/s/${id}?surface=${n}`)));
  const [h, d, m, g] = await Promise.all(docs.map((r) => r.text()));
  assert.match(h, /<p>diagram<\/p>/);
  assert.match(d, /diffs-container/);
  assert.match(m, /<h2>Plan<\/h2>/);
  assert.match(g, /esm\.sh\/mermaid/);
  for (const res of docs) {
    assert.equal(res.status, 200);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /\bsandbox\b/);
    assert.match(csp, /\ballow-scripts\b/);
    assert.doesNotMatch(csp, /allow-same-origin/);
    assert.doesNotMatch(csp, /frame-ancestors/);
  }
  // A bare load is surface 0.
  assert.match(await (await app.request(`/s/${id}`)).text(), /<p>diagram<\/p>/);
  assert.equal((await app.request(`/s/${id}?surface=4`)).status, 404);
  assert.equal((await app.request(`/s/${id}?surface=9`)).status, 404);
  assert.equal((await app.request("/s/nope")).status, 404);
});

test("/s pinned to a version is immutable; old versions stay renderable", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html("<p>v1</p>") });
  await publish(app, { mock: "card", ...html("<p>v2</p>") });
  const id = out.post.id;
  const pinned = await app.request(`/s/${id}?surface=0&ver=1&mode=light`);
  assert.match(pinned.headers.get("cache-control") ?? "", /immutable/);
  assert.match(await pinned.text(), /<p>v1<\/p>/);
  const bare = await app.request(`/s/${id}?surface=0`);
  assert.match(bare.headers.get("cache-control") ?? "", /no-cache/);
  assert.match(await bare.text(), /<p>v2<\/p>/);
  assert.equal((await app.request(`/s/${id}?ver=7`)).status, 404);
});

test("kits ride the html surface into the document; the CSP allows the server origin", async () => {
  const app = makeApp();
  const out = await publish(app, {
    mock: "deck",
    surfaces: [{ kind: "html", html: "<div class=deck><img src=/a/x></div>", kits: ["slides"] }],
  });
  const doc = await (await app.request(`/s/${out.post.id}?surface=0`)).text();
  assert.match(doc, /\/asset\/kit-slides\.[a-z0-9]+\.css/);
  assert.match(doc, /querySelector\('\.deck'\)/);
  assert.match(doc, /img-src https: data: blob: http:\/\/localhost/);
  // The kit stylesheet is content-hashed, so it is served immutable.
  const cssPath = doc.match(/\/asset\/kit-slides\.[a-z0-9]+\.css/)![0];
  const css = await app.request(cssPath);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /text\/css/);
  assert.match(css.headers.get("cache-control") ?? "", /immutable/);
  assert.equal((await app.request("/asset/kit-nope.0.css")).status, 404);
  const kits = (await call(app, "/api/kits")).body;
  assert.ok(kits.some((k: any) => k.id === "slides"));
  assert.ok(kits.every((k: any) => k.css === undefined));
});

test("a page mock expands <mockpit-slot> with the component's first state", async () => {
  const app = makeApp();
  await publish(app, { mock: "button", state: "Rest", ...html("<button>Buy</button>") });
  const page = await publish(app, {
    mock: "checkout",
    kind: "page",
    ...html('<main><mockpit-slot slug="button"></mockpit-slot></main>'),
  });
  const doc = await (await app.request(`/s/${page.post.id}`)).text();
  assert.match(doc, /<button>Buy<\/button>/);
});

// --- viewer pages ---------------------------------------------------------------------------

test("viewer routes serve the trusted shell with frame-ancestors only", async () => {
  const app = makeApp();
  await publish(app, { mock: "card", title: "Auth Flow", ...html("<p>diagram</p>") });
  for (const path of ["/", "/project/demo", "/project/demo/card", "/project/demo/missing"]) {
    const res = await app.request(path);
    assert.equal(res.status, 200, path);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'self'/);
    assert.doesNotMatch(csp, /\bsandbox\b/);
    const body = await res.text();
    assert.ok(body.includes("viewer"));
    assert.doesNotMatch(body, /<p>diagram<\/p>/);
  }
  assert.match(await (await app.request("/project/demo")).text(), /<title>demo<\/title>/);
});

test("a mock page carries pinned, token-free link-preview metadata", async () => {
  const app = makeApp("secret", { version: "1.2.3", basePath: "/u/alice" });
  const res = await app.request(
    "https://board.test/api/mocks",
    authed({ project: "demo", mock: "card", title: `A "quoted" <tag>`, html: "<p/>" }),
  );
  const out = (await res.json()) as any;
  const body = await (await app.request("https://board.test/project/demo/card?key=secret")).text();
  const canonical = "https://board.test/u/alice/project/demo/card";
  assert.ok(body.includes(`<link rel="canonical" href="${canonical}">`));
  assert.ok(
    body.includes(
      `<meta property="og:image" content="https://board.test/u/alice/s/${out.post.id}.png?card=1&amp;theme=dialkit&amp;mode=dark&amp;v=1&amp;g=1.2.3">`,
    ),
  );
  assert.ok(body.includes('<meta property="og:title" content="A &quot;quoted&quot; &lt;tag&gt;">'));
  assert.ok(body.includes("<title>A &quot;quoted&quot; &lt;tag&gt;</title>"));
  assert.match(body, /window\.__MOCKPIT_BASE_PATH__="\/u\/alice"/);
  for (const line of body.split("\n").filter((l) => /canonical|og:|twitter:/.test(l))) {
    assert.doesNotMatch(line, /secret/);
  }
  await app.request("/api/theme", authed({ mode: "light" }, "PUT"));
  const after = await (await app.request("https://board.test/project/demo/card?key=secret")).text();
  assert.match(after, /mode=light/);
});

test("viewer config: screenshots flag and readonly markers", async () => {
  const shots = await (
    await makeApp("secret", { screenshots: true }).request("/", {
      headers: { authorization: "Bearer secret" },
    })
  ).text();
  assert.ok(shots.includes("__MOCKPIT_SCREENSHOTS__=true"));
  const plain = await (
    await makeApp("secret").request("/", { headers: { authorization: "Bearer secret" } })
  ).text();
  assert.ok(!plain.includes("__MOCKPIT_SCREENSHOTS__"));

  const full = makeApp("secret", { publicRead: "full" });
  const visitor = await (await full.request("/")).text();
  assert.ok(visitor.includes("__MOCKPIT_READONLY__=true"));
  assert.ok(visitor.includes('__MOCKPIT_PUBLIC_READ__="full"'));
  const owner = await (
    await full.request("/", { headers: { authorization: "Bearer secret" } })
  ).text();
  assert.ok(!owner.includes("__MOCKPIT_READONLY__"));
  const keyed = await (await full.request("/?key=secret")).text();
  assert.ok(!keyed.includes("__MOCKPIT_READONLY__"));

  const session = makeApp("secret", { publicRead: "session" });
  const page = await (await session.request("/project/demo/card")).text();
  assert.ok(page.includes('__MOCKPIT_PUBLIC_READ__="session"'));
});

test("public-read session mode: an anonymous author=user read never advances the agent cursor", async () => {
  const app = makeApp("secret", { publicRead: "session" });
  const first = await publish(app, { mock: "card", ...html('<p data-part="body">hi</p>') }, authed);
  const mockId: string = first.mock.id;
  const sessionId: string = first.sessionId;
  await app.request("/api/comments", {
    ...viewer({ mock: mockId, author: "user", text: "needs more air" }),
    headers: { ...CT, "sec-fetch-site": "same-origin", authorization: "Bearer secret" },
  });
  const anon = await app.request(`/api/comments?session=${sessionId}&author=user`);
  assert.equal(anon.status, 200);
  const session = (await (
    await app.request(`/api/sessions/${sessionId}`, { headers: { authorization: "Bearer secret" } })
  ).json()) as { agentSeq: number };
  assert.equal(session.agentSeq, 0);
  const agentRead = (await (
    await app.request(`/api/comments?session=${sessionId}&author=user`, {
      headers: { authorization: "Bearer secret" },
    })
  ).json()) as { comments: unknown[] };
  assert.equal(agentRead.comments.length, 1);
});

// --- auth -----------------------------------------------------------------------------------

test("auth token guards everything but the docs; ?key= sets a cookie", async () => {
  const app = makeApp("secret");
  assert.equal((await app.request("/api/mocks", agent({ mock: "x", html: "<p/>" }))).status, 401);
  assert.equal((await app.request("/api/mocks", authed({ mock: "x", html: "<p/>" }))).status, 201);
  assert.equal((await app.request("/api/mocks")).status, 401);
  assert.equal((await app.request("/")).status, 401);
  assert.equal((await app.request("/a/anything")).status, 401);
  for (const doc of ["/guide", "/setup", "/agent-howto"]) {
    assert.equal((await app.request(doc)).status, 200);
  }
  const keyed = await app.request("/?key=secret");
  assert.equal(keyed.status, 200);
  assert.ok((keyed.headers.get("set-cookie") ?? "").includes("mockpit_key=secret"));
  const viaCookie = await app.request("/api/mocks", { headers: { cookie: "mockpit_key=secret" } });
  assert.equal(viaCookie.status, 200);
  for (const res of [await app.request("/guide"), await app.request("/api/sessions")]) {
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  }
});

test("an authenticate hook guards the app, and public read never bypasses it", async () => {
  const app = makeApp(undefined, {
    authenticate: (request) => request.headers.get("x-mockpit-internal") === "ok",
    publicRead: "full",
  });
  assert.equal((await app.request("/guide")).status, 401);
  assert.equal((await app.request("/api/mocks")).status, 401);
  assert.equal(
    (await app.request("/api/mocks", { headers: { "x-mockpit-internal": "ok" } })).status,
    200,
  );
});

test("public read full mode allows every GET but no write", async () => {
  const app = makeApp("secret", { publicRead: "full" });
  const res = await app.request(
    "/api/mocks",
    authed({ project: "demo", mock: "card", html: "<p/>" }),
  );
  const out = (await res.json()) as any;
  for (const path of [
    "/",
    "/api/mocks",
    "/api/sessions",
    "/api/mocks/card?project=demo",
    `/s/${out.post.id}`,
  ]) {
    assert.equal((await app.request(path)).status, 200, path);
  }
  assert.equal((await app.request("/api/mocks", agent({ mock: "x", html: "<p/>" }))).status, 401);
  assert.equal(
    (await app.request("/api/comments", agent({ mock: "card", text: "hi" }))).status,
    401,
  );
});

test("public read session mode only exposes reads addressed by an unguessable id", async () => {
  const app = makeApp("secret", { publicRead: "session" });
  const res = await app.request(
    "/api/mocks",
    authed({ project: "demo", mock: "card", html: "<p/>" }),
  );
  const out = (await res.json()) as any;
  const id = out.mock.id;
  await app.request(`/api/mocks/${id}/say`, authed({ message: "hi" }));

  for (const path of [
    `/api/mocks/${id}`,
    `/api/mocks/${id}/export`,
    `/s/${out.post.id}`,
    "/project/demo/card",
    `/api/comments?mock=${id}`,
    `/api/comments?session=${out.sessionId}`,
    "/api/theme",
    "/api/version",
    "/api/kits",
  ]) {
    assert.equal((await app.request(path)).status, 200, path);
  }
  for (const path of [
    "/",
    "/api/mocks",
    "/api/sessions",
    "/api/projects",
    `/api/mocks/${id}?project=demo`,
    `/api/mocks/${id}/draft`,
    `/api/feedback?session=${out.sessionId}`,
    "/api/comments",
  ]) {
    assert.equal((await app.request(path)).status, 401, path);
  }
  // A slug is a name, not an id: it must not resolve for an anonymous reader.
  assert.equal((await app.request("/api/mocks/card")).status, 404);
  assert.equal((await app.request("/api/comments?session=missing")).status, 404);
  assert.equal((await app.request("/api/comments?mock=missing")).status, 404);
  assert.equal((await app.request("/api/events")).status, 401);
  assert.equal((await app.request("/api/events?mock=missing")).status, 404);
  assert.equal((await app.request("/api/mocks", agent({ mock: "x", html: "<p/>" }))).status, 401);
});

test("public read session mode scopes event streams to a mock", async () => {
  const app = makeApp("secret", { publicRead: "session" });
  const a = (await (
    await app.request("/api/mocks", authed({ project: "demo", mock: "a", html: "<p/>" }))
  ).json()) as any;
  await app.request("/api/mocks", authed({ project: "demo", mock: "b", html: "<p/>" }));
  const ac = new AbortController();
  const stream = await app.request(`/api/events?mock=${a.mock.id}`, { signal: ac.signal });
  assert.equal(stream.status, 200);
  const other = (await (
    await app.request("/api/mocks", authed({ project: "demo", mock: "b", html: "<p>2</p>" }))
  ).json()) as any;
  const mine = (await (
    await app.request("/api/mocks", authed({ project: "demo", mock: "a", html: "<p>2</p>" }))
  ).json()) as any;
  const text = await readSseUntil(stream, mine.post.id, () => ac.abort());
  assert.ok(!text.includes(other.post.id));
});

test("the global body cap rejects oversize JSON and MCP bodies", async () => {
  const app = makeApp();
  const oversize = {
    "content-type": "application/json",
    "content-length": String(17 * 1024 * 1024),
  };
  for (const path of ["/api/mocks", "/mcp"]) {
    const res = await app.request(path, {
      method: "POST",
      headers: oversize,
      body: new Uint8Array(0),
    });
    assert.equal(res.status, 413, path);
  }
});

// --- docs, theme, version, push ------------------------------------------------------------

test("/agent-howto is the project brief, ?topic= one topic, and /guide the html topic", async () => {
  const app = makeApp();
  assert.equal(await (await app.request("/guide")).text(), "# guide");
  assert.equal(await (await app.request("/setup")).text(), "# setup");
  const brief = await (await app.request("/agent-howto?project=demo")).text();
  assert.match(brief, /# mockpit brief/);
  assert.match(brief, /--mock writer/);
  assert.equal(await (await app.request("/agent-howto?topic=html")).text(), "# guide");
  const unknown = await app.request("/agent-howto?topic=colours");
  assert.equal(unknown.status, 400);
  const body = (await unknown.json()) as { error: string; topics: string[] };
  assert.match(body.error, /unknown topic "colours"/);
  assert.deepEqual(body.topics, [
    "knobs",
    "asks",
    "surfaces",
    "html",
    "feedback",
    "http",
    "scripts",
  ]);
});

test("the theme setting is the workspace's mode: dark by default, light or dark only", async () => {
  const events: any[] = [];
  const app = makeApp(undefined, { onEvent: (e) => events.push(e) });
  assert.deepEqual((await call(app, "/api/theme")).body, { mode: "dark" });
  assert.equal((await call(app, "/api/theme", agent({ mode: "sepia" }, "PUT"))).status, 400);
  // the retired theme-id body is refused, not silently half-applied
  assert.equal((await call(app, "/api/theme", agent({ id: "gruvbox" }, "PUT"))).status, 400);
  assert.deepEqual((await call(app, "/api/theme", agent({ mode: "light" }, "PUT"))).body, {
    mode: "light",
  });
  assert.deepEqual((await call(app, "/api/theme")).body, { mode: "light" });
  assert.deepEqual(events.at(-1), { type: "theme-changed", mode: "light" });
});

function makeVersionApp(version?: string, latest?: { version: string; notes?: string } | Error) {
  return createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html>viewer</html>",
    topics: { html: "# guide" },
    setupText: "# setup",
    version,
    upgradeCommand: "npm install -g mockpit",
    fetchLatestRelease: () =>
      latest instanceof Error ? Promise.reject(latest) : Promise.resolve(latest ?? null),
  });
}

test("version endpoint reports an update, and stays quiet when current or offline", async () => {
  const get = async (app: App) => (await call(app, "/api/version")).body;
  assert.deepEqual(await get(makeVersionApp("0.3.0", { version: "0.4.0", notes: "n" })), {
    current: "0.3.0",
    latest: "0.4.0",
    updateAvailable: true,
    upgradeCommand: "npm install -g mockpit",
    notes: "n",
  });
  assert.equal((await get(makeVersionApp("0.4.1", { version: "0.4.0" }))).updateAvailable, false);
  assert.deepEqual(await get(makeVersionApp(undefined)), {
    current: null,
    latest: null,
    updateAvailable: false,
  });
  assert.equal((await get(makeVersionApp("0.3.0", new Error("offline")))).latest, null);
});

test("push subscriptions and webhooks are validated and listed", async () => {
  const app = makeApp();
  assert.ok((await call(app, "/api/push/vapid")).body.publicKey);
  assert.equal((await call(app, "/api/push/subscribe", agent({ nope: 1 }))).status, 400);
  assert.equal(
    (await call(app, "/api/hooks", agent({ url: "ftp://x", events: ["ask"] }))).status,
    400,
  );
  assert.equal(
    (await call(app, "/api/hooks", agent({ url: "https://x.test", events: [] }))).status,
    400,
  );
  const hook = await call(
    app,
    "/api/hooks",
    agent({ url: "https://x.test", events: ["ask", "bogus"] }),
  );
  assert.equal(hook.status, 201);
  const hooks = (await call(app, "/api/hooks")).body;
  assert.deepEqual(hooks[0].events, ["ask"]);
  assert.equal((await call(app, `/api/hooks/${hook.body.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await call(app, `/api/hooks/${hook.body.id}`, { method: "DELETE" })).status, 404);
});

// --- assets ------------------------------------------------------------------------------------

const b64 = (bytes: number[]) => Buffer.from(new Uint8Array(bytes)).toString("base64");

test("uploads an asset via base64 JSON and serves the exact bytes inline", async () => {
  const app = makeApp(undefined, { basePath: "/u/alice" });
  const res = await call(
    app,
    "https://board.test/api/assets",
    agent({ data: b64([137, 80, 78, 71, 0, 255]), contentType: "image/png", filename: "shot.png" }),
  );
  assert.equal(res.status, 201);
  const asset = res.body;
  assert.ok(asset.sessionId);
  assert.equal(asset.kind, "image");
  assert.equal(asset.byteLength, 6);
  assert.equal(asset.url, `https://board.test/u/alice/a/${asset.id}`);
  const served = await app.request(`/a/${asset.id}`);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("content-disposition"), "inline");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await served.arrayBuffer())], [137, 80, 78, 71, 0, 255]);
});

test("raw uploads take metadata from the query; unsafe types are attachments", async () => {
  const app = makeApp();
  const raw = await call(app, "/api/assets?kind=file&filename=a.bin", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array([1, 2, 3]),
  });
  assert.equal(raw.status, 201);
  assert.equal(raw.body.kind, "file");
  const svg = (
    await call(app, "/api/assets", agent({ data: b64([60, 115]), contentType: "image/svg+xml" }))
  ).body;
  const svgRes = await app.request(`/a/${svg.id}`);
  assert.equal(svgRes.headers.get("content-type"), "image/svg+xml");
  assert.match(svgRes.headers.get("content-disposition") ?? "", /^attachment/);
  const page = (
    await call(app, "/api/assets", agent({ data: b64([60, 104]), contentType: "text/html" }))
  ).body;
  const pageRes = await app.request(`/a/${page.id}`);
  assert.equal(pageRes.headers.get("content-type"), "application/octet-stream");
});

test("asset uploads reject empty, oversized, malformed and unknown-session bodies", async () => {
  const app = makeApp();
  const post = (body: unknown) => app.request("/api/assets", agent(body));
  assert.equal((await post({ data: "", contentType: "x" })).status, 400);
  assert.equal((await post({ data: "not valid base64!!!", contentType: "image/png" })).status, 400);
  assert.equal(
    (await post({ data: b64(Array(5 * 1024 * 1024 + 1).fill(0)), contentType: "image/png" }))
      .status,
    413,
  );
  assert.equal(
    (await post({ data: b64([1]), contentType: "image/png", session: "nope" })).status,
    404,
  );
  const declared = await app.request("/api/assets?kind=file", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(5 * 1024 * 1024 + 1),
    },
    body: new Uint8Array(0),
  });
  assert.equal(declared.status, 413);
  assert.equal((await app.request("/a/missing")).status, 404);
});

test("a chunked upload is capped while streaming, and a valid one reassembles", async () => {
  const app = makeApp();
  let pulled = 0;
  const flood = new ReadableStream({
    pull(controller) {
      pulled++;
      if (pulled > 40) return controller.close();
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  const capped = await app.request(
    new Request("http://localhost/api/assets?kind=file", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: flood,
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
  assert.equal(capped.status, 413);
  assert.ok(pulled < 16, `read too much before capping: ${pulled} chunks`);

  const chunks = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    },
  });
  const ok = await app.request(
    new Request("http://localhost/api/assets?kind=file", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: chunks,
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
  const asset = (await ok.json()) as any;
  const served = await app.request(`/a/${asset.id}`);
  assert.deepEqual([...new Uint8Array(await served.arrayBuffer())], [1, 2, 3, 4, 5, 6]);
});

test("an asset referenced before its upload is served once the bytes land", async () => {
  const app = makeApp();
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const id = createHash("sha256").update(bytes).digest("hex");
  const out = await publish(app, { mock: "shot", surfaces: [{ kind: "image", assetId: id }] });
  const pending = app.request(`/a/${id}`);
  setTimeout(() => {
    void app.request(
      "/api/assets",
      agent({
        data: Buffer.from(bytes).toString("base64"),
        contentType: "image/png",
        session: out.sessionId,
      }),
    );
  }, 100);
  const res = await pending;
  assert.equal(res.status, 200);
  assert.equal((await res.arrayBuffer()).byteLength, bytes.length);
});

// --- MCP over HTTP -----------------------------------------------------------------------------

test("mcp: initialize and tools/list advertise exactly the mock tools", async () => {
  const app = makeApp();
  const init = (
    await call(app, "/mcp", mcpCall(1, "initialize", { protocolVersion: "2025-03-26" }))
  ).body;
  assert.equal(init.result.serverInfo.name, "mockpit");
  assert.match(init.result.instructions, /publish/);
  assert.doesNotMatch(init.result.instructions, /\bwait\b|timeout/);
  const list = (await call(app, "/mcp", mcpCall(2, "tools/list"))).body;
  assert.deepEqual(
    list.result.tools.map((t: any) => t.name),
    ["publish", "ask", "read", "feedback", "say", "export", "upload", "guide"],
  );
});

test("mcp: the design loop round-trips through the shared flows", async () => {
  const app = makeApp();
  const pub = await tool(app, "publish", {
    project: "demo",
    mock: "writer",
    state: "Writing",
    variant: "quiet",
    html: '<h1 data-part="title">T</h1>',
  });
  assert.equal(pub.post.variant, "quiet");
  assert.deepEqual(pub.parts[0].parts, [{ name: "title" }]);
  const session = pub.sessionId;
  await tool(app, "publish", {
    project: "demo",
    mock: "writer",
    state: "Writing",
    variant: "dark",
    session,
    html: "<p/>",
  });
  const rev = await tool(app, "publish", {
    project: "demo",
    mock: "writer",
    state: "Writing",
    variant: "dark",
    html: "<p>2</p>",
  });
  assert.equal(rev.post.version, 2);
  const listed = await tool(app, "read", { project: "demo" });
  assert.equal(listed.mocks.length, 1);
  assert.deepEqual(listed.pending, [{ mock: "writer", viewerOpen: false, draft: null }]);
  const asked = await tool(app, "ask", {
    mock: "writer",
    project: "demo",
    asks: [{ id: "look", text: "Look?", options: [{ label: "Dark", variant: "dark" }] }],
  });
  // "look" binds only dark, so quiet stays unbound and the built-in ask counts.
  assert.equal(asked.open, 2);

  const empty = await tool(app, "feedback", { session });
  assert.deepEqual(empty.feedback, []);
  assert.equal(empty.pending[0].mock, "writer");

  await call(app, `/api/mocks/${pub.mock.id}/reply`, viewer({ answers: { look: "dark" } }));
  const fb = await tool(app, "feedback", { session });
  assert.equal(fb.feedback[0].reply.answers.look, "dark");
  const said = await tool(app, "say", { mock: "writer", project: "demo", message: "on it" });
  assert.deepEqual(said.feedback, []);
  const thread = (await call(app, `/api/comments?mock=${pub.mock.id}`)).body.comments;
  assert.notEqual(thread.find((c: any) => c.text === "on it").author, "user");

  const detail = await tool(app, "read", { mock: "writer", project: "demo", body: true });
  assert.equal(detail.variants.find((v: any) => v.variant === "dark").status, "accepted");
  assert.deepEqual(detail.pending, { mock: "writer", viewerOpen: false, draft: null });
  const exported = await tool(app, "export", { mock: "writer", project: "demo" });
  assert.equal(exported.states[0].variant, "dark");
});

test("mcp: structuredContent matches each tool's outputSchema on both transports", async () => {
  const app = makeApp();
  const list = (await call(app, "/mcp", mcpCall(1, "tools/list"))).body.result.tools as any[];
  const ajv = new AjvJsonSchemaValidator();
  const checked = new Set<string>();
  const run = async (name: string, args: Record<string, unknown>) => {
    const { body } = await call(app, "/mcp", mcpCall(1, "tools/call", { name, arguments: args }));
    const result = body.result;
    assert.ok(!result.isError, `${name} failed: ${result.content[0].text}`);
    const value = result.structuredContent;
    assert.deepEqual(value, JSON.parse(result.content[0].text), `${name} text and structure agree`);
    const http = list.find((t) => t.name === name).outputSchema;
    const verdict = ajv.getValidator(http)(value);
    assert.ok(verdict.valid, `${name} HTTP outputSchema: ${verdict.errorMessage}`);
    // stdio lists its own catalog and the SDK re-checks each result with zod
    // server-side, so a mismatch there would turn a good call into an error.
    const stdio = STDIO_MCP_CATALOG.find((t) => t.name === name)!.outputSchema!;
    const stdioVerdict = ajv.getValidator(stdio)(value);
    assert.ok(stdioVerdict.valid, `${name} stdio outputSchema: ${stdioVerdict.errorMessage}`);
    const zod = STDIO_MCP_TOOLS.find((t) => t.name === name)!.outputSchema!;
    assert.ok(zod.safeParse(value).success, `${name} stdio zod outputSchema`);
    checked.add(name);
    return value;
  };

  const pub = await run("publish", {
    project: "demo",
    mock: "writer",
    state: "Writing",
    variant: "quiet",
    knobs: { size: [16, 12, 20, 1] },
    html: '<h1 data-part="title">T</h1><p data-part="body">b</p>',
  });
  const session = pub.sessionId;
  const second = await run("publish", {
    project: "demo",
    mock: "writer",
    state: "Writing",
    variant: "dark",
    session,
    html: '<h1 data-part="title">T</h1>',
  });
  assert.ok(second.suggestedAsk, "two unbound variants suggest an ask");
  await run("ask", {
    project: "demo",
    mock: "writer",
    session,
    asks: [{ id: "look", text: "Look?", options: [{ label: "Dark", variant: "dark" }] }],
  });
  assert.deepEqual((await run("feedback", { session })).feedback, []);
  await call(app, "/api/comments", viewer({ mock: pub.mock.id, text: "tighter", author: "user" }));
  await call(app, `/api/mocks/${pub.mock.id}/draft`, viewer({ answers: { look: "dark" } }, "PUT"));
  const drafting = await run("read", { project: "demo", mock: "writer", history: true });
  assert.equal(drafting.pending.draft.answered, 1);
  await call(
    app,
    `/api/mocks/${pub.mock.id}/reply`,
    viewer({
      answers: { look: "dark" },
      tuned: { size: 18 },
      comments: [{ part: "title", state: "Writing", text: "bigger" }],
    }),
  );
  const fb = await run("feedback", { session });
  assert.equal(fb.feedback.at(-1).reply.asks[0].chosen[0].label, "Dark");
  // A version that drops a part carries partChanges, and an undelivered
  // comment rides along as feedback.
  await call(app, "/api/comments", viewer({ mock: pub.mock.id, text: "one more", author: "user" }));
  const rev = await run("publish", {
    project: "demo",
    mock: "writer",
    state: "Writing",
    variant: "quiet",
    session,
    html: '<h1 data-part="title">T2</h1>',
  });
  assert.deepEqual(rev.partChanges.vanished, ["body"]);
  assert.ok(rev.feedback.length, "the pending comment rides along");
  await call(app, "/api/comments", viewer({ mock: pub.mock.id, text: "last", author: "user" }));
  const said = await run("say", { project: "demo", mock: "writer", session, message: "ok" });
  assert.equal(said.feedback.length, 1);
  await run("read", { project: "demo" });
  await run("export", { project: "demo", mock: "writer" });
  assert.deepEqual(
    [...checked].sort(),
    list
      .filter((t) => t.outputSchema)
      .map((t) => t.name)
      .sort(),
    "every tool with an outputSchema was exercised",
  );
});

test("mcp: publish takes the full surface list by id", async () => {
  const app = makeApp();
  const pub = await tool(app, "publish", { project: "demo", mock: "card", html: "<p/>" });
  const id = pub.post.surfaces[0].id;
  const added = await tool(app, "publish", {
    mock: pub.mock.id,
    surfaces: [{ kind: "markdown", markdown: "# hi" }, { id }],
  });
  assert.deepEqual(
    added.post.surfaces.map((s: any) => s.kind),
    ["markdown", "html"],
  );
  const removed = await tool(app, "publish", { mock: pub.mock.id, surfaces: [{ id }] });
  assert.equal(removed.post.surfaces.length, 1);
  assert.equal(removed.post.version, 3);
});

test("mcp: errors carry the REST hint; unknown tools and methods fail cleanly", async () => {
  const app = makeApp();
  await tool(app, "publish", { project: "demo", mock: "w", state: "A", html: "<p/>" });
  await tool(app, "publish", { project: "demo", mock: "w", state: "B", html: "<p/>" });
  const missingState = await tool(app, "publish", {
    project: "demo",
    mock: "w",
    html: "<p/>",
  });
  assert.match(missingState.error, /pass state.*"states":\["A","B"\]/);
  assert.match((await tool(app, "publish", { mock: "x" })).error, /surfaces/);
  assert.match((await tool(app, "feedback", {})).error, /session/);
  for (const retired of ["nope", "publish_mock", "wait_for_feedback", "revise_mock", "wait"]) {
    assert.match((await tool(app, retired, {})).error, /unknown tool/, retired);
  }
  const bad = (await call(app, "/mcp", mcpCall(1, "resources/list"))).body;
  assert.equal(bad.error.code, -32601);
});

test("mcp: transport edge cases", async () => {
  const app = makeApp();
  const parse = await call(app, "/mcp", { method: "POST", body: "{not valid json" });
  assert.equal(parse.status, 400);
  assert.equal(parse.body.error.code, -32700);
  const batch = await call(app, "/mcp", agent([{ jsonrpc: "2.0", id: 1, method: "ping" }]));
  assert.equal(batch.status, 400);
  assert.equal(batch.body.error.code, -32600);
  const note = await app.request(
    "/mcp",
    agent({ jsonrpc: "2.0", method: "notifications/initialized" }),
  );
  assert.equal(note.status, 202);
  assert.deepEqual((await call(app, "/mcp", mcpCall(1, "ping"))).body.result, {});
  assert.equal((await app.request("/mcp")).status, 405);

  const guarded = makeApp("secret");
  assert.equal((await guarded.request("/mcp", mcpCall(1, "tools/list"))).status, 401);
  assert.equal(
    (await guarded.request("/mcp", authed({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).status,
    200,
  );
});

test("mcp: upload and guide", async () => {
  const app = makeApp();
  const session = (await call(app, "/api/sessions", agent({ agent: "m" }))).body;
  const data = Buffer.from("\x89PNG\r\n\x1a\n pixels");
  const asset = await tool(app, "upload", {
    data: data.toString("base64"),
    contentType: "image/png",
    kind: "image",
    session: session.id,
  });
  assert.equal(asset.kind, "image");
  assert.equal(asset.sessionId, session.id);
  assert.equal(asset.byteLength, data.length);
  assert.ok(asset.url.endsWith(`/a/${asset.id}`));
  assert.match((await tool(app, "upload", { contentType: "image/png" })).error, /base64/);
  const guide = await tool(app, "guide", {});
  assert.match(guide, /Run `mockpit init`/);
  assert.equal(await tool(app, "guide", { topic: "html" }), "# guide");
  const unknown = await tool(app, "guide", { topic: "colours" });
  assert.match(
    unknown.error,
    /unknown topic "colours"; topics: knobs, asks, surfaces, html, feedback, http/,
  );
});

test("feedback taken by the MCP tool is not re-delivered over REST, and vice versa", async () => {
  const app = makeApp();
  const out = await publish(app, { mock: "card", ...html("<p/>") });
  await call(app, "/api/comments", viewer({ mock: out.mock.id, text: "one", author: "user" }));
  const viaMcp = await tool(app, "feedback", { session: out.sessionId });
  assert.equal(viaMcp.feedback[0].comments[0].text, "one");
  const rest = (await call(app, `/api/feedback?session=${out.sessionId}`)).body;
  assert.deepEqual(rest.feedback, []);
  const write = await publish(app, { mock: "card", session: out.sessionId, ...html("<p>2</p>") });
  assert.deepEqual(write.feedback, []);

  await call(app, "/api/comments", viewer({ mock: out.mock.id, text: "two", author: "user" }));
  const viaRest = (await call(app, `/api/feedback?session=${out.sessionId}`)).body;
  assert.equal(viaRest.feedback[0].comments[0].text, "two");
  const mcpAgain = await tool(app, "feedback", { session: out.sessionId });
  assert.deepEqual(mcpAgain.feedback, []);
});
