import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

const TOKEN = "worker-integration-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };

type WriteResult = {
  mock: { id: string; slug: string };
  post: {
    id: string;
    title: string;
    version: number;
    surfaces: Array<{ id: string; kind: string }>;
  };
  sessionId: string;
  // One batch per mock — a reply plus the comments released with it.
  userFeedback?: Array<{ mock: string | null; comments: Array<{ text: string }> }>;
};

type MockDetail = {
  id: string;
  title: string;
  variants: Array<{ version: number; title: string; surfaces: Array<{ html?: string }> }>;
};

type AssetResult = {
  id: string;
  sessionId: string;
  byteLength: number;
  url: string;
};

function json(body: unknown, method = "POST") {
  return {
    method,
    headers: { ...AUTH, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  };
}

async function expectJson<T>(response: Response, status: number): Promise<T> {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return JSON.parse(text) as T;
}

async function startWorker(
  persistTo: string,
  vars: Record<string, string>,
): Promise<Unstable_DevWorker> {
  // The API type requires a positional script, but leaving it undefined makes
  // Wrangler resolve `main` from the checked-in config, just like deploy/dev.
  return unstable_dev(undefined as never, {
    config: "wrangler.jsonc",
    local: true,
    persist: true,
    persistTo,
    vars,
    logLevel: "error",
    experimental: {
      disableDevRegistry: true,
      disableExperimentalWarning: true,
      watch: false,
    },
  });
}

test(
  "the local Wrangler runtime wires the Worker, Durable Object, and SQLite store",
  { timeout: 60_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "mockpit-worker-integration-"));
    const persistTo = join(root, "state");
    let worker: Unstable_DevWorker | undefined;

    let stopping: Promise<void> | undefined;
    const stopWorker = async () => {
      if (!worker) return;
      if (stopping) return stopping;
      const active = worker;
      stopping = active
        .stop()
        .then(() => {
          if (worker === active) worker = undefined;
        })
        .finally(() => {
          stopping = undefined;
        });
      return stopping;
    };
    t.signal.addEventListener("abort", () => void stopWorker().catch(() => {}), { once: true });
    t.after(async () => {
      try {
        await stopWorker();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    worker = await startWorker(persistTo, { MOCKPIT_TOKEN: "" });
    const unconfigured = await worker.fetch("/");
    assert.equal(unconfigured.status, 503);
    assert.match(await unconfigured.text(), /wrangler secret put MOCKPIT_TOKEN/);
    await stopWorker();

    worker = await startWorker(persistTo, { MOCKPIT_TOKEN: TOKEN });

    assert.equal((await worker.fetch("/api/sessions")).status, 401);

    const marker = '<p id="worker-marker">real workerd render</p>';
    const published = await expectJson<WriteResult>(
      await worker.fetch(
        "/api/mocks",
        json({
          agent: "worker-integration",
          sessionTitle: "Durable workspace",
          project: "worker",
          mock: "card",
          title: "Worker post",
          surfaces: [{ kind: "html", html: marker }],
        }),
      ),
      201,
    );
    const { post, sessionId } = published;
    const mockId = published.mock.id;
    assert.ok(post.id);
    assert.ok(sessionId);
    assert.equal(post.version, 1);
    assert.equal(post.surfaces[0].kind, "html");

    assert.equal((await worker.fetch(`/api/mocks/${mockId}`)).status, 401);

    const eventStream = await worker.fetch(`/api/events?session=${sessionId}`, {
      headers: AUTH,
    });
    assert.equal(eventStream.status, 200);
    assert.match(eventStream.headers.get("content-type") ?? "", /text\/event-stream/);
    const eventReader = eventStream.body?.getReader();
    assert.ok(eventReader);
    const connected = await eventReader.read();
    assert.match(new TextDecoder().decode(connected.value), /event: hello/);
    const nextEvent = (async () => {
      let text = "";
      while (!text.includes('"type":"comment-created"')) {
        const chunk = await eventReader.read();
        if (chunk.done) throw new Error("SSE stream ended before comment-created");
        text += new TextDecoder().decode(chunk.value);
      }
      return text;
    })();
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expectJson(
        await worker.fetch(
          "/api/comments",
          json({ mock: mockId, text: "event stream probe", author: "worker-agent" }),
        ),
        201,
      );
      const event = await Promise.race([
        nextEvent,
        new Promise<never>((_resolve, reject) => {
          eventTimer = setTimeout(
            () => reject(new Error("timed out waiting for SSE event")),
            2_000,
          );
        }),
      ]);
      assert.match(event, /comment-created/);
    } finally {
      if (eventTimer) clearTimeout(eventTimer);
      await eventReader.cancel();
    }

    const rendered = await worker.fetch(`/s/${post.id}?surface=0&ver=1&mode=dark`, {
      headers: AUTH,
    });
    assert.equal(rendered.status, 200);
    assert.match(await rendered.text(), /worker-marker/);
    assert.equal(rendered.headers.get("content-security-policy"), "sandbox allow-scripts");
    assert.equal(rendered.headers.get("referrer-policy"), "no-referrer");
    assert.equal(rendered.headers.get("x-content-type-options"), "nosniff");
    assert.match(rendered.headers.get("cache-control") ?? "", /immutable/);

    // Rich surfaces are the ones that pull in richRender.ts, and app.ts imports it
    // DYNAMICALLY so a server that never renders one doesn't pay ~48 MB of RSS for
    // shiki/@pierre/diffs at boot. A dynamic import is the kind of thing that works
    // on Node and fails only once deployed, so it gets exercised on real workerd
    // here — the html render above deliberately never reaches that code path.
    //
    // Each assertion looks for markup only the real renderer emits (shiki's span
    // classes, ansi_up's inline colors, the diff web component), so a renderer that
    // loaded but silently produced a fallback still fails.
    const richPost = await expectJson<WriteResult>(
      await worker.fetch(
        "/api/mocks",
        json({
          session: sessionId,
          project: "worker",
          mock: "rich",
          title: "Rich surfaces",
          surfaces: [
            { kind: "markdown", markdown: "# Heading\n\n```ts\nconst x: number = 1;\n```" },
            { kind: "code", code: "export const y = 2;", language: "typescript" },
            { kind: "terminal", text: "\u001b[31mred\u001b[0m plain" },
            {
              kind: "diff",
              patch: [
                "diff --git a/a.ts b/a.ts",
                "--- a/a.ts",
                "+++ b/a.ts",
                "@@ -1,2 +1,2 @@",
                " const keep = 1;",
                "-const before = 2;",
                "+const after = 3;",
              ].join("\n"),
            },
          ],
        }),
      ),
      201,
    );
    const richExpectations: Array<[kind: string, pattern: RegExp]> = [
      ["markdown", /<h1>Heading<\/h1>/],
      ["code", /class="shiki/],
      ["terminal", /rgb\(/],
      ["diff", /diffs-container/],
    ];
    for (const [index, [kind, pattern]] of richExpectations.entries()) {
      const page = await worker.fetch(`/s/${richPost.post.id}?surface=${index}&mode=dark`, {
        headers: AUTH,
      });
      const body = await page.text();
      assert.equal(page.status, 200, `${kind} surface failed to render: ${body.slice(0, 400)}`);
      assert.match(body, pattern, `${kind} surface rendered without the real renderer's markup`);
    }

    assert.equal((await worker.fetch(`/s/${post.id}.png?card=1`, { method: "HEAD" })).status, 401);
    const screenshot = await worker.fetch(`/s/${post.id}.png?card=1`, {
      method: "HEAD",
      headers: AUTH,
    });
    assert.equal(screenshot.status, 200);
    assert.equal(screenshot.headers.get("content-type"), "image/png");
    assert.equal((await screenshot.arrayBuffer()).byteLength, 0);
    assert.equal(
      (await worker.fetch("/s/missing.png", { method: "HEAD", headers: AUTH })).status,
      404,
    );

    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const asset = await expectJson<AssetResult>(
      await worker.fetch(
        "/api/assets",
        json({
          session: sessionId,
          filename: "worker.bin",
          contentType: "application/octet-stream",
          data: Buffer.from(bytes).toString("base64"),
        }),
      ),
      201,
    );
    assert.equal(asset.sessionId, sessionId);
    assert.equal(asset.byteLength, bytes.byteLength);

    const servedAsset = await worker.fetch(`/a/${asset.id}`, { headers: AUTH });
    assert.equal(servedAsset.status, 200);
    assert.equal(servedAsset.headers.get("content-type"), "application/octet-stream");
    assert.equal(servedAsset.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await servedAsset.arrayBuffer()), bytes);

    await expectJson(await worker.fetch("/api/theme", json({ mode: "light" }, "PUT")), 200);

    const pendingFeedback = worker.fetch(`/api/comments?session=${sessionId}&author=user&wait=2`, {
      headers: AUTH,
    });
    // Give the held request time to register before the write, matching the
    // direct-app wakeup test and exercising the DO's in-memory event bus path.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expectJson(
      await worker.fetch(
        "/api/comments",
        json({ mock: mockId, text: "wake the worker", author: "user" }),
      ),
      201,
    );
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
    let feedbackResponse: Awaited<typeof pendingFeedback>;
    try {
      feedbackResponse = await Promise.race([
        pendingFeedback,
        new Promise<never>((_resolve, reject) => {
          feedbackTimer = setTimeout(
            () => reject(new Error("long-poll was not woken by the DO event bus")),
            1_000,
          );
        }),
      ]);
    } finally {
      if (feedbackTimer) clearTimeout(feedbackTimer);
    }
    const waited = await expectJson<{ comments: Array<{ text: string }> }>(feedbackResponse, 200);
    assert.deepEqual(
      waited.comments.map((comment) => comment.text),
      ["wake the worker"],
    );

    const afterWait = await expectJson<WriteResult>(
      await worker.fetch(
        `/api/mocks/${mockId}/revise`,
        json({
          session: sessionId,
          title: "Worker post v2",
          surfaces: [{ kind: "html", html: `${marker}<p>v2</p>` }],
        }),
      ),
      200,
    );
    assert.equal(afterWait.userFeedback, undefined);

    await expectJson(
      await worker.fetch(
        "/api/comments",
        json({ mock: mockId, text: "persist this feedback", author: "user" }),
      ),
      201,
    );
    const piggybacked = await expectJson<WriteResult>(
      await worker.fetch(
        `/api/mocks/${mockId}/revise`,
        json({
          session: sessionId,
          title: "Worker post v3",
          surfaces: [{ kind: "html", html: `${marker}<p>v3</p>` }],
        }),
      ),
      200,
    );
    assert.deepEqual(
      piggybacked.userFeedback?.flatMap((batch) => batch.comments.map((c) => c.text)),
      ["persist this feedback"],
    );

    await stopWorker();
    worker = await startWorker(persistTo, {
      MOCKPIT_TOKEN: TOKEN,
      MOCKPIT_PUBLIC_READ: "session",
    });

    const publicMock = await expectJson<MockDetail>(
      await worker.fetch(`/api/mocks/${mockId}`),
      200,
    );
    assert.equal(publicMock.variants[0].title, "Worker post v3");
    assert.equal((await worker.fetch("/api/sessions")).status, 401);

    const persisted = await expectJson<MockDetail>(
      await worker.fetch(`/api/mocks/${mockId}?body=1`, { headers: AUTH }),
      200,
    );
    assert.equal(persisted.variants[0].title, "Worker post v3");
    assert.equal(persisted.variants[0].version, 3);
    assert.equal(persisted.variants[0].surfaces[0].html, `${marker}<p>v3</p>`);

    const persistedTheme = await expectJson<{ mode: string }>(
      await worker.fetch("/api/theme", { headers: AUTH }),
      200,
    );
    assert.equal(persistedTheme.mode, "light");

    const persistedAsset = await worker.fetch(`/a/${asset.id}`, { headers: AUTH });
    assert.equal(persistedAsset.status, 200);
    assert.deepEqual(new Uint8Array(await persistedAsset.arrayBuffer()), bytes);

    await expectJson(
      await worker.fetch(
        "/api/comments",
        json({ mock: mockId, text: "feedback after restart", author: "user" }),
      ),
      201,
    );
    const afterRestart = await expectJson<WriteResult>(
      await worker.fetch(
        `/api/mocks/${mockId}/revise`,
        json({
          session: sessionId,
          title: "Worker post v4",
          surfaces: [{ kind: "html", html: `${marker}<p>v4</p>` }],
        }),
      ),
      200,
    );
    assert.deepEqual(
      afterRestart.userFeedback?.flatMap((batch) => batch.comments.map((c) => c.text)),
      ["feedback after restart"],
    );

    const sessions = await expectJson<Array<{ id: string; postCount: number }>>(
      await worker.fetch("/api/sessions", { headers: AUTH }),
      200,
    );
    // Two variants: the html card this test drives throughout, plus the rich-surface
    // mock published above to exercise the lazily-imported renderers.
    assert.deepEqual(
      sessions.map(({ id, postCount }) => ({ id, postCount })),
      [{ id: sessionId, postCount: 2 }],
    );
  },
);
