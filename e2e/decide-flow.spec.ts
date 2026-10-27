import type { Page } from "@playwright/test";
import { MARKER, PROJECT, revise, seedAsked, seedWriter, writerHtml } from "./decideSeed.ts";
import { agentCall, expect, test } from "./fixtures.ts";

// The flow end to end against the real server: Home → the question card (Look,
// a part ask, a state-bound part ask) → Send → Thread ✓ → the agent reads it →
// ✓✓; the history (stepping, hiding, Use this), mid-answer versions, New, the
// theme, and the sandbox invariant.

const mockPath = `/project/${PROJECT}/writer`;

// The viewer's own reads: same-origin, so the server treats them as the user.
const viewerGet = (page: Page, path: string) =>
  page.evaluate(async (p) => (await fetch(p)).json(), path);

const card = (page: Page) => page.locator(".qcard");
const count = (page: Page) => page.locator(".qcard .qcount");
const question = (page: Page) => page.locator(".qcard .qt");
const sendBtn = (page: Page) => page.locator(".qcard .qsend");
const option = (page: Page, id: string) => page.locator(`.qcard .opt[data-option="${id}"]`);
const onStage = (page: Page) => page.locator(".frame.on");
const stateName = (page: Page) => page.locator(".mcrumb b");
const partPin = (page: Page, n: number) =>
  page.locator(`.frame.on .overlay .pin[data-question="${n}"]`);

// Option pictures shrink to their page once its frame reports a height, which
// moves whatever sits under them; a click aimed before that lands elsewhere.
const picturesSettled = (page: Page) =>
  expect(page.locator(".opts .thumb:not([data-sized])")).toHaveCount(0);

// The history and thread panel, on its Thread tab.
async function openThread(page: Page) {
  if (!(await page.locator(".bpanel").count())) await page.locator(".vlabel").click();
  await page.getByRole("tab", { name: "Thread" }).click();
}

async function pickAndWait(page: Page, mockId: string, id: string) {
  const write = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
  );
  await option(page, id).click();
  expect((await write).ok()).toBe(true);
}

test("Home lists the mock with its open count and Answer next goes to it", async ({
  page,
  server,
}) => {
  await seedWriter(server.url);
  await page.goto(`${server.url}/project/${PROJECT}`);
  const row = page.locator('.home-row[data-mock="writer"]');
  await expect(row).toContainText("Writer");
  await expect(row.locator(".home-chip")).toHaveText("3 open");
  await expect(page.locator(".home-lead")).toContainText("3 open across 1 mock");
  await page.getByRole("link", { name: "Answer next ›" }).click();
  await expect(page).toHaveURL(new RegExp(`${mockPath}$`));
  await expect(count(page)).toHaveText("1 of 2");
});

test("questions: pictures, hover preview, pick, part focus, Borrow in Tune, Send, ✓ → ✓✓", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);

  // Q1 Look: picture options, nothing to send yet.
  await expect(count(page)).toHaveText("1 of 2");
  await expect(question(page)).toHaveText("Which look should the Writer take?");
  for (const look of ["quiet", "dark", "editorial"]) {
    await expect(option(page, look).locator("iframe")).toHaveCount(1);
  }
  await expect(sendBtn(page)).toBeDisabled();
  await expect(onStage(page)).toHaveAttribute("data-variant", "quiet");

  // Hover previews on the stage; leaving puts it back.
  await option(page, "dark").hover();
  await expect(onStage(page)).toHaveAttribute("data-variant", "dark");
  await option(page, "editorial").hover();
  await expect(onStage(page)).toHaveAttribute("data-variant", "editorial");
  await question(page).hover();
  await expect(onStage(page)).toHaveAttribute("data-variant", "quiet");

  // A click picks; the same option again moves on.
  await pickAndWait(page, mockId, "quiet");
  await expect(option(page, "quiet")).toHaveAttribute("aria-pressed", "true");
  await option(page, "quiet").click();
  await expect(count(page)).toHaveText("2 of 2");
  await page.getByRole("button", { name: "Previous question" }).click();
  await expect(count(page)).toHaveText("1 of 2");
  await expect(option(page, "quiet")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next question" }).click();

  // Q2, a part ask: knob-set options are pictures, the part carries the pin.
  await expect(count(page)).toHaveText("2 of 2");
  await expect(question(page)).toHaveText("How should the versions open?");
  await expect(option(page, "drawer").locator("iframe")).toHaveCount(1);
  await expect(partPin(page, 2)).toHaveText("2");
  await pickAndWait(page, mockId, "drawer");
  await expect(sendBtn(page)).toHaveText("Next");
  await sendBtn(page).click();

  // Q3 is bound to a part that only "Lab open" shows: the stage follows it.
  await expect(count(page)).toHaveText("3 of 3");
  await expect(stateName(page)).toHaveText("Lab open");
  await expect(partPin(page, 3)).toHaveText("3");
  await expect(option(page, "below")).toHaveClass(/pill/);
  await pickAndWait(page, mockId, "below");
  await expect(partPin(page, 3)).toHaveText("✓");

  // Borrowing a part from another look is in Built from, per part.
  await page.locator(".mtop [aria-expanded]").last().click();
  const drawer = page.locator(".drawer.open");
  await drawer.getByRole("button", { name: "Tune title" }).click();
  const borrow = drawer.locator(".borrow-row", { hasText: "title as in editorial" });
  await expect(borrow).toHaveCount(1);
  await borrow.hover();
  await expect(onStage(page)).toHaveAttribute("data-variant", "editorial");
  await borrow.click();
  await expect(borrow).toHaveAttribute("aria-pressed", "true");
  await borrow.click();
  await expect(borrow).toHaveAttribute("aria-pressed", "false");
  // Q2 decided the versions, so they are never offered to borrow.
  await drawer.getByRole("button", { name: "Tune versions" }).click();
  await expect(drawer.locator(".borrow-row")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Close" }).click();

  // The last question owed: Send sends every answer in one reply.
  await expect(sendBtn(page)).toHaveText("Send");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await sendBtn(page).click();
  expect((await reply).status()).toBe(201);

  const pill = page.locator(".sentrow .pill");
  await expect(pill).toHaveText("Sent · Not seen yet");
  await openThread(page);
  const row = page.locator(".trow.you");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Sent · look quiet · versions drawer · trim below the lab");
  await expect(row.locator(".tdelivered")).toHaveText("✓Not seen yet");
  // Nobody has read it after a beat: the confirmation asks the user to say so.
  await expect(page.locator(".sentrow .sent-hint")).toHaveText("tell your agent you've answered");

  // The agent reads its feedback; the row and the confirmation turn Delivered.
  const read = await agentCall(server.url, `/api/feedback?session=${session}`);
  expect(read.feedback).toHaveLength(1);
  await expect(row.locator(".tdelivered")).toHaveText("✓✓Delivered");
  await expect(pill).toHaveText("Sent · Delivered");
  await expect(page.locator(".sentrow .sent-hint")).toHaveCount(0);

  // The draft is gone and the Look settled the variants.
  expect(await viewerGet(page, `/api/mocks/${mockId}/draft`)).toEqual({ draft: null });
  const detail = await agentCall(server.url, `/api/mocks/${mockId}`);
  for (const v of detail.variants) {
    expect([v.variant, v.status]).toEqual([
      v.variant,
      v.variant === "quiet" ? "accepted" : "archived",
    ]);
  }
});

