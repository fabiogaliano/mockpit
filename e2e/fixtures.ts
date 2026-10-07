import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const embedDir = fileURLToPath(new URL("../viewer/dist-embed", import.meta.url));

type ServerHandle = { url: string; stop: () => void };

type PublicReadServer = { url: string; token: string; mode: "full" | "session" };

export async function startMockpitServer(
  env: Record<string, string | undefined> = {},
): Promise<ServerHandle> {
  const dataDir = mkdtempSync(join(tmpdir(), "mockpit-e2e-"));
  const proc: ChildProcess = spawn(process.execPath, ["server/index.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      PORT: "0",
      MOCKPIT_DATA: join(dataDir, "data.json"),
      // empty = no version = no update check: keeps tests off the network
      // and the update banner out of the DOM
      MOCKPIT_VERSION: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = out.match(/listening on (http:\/\/localhost:\d+)/);
      if (match) resolve(match[1]);
    });
    proc.on("exit", (code) => reject(new Error(`server exited early with code ${code}`)));
    setTimeout(() => reject(new Error(`server did not boot in time; output: ${out}`)), 15_000);
  });
  return { url, stop: () => proc.kill() };
}

// Each test gets its own mockpit server on an ephemeral port with a fresh
// data file, so tests can mutate state freely and run in parallel.
export const test = base.extend<{ server: { url: string } }>({
  // oxlint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const server = await startMockpitServer({ MOCKPIT_TOKEN: "" });
    try {
      await use({ url: server.url });
    } finally {
      server.stop();
    }
  },
});

export const publicReadTest = base.extend<{ publicReadServer: PublicReadServer }>({
  // oxlint-disable-next-line no-empty-pattern
  publicReadServer: async ({}, use) => {
    const token = "secret";
    const mode = "full";
    const server = await startMockpitServer({ MOCKPIT_TOKEN: token, MOCKPIT_PUBLIC_READ: mode });
    try {
      await use({ url: server.url, token, mode });
    } finally {
      server.stop();
    }
  },
});

export { expect };

export async function publish(
  serverUrl: string,
  body: { html: string; title?: string; agent?: string; session?: string; sessionTitle?: string },
  token?: string,
): Promise<{ id: string; sessionId: string; version: number }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${serverUrl}/api/snippets`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`publish failed: ${res.status}`);
  return res.json() as Promise<{ id: string; sessionId: string; version: number }>;
}

export async function update(
  serverUrl: string,
  id: string,
  body: { html?: string; title?: string },
): Promise<void> {
  const res = await fetch(`${serverUrl}/api/snippets/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`update failed: ${res.status}`);
}

