import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import { createNodeExecutor } from "../server/codeRunner.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

// The publish contract for slots and page embeds, through the same route the
// CLI, MCP and scripts write to.

function app() {
  return createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html>viewer</html>",
    topics: { html: "# guide" },
    setupText: "# setup",
    executor: createNodeExecutor({ graceMs: 200 }),
  });
}

async function publish(a: ReturnType<typeof app>, body: Record<string, unknown>) {
  const res = await a.fetch(
    new Request("http://x/api/mocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: "p", agent: "test", ...body }),
    }),
  );
  return { status: res.status, body: (await res.json()) as any };
}

test("a fills splice adds an alternative to a slot and the suggested ask follows", async () => {
  const a = app();
  const first = await publish(a, {
    mock: "send",
    html: `<p data-part="message">Bife</p>
<section data-part="entry" data-fill="dots">···</section>
<section data-part="entry" data-fill="skeleton">…</section>`,
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.deepEqual(
    first.body.suggestedSlotAsks[0].options.map((o: { set: object }) => o.set),
    [{ entry: "dots" }, { entry: "skeleton" }],
  );

  const next = await publish(a, {
    mock: "send",
    fills: {
      "entry#filling": "<section>2 of 3</section>",
      "entry#dots": "<section>• • •</section>",
    },
  });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.deepEqual(next.body.applied, ["entry#filling", "entry#dots"]);
  assert.deepEqual(
    next.body.slots[0].fills.map((f: { name: string }) => f.name),
    ["dots", "skeleton", "filling"],
  );
  assert.equal(next.body.suggestedSlotAsks[0].options.length, 3);

  const bad = await publish(a, { mock: "send", fills: { "message#big": "<p>Bife</p>" } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /no fills of "message"/);
  const both = await publish(a, { mock: "send", parts: { message: "<p></p>" }, fills: {} });
  assert.equal(both.status, 400);
  assert.match(both.body.error, /not parts and fills/);
});

test("a page embeds a component with <mockpit-embed>, and <mockpit-slot> still works", async () => {
  const a = app();
  await publish(a, { mock: "button", html: "<button>Go</button>" });
  const page = await publish(a, {
    mock: "page",
    kind: "page",
    html: `<main><mockpit-embed slug="button"></mockpit-embed><mockpit-slot slug="button"></mockpit-slot></main>`,
  });
  assert.equal(page.status, 201, JSON.stringify(page.body));
  const doc = await (await a.fetch(new Request(`http://x/s/${page.body.post.id}`))).text();
  const embedded = doc.match(/<div data-mockpit-embed="button"[^>]*><button>Go<\/button><\/div>/g);
  assert.equal(embedded?.length, 2);
});