test("a pick survives a reload", async ({ page, server }) => {
  const { mockId } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  await pickAndWait(page, mockId, "dark");
  await page.reload();
  // It opens on the first question still owed, the pick on the stage.
  await expect(count(page)).toHaveText("2 of 2");
  await expect(onStage(page)).toHaveAttribute("data-variant", "dark");
  await page.getByRole("button", { name: "Previous question" }).click();
  await expect(option(page, "dark")).toHaveAttribute("aria-pressed", "true");
});

test("a note and an Other… write-in survive a reload and reach the agent in the reply", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  const saved = () =>
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
    );
  const addNote = page.getByRole("button", { name: "Add a note for the agent" });

  // Q1: the note is opt-in, behind the card's note button.
  await expect(count(page)).toHaveText("1 of 2");
  await expect(page.locator(".ask-note")).toHaveCount(0);
  await picturesSettled(page);
  await addNote.click();
  let write = saved();
  await page.locator(".ask-note textarea").fill("Dark on desktop, quiet on mobile");
  expect((await write).ok()).toBe(true);
  await pickAndWait(page, mockId, "dark");
  await sendBtn(page).click();

  // Q2: Other… is one more option; picking it opens the write-in in place.
  await expect(count(page)).toHaveText("2 of 2");
  await expect(page.locator(".other-text")).toHaveCount(0);
  await option(page, "other").click();
  await expect(option(page, "other")).toHaveAttribute("aria-pressed", "true");
  write = saved();
  await page.locator(".other-text textarea").fill("a tab in the sidebar");
  expect((await write).ok()).toBe(true);

  // After a reload the card opens on what is still owed (Trim, on Lab open);
  // the answers behind it kept their words.
  await page.reload();
  await expect(count(page)).toHaveText("3 of 3");
  const prev = page.getByRole("button", { name: "Previous question" });
  await prev.click();
  await expect(option(page, "other")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".other-text textarea")).toHaveValue("a tab in the sidebar");
  await prev.click();
  await expect(page.locator(".ask-note textarea")).toHaveValue("Dark on desktop, quiet on mobile");

  // Q3: a note alone answers it, so Send opens up on the last question.
  const next = page.getByRole("button", { name: "Next question" });
  await next.click();
  await next.click();
  await expect(count(page)).toHaveText("3 of 3");
  await addNote.click();
  write = saved();
  await page.locator(".ask-note textarea").fill("neither, keep it hidden");
  expect((await write).ok()).toBe(true);
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await expect(sendBtn(page)).toHaveText("Send");
  await sendBtn(page).click();
  expect((await reply).status()).toBe(201);
  await openThread(page);
  await expect(page.locator(".trow.you .tnote")).toHaveCount(2);
  await expect(page.locator(".trow.you")).toContainText("note: neither, keep it hidden");

  const read = await agentCall(server.url, `/api/feedback?session=${session}`);
  const asks = read.feedback[0].reply.asks;
  expect(asks.find((a: any) => a.ask === "look")).toMatchObject({
    chosen: [{ id: "dark" }],
    note: "Dark on desktop, quiet on mobile",
  });
  expect(asks.find((a: any) => a.ask === "versions").chosen).toEqual([
    { id: "other", label: "a tab in the sidebar", other: true },
  ]);
  expect(asks.find((a: any) => a.ask === "trim")).toMatchObject({
    chosen: [],
    note: "neither, keep it hidden",
  });
  expect(await viewerGet(page, `/api/mocks/${mockId}/draft`)).toEqual({ draft: null });
});

// 1×1 PNG: real image bytes, so the browser decodes it like any screenshot.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("images attach to a note by picker and paste, × removes one, and the rest reach the agent", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  await picturesSettled(page);
  await page.getByRole("button", { name: "Add a note for the agent" }).click();
  const note = page.locator(".ask-note");
  const thumbs = note.locator(".attach-item:not(.pending)");

  await note.locator('input[type="file"]').setInputFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_B64, "base64"),
  });
  await expect(thumbs).toHaveCount(1);
  await expect(thumbs.first().locator("img")).toHaveAttribute("src", /\/a\//);

  // A pasted screenshot attaches the same way; a text paste stays text.
  await note.locator("textarea").evaluate(async (el, b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    // Different bytes from the first, so it is a second asset.
    const file = new File([blob, new Uint8Array([0])], "image.png", { type: "image/png" });
    const data = new DataTransfer();
    data.items.add(file);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, PNG_B64);
  await expect(thumbs).toHaveCount(2);

  const saved = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
  );
  await thumbs.nth(1).getByRole("button", { name: "Remove image 2" }).click();
  await expect(thumbs).toHaveCount(1);
  await expect(note.getByRole("button", { name: "Remove image 1" })).toBeFocused();
  expect((await saved).ok()).toBe(true);
  const typed = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
  );
  await note.locator("textarea").fill("like this one");
  expect((await typed).ok()).toBe(true);

  await page.reload();
  // A note counts as an answer, so the card opens on the next question.
  await expect(count(page)).toHaveText("2 of 2");
  await page.getByRole("button", { name: "Previous question" }).click();
  await expect(page.locator(".ask-note .attach-item")).toHaveCount(1);

  // Each pick, then on: the last one sends.
  for (const id of ["dark", "drawer", "below"]) {
    await pickAndWait(page, mockId, id);
    if (id !== "below") await sendBtn(page).click();
  }
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await expect(sendBtn(page)).toHaveText("Send");
  await sendBtn(page).click();
  expect((await reply).status()).toBe(201);
  await openThread(page);
  await expect(page.locator(".trow.you .timgs img")).toHaveCount(1);

  const read = await agentCall(server.url, `/api/feedback?session=${session}`);
  const look = read.feedback[0].reply.asks.find((a: any) => a.ask === "look");
  expect(look.note).toBe("like this one");
  expect(look.noteImages).toHaveLength(1);
  expect(look.noteImages[0].url).toContain("/a/");
});