// A 1x1 transparent PNG, base64 — small enough to inline in a test.
export const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export async function upload(
  serverUrl: string,
  body: { data: string; contentType: string; filename?: string; kind?: string; session?: string },
): Promise<{ id: string; sessionId: string; url: string; kind: string }> {
  const res = await fetch(`${serverUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json() as Promise<{ id: string; sessionId: string; url: string; kind: string }>;
}

// A post published through the reshape contract: project › item › variant.
// `publish`/`publishParts` above stay on the legacy routes (which the server
// still resolves into an item), so both entry points keep coverage.
export interface PublishedItem {
  id: string;
  sessionId: string;
  version: number;
  project: string;
  slug: string;
  variant: string;
}

export async function publishItem(
  serverUrl: string,
  body: {
    surfaces?: unknown[];
    html?: string;
    title?: string;
    project?: string;
    slug?: string;
    kind?: "component" | "page";
    variant?: string;
    prompt?: string;
    from?: number;
    slots?: unknown[];
    agent?: string;
    session?: string;
  },
  token?: string,
): Promise<PublishedItem> {
  const { html, ...rest } = body;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${serverUrl}/api/posts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...rest,
      surfaces: body.surfaces ?? [{ kind: "html", html: html ?? "<p>item</p>" }],
    }),
  });
  if (!res.ok) throw new Error(`publishItem failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<PublishedItem>;
}

// The three-project demo workspace (`POST /api/demo/reshape`, the same seed
// `mockpit demo` writes) — for specs that need a populated navigation.
export async function seedDemo(serverUrl: string): Promise<{
  project: string;
  sessionId: string;
  pricingId: string;
  pageId: string;
  draftId: string | null;
}> {
  const res = await fetch(`${serverUrl}/api/demo/reshape`, { method: "POST" });
  if (!res.ok) throw new Error(`demo seed failed: ${res.status}`);
  return res.json() as Promise<{
    project: string;
    sessionId: string;
    pricingId: string;
    pageId: string;
    draftId: string | null;
  }>;
}

export const itemPath = (project: string, slug?: string) =>
  slug
    ? `/project/${encodeURIComponent(project)}/${encodeURIComponent(slug)}`
    : `/project/${encodeURIComponent(project)}`;

// The item screen is the post surface now; `.ss-item` is its root and
// `.ss-stagewrap` holds the rendered variant. Scoping through this keeps specs
// off the update-notes card, the way `.card:not(#whatsNew)` used to.
export const itemScreen = (page: Page): Locator => page.locator(".ss-item");
export const stage = (page: Page): Locator => page.locator(".ss-stagewrap");

// The stage scales its frame to fit the pane (`transform: scale()`), so a
// bounding box is the SCALED height. Layout height is what the resize bridge
// actually set.
export function frameHeight(frame: Locator): Promise<number> {
  return frame.evaluate((el) => (el as HTMLElement).offsetHeight);
}

export async function publishParts(
  serverUrl: string,
  body: { title?: string; parts: unknown[]; agent?: string; session?: string },
): Promise<{ id: string; sessionId: string; version: number }> {
  const res = await fetch(`${serverUrl}/api/surfaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`publishParts failed: ${res.status}`);
  return res.json() as Promise<{ id: string; sessionId: string; version: number }>;
}

export async function expectNoHorizontalOverflow(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).count()).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page
        .locator(selector)
        .evaluateAll((elements) =>
          Math.max(0, ...elements.map((el) => Math.ceil(el.scrollWidth - el.clientWidth))),
        ),
    )
    .toBeLessThanOrEqual(1);
}

function embedContentType(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".css")) return "text/css";
  return "application/octet-stream";
}

export async function serveEmbedBundle(page: Page) {
  await page.route("**/__embed/**", (route) => {
    const name = new URL(route.request().url()).pathname.replace("/__embed/", "");
    route.fulfill({
      contentType: embedContentType(name),
      body: readFileSync(`${embedDir}/${name}`),
    });
  });
}

// Mount the built embeddable engine on the mockpit server's own origin, so its
// same-origin /api/* reads hit real data. `host` is the JS source of the host
// object passed to mountViewer; `body` is the light DOM inside the mount element
// (where an embedder projects `slot=` children). The engine attaches an OPEN
// shadow root, so Playwright's CSS locators pierce it.
export async function mountEmbed(
  page: Page,
  serverUrl: string,
  opts: { host: string; body?: string; prelude?: string; path?: string },
): Promise<void> {
  const path = opts.path ?? "/__embedtest";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}#m{position:fixed;inset:0}</style></head>
<body><div id="m">${opts.body ?? ""}</div>
${opts.prelude ?? ""}
<script type="module">
  import { mountViewer } from "/__embed/engine.js";
  window.__viewerHandle = mountViewer(document.getElementById("m"), ${opts.host});
</script></body></html>`;
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("[console]", m.text()));
  await page.route(`**${path}`, (route) => route.fulfill({ contentType: "text/html", body: html }));
  await serveEmbedBundle(page);
  await page.goto(`${serverUrl}${path}`);
}

// The host source for a router pinned to one route — for specs about a route the
// engine never leaves.
export const fixedRouter = (route: Record<string, unknown>) =>
  `{ get: () => (${JSON.stringify(route)}), navigate() {}, subscribe() { return () => {}; } }`;

// A host router that actually owns a route in memory: the engine resolves a
// session permalink onto the item screen by NAVIGATING, so any full-layout embed
// starting from `/session/:id` needs its host to honour that. The route it last
// received is readable as `window.__navigated`.
export const navigatingRouter = (initial: Record<string, unknown>) =>
  `{
    get: () => window.__route ?? (${JSON.stringify(initial)}),
    navigate(to) {
      window.__route = to;
      window.__navigated = to;
      for (const cb of (window.__subs ??= [])) cb(to);
    },
    subscribe(cb) {
      (window.__subs ??= []).push(cb);
      return () => { window.__subs = (window.__subs ?? []).filter((x) => x !== cb); };
    },
  }`;

export async function expectIframesNoHorizontalOverflow(page: Page, container: Locator) {
  const frameUrls = await container
    .locator("iframe")
    .evaluateAll((frames) => frames.map((frame) => (frame as HTMLIFrameElement).src));
  expect(frameUrls.length).toBeGreaterThan(0);

  await expect
    .poll(async () => {
      const childFrames = frameUrls
        .map((url) => page.frames().find((frame) => frame.url() === url))
        .filter((frame) => frame !== undefined);
      if (childFrames.length < frameUrls.length) return Number.POSITIVE_INFINITY;
      const overflows = await Promise.all(
        childFrames.map((frame) =>
          frame.evaluate(() => {
            if (document.readyState === "loading") return Number.POSITIVE_INFINITY;
            const doc = document.documentElement;
            const body = document.body;
            const scrollWidth = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0);
            const clientWidth = Math.max(doc.clientWidth, body?.clientWidth ?? 0);
            return Math.ceil(scrollWidth - clientWidth);
          }),
        ),
      );
      return Math.max(0, ...overflows);
    })
    .toBeLessThanOrEqual(1);
}
