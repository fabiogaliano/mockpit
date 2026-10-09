import type { Page } from "@playwright/test";
import { MARKER, PROJECT, revise, seedWriter, writerHtml } from "./decideSeed.ts";
import { agentCall, expect, test } from "./fixtures.ts";

// The final prototype's flow, end to end against the real server: Home → the
// questions (Look, a part ask, a state-bound part ask, Mix) → Send → Thread
// ✓ → the agent reads it → ✓✓; versions, mid-answer versions, the plain
// verdict, the theme, and the sandbox invariant.

const mockPath = `/project/${PROJECT}/writer`;

// The viewer's own reads: same-origin, so the server treats them as the user.
const viewerGet = (page: Page, path: string) =>
  page.evaluate(async (p) => (await fetch(p)).json(), path);

const header = (page: Page) => page.locator(".qhd");
const option = (page: Page, id: string) => page.locator(`.opt[data-option="${id}"]`);
const onStage = (page: Page) => page.locator(".frame.on");
const activeState = (page: Page) => page.locator('.strip [role="tab"][aria-selected="true"]');
const cornerPin = (page: Page, n: number) => page.locator(`.pins .pin[data-question="${n}"]`);
const partPin = (page: Page, n: number) =>
  page.locator(`.frame.on .overlay .pin[data-question="${n}"]`);

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
  await expect(header(page)).toContainText("Question 1 of 3");
});