test("history: step through every version of the state, view one, hide it and bring it back", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await revise(server.url, mockId, {
    state: "At rest",
    variant: "quiet",
    session,
    prompt: "tighter title",
    html: writerHtml("At rest", "quiet", { title: "Draft Early" }),
  });
  await page.goto(`${server.url}${mockPath}`);
  // Every version of every variant in the state counts, in publish order: the
  // three first takes, then quiet's second.
  const label = page.locator(".vlabel");
  await expect(label).toHaveAttribute("aria-label", /^Version 4 of 4, tighter title\./);
  await expect(onStage(page)).toHaveAttribute("data-variant", "quiet");
  await page.getByRole("button", { name: "Previous version" }).click();
  await expect(label).toHaveAttribute("aria-label", /^Version 3 of 4/);
  await expect(onStage(page)).toHaveAttribute("data-variant", "editorial");
  await page.getByRole("button", { name: "Next version" }).click();
  await expect(onStage(page)).toHaveAttribute("data-variant", "quiet");

  // The label opens the history: one line per variant, a thumb per version.
  await label.click();
  const thumbs = page.locator(".hthumb");
  await expect(thumbs).toHaveCount(4);
  await expect(page.locator(".htree .hcell")).toHaveCount(4);
  await page.locator('.hthumb[data-version="1"]').click();
  await expect(label).toHaveAttribute("aria-label", /^Version 1 of 4/);
  await expect(onStage(page).locator("iframe").first()).toHaveAttribute("src", /ver=1/);

  // Hidden, never removed: the bin hides it, Undo stays until it's answered.
  await page.getByRole("button", { name: "Hide v1" }).click();
  const toast = page.locator(".toast.on");
  await expect(toast).toContainText("Hid v1");
  await expect(page.locator(".hcount")).toHaveText("3 versions");
  await expect(page.locator(".hidlink")).toHaveText("1 hidden");
  const read = await agentCall(server.url, `/api/mocks/${mockId}?history=1`);
  const quiet = read.variants.find((v: any) => v.state === "At rest" && v.variant === "quiet");
  expect(quiet.history.find((h: any) => h.version === 1).hidden).toBe(true);
  await page.waitForTimeout(3000);
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".hidlink")).toHaveCount(0);
  await expect(page.locator(".hcount")).toHaveText("4 versions");

  // Hidden again, it folds away; "1 hidden" shows it dimmed, with Restore.
  await page.getByRole("button", { name: "Hide v1" }).click();
  await page.locator(".toast.on").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator(".toast.on")).toHaveCount(0);
  await page.locator(".hidlink").click();
  const hidden = page.locator(".hthumb.hid");
  await expect(hidden).toHaveCount(1);
  await hidden.click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".hthumb.hid")).toHaveCount(0);
  const after = await agentCall(server.url, `/api/mocks/${mockId}?history=1`);
  const back = after.variants.find((v: any) => v.state === "At rest" && v.variant === "quiet");
  expect(back.history.some((h: any) => h.hidden)).toBe(false);
});

test("a version arriving mid-answer waits behind a banner, then carries picks over", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await revise(server.url, mockId, {
    state: "At rest",
    variant: "quiet",
    session,
    html: writerHtml("At rest", "quiet", { title: "v2" }),
  });
  await page.goto(`${server.url}${mockPath}`);
  await pickAndWait(page, mockId, "dark");
  await sendBtn(page).click();
  await expect(count(page)).toHaveText("2 of 2");
  await pickAndWait(page, mockId, "inline");
  const draft = await viewerGet(page, `/api/mocks/${mockId}/draft`);
  expect(draft.draft.version).toBe(2);

  // The agent drops the "inline" option and publishes v3.
  await agentCall(server.url, `/api/mocks/${mockId}/asks`, {
    session,
    asks: [
      {
        id: "versions",
        text: "How should the versions open?",
        scope: "part",
        part: "versions",
        options: [
          { id: "drawer", label: "Drawer", set: { "versions.layout": "drawer" } },
          { id: "stacked", label: "Stacked", set: { "versions.layout": "inline" } },
        ],
      },
    ],
  });
  await revise(server.url, mockId, {
    state: "At rest",
    variant: "quiet",
    session,
    html: writerHtml("At rest", "quiet", { title: "v3" }),
  });

  const banner = page.locator(".banner");
  await expect(banner).toContainText("v3 arrived");
  await expect(banner).toContainText("your answers stay on v2 until you do");
  await banner.getByRole("button", { name: "view" }).click();
  await expect(banner).toHaveCount(0);

  // Whether Mix joins depends on how the looks render, which this test is not about.
  await expect(card(page).locator(".qs .flag")).toHaveText("your pick is gone in v3");
  await page.getByRole("button", { name: "Previous question" }).click();
  await expect(option(page, "dark")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await viewerGet(page, `/api/mocks/${mockId}/draft`)).draft)
    .toMatchObject({ version: 3, answers: { look: "dark" } });
  const after = await viewerGet(page, `/api/mocks/${mockId}/draft`);
  expect(after.draft.answers.versions).toBeUndefined();
});

