import { agentCall, expect, test } from "./fixtures.ts";

// An answer drives the screen on a phone even while the page is still loading
// something slow: the stage starts with the draft's values (they ride in its
// URL) and takes a tap's values the moment its knob runtime says it is ready,
// not after the parts report a slow stylesheet holds back. Once the page has
// reported, the part an answer changed is outlined on stage.

const SLOW_CSS = "https://cdn.jsdelivr.net/npm/mockpit-e2e-slow/slow.css";
const fill = (name: string, body: string) =>
  `<section class="f-${name}" data-part="${name === "dots" ? "dots" : "entry"}" data-part-label="Entry">${body}</section>`;
const html = `<link rel="stylesheet" href="${SLOW_CSS}">
<style>
  body{margin:0;font:16px system-ui;padding:24px}
  html:not([data-k-pending="dots"]) .f-dots,
  html:not([data-k-pending="skeleton"]) .f-skeleton,
  html:not([data-k-pending="filling"]) .f-filling{display:none}
  section{padding:16px;border:1px solid #ccc;border-radius:12px}
</style>
<p data-part="message" data-part-label="Message">Bife à Passarinhos, with rice and fries</p>
${fill("dots", "···")}
${fill("skeleton", "<div style='height:120px'>Reading your message…</div>")}
${fill("filling", "<div style='height:60px'>Logging 2 of 3…</div>")}`;

test("a tap reaches the stage before a slow stylesheet loads, then outlines what changed", async ({
  page,
  server,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route(SLOW_CSS, async (route) => {
    await held;
    await route.fulfill({ contentType: "text/css", body: "/* slow */" });
  });

  const pub = await agentCall<{ mock: { id: string }; sessionId?: string }>(
    server.url,
    "/api/mocks",
    {
      project: "o",
      mock: "send",
      title: "Send",
      agent: "e2e",
      html,
      knobs: {
        pending: { type: "select", options: ["dots", "skeleton", "filling"], value: "filling" },
      },
    },
  );
  await agentCall(server.url, `/api/mocks/${pub.mock.id}/asks`, {
    session: pub.sessionId,
    asks: [
      {
        id: "pending",
        text: "Right after you send, what do you see?",
        options: [
          { label: "Typing dots", set: { pending: "dots" } },
          { label: "A skeleton card", set: { pending: "skeleton" } },
          { label: "The card fills in", set: { pending: "filling" } },
        ],
      },
    ],
  });

  // The held stylesheet is inside the stage frame, and a frame that attaches
  // before the viewer's own load holds that load back, so don't wait for it.
  await page.goto(`${server.url}/project/o/send`, { waitUntil: "domcontentloaded" });
  const doc = page.frameLocator(".frame.on iframe").locator("html");
  // First paint: the declared default, from the URL, with the stylesheet still held.
  await expect(doc).toHaveAttribute("data-k-pending", "filling");

  // A tap puts the pick on the stage while the stylesheet is still held.
  await page
    .getByRole("button", { name: /A skeleton card/ })
    .first()
    .tap();
  await expect(doc).toHaveAttribute("data-k-pending", "skeleton", { timeout: 2000 });

  // Once the page loads and reports its parts, a change is outlined on stage.
  release();
  await expect(page.locator(".frame.on .overlay[data-doc-width]")).toBeVisible();
  await page.waitForTimeout(500);
  await page
    .getByRole("button", { name: /Typing dots/ })
    .first()
    .tap();
  await expect(doc).toHaveAttribute("data-k-pending", "dots");
  await expect(page.locator('.frame.on .box.flash[data-part="dots"]')).toBeVisible();
});

// A whole phone screen beside the question card reads at under a fifth of its
// size, too small to see a fill change; a question about one slot fits that
// slot instead and scrolls the page to it.
test("a slot's question brings the slot into view at a readable size", async ({
  page,
  server,
}, testInfo) => {
  const tall = `<style>body{margin:0;font:16px system-ui}header{height:900px;padding:24px}section{padding:16px;margin:16px;border:1px solid #ccc;border-radius:12px}</style>
<header data-part="head">Monday</header>
<section data-part="entry" data-part-label="Entry" data-fill="dots">···</section>
<section data-part="entry" data-fill="skeleton"><div style="height:120px">Reading your message…</div></section>
<footer style="height:400px"></footer>`;
  const pub = await agentCall<{ mock: { id: string }; sessionId?: string }>(
    server.url,
    "/api/mocks",
    { project: "z", mock: "zoom", title: "Zoom", agent: "e2e", html: tall, widths: [390] },
  );
  await agentCall(server.url, `/api/mocks/${pub.mock.id}/asks`, {
    session: pub.sessionId,
    asks: [
      {
        id: "entry",
        text: "Right after you send?",
        options: [
          { label: "Typing dots", set: { entry: "dots" } },
          { label: "A skeleton card", set: { entry: "skeleton" } },
        ],
      },
    ],
  });
  await page.goto(`${server.url}/project/z/zoom`);
  const box = page.locator('.frame.on .box.sel[data-part="entry"]');
  await expect(box).toBeVisible();
  await expect
    .poll(async () => {
      const b = await box.boundingBox();
      const vh = page.viewportSize()!.height;
      return !!b && b.y >= 0 && b.y + b.height <= vh;
    })
    .toBe(true);
  if (testInfo.project.name === "iphone") {
    const frame = await page.locator(".frame.on iframe").boundingBox();
    expect(frame!.width / 390).toBeGreaterThan(0.5);
  }
});

// A select knob that the design reads as a `data-k-*` attribute, the way a
// design reads a faceplate tone. A tap picks it onto the stage and the same
// tap again moves on; the pick stays on stage past its question and a reload,
// which only a draft answer does: a preview is held in memory alone.
test("a tapped knob option reaches the stage and stays there once picked", async ({
  page,
  server,
}) => {
  const pub = await agentCall<{ mock: { id: string }; sessionId?: string }>(
    server.url,
    "/api/mocks",
    {
      project: "t",
      mock: "tone",
      title: "Tone",
      agent: "e2e",
      html: `<style>body{margin:0}.dv{height:600px;background:#e9e4da}[data-k-tone="graphite"] .dv{background:#2c2b29}</style>
<div class="dv" data-part="plate" data-part-label="Plate"></div>`,
      knobs: { tone: { type: "select", options: ["warm", "graphite"] } },
    },
  );
  await agentCall(server.url, `/api/mocks/${pub.mock.id}/asks`, {
    session: pub.sessionId,
    asks: [
      {
        id: "tone",
        text: "Faceplate tone?",
        options: [
          { id: "warm", label: "Warm", set: { tone: "warm" } },
          { id: "graphite", label: "Graphite", set: { tone: "graphite" } },
        ],
      },
      {
        id: "night",
        text: "Graphite after 21:00?",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
      },
    ],
  });

  await page.goto(`${server.url}/project/t/tone`);
  const doc = page.frameLocator(".frame.on iframe").locator("html");
  await expect(doc).toHaveAttribute("data-k-tone", "warm");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/draft") && r.request().method() === "PUT",
  );
  const graphite = page.locator('.qcard .opt[data-option="graphite"]');
  await graphite.tap();
  await saved;
  await expect(doc).toHaveAttribute("data-k-tone", "graphite");
  await graphite.tap();
  await expect(page.locator(".qcard .qcount")).toHaveText("2 of 2");
  await expect(doc).toHaveAttribute("data-k-tone", "graphite");

  await page.reload();
  await expect(page.frameLocator(".frame.on iframe").locator("html")).toHaveAttribute(
    "data-k-tone",
    "graphite",
  );
});