test("questions: pictures, hover preview, pick, part focus, Mix override, Send, ✓ → ✓✓", async ({
  page,
  server,
}) => {
  const { mockId, session } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);

  // Q1 Look: picture options, no Send yet.
  await expect(header(page)).toContainText("Question 1 of 3");
  await expect(page.locator(".nm")).toHaveText("Look");
  for (const look of ["quiet", "dark", "editorial"]) {
    await expect(option(page, look).locator("iframe")).toHaveCount(1);
  }
  await expect(page.locator("button.send")).toHaveCount(0);
  await expect(onStage(page)).toHaveAttribute("data-variant", "quiet");

  // Hover previews on the stage; leaving puts it back.
  await option(page, "dark").hover();
  await expect(onStage(page)).toHaveAttribute("data-variant", "dark");
  await option(page, "editorial").hover();
  await expect(onStage(page)).toHaveAttribute("data-variant", "editorial");
  await page.locator(".qhd").hover();
  await expect(onStage(page)).toHaveAttribute("data-variant", "quiet");

  // Click picks and moves on; Mix joins as the last question.
  await pickAndWait(page, mockId, "quiet");
  await expect(cornerPin(page, 1)).toHaveText("✓");
  await expect(header(page)).toContainText("Question 2 of 4");
  await page.getByRole("button", { name: "Previous question" }).click();
  await expect(header(page)).toContainText("1 of 4 · picked: Quiet");
  await expect(option(page, "quiet")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next question" }).click();

  // Q2, a part ask: knob-set options are pictures, the part carries the pin.
  await expect(header(page)).toContainText("Question 2 of 4");
  await expect(page.locator(".nm")).toHaveText("Versions");
  await expect(option(page, "drawer").locator("iframe")).toHaveCount(1);
  await expect(partPin(page, 2)).toHaveText("2");
  await expect(page.locator("button.send")).toHaveCount(0);
  await pickAndWait(page, mockId, "drawer");

  // Q3 is bound to a part that only "Lab open" shows: the strip follows it.
  await expect(header(page)).toContainText("Question 3 of 4");
  await expect(activeState(page)).toHaveText("Lab open");
  await expect(partPin(page, 3)).toHaveText("3");
  await expect(option(page, "below")).toHaveClass(/pill/);
  await pickAndWait(page, mockId, "below");
  await expect(partPin(page, 3)).toHaveText("✓");

  // Mix, last: picture options, Send once nothing is open.
  await expect(header(page)).toContainText("4 of 4");
  await expect(page.locator(".nm")).toHaveText("Mix");
  await expect(option(page, "none")).toContainText("No, all quiet");
  const borrow = option(page, "versions:editorial");
  await expect(borrow.locator("iframe")).toHaveCount(1);
  await expect(page.locator("button.send")).toHaveText("Send 3");
  await pickAndWait(page, mockId, "versions:editorial");
  await expect(page.locator("button.send")).toHaveText("Send 4");

  // The borrow overrides Q2: struck ✓, the "Mix uses …" line, and undo.
  await expect(cornerPin(page, 1)).toHaveText("✓");
  await page.getByRole("button", { name: "Previous question" }).click();
  await page.getByRole("button", { name: "Previous question" }).click();
  await expect(header(page)).toContainText("2 of 4");
  await expect(page.locator(".qhd .picked")).toHaveClass(/ovr/);
  const line = page.locator(".ovrline");
  await expect(line).toContainText("Mix uses editorial's versions instead · undo");
  await expect(page.locator('.pin[data-question="2"]')).toHaveClass(/ovr/);
  await line.getByRole("button", { name: "undo" }).click();
  await expect(line).toHaveCount(0);
  await expect(page.locator(".qhd .picked")).not.toHaveClass(/ovr/);
  await expect(page.locator('.pin[data-question="2"]')).toHaveClass(/ok/);

  // Send from the last question.
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(header(page)).toContainText("4 of 4");
  const send = page.locator("button.send");
  await expect(send).toHaveText("Send 3");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await send.click();
  expect((await reply).status()).toBe(201);

  const pill = page.locator(".top .pill.count");
  await expect(pill).toHaveText("Sent · Not seen yet");
  await expect(page.locator('[data-mode="thread"]')).toHaveAttribute("aria-selected", "true");
  const row = page.locator(".trow.you");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Sent · look quiet · versions drawer · trim below the lab");
  await expect(row.locator(".tdelivered")).toHaveText("✓Not seen yet");
  // Nobody has read it after a beat: the confirmation asks the user to say so.
  await expect(page.locator(".top .sent-hint")).toHaveText("tell your agent you've answered");

  // The agent reads its feedback; the row and the confirmation turn Delivered.
  const read = await agentCall(server.url, `/api/feedback?session=${session}`);
  expect(read.feedback).toHaveLength(1);
  await expect(row.locator(".tdelivered")).toHaveText("✓✓Delivered");
  await expect(pill).toHaveText("Sent · Delivered");
  await expect(page.locator(".top .sent-hint")).toHaveCount(0);

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
  await expect(cornerPin(page, 1)).toHaveText("✓");
  await expect(onStage(page)).toHaveAttribute("data-variant", "dark");
  await cornerPin(page, 1).click();
  await expect(header(page)).toContainText("picked: Dark");
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

  // Q1: the note is opt-in, collapsed until asked for.
  await expect(header(page)).toContainText("Question 1 of 3");
  await expect(page.locator(".ask-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Add a note" }).click();
  let write = saved();
  await page.locator(".ask-note textarea").fill("Dark on desktop, quiet on mobile");
  expect((await write).ok()).toBe(true);
  await pickAndWait(page, mockId, "dark");
  // Hover devices move on to the next open question by themselves.
  if (!(await page.evaluate(() => matchMedia("(hover: hover)").matches))) {
    await page.getByRole("button", { name: "Next question" }).click();
  }

  // Q2: Other… is one more option; picking it opens the write-in in place.
  await expect(header(page)).toContainText("Question 2 of");
  await expect(page.locator(".other-text")).toHaveCount(0);
  await option(page, "other").click();
  await expect(option(page, "other")).toHaveAttribute("aria-pressed", "true");
  write = saved();
  await page.locator(".other-text textarea").fill("a tab in the sidebar");
  expect((await write).ok()).toBe(true);

  await page.reload();
  await cornerPin(page, 1).click();
  await expect(page.locator(".ask-note textarea")).toHaveValue("Dark on desktop, quiet on mobile");
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(header(page)).toContainText("picked: “a tab in the sidebar”");
  await expect(option(page, "other")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".other-text textarea")).toHaveValue("a tab in the sidebar");

  // Q3: a note alone answers it, so Send opens up on the last question.
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByRole("button", { name: "Add a note" }).click();
  write = saved();
  await page.locator(".ask-note textarea").fill("neither, keep it hidden");
  expect((await write).ok()).toBe(true);
  const last = page.getByRole("button", { name: "Next question" });
  while (await last.isEnabled()) await last.click();
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${mockId}/reply`) && r.request().method() === "POST",
  );
  await page.locator("button.send").click();
  expect((await reply).status()).toBe(201);
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

test("versions: popover, viewing an older one, back, restore as a new version", async ({
  page,
  server,
}) => {
  const { mockId, session, posts } = await seedWriter(server.url);
  await revise(server.url, mockId, {
    state: "At rest",
    variant: "quiet",
    session,
    prompt: "tighter title",
    html: writerHtml("At rest", "quiet", { title: "Draft Early" }),
  });
  await page.goto(`${server.url}${mockPath}`);
  const vbtn = page.locator(".vbtn");
  await expect(vbtn).toHaveText("v2 ▾");

  await vbtn.click();
  const rows = page.locator(".vpop .vrow");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-version", "2");
  await expect(rows.nth(0)).toContainText("tighter title");
  await expect(rows.nth(0)).toContainText("agent");
  await expect(rows.nth(1)).toContainText("first version");
  await page.keyboard.press("Escape");
  await expect(page.locator(".vpop")).toHaveCount(0);

  await vbtn.click();
  await page.locator('.vrow[data-version="1"]').click();
  const banner = page.locator(".banner");
  await expect(banner).toContainText("Viewing v1");
  await expect(page.locator(".stage")).toHaveClass(/old/);
  await expect(vbtn).toHaveText("v1 ▾");
  await banner.getByRole("button", { name: "↶ back to v2" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".stage")).not.toHaveClass(/old/);
  await expect(vbtn).toHaveText("v2 ▾");

  await vbtn.click();
  await page.locator('.vrow[data-version="1"]').click();
  await banner.getByRole("button", { name: "restore as v3" }).click();
  await expect(banner).toHaveCount(0);
  await expect(vbtn).toHaveText("v3 ▾");
  const detail = await agentCall(server.url, `/api/mocks/${mockId}?history=1`);
  const restored = detail.variants.find(
    (v: { postId: string }) => v.postId === posts["At rest/quiet"],
  );
  expect([restored.version, restored.from, restored.prompt, restored.author]).toEqual([
    3,
    1,
    "restored v1",
    "user",
  ]);
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
  await expect(header(page)).toContainText(/Question 2 of \d/);
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

  await cornerPin(page, 1).click();
  await expect(header(page)).toContainText("picked: Dark");
  await page.getByRole("button", { name: "Next question" }).click();
  // Whether Mix joins depends on how the looks render, which this test is not about.
  await expect(header(page)).toContainText(/Question 2 of \d · your pick is gone in v3/);
  await expect
    .poll(async () => (await viewerGet(page, `/api/mocks/${mockId}/draft`)).draft)
    .toMatchObject({ version: 3, answers: { look: "dark" } });
  const after = await viewerGet(page, `/api/mocks/${mockId}/draft`);
  expect(after.draft.answers.versions).toBeUndefined();
});

test("a plain mock offers Accept / Revise / Drop; Revise reaches the agent", async ({
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
  await page.goto(`${server.url}/project/${PROJECT}/note`);
  for (const name of ["Accept", "Revise", "Drop"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // Nothing to tune: no knobs, no marked parts, so no Tune tab at all.
  await expect(page.locator('[data-mode="thread"]')).toBeVisible();
  await expect(page.locator('[data-mode="tune"]')).toHaveCount(0);
  await page.getByPlaceholder("optional, for the agent").fill("tighten the copy");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${out.mock.id}/reply`) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  expect((await reply).status()).toBe(201);

  const read = await agentCall(server.url, `/api/feedback?session=${out.sessionId}`);
  expect(read.feedback).toHaveLength(1);
  const sent = JSON.stringify(read.feedback[0]);
  expect(sent).toContain("tighten the copy");
  expect(sent).toContain('"revise"');
  await expect(page.locator(".trow.you .tdelivered")).toContainText("Delivered");
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
  await expect(header(page)).toContainText(/Question 2 of \d/);
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
  // The frame has reported its parts once hovering the title boxes it.
  await overlay.hover({ position: { x: 120, y: 70 } });
  await expect(overlay.locator('.box[data-part="title"]')).toHaveCount(1);

  const markBtn = page.locator(".markbtn");
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
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  expect((await reply).status()).toBe(201);
  const row = page.locator(".trow.you");
  await expect(row).toContainText("Sent · 1 comment · revise default");
  await expect(row.locator(".cline")).toHaveText("title “make it louder”");

  const read = await agentCall(server.url, `/api/feedback?session=${out.sessionId}`);
  expect(read.feedback).toHaveLength(1);
  const sent = read.feedback[0].reply.comments;
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ part: "title", text: "make it louder", anchor: c.anchor });
});

