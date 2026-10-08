import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import {
  bundledIconSets,
  expandIcons,
  iconCount,
  iconFromSet,
  type IconifyJSON,
  resolverFor,
} from "../server/icons.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";

const CHECK = '<path fill="none" stroke="currentColor" d="M5 12l5 5L20 7"/>';
const STAR = '<path fill="currentColor" d="M12 2l3 7h7l-6 5l2 8l-6-4l-6 4l2-8l-6-5h7z"/>';

const fixture: IconifyJSON = {
  prefix: "t",
  width: 24,
  height: 24,
  icons: {
    check: { body: CHECK },
    star: { body: STAR },
    wide: { body: "<rect/>", width: 32 },
    old: { body: "<circle/>", hidden: true },
  },
  aliases: {
    tick: { parent: "check" },
    "tick-again": { parent: "tick" },
    "check-mirrored": { parent: "check", hFlip: true },
    "check-turned": { parent: "wide", rotate: 1 },
    "wide-tall": { parent: "wide", height: 32 },
    orphan: { parent: "missing" },
  },
};

const mage: IconifyJSON = {
  prefix: "mage",
  width: 24,
  height: 24,
  icons: { check: { body: CHECK } },
};

const resolve = resolverFor([fixture, mage]);

test("an icon attribute becomes an inline svg that keeps the element's attributes", () => {
  const { html, unknown } = expandIcons(
    '<p>Done <i icon="t:check" class="big" data-part="ok" style="color:red"></i></p>',
    resolve,
  );
  assert.equal(
    html,
    `<p>Done <svg class="icon big" data-part="ok" style="color:red" viewBox="0 0 24 24" aria-hidden="true">${CHECK}</svg></p>`,
  );
  assert.deepEqual(unknown, []);

  assert.equal(
    expandIcons("<span icon='t:star'/>", resolve).html,
    `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${STAR}</svg>`,
    "self-closing, any tag",
  );
  assert.match(
    expandIcons('<i icon="t:star" aria-label="Favourite"></i>', resolve).html,
    /^<svg class="icon" aria-label="Favourite" viewBox="0 0 24 24" role="img">/,
    "a labelled icon is an image, not decoration",
  );
});

test("only empty elements outside script, style and comments are expanded", () => {
  const src = [
    '<button icon="t:check">Save</button>',
    `<script>el.innerHTML = '<i icon="t:check"></i>';</script>`,
    '<style>[icon="t:check"]{}</style>',
    '<!-- <i icon="t:check"></i> -->',
    '<i icon="nocolon"></i>',
  ].join("");
  assert.deepEqual(expandIcons(src, resolve), { html: src, unknown: [] });
});

test("unknown names render as an empty box and are reported once", () => {
  const { html, unknown } = expandIcons(
    '<i icon="t:nope"></i><i icon="t:nope"></i><i icon="zz:check"></i>',
    resolve,
  );
  assert.equal(html, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"></svg>'.repeat(3));
  assert.deepEqual(unknown, ["t:nope", "zz:check"]);
});

test("the older mage sprite form expands from the same data", () => {
  const { html, unknown } = expandIcons(
    '<svg class="icon" data-part="x"><use href="#mage-check"/></svg>' +
      '<svg class="icon"><use xlink:href="#mage-check"></use></svg>' +
      '<svg class="icon"><use href="#mage-gone"/></svg>' +
      '<svg><use href="#other"/></svg>',
    resolve,
  );
  assert.equal(
    html,
    `<svg class="icon" data-part="x" viewBox="0 0 24 24" aria-hidden="true">${CHECK}</svg>` +
      `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${CHECK}</svg>` +
      '<svg class="icon"><use href="#mage-gone"/></svg>' +
      '<svg><use href="#other"/></svg>',
  );
  assert.deepEqual(unknown, ["mage:gone"]);
});

test("per-icon sizes, hidden icons and aliases resolve as Iconify defines them", () => {
  assert.deepEqual(iconFromSet(fixture, "wide"), {
    body: "<rect/>",
    left: 0,
    top: 0,
    width: 32,
    height: 24,
  });
  assert.equal(iconFromSet(fixture, "old")?.body, "<circle/>", "hidden icons still resolve");
  assert.equal(iconCount(fixture), 3, "but are not counted");

  assert.equal(iconFromSet(fixture, "tick")?.body, CHECK);
  assert.equal(iconFromSet(fixture, "tick-again")?.body, CHECK, "aliases chain");
  assert.equal(iconFromSet(fixture, "wide-tall")?.height, 32, "an alias can resize");
  assert.equal(
    iconFromSet(fixture, "check-mirrored")?.body,
    `<g transform="translate(24 0) scale(-1 1)">${CHECK}</g>`,
  );
  const turned = iconFromSet(fixture, "check-turned")!;
  assert.equal(turned.body, '<g transform="rotate(90 16 12)"><rect/></g>');
  assert.deepEqual([turned.left, turned.top, turned.width, turned.height], [4, -4, 24, 32]);
  assert.equal(iconFromSet(fixture, "orphan"), null);
  assert.equal(iconFromSet(fixture, "constructor"), null, "no prototype lookups");
});

test("lucide and mage are bundled", async () => {
  const sets = await bundledIconSets();
  assert.deepEqual([...sets.keys()], ["lucide", "mage"]);
  const bundled = resolverFor(sets.values());
  assert.match(bundled("lucide", "check")!.body, /stroke="currentColor"/);
  assert.ok(bundled("mage", "check"));
  const lucide = sets.get("lucide")!;
  const [alias, { parent }] = Object.entries(lucide.aliases ?? {})[0];
  assert.equal(bundled("lucide", alias)!.body, lucide.icons[parent].body);
});

// --- through the API ---------------------------------------------------------

const CT = { "content-type": "application/json" };
function makeApp() {
  return createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html><head></head><body>viewer</body></html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    agentHowtoText: "# agent how-to",
  });
}
type App = ReturnType<typeof makeApp>;

