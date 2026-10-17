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

  await page.goto(`${server.url}/project/o/send`);
  const doc = page.frameLocator(".frame.on iframe").locator("html");
  // First paint: the declared default, from the URL, with the stylesheet still held.
  await expect(doc).toHaveAttribute("data-k-pending", "filling");

  // A first tap previews on touch; the stage follows while the stylesheet is held.
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