test("a plain mock offers New and Use this; both reach the agent, and Use this pins the version", async ({
  page,
  server,
}) => {
  const out = await agentCall(server.url, "/api/mocks", {
    project: PROJECT,
    mock: "note",
    title: "Note",
    agent: "e2e",
    html: "<p>A plain card.</p>",
  });
  await agentCall(server.url, "/api/mocks", {
    mock: out.mock.id,
    session: out.sessionId,
    html: "<p>A plainer card.</p>",
  });
  const mockId = out.mock.id;
  await page.goto(`${server.url}/project/${PROJECT}/note`);
  await expect(page.getByRole("button", { name: "New version" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this version" })).toBeVisible();
  // Nothing to tune: no knobs, no marked parts, so no Tune tool at all.
  await expect(page.getByRole("button", { name: "Tune", exact: true })).toHaveCount(0);

  // New asks for another version, as a reply through the same cursor.
  let reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "New version" }).click();
  expect((await reply).status()).toBe(201);
  let read = await agentCall(server.url, `/api/feedback?session=${out.sessionId}`);
  expect(read.feedback).toHaveLength(1);
  expect(read.feedback[0].reply.decision).toMatchObject({ kind: "revise", variant: "default" });
  expect(JSON.stringify(read.feedback[0])).toContain("New version");
  await openThread(page);
  await expect(page.locator(".trow.you .tdelivered")).toContainText("Delivered");
  await page.getByRole("button", { name: "Close history and thread" }).click();

  // Use this on the earlier version: it is in use, pinned, and the agent hears it.
  await page.getByRole("button", { name: "Previous version" }).click();
  await expect(page.locator(".vlabel")).toHaveAttribute("aria-label", /^Version 1 of 2/);
  const used = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/use`) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Use this version" }).click();
  expect((await used).status()).toBe(201);
  const inUse = page.getByRole("button", { name: "In use", exact: true });
  await expect(inUse).toBeDisabled();
  const detail = await agentCall(server.url, `/api/mocks/${mockId}`);
  expect(detail.inUse).toEqual([{ state: null, variant: "default", version: 1 }]);
  read = await agentCall(server.url, `/api/feedback?session=${out.sessionId}`);
  expect(read.feedback).toHaveLength(1);
  expect(read.feedback[0].accepted).toEqual([{ state: null, variant: "default", version: 1 }]);

  // Exploring never changes it; the way back is one tap.
  await page.getByRole("button", { name: "Next version" }).click();
  await expect(inUse).toHaveCount(0);
  await page.getByRole("button", { name: "Back to v1, the version in use" }).click();
  await expect(inUse).toBeVisible();
  // The version in use can't be hidden.
  await page.locator(".vlabel").click();
  await expect(page.locator('.hthumb[data-version="1"] .mk.cur')).toHaveCount(1);
  await expect(page.locator(".hbin")).toHaveAttribute(
    "title",
    "In use. Use another version first.",
  );
});

test("the theme toggles dark ↔ light and persists across a reload", async ({ page, server }) => {
  await seedWriter(server.url);
  await page.goto(`${server.url}/project/${PROJECT}`);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.locator(".themebtn").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect.poll(async () => (await agentCall(server.url, "/api/theme")).mode).toBe("light");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.locator(".themebtn").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect.poll(async () => (await agentCall(server.url, "/api/theme")).mode).toBe("dark");
});

test("every surface is a sandboxed /s/ frame; agent markup never enters the viewer DOM", async ({
  page,
  server,
}) => {
  const { mockId } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  await pickAndWait(page, mockId, "quiet");
  await sendBtn(page).click();
  await expect(count(page)).toHaveText("2 of 2");
  // The marked part is on stage and has reported back through the bridge.
  await expect(partPin(page, 2)).toBeVisible();

  const frames = await page.locator("iframe").evaluateAll((els) =>
    els.map((el) => ({
      sandbox: el.getAttribute("sandbox"),
      src: el.getAttribute("src") ?? "",
      srcdoc: el.hasAttribute("srcdoc"),
    })),
  );
  expect(frames.length).toBeGreaterThan(3);
  for (const f of frames) {
    expect(f.sandbox).toBe("allow-scripts");
    expect(f.src.startsWith("/s/")).toBe(true);
    expect(f.srcdoc).toBe(false);
  }
  await expect
    .poll(async () => {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const text = await f.evaluate(() => document.body?.innerText ?? "").catch(() => "");
        if (text.includes(MARKER)) return true;
      }
      return false;
    })
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(MARKER);
  await expect(page.locator("[srcdoc]")).toHaveCount(0);

  await page.goto(`${server.url}/project/${PROJECT}`);
  await expect(page.locator(".home-row iframe")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(MARKER);
  const thumbs = await page
    .locator("iframe")
    .evaluateAll((els) => els.map((el) => [el.getAttribute("sandbox"), el.getAttribute("src")]));
  for (const [sandbox, src] of thumbs) {
    expect(sandbox).toBe("allow-scripts");
    expect(src?.startsWith("/s/")).toBe(true);
  }
});

// A mock with one marked part and room around it, published plain (no asks).
async function publishCard(server: string, variant?: string) {
  return agentCall(server, "/api/mocks", {
    project: PROJECT,
    mock: "card",
    title: "Card",
    agent: "e2e",
    ...(variant ? { variant } : {}),
    html: `<div style="padding:40px"><h1 data-part="title" style="margin:0;height:60px">Hello card</h1><p style="height:300px">Body (${variant ?? "default"})</p></div>`,
  });
}

test("Mark: a pin on the stage, its comment and anchor in the reply, listed in Thread", async ({
  page,
  server,
}) => {
  const out = await publishCard(server.url);
  const mockId = out.mock.id;
  await page.goto(`${server.url}/project/${PROJECT}/card`);
  const overlay = page.locator(".frame.on .overlay");
  // A hover before the frame's first parts report finds no part to box.
  await expect(overlay).toHaveAttribute("data-doc-width", /\d/);
  await overlay.hover({ position: { x: 120, y: 70 } });
  await expect(overlay.locator('.box[data-part="title"]')).toHaveCount(1);

  const markBtn = page.getByRole("button", { name: "Mark", exact: true });
  await markBtn.click();
  await expect(markBtn).toHaveAttribute("aria-pressed", "true");
  await overlay.click({ position: { x: 120, y: 70 } });
  const field = page.locator(".markfield");
  await expect(field.locator(".markfield-hd")).toHaveText("Mark 1 · title");
  const write = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
  );
  await field.locator("input").fill("make it louder");
  await field.locator("input").press("Enter");
  expect((await write).ok()).toBe(true);
  await expect(field).toHaveCount(0);
  const pin = overlay.locator('.pin.mark[data-mark="1"]');
  await expect(pin).toHaveText("1");
  await expect(pin).not.toHaveClass(/moved/);

  // Esc leaves the tool; a click then selects instead of marking.
  await page.keyboard.press("Escape");
  await expect(markBtn).toHaveAttribute("aria-pressed", "false");

  const { draft } = await viewerGet(page, `/api/mocks/${mockId}/draft`);
  expect(draft.comments).toHaveLength(1);
  const c = draft.comments[0];
  expect([c.part, c.state, c.text]).toEqual(["title", null, "make it louder"]);
  expect(c.anchor.offset).toHaveLength(2);
  expect(c.anchor.selector).toContain("h1");
  expect(c.anchor.quote).toBe("Hello card");
  // The title's own box (the page's base styles add a body margin around the padding).
  expect(c.anchor.box).toHaveLength(4);
  expect(c.anchor.box[3]).toBe(60);

  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "New version" }).click();
  expect((await reply).status()).toBe(201);
  await openThread(page);
  const row = page.locator(".trow.you");
  await expect(row).toContainText("Sent · 1 comment · revise default");
  await expect(row.locator(".cline")).toHaveText("title “make it louder”");

  const read = await agentCall(server.url, `/api/feedback?session=${out.sessionId}`);
  expect(read.feedback).toHaveLength(1);
  const sent = read.feedback[0].reply.comments;
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ part: "title", text: "make it louder", anchor: c.anchor });
});

test("a sent answer stays in force on the stage and under later questions", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  await expect(count(page)).toHaveText("1 of 2");
  const status = await page.evaluate(async (id) => {
    const r = await fetch(`/api/mocks/${id}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        answers: { versions: "inline" },
        mix: {},
        tuned: {},
        comments: [],
      }),
    });
    return r.status;
  }, mockId);
  expect(status).toBe(201);

  const detail = await agentCall(server.url, `/api/mocks/${mockId}`);
  expect(detail.settled).toEqual({ "versions.layout": "inline" });

  // A later question's pictures render on top of what was sent, not the default.
  await agentCall(server.url, `/api/mocks/${mockId}/asks`, {
    session,
    asks: [
      {
        id: "again",
        text: "Which look, with inline versions?",
        scope: "mock",
        options: [
          { id: "quiet", label: "Quiet", variant: "quiet" },
          { id: "dark", label: "Dark", variant: "dark" },
        ],
      },
    ],
  });
  await page.reload();
  const picture = page.frameLocator(`.qcard .opt[data-option="dark"] iframe`).locator("html");
  await expect(picture).toHaveAttribute("data-k-versions-layout", "inline");
  const stage = page.frameLocator(".frame.on iframe").locator("html");
  await expect(stage).toHaveAttribute("data-k-versions-layout", "inline");
});