async function json(app: App, path: string, init?: { method: string; body?: unknown }) {
  const res = await app.request(path, {
    method: init?.method ?? "GET",
    headers: CT,
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function uploadSet(app: App, set: unknown): Promise<string> {
  const res = await app.request("/api/assets?kind=file&filename=icons.json", {
    method: "POST",
    headers: CT,
    body: JSON.stringify(set),
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as { id: string }).id;
}

const putIcons = (app: App, iconSets: unknown, extra: Record<string, unknown> = {}) =>
  json(app, "/api/projects/demo/design", { method: "PUT", body: { ...extra, iconSets } });

test("icons add: an uploaded set is installed on the project's design", async () => {
  const app = makeApp();
  const assetId = await uploadSet(app, fixture);

  const put = await putIcons(app, [{ prefix: "t", assetId, count: 999 }], { kit: "builtin" });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.iconSets, [{ prefix: "t", assetId, count: 3 }], "count is read");

  const list = await json(app, "/api/projects/demo/icons");
  assert.deepEqual(
    list.body.sets.map((s: { prefix: string; source: string }) => `${s.prefix}:${s.source}`),
    ["t:installed", "lucide:bundled", "mage:bundled"],
  );

  // init re-PUTs the detected design without iconSets; installed sets survive
  const reinit = await json(app, "/api/projects/demo/design", {
    method: "PUT",
    body: { kit: "tailwind" },
  });
  assert.deepEqual(reinit.body.iconSets, put.body.iconSets);

  const mismatch = await putIcons(app, [{ prefix: "lucide", assetId }]);
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body.error, /holds the t set/);
  const notASet = await uploadSet(app, { hello: "world" });
  assert.equal((await putIcons(app, [{ prefix: "x", assetId: notASet }])).status, 400);
  assert.equal((await putIcons(app, [{ prefix: "x", assetId: "nope" }])).status, 400);

  const removed = await putIcons(app, []);
  assert.deepEqual(removed.body.iconSets, []);
});

test("writes warn about unknown icons; /s/:id inlines known ones with no sprite loader", async () => {
  const app = makeApp();
  const pub = await json(app, "/api/mocks", {
    method: "POST",
    body: {
      project: "demo",
      mock: "icons",
      html: '<i icon="lucide:check" data-part="ok"></i><i icon="t:check"></i><i icon="lucide:nope"></i>',
    },
  });
  assert.equal(pub.status, 201);
  assert.deepEqual(pub.body.warnings, [
    "unknown icon t:check (sets: lucide, mage)",
    "unknown icon lucide:nope (sets: lucide, mage)",
  ]);

  const render = async () => (await app.request(`/s/${pub.body.post.id}?surface=0`)).text();
  const before = await render();
  assert.match(
    before,
    /<svg class="icon" data-part="ok" viewBox="0 0 24 24" aria-hidden="true"><path [^>]*stroke="currentColor"/,
  );
  assert.ok(!before.includes("icon="), "no icon attribute reaches the frame");
  assert.ok(!before.includes("fetch("), "no sprite loader");
  const csp = before.match(/connect-src ([^;"]*)/)![1];
  assert.ok(!csp.includes("localhost"), "connect-src stays CDN-only");

  // installing a set must not leave the latest render stale
  await putIcons(app, [{ prefix: "t", assetId: await uploadSet(app, fixture) }]);
  assert.ok((await render()).includes(CHECK));

  const revised = await json(app, "/api/mocks", {
    method: "POST",
    body: { project: "demo", mock: "icons", html: '<i icon="t:check"></i>' },
  });
  assert.equal(revised.status, 200);
  assert.equal(revised.body.warnings, undefined, "no unknown icons, no field");
});