test("un-archive: a losing look is restored from the answered Look question", async ({
  page,
  server,
}) => {
  const { mockId } = await seedWriter(server.url);
  await page.goto(`${server.url}${mockPath}`);
  await expect(header(page)).toContainText("Question 1 of 3");
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

  await cornerPin(page, 1).click();
  await expect(page.locator(".nm")).toHaveText("Look");
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

test("un-archive: the variant switcher dims archived variants and restores them", async ({
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
  // While "Which one?" is open it is the switcher; the switcher returns once it is answered.
  const sw = page.locator(".variant-switch");
  await expect(sw).toHaveCount(0);
  await option(page, "a").click();
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${a.mock.id}/reply`) && r.request().method() === "POST",
  );
  await page.locator("button.send").click();
  expect((await reply).status()).toBe(201);
  await expect(sw.locator('[role="tab"]')).toHaveCount(2);
  await expect(sw.locator('[data-variant="a"] .vok')).toHaveText("✓");
  const b = sw.locator('[data-variant="b"]');
  await expect(b).toHaveClass(/arch/);
  await sw.getByRole("button", { name: "Restore b" }).click();
  // Two live variants again: the choice is open again, so "Which one?" is back.
  await page.locator('[data-mode="questions"]').click();
  await expect(page.locator(".ask")).toHaveText("Which one?");
  await expect(sw).toHaveCount(0);
  const detail = await agentCall(server.url, `/api/mocks/${a.mock.id}`);
  const statuses = Object.fromEntries(
    detail.variants.map((v: { variant: string; status: string }) => [v.variant, v.status]),
  );
  expect(statuses).toEqual({ a: "accepted", b: "open" });
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

  await expect(page.locator(".ask")).toHaveText("Which one?");
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
  const looks = page.locator('.opt:not([data-option="other"])');
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
  await page.locator("button.send").click();
  expect((await reply).status()).toBe(201);

  // Stored but not read: the row and the confirmation say so.
  const row = page.locator(".trow.you");
  await expect(row).toContainText("Sent · look b");
  await expect(row.locator(".tdelivered")).toContainText("Not seen yet");
  await expect(page.locator(".top .pill.count")).toHaveText("Sent · Not seen yet");

  // The reply flipped the variants; the choice is made, so the built-in ask is gone.
  const detail = await agentCall(server.url, `/api/mocks/${mockId}`);
  const statuses = Object.fromEntries(
    detail.variants.map((v: { variant: string; status: string }) => [v.variant, v.status]),
  );
  expect(statuses).toEqual({ a: "archived", b: "accepted" });
  await page.locator('[data-mode="questions"]').click();
  await expect(page.locator(".ask")).not.toHaveText("Which one?");
  await page.locator('[data-mode="thread"]').click();

  const read = await agentCall(server.url, `/api/feedback?session=${a.sessionId}`);
  expect(read.feedback).toHaveLength(1);
  expect(read.feedback[0].reply.asks).toEqual([
    expect.objectContaining({ ask: "variant", chosen: [expect.objectContaining({ id: "b" })] }),
  ]);
  await expect(row.locator(".tdelivered")).toContainText("Delivered");
  await expect(page.locator(".top .pill.count")).toHaveText("Sent · Delivered");
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
  await expect(page.locator(".qhd")).toContainText("Question 1 of 2");
  await expect(page.locator(".nm")).toHaveText("Start");
  await expect(page.locator('.opt:not([data-option="other"]) .lbl')).toHaveText(["a", "b"]);
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.locator(".nm")).toHaveText("End");
  await expect(page.locator('.opt:not([data-option="other"]) .lbl')).toHaveText(["a", "c"]);
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

  await expect(page.locator('[data-mode="thread"]')).toHaveAttribute("aria-selected", "true");
  const input = page.locator(".tcomment input");
  await expect(input).toHaveValue("tighten the title");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.locator(".trow.you")).toContainText("tighten the title");
  const read = await agentCall(server.url, `/api/feedback?session=${session}`);
  expect(JSON.stringify(read.feedback)).toContain("tighten the title");
  expect(JSON.stringify(read.feedback)).not.toContain("from a hidden frame");
});