test("un-archive: a losing look is restored from the answered Look ask", async ({
  page,
  server,
}) => {
  const { mockId } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  await expect(count(page)).toHaveText("1 of 2");
  const status = await page.evaluate(async (id) => {
    const r = await fetch(`/api/mocks/${id}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        answers: { look: "quiet", versions: "drawer", trim: "below" },
        mix: {},
        tuned: {},
        comments: [],
      }),
    });
    return r.status;
  }, mockId);
  expect(status).toBe(201);

  // Sent answers leave the card; they fold into the Thread, read-only, and
  // changing one is a deliberate step.
  await expect(card(page)).toHaveCount(0);
  await openThread(page);
  await page.getByRole("button", { name: "Answered · 3" }).click();
  await expect(page.locator(".answered-row .review-said")).toHaveText([
    "Quiet",
    "Drawer",
    "Below the lab",
  ]);
  await page
    .getByRole("button", { name: "Change answer: Which look should the Writer take?" })
    .click();
  await expect(question(page)).toHaveText("Which look should the Writer take?");
  await expect(page.locator(".revising")).toContainText("Changing a sent answer");
  const dark = page.locator('.opt-arch[data-archived="dark"]');
  await expect(dark).toHaveCount(1);
  await expect(page.locator('.opt-arch[data-archived="editorial"]')).toHaveCount(1);
  await expect(page.locator('.opt-arch[data-archived="quiet"]')).toHaveCount(0);
  await dark.getByRole("button", { name: "Restore Dark" }).click();
  await expect(dark).toHaveCount(0);
  await expect(page.locator('.opt-arch[data-archived="editorial"]')).toHaveCount(1);
  const detail = await agentCall(server.url, `/api/mocks/${mockId}`);
  for (const v of detail.variants) {
    const want = { quiet: "accepted", dark: "open", editorial: "archived" }[v.variant as string];
    expect([v.state, v.variant, v.status]).toEqual([v.state, v.variant, want]);
  }
});

test("un-archive: a variant archived by Which one? stays in the history and comes back with Use this", async ({
  page,
  server,
}) => {
  const a = await publishCard(server.url, "a");
  await agentCall(server.url, "/api/mocks", {
    project: PROJECT,
    mock: "card",
    session: a.sessionId,
    variant: "b",
    html: "<p>b</p>",
  });
  await page.goto(`${server.url}/project/${PROJECT}/card`);
  await option(page, "a").click();
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${a.mock.id}/reply`) && r.request().method() === "POST",
  );
  await sendBtn(page).click();
  expect((await reply).status()).toBe(201);
  // b is archived, yet still a version in the history, a ready to go back to.
  await page.locator(".vlabel").click();
  await expect(page.locator(".hthumb")).toHaveCount(2);
  await expect(page.locator(".hthumb .mk.cur")).toHaveCount(1);
  await page.getByRole("button", { name: /^v2, b/ }).click();
  await expect(onStage(page)).toHaveAttribute("data-variant", "b");
  await page.getByRole("button", { name: "Close history and thread" }).click();
  await page.getByRole("button", { name: "Use this version" }).click();
  await expect(page.getByRole("button", { name: "In use", exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const detail = await agentCall(server.url, `/api/mocks/${a.mock.id}`);
      return Object.fromEntries(
        detail.variants.map((v: { variant: string; status: string }) => [v.variant, v.status]),
      );
    })
    .toEqual({ a: "archived", b: "accepted" });
});

test("two variants and no ask: the built-in Which one? decides in one Send", async ({
  page,
  server,
}) => {
  const a = await publishCard(server.url, "a");
  const mockId = a.mock.id;
  await agentCall(server.url, "/api/mocks", {
    mock: mockId,
    session: a.sessionId,
    variant: "b",
    html: "<p>b</p>",
  });
  await page.goto(`${server.url}/project/${PROJECT}/card`);

  await expect(question(page)).toHaveText("Which one?");
  // The card is the decision while it is open: no Use this beside it.
  await expect(page.getByRole("button", { name: "Use this version" })).toHaveCount(0);
  const looks = page.locator('.qcard .opt:not([data-option="other"])');
  await expect(looks).toHaveCount(2);
  await expect(looks.locator(".lbl")).toHaveText(["a", "b"]);
  // Each option's picture is a sandboxed frame, never markup in the viewer.
  await expect(looks.locator(".thumb iframe")).toHaveCount(2);
  for (const sandbox of await looks
    .locator(".thumb iframe")
    .evaluateAll((els) => els.map((el) => el.getAttribute("sandbox")))) {
    expect(sandbox).toBe("allow-scripts");
  }

  const write = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
  );
  await option(page, "b").click();
  const written = await write;
  expect(written.ok()).toBe(true);
  expect((await written.json()).draft.answers).toEqual({ variant: "b" });
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await sendBtn(page).click();
  expect((await reply).status()).toBe(201);

  // Stored but not read: the row and the confirmation say so.
  await expect(page.locator(".sentrow .pill")).toHaveText("Sent · Not seen yet");
  await openThread(page);
  const row = page.locator(".trow.you");
  await expect(row).toContainText("Sent · look b");
  await expect(row.locator(".tdelivered")).toContainText("Not seen yet");

  // The reply flipped the variants; the choice is made, so the built-in ask is gone.
  const detail = await agentCall(server.url, `/api/mocks/${mockId}`);
  const statuses = Object.fromEntries(
    detail.variants.map((v: { variant: string; status: string }) => [v.variant, v.status]),
  );
  expect(statuses).toEqual({ a: "archived", b: "accepted" });
  await page.getByRole("button", { name: "Close history and thread" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "In use", exact: true })).toBeVisible();

  const read = await agentCall(server.url, `/api/feedback?session=${a.sessionId}`);
  expect(read.feedback).toHaveLength(1);
  expect(read.feedback[0].reply.asks).toEqual([
    expect.objectContaining({ ask: "variant", chosen: [expect.objectContaining({ id: "b" })] }),
  ]);
  await expect(page.locator(".sentrow .pill")).toHaveText("Sent · Delivered");
});

