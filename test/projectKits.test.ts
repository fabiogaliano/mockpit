import assert from "node:assert/strict";
import { test } from "node:test";
import { CDN_ALLOWLIST } from "../server/cdn.ts";
import { createApp } from "../server/app.ts";
import { renderBriefGuide } from "../server/designGuide.ts";
import { checkProjectKit, KITS, PROJECT_KIT_DOC_MAX } from "../server/kits.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { renderHtmlPage } from "../server/surfacePage.ts";
import type { DesignSettings } from "../server/types.ts";

// Reference kits (a CDN stylesheet plus a vocabulary blurb) and per-project
// kits. A kit URL is user-provided content that becomes a tag in the sandboxed
// document, so these tests pin that it stays there and stays on the allowlist.

const ORIGIN = "http://localhost:8228";
const ACME_CSS = "https://cdn.jsdelivr.net/npm/@acme/ui@2/dist/ui.css";
const ACME_DOC = "Buttons: `.acme-btn` (`.acme-btn--primary`). Cards: `.acme-card`.";

const makeApp = () =>
  createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html><head></head><body>viewer</body></html>",
    topics: { html: "# guide" },
    setupText: "# setup",
  });
type App = ReturnType<typeof makeApp>;

async function call(app: App, path: string, method = "GET", body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json, res };
}

const design = (over: Partial<DesignSettings> = {}): DesignSettings => ({
  detected: null,
  palette: null,
  kit: "none",
  cssVars: "",
  tailwindCss: "",
  strippedImports: [],
  iconSets: [],
  projectKits: [],
  updatedAt: "2026-10-08T00:00:00.000Z",
  ...over,
});

function cspSources(doc: string): string[] {
  const m = /content="([^"]*)"/.exec(doc.slice(doc.indexOf("Content-Security-Policy")));
  return (m ? m[1] : "").split(/[;\s]+/).filter((s) => s.includes("://"));
}

test("basecoat renders as a CDN link plus its token bridge, never inline library CSS", () => {
  const basecoat = KITS.find((k) => k.id === "basecoat")!;
  assert.ok(basecoat.summary.length <= 160 && basecoat.classes.length <= 160);
  const doc = renderHtmlPage({
    title: "t",
    html: '<button class="btn">Go</button>',
    origin: ORIGIN,
    kits: ["basecoat"],
  });
  assert.ok(doc.includes(`<link rel="stylesheet" href="${basecoat.href}">`));
  assert.ok(doc.includes(`<script src="${basecoat.script}" defer></script>`));
  assert.match(doc, /href="[^"]*\/asset\/kit-basecoat\.[a-z0-9]+\.css"/, "the bridge is an asset");
  assert.ok(!doc.includes("--primary:var(--color-text-primary)"), "no inline kit css");
  assert.ok(!doc.includes("kit-core"), "a reference kit skips mockpit's core helpers");
  // The CSP is unchanged: only the allowlist and the server's own origin.
  for (const src of cspSources(doc)) {
    assert.ok(CDN_ALLOWLIST.includes(src) || src.startsWith(ORIGIN), src);
  }
});

test("a project kit is injected only from the design it belongs to", () => {
  const own = { id: "acme", href: ACME_CSS, doc: ACME_DOC };
  const doc = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    design: design({ kit: "acme", projectKits: [own] }),
  });
  assert.ok(doc.includes(`<link rel="stylesheet" href="${ACME_CSS}">`));
  // A stored URL that somehow left the allowlist is dropped at render too.
  const tampered = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    kits: ["evil"],
    design: design({ projectKits: [{ id: "evil", href: "https://evil.example/x.css", doc: "x" }] }),
  });
  assert.ok(!tampered.includes("evil.example"));
});

