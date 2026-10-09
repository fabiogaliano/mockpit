import { expect, type Frame, type Page, test } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockpitServer } from "./fixtures.ts";
import {
  EXPECTED,
  MOCK_KNOBS,
  STATES,
  type State,
  VARIANT_KNOBS,
  writerHtml,
} from "./bridge/writer.ts";

// The parts/knobs bridge on the real /s/:id renderer, driven by a trusted host
// page that is NOT the viewer (docs/tmp/experiments/parts-bridge ported: the same
// Writer states and the same 21 checks), on chromium and webkit.

// The host page is served (by route interception) from the server's own origin,
// as the viewer is: a page on another origin framing localhost trips Chromium's
// local-network-access block.
const HOST_PATH = "/__e2e-bridge";
const here = fileURLToPath(new URL("./bridge/", import.meta.url));
const hostHtml = readFileSync(join(here, "host.html"), "utf8");
const hostJs = readFileSync(join(here, "host.js"), "utf8");
// Reported boxes vs Playwright's own measurement, through the host's scale.
const TOL = 0.05;

type Published = { mockId: string; ids: Record<State, string> };

async function api(server: string, path: string, body: unknown) {
  const res = await fetch(`${server}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ mock: { id: string }; post: { id: string; version: number } }>;
}

async function publishWriter(server: string): Promise<Published> {
  const ids = {} as Record<State, string>;
  let mockId = "";
  for (const state of STATES) {
    const out = await api(server, "/api/mocks", {
      project: "e2e",
      mock: "writer",
      state,
      html: writerHtml(state),
      ...(state === "rest" ? { knobs: MOCK_KNOBS, variantKnobs: VARIANT_KNOBS } : {}),
    });
    ids[state] = out.post.id;
    mockId = out.mock.id;
  }
  return { mockId, ids };
}

async function reviseWriter(server: string, mockId: string) {
  for (const state of STATES) {
    const out = await api(server, "/api/mocks", {
      mock: mockId,
      state,
      html: writerHtml(state, true),
    });
    expect(out.post.version).toBe(2);
  }
}

const servers = new Map<string, () => void>();
// oxlint-disable-next-line no-empty-pattern
test.afterEach(({}, info) => {
  servers.get(info.testId)?.();
});

async function boot(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-bridge-"));
  const server = await startMockpitServer({
    MOCKPIT_TOKEN: "",
    MOCKPIT_DB: join(dir, "db.sqlite"),
  });
  servers.set(test.info().testId, server.stop);
  await page.route(`${server.url}${HOST_PATH}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `${HOST_PATH}/host.js`) {
      return route.fulfill({ contentType: "text/javascript", body: hostJs });
    }
    return route.fulfill({ contentType: "text/html", body: hostHtml });
  });
  return server.url;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("parts bridge: identity, geometry, hit-testing and versions across four states", async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1000, height: 640 });
  const server = await boot(page);
  const { mockId, ids } = await publishWriter(server);
  await page.addInitScript(
    (cfg) => {
      (window as any).__bridgeConfig = cfg;
    },
    { server, ids, states: [...STATES] },
  );

  const rows: { label: string; ok: boolean; detail: string }[] = [];
  const check = (label: string, ok: boolean, detail = "") => rows.push({ label, ok, detail });
  const frameOf = (s: State): Frame =>
    page.frames().find((f) => f.url().includes(`/s/${ids[s]}?`))!;
  const report = (s: State) => page.evaluate((s) => (window as any).__mp.reports[s], s);
  const show = async (s: State) => {
    await page.click(`#strip button[data-state="${s}"]`);
    await sleep(150);
  };
  const waitComplete = (v: number) =>
    page.waitForFunction(
      ([exp, v]) => {
        const r = (window as any).__mp?.reports;
        return (
          r &&
          Object.keys(exp).every(
            (s) =>
              r[s] &&
              r[s].version === v &&
              (exp as any)[s].every((n: string) => r[s].parts.some((p: any) => p.name === n)),
          )
        );
      },
      [EXPECTED, v] as const,
      { timeout: 15_000 },
    );
  const completeIn = (log: any[], v: number) => {
    let first = 0,
      complete = 0;
    for (const s of STATES) {
      const mine = log.filter((e) => e.state === s && e.v === v);
      if (!mine.length) return null;
      first = Math.max(first, mine[0].t);
      const c = mine.find((e) => EXPECTED[s].every((n) => e.names.includes(n)));
      if (!c) return null;
      complete = Math.max(complete, c.t);
    }
    return { first, complete };
  };

  async function compareBoxes(s: State, tag: string) {
    const frame = frameOf(s);
    const r = await report(s);
    let worst = 0,
      worstName = "";
    const missing: string[] = [];
    for (const p of r.parts) {
      const ov = await page.locator(`#layer .ov[data-name="${p.name}"]`).first().boundingBox();
      const direct = await frame.locator(`[data-part="${p.name}"]`).first().boundingBox();
      if (!ov || !direct) {
        missing.push(p.name);
        continue;
      }
      const err = Math.max(
        Math.abs(ov.x - direct.x),
        Math.abs(ov.y - direct.y),
        Math.abs(ov.width - direct.width),
        Math.abs(ov.height - direct.height),
      );
      if (err > worst) {
        worst = err;
        worstName = p.name;
      }
    }
    check(
      `(b) boxes ${s}${tag}`,
      worst <= TOL && !missing.length,
      `max ${worst.toFixed(2)}px${worstName ? " @" + worstName : ""}${missing.length ? " missing " + missing.join(",") : ""}`,
    );
  }

  const navAt = Date.now();
  await page.goto(`${server}${HOST_PATH}/host.html`);
  await waitComplete(1);
  const t1 = completeIn(await page.evaluate(() => (window as any).__mp.log), 1);
  await sleep(1000); // the 600ms late-font class and the toast animation settle

  // late font: every state's title was re-reported at a new height
  const flog = await page.evaluate(() => (window as any).__mp.log);
  const fontDetail: string[] = [],
    fontBad: string[] = [];
  for (const s of STATES) {
    const hs = flog
      .filter((e: any) => e.state === s && e.v === 1)
      .map((e: any) => e.h[e.names.indexOf("title")]);
    if (!(hs.at(-1) > hs[0] + 1)) fontBad.push(s);
    fontDetail.push(`${s} ${hs[0].toFixed(0)}→${hs.at(-1).toFixed(0)}`);
  }
  check("(b) late font class re-reported title", !fontBad.length, fontDetail.join(", "));

  // (a) names per state, and union identity
  const bad: string[] = [];
  for (const s of STATES) {
    const got: string[] = (await report(s)).parts.map((p: any) => p.name);
    if (!sameSet([...new Set(got)], EXPECTED[s])) bad.push(`${s}: ${got.join(",")}`);
  }
  check("(a) expected names in each of 4 states", !bad.length, bad.join("; ") || "exact match");
  const union = await page.evaluate(() => (window as any).__mp.union);
  check(
    "(a) union: versions in all 4",
    sameSet(union.versions || [], [...STATES]),
    (union.versions || []).join(","),
  );
  const panelVersions = (await report("panel")).parts.find((p: any) => p.name === "versions");
  check(
    "(a) nested: versions in panel",
    panelVersions?.parent === "panel" && panelVersions.depth === 1,
    JSON.stringify({ parent: panelVersions?.parent, depth: panelVersions?.depth }),
  );

  for (const s of STATES) {
    await show(s);
    await compareBoxes(s, "");
  }
  // scrolled: a wheel over the overlay layer is forwarded into the frame
  for (const s of ["rest", "lab"] as const) {
    await show(s);
    const before = (await page.evaluate(() => ({ ...(window as any).__mp.counts })))[s];
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(
      ([s, n]) =>
        (window as any).__mp.counts[s] > n && (window as any).__mp.reports[s].scroll.y > 0,
      [s, before] as const,
    );
    await sleep(200);
    const sy = await frameOf(s).evaluate(() => scrollY);
    const r = await report(s);
    check(
      `(b) scroll forwarded ${s}`,
      sy > 0 && r.scroll.y === sy,
      `frame scrollY=${sy} reported=${r.scroll.y}`,
    );
    await compareBoxes(s, " scrolled");
    await frameOf(s).evaluate(() => scrollTo(0, 0));
    await sleep(200);
  }

  // (c) hover highlights in-frame; click hit-tests in-frame
  await show("rest");
  const highlighted = (s: State) =>
    frameOf(s).evaluate(() =>
      [...document.querySelectorAll(".mockpit-part-hl")].map(
        (e) => (e as HTMLElement).dataset.part!,
      ),
    );
  const hov = (await page.locator('#layer .ov[data-name="title"]').boundingBox())!;
  const countsBeforeHover = await page.evaluate(() => ({ ...(window as any).__mp.counts }));
  await page.mouse.move(hov.x + hov.width / 2, hov.y + hov.height / 2);
  await sleep(150);
  const hl = await highlighted("rest");
  check("(c) hover title highlights in frame", sameSet(hl, ["title"]), hl.join(",") || "none");
  await page.mouse.move(5, 5);
  await sleep(150);
  const hl2 = (await highlighted("rest")).length;
  check("(c) leave clears highlight", hl2 === 0, `${hl2} left`);
  // our own highlight class must not read as the page changing
  const countsAfterHover = await page.evaluate(() => ({ ...(window as any).__mp.counts }));
  expect(countsAfterHover.rest, "highlight/clear triggered a parts report").toBe(
    countsBeforeHover.rest,
  );
  const hitsBefore = await page.evaluate(() => (window as any).__mp.hits.length);
  const wordOv = (await page.locator('#layer .ov[data-name="word"]').boundingBox())!;
  await page.mouse.click(wordOv.x + wordOv.width / 2, wordOv.y + wordOv.height / 2);
  await page.waitForFunction((n) => (window as any).__mp.hits.length > n, hitsBefore);
  const hit = await page.evaluate(() => (window as any).__mp.hits.at(-1).name);
  check("(c) click word -> hit deepest = word", hit === "word", String(hit));

  // (d) v2: trim moves inside lab, title grows; identity by name survives
  await show("lab");
  const v1 = await report("lab");
  const title1 = v1.parts.find((p: any) => p.name === "title").box.h;
  await reviseWriter(server, mockId);
  await page.click("#v2");
  await waitComplete(2);
  const log = await page.evaluate(() => (window as any).__mp.log);
  const v2At = await page.evaluate(() => (window as any).__mp.v2At);
  const c2 = completeIn(log, 2);
  await sleep(1000);
  const v2 = await report("lab");
  const trim = v2.parts.find((p: any) => p.name === "trim"),
    lab = v2.parts.find((p: any) => p.name === "lab");
  const title2 = v2.parts.find((p: any) => p.name === "title").box.h;
  const inside =
    trim &&
    lab &&
    trim.box.x >= lab.box.x &&
    trim.box.y >= lab.box.y &&
    trim.box.x + trim.box.w <= lab.box.x + lab.box.w + 0.5 &&
    trim.box.y + trim.box.h <= lab.box.y + lab.box.h + 0.5;
  check(
    "(d) v2 trim nested in lab",
    trim?.parent === "lab" && trim.depth === 1 && !!inside,
    JSON.stringify({ parent: trim?.parent, depth: trim?.depth, inside }),
  );
  check("(d) v2 title taller", title2 > title1, `${title1.toFixed(1)} -> ${title2.toFixed(1)}`);
  check(
    "(d) v2 identity: union unchanged",
    sameSet(Object.keys(await page.evaluate(() => (window as any).__mp.union)), Object.keys(union)),
    "",
  );
  await compareBoxes("lab", " v2");
  const tOv = (await page.locator('#layer .ov[data-name="trim"]').boundingBox())!;
  const hb = await page.evaluate(() => (window as any).__mp.hits.length);
  await page.mouse.click(tOv.x + tOv.width / 2, tOv.y + tOv.height / 2);
  await page.waitForFunction((n) => (window as any).__mp.hits.length > n, hb);
  const hit2 = await page.evaluate(() => (window as any).__mp.hits.at(-1).name);
  check("(d) click trim inside lab -> trim (deepest)", hit2 === "trim", String(hit2));

  // the lab popover's top-left corner paints over the (deeper) versions well
  const lo = (await page.locator('#layer .ov[data-name="lab"]').boundingBox())!;
  await page.mouse.move(lo.x + 8, lo.y + 8);
  await sleep(150);
  const hl3 = await highlighted("lab");
  check(
    "(c) hover follows page stacking (lab over versions)",
    sameSet(hl3, ["lab"]),
    hl3.join(",") || "none",
  );

  const ms = (x: number | undefined) => (x == null ? "n/a" : `${Math.round(x)}ms`);
  // log times are performance.now() in the host, i.e. ms since its navigation
  const timing =
    `nav→first report all 4: ${ms(t1?.first)}, ` +
    `nav→complete: ${ms(t1?.complete)}, ` +
    `v2 click→complete: ${ms(c2 ? c2.complete - v2At : undefined)}`;
  const table = rows.map((r) => `${r.ok ? "✓" : "✗"} ${r.label}: ${r.detail}`).join("\n");
  console.log(
    `[${browserName}] ${rows.filter((r) => r.ok).length}/${rows.length}; ${timing}\n${table}`,
  );
  test
    .info()
    .annotations.push({ type: "timing", description: `${timing} (wall ${Date.now() - navAt}ms)` });
  expect(rows.length).toBe(21);
  expect(rows.filter((r) => !r.ok).map((r) => `${r.label}: ${r.detail}`)).toEqual([]);
});