test("Which one? is asked per state when the variant names differ", async ({ page, server }) => {
  const first = await agentCall(server.url, "/api/mocks", {
    project: PROJECT,
    mock: "flow",
    title: "Flow",
    agent: "e2e",
    state: "Start",
    variant: "a",
    html: "<p>start a</p>",
  });
  const more = [
    ["Start", "b"],
    ["End", "a"],
    ["End", "c"],
  ];
  for (const [state, variant] of more) {
    await agentCall(server.url, "/api/mocks", {
      mock: first.mock.id,
      session: first.sessionId,
      state,
      variant,
      html: `<p>${state} ${variant}</p>`,
    });
  }
  await page.goto(`${server.url}/project/${PROJECT}/flow`);
  await expect(stateName(page)).toHaveText("Start");
  await expect(question(page)).toHaveText("Which one?");
  await expect(page.locator('.qcard .opt:not([data-option="other"]) .lbl')).toHaveText(["a", "b"]);
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(stateName(page)).toHaveText("End");
  await expect(page.locator('.qcard .opt:not([data-option="other"]) .lbl')).toHaveText(["a", "c"]);
});

test("bridge: sendPrompt from the frame on stage prefills Thread's comment; others are ignored", async ({
  page,
  server,
}) => {
  const { session } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  await expect(onStage(page)).toHaveAttribute("data-variant", "quiet");
  await expect(partPin(page, 2)).toHaveCount(0);
  // By URL rather than contentFrame(): WebKit can hand back null for a frame
  // that is laid out but hidden. Retried, since a frame still settling (theme,
  // version) is replaced by a new element and the old one detaches.
  const prompt = (sel: string, text: string) =>
    expect(async () => {
      const src = await page.locator(sel).first().getAttribute("src");
      const frame = page.frames().find((f) => f.url() === `${server.url}${src}`);
      expect(frame).toBeTruthy();
      // The bridge script loads after the body; wait until it defined the global.
      await frame!.waitForFunction(() => typeof (window as any).sendPrompt === "function");
      await frame!.evaluate((t) => (window as any).sendPrompt(t), text);
    }).toPass();
  await prompt('.frame:not(.on)[data-variant="dark"] iframe', "from a hidden frame");
  await prompt(".frame.on iframe", "tighten the title");

  await expect(page.getByRole("tab", { name: "Thread" })).toHaveAttribute("aria-selected", "true");
  const input = page.locator(".tcomment input");
  await expect(input).toHaveValue("tighten the title");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.locator(".trow.you")).toContainText("tighten the title");
  const read = await agentCall(server.url, `/api/feedback?session=${session}`);
  expect(JSON.stringify(read.feedback)).toContain("tighten the title");
  expect(JSON.stringify(read.feedback)).not.toContain("from a hidden frame");
});

// --- the flow across mocks: keys, Send, the next mock ---