test("checkProjectKit enforces https on the allowlist, a free id and a short doc", () => {
  assert.deepEqual(checkProjectKit({ id: "acme", href: ACME_CSS, doc: ACME_DOC }), {
    id: "acme",
    href: ACME_CSS,
    doc: ACME_DOC,
  });
  const bad = (over: Record<string, unknown>) =>
    checkProjectKit({ id: "acme", href: ACME_CSS, doc: ACME_DOC, ...over });
  assert.match(String(bad({ href: "http://cdn.jsdelivr.net/x.css" })), /cdn\.jsdelivr\.net/);
  assert.match(String(bad({ href: "https://example.com/x.css" })), /must be an https URL on/);
  assert.match(String(bad({ script: "javascript:alert(1)" })), /kit script/);
  assert.match(String(bad({ id: "basecoat" })), /taken/);
  assert.match(String(bad({ id: "tailwind" })), /taken/);
  assert.match(String(bad({ doc: "x".repeat(PROJECT_KIT_DOC_MAX + 1) })), /1200/);
  assert.match(String(bad({ doc: "" })), /needs a doc/);
});

test("project kits: add, list, use in surfaces, become the default, remove", async () => {
  const app = makeApp();
  const base = "/api/projects/demo";

  const refused = await call(app, `${base}/kits/acme`, "PUT", {
    href: "https://example.com/x.css",
    doc: ACME_DOC,
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /cdn\.jsdelivr\.net/);

  const added = await call(app, `${base}/kits/acme`, "PUT", { href: ACME_CSS, doc: ACME_DOC });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.projectKits, [{ id: "acme", href: ACME_CSS, doc: ACME_DOC }]);

  const listed = (await call(app, "/api/kits?project=demo")).body;
  assert.ok(listed.some((k: any) => k.id === "basecoat" && k.source === "bundled"));
  assert.ok(listed.some((k: any) => k.id === "acme" && k.source === "project"));
  assert.ok(!(await call(app, "/api/kits")).body.some((k: any) => k.id === "acme"));

  // Addressable in surfaces[].kits for this project only.
  const surface = { kind: "html", html: "<p>x</p>", kits: ["acme"] };
  const pub = await call(app, "/api/mocks", "POST", {
    project: "demo",
    mock: "card",
    surfaces: [surface],
  });
  assert.equal(pub.status, 201, JSON.stringify(pub.body));
  const doc = await (await app.request(`/s/${pub.body.post.id}?surface=0`)).text();
  assert.ok(doc.includes(`href="${ACME_CSS}"`));
  const elsewhere = await call(app, "/api/mocks", "POST", {
    project: "other",
    mock: "card",
    surfaces: [surface],
  });
  assert.equal(elsewhere.status, 400);
  assert.match(elsewhere.body.error, /unknown kit "acme"/);
  const unknown = await call(app, "/api/mocks", "POST", {
    project: "demo",
    mock: "card",
    surfaces: [{ kind: "html", html: "<p>x</p>", kits: ["nope"] }],
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /unknown kit "nope" — known: .*basecoat.*acme/);

  // The design PUT accepts the project kit (and bundled ones) as the default.
  const current = (await call(app, `${base}/design`)).body;
  const asDefault = await call(app, `${base}/design`, "PUT", { ...current, kit: "acme" });
  assert.equal(asDefault.status, 200);
  assert.equal(asDefault.body.kit, "acme");
  assert.deepEqual(
    asDefault.body.projectKits.map((k: any) => k.id),
    ["acme"],
  );
  assert.equal((await call(app, `${base}/design`, "PUT", { kit: "bogus" })).status, 400);
  assert.match(renderBriefGuide(asDefault.body), /Kit: acme[\s\S]*\.acme-btn--primary/);

  const removed = await call(app, `${base}/kits/acme`, "DELETE");
  assert.equal(removed.status, 200);
  assert.equal(removed.body.kit, "none", "the default falls back once its kit is gone");
  assert.deepEqual(removed.body.projectKits, []);
  assert.equal((await call(app, `${base}/kits/acme`, "DELETE")).status, 404);
});

test("the brief prints a bundled default's classes and lists basecoat when there is none", () => {
  assert.match(renderBriefGuide(design({ kit: "basecoat" })), /Kit: basecoat[^\n]*data-variant/);
  assert.match(renderBriefGuide(design()), /Kit: none[\s\S]*`basecoat`/);
});
