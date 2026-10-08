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

  await expect(page.locator(".top .pill.count")).toContainText("Sent");
  await expect(page.locator('[data-mode="thread"]')).toHaveAttribute("aria-selected", "true");
  const row = page.locator(".trow.you");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Sent · look quiet · versions drawer · trim below the lab");
  await expect(row.locator(".tseen .tick")).toHaveText("✓");

  // The agent reads its feedback; the row turns ✓✓ seen.
  const read = await agentCall(server.url, `/api/comments?session=${session}&author=user`);
  expect(read.feedback).toHaveLength(1);
  await expect(row.locator(".tseen .tick")).toHaveText("✓✓");
  await expect(row.locator(".tseen")).toContainText("seen");

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
  await page.getByPlaceholder("optional, for the agent").fill("tighten the copy");
  const reply = page.waitForResponse(
    (r) => r.url().endsWith(`/api/mocks/${out.mock.id}/reply`) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  expect((await reply).status()).toBe(201);

  const read = await agentCall(
    server.url,
    `/api/comments?session=${out.sessionId}&author=user&wait=5`,
  );
  expect(read.feedback).toHaveLength(1);
  const sent = JSON.stringify(read.feedback[0]);
  expect(sent).toContain("tighten the copy");
  expect(sent).toContain('"revise"');
  await expect(page.locator(".trow.you .tseen .tick")).toHaveText("✓✓");
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
