import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import { createNodeExecutor } from "../server/codeRunner.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

// Behind a TLS-terminating proxy (tailscale serve) the request arrives as http
// while the browser is on https. The frame must load its bridge over https, or
// the browser blocks it as mixed content and live knobs never reach the stage.

function app() {
  return createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html>viewer</html>",
    topics: { html: "# guide" },
    setupText: "# setup",
    executor: createNodeExecutor({ graceMs: 200 }),
  });
}

async function frame(headers: Record<string, string>) {
  const a = app();
  const res = await a.fetch(
    new Request("http://box.ts.net:8228/api/mocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: "p", agent: "test", mock: "m", html: "<p>hi</p>" }),
    }),
  );
  const body = (await res.json()) as { post: { id: string } };
  const page = await a.fetch(
    new Request(`http://box.ts.net:8228/s/${body.post.id}?surface=0&ver=1`, { headers }),
  );
  return page.text();
}

const bridgeSrcs = (html: string) => [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test("a frame behind an https proxy loads its bridge over https", async () => {
  const srcs = bridgeSrcs(await frame({ "x-forwarded-proto": "https" }));
  assert.ok(srcs.length > 0);
  for (const src of srcs) assert.ok(src.startsWith("https://box.ts.net:8228/asset/"), src);
});

test("a direct http request keeps http asset URLs", async () => {
  const srcs = bridgeSrcs(await frame({}));
  assert.ok(srcs.length > 0);
  for (const src of srcs) assert.ok(src.startsWith("http://box.ts.net:8228/asset/"), src);
});