test("keys pick, send on and step the versions; Send carries on to the next mock", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await seedAsked(server.url, "card", "Card", session);
  await page.goto(`${server.url}${mockPath}`);
  const saved = () =>
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/mocks/${mockId}/draft`) && r.request().method() === "PUT",
    );

  // A number key picks the nth option; Enter sends it on.
  await expect(count(page)).toHaveText("1 of 2");
  let write = saved();
  await page.keyboard.press("2");
  expect((await write).ok()).toBe(true);
  await expect(option(page, "dark")).toHaveAttribute("aria-pressed", "true");
  // Typing in a field keeps its keys.
  await page.getByRole("button", { name: "Add a note for the agent" }).click();
  await page.locator(".ask-note textarea").press("3");
  await expect(option(page, "dark")).toHaveAttribute("aria-pressed", "true");
  // Out of the field (a click on plain text), the keys are the screen's again.
  await question(page).click();
  // ←/→ step through the versions of the state on stage.
  const label = page.locator(".vlabel");
  const before = await label.getAttribute("aria-label");
  await page.keyboard.press("ArrowLeft");
  await expect(label).not.toHaveAttribute("aria-label", before!);
  await page.keyboard.press("ArrowRight");
  await expect(label).toHaveAttribute("aria-label", before!);
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("2 of 2");
  write = saved();
  await page.keyboard.press("1");
  expect((await write).ok()).toBe(true);
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("3 of 3");
  write = saved();
  await page.keyboard.press("1");
  expect((await write).ok()).toBe(true);

  // Enter on the last question sends; the next mock owed is offered and taken.
  await expect(sendBtn(page)).toHaveText("Send");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await page.keyboard.press("Enter");
  expect((await reply).status()).toBe(201);
  await expect(page.locator(".nextcard-go")).toHaveText("Next: Card · 1 question ›");
  await expect(page).toHaveURL(new RegExp(`/project/${PROJECT}/card$`));

  // The Send's status came along, and turns Delivered once the agent reads it.
  const chip = page.locator(".sentnote .carried");
  await expect(chip).toHaveText("Writer · Not seen yet");
  await agentCall(server.url, `/api/feedback?session=${session}`);
  await expect(chip).toHaveText("Writer · Delivered");
  // Seen Delivered, it ends there: by way of Home and back, it is gone.
  await page.getByRole("link", { name: "Back" }).click();
  await page.locator('.home-row[data-mock="card"]').click();
  await expect(question(page)).toHaveText("Which tone?");
  await expect(chip).toHaveCount(0);

  // The last mock owed: Send says so instead of moving on.
  await option(page, "warm").click();
  await sendBtn(page).click();
  await expect(page.locator(".nextcard-done")).toContainText("Nothing else to answer here.");
  await expect(page.locator(".sentrow .pill")).toHaveText("Sent · Not seen yet");
  await expect(chip).toHaveCount(0);
});

test("Stay keeps the screen after Send; ] and [ step through the mocks owed", async ({
  page,
  server,
}) => {
  const { session } = await seedAsked(server.url, "first", "First");
  await seedAsked(server.url, "second", "Second", session);
  await seedAsked(server.url, "third", "Third", session);
  // Fake timers, still flowing in real time, so the beat can be run past at once.
  await page.clock.install();
  await page.goto(`${server.url}/project/${PROJECT}/second`);
  await expect(question(page)).toHaveText("Which tone?");
  await page.keyboard.press("]");
  await expect(page).toHaveURL(/\/third$/);
  await expect(question(page)).toHaveText("Which tone?");
  // Past the last, it wraps to the first still owed.
  await page.keyboard.press("]");
  await expect(page).toHaveURL(/\/first$/);
  await page.keyboard.press("[");
  await expect(page).toHaveURL(/\/third$/);
  await expect(question(page)).toHaveText("Which tone?");

  // The only question: picked, then Enter sends it.
  await page.keyboard.press("1");
  await expect(sendBtn(page)).toHaveText("Send");
  await page.keyboard.press("Enter");
  const stay = page.getByRole("button", { name: "Stay here" });
  await stay.click();
  await expect(stay).toHaveCount(0);
  await expect(page.locator(".nextcard-bar")).toHaveCount(0);
  // Well past the beat, still here, the way on still offered.
  await page.clock.runFor(5000);
  await expect(page).toHaveURL(/\/third$/);
  await page.locator(".nextcard-go").click();
  await expect(page).toHaveURL(/\/first$/);
});

test("after Send, a tap anywhere on the screen (here: Thread) keeps it from moving on", async ({
  page,
  server,
}) => {
  const { session } = await seedAsked(server.url, "first", "First");
  await seedAsked(server.url, "second", "Second", session);
  await page.clock.install();
  await page.goto(`${server.url}/project/${PROJECT}/first`);
  await expect(question(page)).toHaveText("Which tone?");
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Stay here" })).toBeVisible();
  // Reading the Thread for Delivered must not be cut short by the move-on.
  await openThread(page);
  await expect(page.getByRole("button", { name: "Stay here" })).toHaveCount(0);
  await page.clock.runFor(5000);
  await expect(page).toHaveURL(/\/first$/);
  await expect(page.locator(".trow.you")).toHaveCount(1);
  await expect(page.locator(".nextcard-go")).toHaveText("Next: Second · 1 question ›");
});

test("after Send, another agent conversation's mock is offered, never moved to", async ({
  page,
  server,
}) => {
  await seedAsked(server.url, "first", "First");
  await seedAsked(server.url, "other", "Other");
  await page.clock.install();
  await page.goto(`${server.url}/project/${PROJECT}/first`);
  await expect(question(page)).toHaveText("Which tone?");
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.locator(".nextcard-go")).toHaveText("Next: Other · 1 question ›");
  await expect(page.getByRole("button", { name: "Stay here" })).toHaveCount(0);
  await page.clock.runFor(5000);
  await expect(page).toHaveURL(/\/first$/);
});

test("Home: the canvas lays out each mock with its designs; a row finds its mock, a tile opens its variant", async ({
  page,
  server,
}) => {
  await seedWriter(server.url);
  await page.goto(`${server.url}/project/${PROJECT}`);
  const cluster = page.locator('.pc-cluster[data-cluster="writer"]');
  await expect(cluster).toBeVisible();
  await expect(page.locator('.pc-tile[data-variant="quiet"]')).toHaveCount(4);
  await page.getByRole("button", { name: "Tree of Writer" }).click();
  await expect(cluster).toHaveClass(/marked/);
  // A tile opens its mock on that state and variant.
  await page.locator('.pc-tile[data-variant="dark"]').first().click();
  await expect(page).toHaveURL(/\/writer\?variant=dark&state=/);
  await expect(onStage(page)).toHaveAttribute("data-variant", "dark");
});

test("Home: Answer next follows the agent's order, and a started mock shows its draft", async ({
  page,
  server,
}) => {
  await seedWriter(server.url);
  const card = await seedAsked(server.url, "card", "Card");
  // The card is the newest activity, yet the writer came first.
  await page.goto(`${server.url}/project/${PROJECT}/card`);
  const write = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${card.mockId}/draft`) && r.request().method() === "PUT",
  );
  await option(page, "warm").click();
  expect((await write).ok()).toBe(true);

  await page.goto(`${server.url}/project/${PROJECT}`);
  await expect(page.locator('.home-row[data-mock="card"] .home-sub')).toHaveText(
    "1 state · draft 1/1",
  );
  await expect(page.locator('.home-row[data-mock="writer"] .home-sub')).toHaveText("4 states");
  await page.getByRole("link", { name: "Answer next ›" }).click();
  await expect(page).toHaveURL(new RegExp(`${mockPath}$`));
});

test("slots: a fill's own question applies only while that fill is chosen; the reply carries the decisions", async ({
  page,
  server,
}) => {
  const html = `<p data-part="msg">Bife à Passarinhos</p>
<section data-part="entry" data-part-label="Entry" data-fill="dots" data-fill-label="Typing dots">···</section>
<section data-part="entry" data-fill="skeleton" data-fill-label="A skeleton card">
  <div data-part="rows" data-part-label="Rows" data-fill="pulse">pulse</div>
  <div data-part="rows" data-fill="shimmer">shimmer</div>
</section>
<section data-part="entry" data-fill="filling" data-fill-label="The card fills in">Logging…</section>`;
  const pub = await agentCall(server.url, "/api/mocks", {
    project: PROJECT,
    mock: "send",
    title: "Send",
    agent: "e2e",
    html,
  });
  expect(pub.slots.map((s: { part: string }) => s.part)).toEqual(["entry", "rows"]);
  await agentCall(server.url, `/api/mocks/${pub.mock.id}/asks`, {
    session: pub.sessionId,
    asks: pub.suggestedSlotAsks,
  });
  const mockId = pub.mock.id;
  await page.goto(`${server.url}/project/${PROJECT}/send`);

  // The question names its slot, and the stage shows only the chosen fill.
  await expect(page.locator(".qcard .slotchip")).toHaveText("Slot · Entry");
  const doc = page.frameLocator(".frame.on iframe");
  await expect(doc.locator('[data-fill="dots"]')).toBeVisible();
  await expect(doc.locator('[data-fill="skeleton"]')).toBeHidden();

  // The skeleton fill holds a slot of its own: its question comes next.
  await pickAndWait(page, mockId, "a-skeleton-card");
  await expect(doc.locator('[data-fill="skeleton"]')).toBeVisible();
  await sendBtn(page).click();
  await expect(count(page)).toHaveText("2 of 2");
  await expect(page.locator(".qcard .slotchip")).toHaveText("Slot · Rows");
  await pickAndWait(page, mockId, "shimmer");

  // Back to typing dots: the rows question no longer applies and is not sent.
  await page.getByRole("button", { name: "Previous question" }).click();
  await pickAndWait(page, mockId, "typing-dots");
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.locator(".qcard .qs .flag")).toHaveText("skipped");
  await expect(page.locator(".dormant")).toContainText("Only for A skeleton card");
  await page.getByRole("button", { name: "Go to question 1" }).click();
  await expect(sendBtn(page)).toHaveText("Send");

  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await sendBtn(page).click();
  expect((await reply).status()).toBe(201);
  const read = await agentCall(server.url, `/api/feedback?session=${pub.sessionId}`);
  const sent = read.feedback[0].reply;
  expect(Object.keys(sent.answers)).toEqual(["entry"]);
  expect(sent.decisions.states[""].slots).toEqual({
    entry: { fill: "dots", label: "Typing dots" },
  });
  const exported = await agentCall(server.url, `/api/mocks/${mockId}/export`);
  expect(exported.states[0].html).toContain("···");
  expect(exported.states[0].html).not.toContain("Logging");
});