test("knobs: ?k= is baked on load, the knobs command applies live, invalid values are refused", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 640 });
  const server = await boot(page);
  const { ids } = await publishWriter(server);
  const src = (k: unknown) =>
    `${server}/s/${ids.rest}?surface=0&ver=1&mode=light&k=${encodeURIComponent(JSON.stringify(k))}`;

  // out of range never reaches a document
  const refused = await fetch(src({ size: 99 }));
  expect(refused.status).toBe(400);
  expect(refused.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
  expect((await fetch(src({ face: "comic" }))).status).toBe(400);
  expect((await fetch(src({ undeclared: 1 }))).status).toBe(400);

  await page.goto(`${server}${HOST_PATH}/blank.html`);
  await page.evaluate(
    (url) => {
      document.body.textContent = "";
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-scripts");
      f.width = "820";
      f.height = "640";
      f.src = url;
      document.body.appendChild(f);
    },
    src({ size: 20, face: "mono", label: "Draft <4>" }),
  );
  await expect.poll(() => page.frames().length).toBe(2);
  const frame = page.frames()[1];
  await frame.waitForFunction(() => (window as any).__knobEvents?.length >= 1);

  const read = () =>
    frame.evaluate(() => {
      const root = document.documentElement;
      const shown = (sel: string) =>
        getComputedStyle(document.querySelector(sel)!).display !== "none";
      return {
        size: getComputedStyle(root).getPropertyValue("--k-size").trim(),
        face: root.getAttribute("data-k-face"),
        sizeAttr: root.getAttribute("data-k-size"),
        bodyPx: getComputedStyle(document.body).fontSize,
        label: document.getElementById("wr-label")!.textContent,
        mono: shown(".wr-face-mono"),
        serif: shown(".wr-face-serif"),
        events: (window as any).__knobEvents,
      };
    });
  const baked = await read();
  expect(baked).toMatchObject({
    size: "20",
    face: "mono",
    sizeAttr: "20",
    bodyPx: "20px",
    label: "Draft <4>",
    mono: true,
    serif: false,
  });
  expect(baked.events).toEqual([{ size: 20, face: "mono", label: "Draft <4>" }]);

  // live: the same mapping, applied in place (no reload), and idempotent
  const send = (values: Record<string, unknown>) =>
    page.evaluate((values) => {
      document
        .querySelector("iframe")!
        .contentWindow!.postMessage({ __mockpit: true, type: "knobs", values }, "*");
    }, values);
  await send({ size: 14, face: "serif" });
  await send({ size: 14, face: "serif" });
  await frame.waitForFunction(() => (window as any).__knobEvents.length >= 3);
  const live = await read();
  expect(live).toMatchObject({
    size: "14",
    face: "serif",
    sizeAttr: "14",
    bodyPx: "14px",
    label: "Draft <4>",
    mono: false,
    serif: true,
  });
  expect(live.events.at(-1)).toEqual({ size: 14, face: "serif", label: "Draft <4>" });
  expect(live.events.at(-2)).toEqual(live.events.at(-1));
});