// --- questions per state, open ones only, and Resolve ---

test("a state's questions show on that state, and the flow bar marks what each still owes", async ({
  page,
  server,
}) => {
  const first = await agentCall(server.url, "/api/mocks", {
    project: PROJECT,
    mock: "steps",
    title: "Steps",
    agent: "e2e",
    state: "Empty",
    html: "<p>empty</p>",
  });
  await agentCall(server.url, "/api/mocks", {
    mock: first.mock.id,
    session: first.sessionId,
    state: "Full",
    html: "<p>full</p>",
  });
  await agentCall(server.url, `/api/mocks/${first.mock.id}/asks`, {
    session: first.sessionId,
    asks: [
      {
        id: "copy",
        text: "What does the empty state say?",
        scope: "state",
        state: "Empty",
        options: ["Nothing yet", "Start here"],
      },
      {
        id: "sort",
        text: "How is the list sorted?",
        scope: "state",
        state: "Full",
        options: ["Newest", "Name"],
      },
      {
        id: "dense",
        text: "How dense?",
        scope: "state",
        state: "Full",
        options: ["Roomy", "Tight"],
      },
    ],
  });
  await page.goto(`${server.url}/project/${PROJECT}/steps`);
  await expect(stateName(page)).toHaveText("Empty");
  await expect(question(page)).toHaveText("What does the empty state say?");
  await expect(page.locator(".flowbar .dots i.owe")).toHaveCount(2);

  // Answered there, the flow moves on to the next state and its own questions.
  await option(page, "nothing-yet").click();
  await sendBtn(page).click();
  await expect(stateName(page)).toHaveText("Full");
  await expect(count(page)).toHaveText("1 of 2");
  await expect(page.locator(".flowbar .dots i.owe")).toHaveCount(1);

  // Back on Empty, only its own question shows, with its pick.
  await page.getByRole("button", { name: "Previous step: Empty" }).click();
  await expect(question(page)).toHaveText("What does the empty state say?");
  await expect(option(page, "nothing-yet")).toHaveAttribute("aria-pressed", "true");
});

test("after a Send only new questions are open; a sent answer is folded and changes only on purpose", async ({
  page,
  server,
}) => {
  const card = await seedAsked(server.url, "card", "Card");
  await page.goto(`${server.url}/project/${PROJECT}/card`);
  await expect(question(page)).toHaveText("Which tone?");
  await option(page, "warm").click();
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${card.mockId}/reply`) && r.request().method() === "POST",
  );
  await sendBtn(page).click();
  expect((await reply).status()).toBe(201);

  await agentCall(server.url, `/api/mocks/${card.mockId}/asks`, {
    session: card.session,
    asks: [
      { id: "size", text: "Which size?", options: ["Small", "Large"] },
      { id: "edge", text: "Which edge?", options: ["Round", "Square"] },
    ],
  });
  // Two new questions, not three: the sent one is out of the way.
  await expect(count(page)).toHaveText("1 of 2");
  await expect(question(page)).toHaveText("Which size?");
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(count(page)).toHaveText("2 of 2");
  await expect(page.getByRole("button", { name: "Next question" })).toBeDisabled();

  // The sent one is folded in the Thread, read-only.
  await openThread(page);
  const answered = page.getByRole("button", { name: "Answered · 1" });
  await expect(answered).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".answered-row")).toHaveCount(0);
  await answered.click();
  await expect(page.locator(".answered-row .review-said")).toHaveText("Warm");
  await expect(page.locator(".answered-row .opt")).toHaveCount(0);

  // Change answer is the one way back in; keeping it folds it away again.
  await page.getByRole("button", { name: "Change answer: Which tone?" }).click();
  await expect(question(page)).toHaveText("Which tone?");
  await expect(page.locator(".revising")).toContainText("Changing a sent answer");
  await expect(option(page, "warm")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Keep sent answer" }).click();
  await expect(page.locator(".revising")).toHaveCount(0);
  await expect(question(page)).toHaveText("Which size?");
});

test("Home: a row's Resolve button closes the mock; the mock says so and reopens", async ({
  page,
  server,
}) => {
  const card = await seedAsked(server.url, "card", "Card");
  await page.goto(`${server.url}/project/${PROJECT}`);
  const row = page.locator('.home-item:has([data-mock="card"])');
  await row.hover();
  await row.getByRole("button", { name: "Resolve Card" }).click();
  await expect(page.locator(".home-toast")).toContainText("Resolved “Card”");
  await expect(page.locator(".home-lead")).toContainText("0 open");
  const read = await agentCall(server.url, `/api/feedback?session=${card.session}`);
  expect(read.feedback).toEqual([
    expect.objectContaining({
      mock: "card",
      resolved: true,
      dismissed: [{ ask: "tone", text: "Which tone?" }],
    }),
  ]);

  await page.locator(".home-resolved-hd").click();
  await page.locator('.home-resolved .home-row[data-mock="card"]').click();
  await expect(page.locator(".resolved-note")).toContainText("Resolved.");
  await expect(page.locator(".opt")).toHaveCount(0);
  await page.locator(".resolved-note").getByRole("button", { name: "Reopen" }).click();
  await expect(page.locator(".resolved-note")).toHaveCount(0);
  await expect(question(page)).toHaveText("Which tone?");
});
