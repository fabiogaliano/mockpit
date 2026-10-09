import { agentCall, expect, test } from "./fixtures.ts";

// The bell: asks for permission on click, then a burst of agent writes while the
// tab is away becomes one notification for the mock, and clicking it opens the mock.

declare global {
  interface Window {
    __notes: { title: string; body?: string; tag?: string; onclick: (() => void) | null }[];
    __away: boolean;
  }
}

test("bell on, away: one notification per mock burst, click opens the mock", async ({
  page,
  server,
}) => {
  await page.addInitScript(() => {
    window.__notes = [];
    window.__away = false;
    let permission: NotificationPermission = "default";
    class FakeNotification {
      static get permission() {
        return permission;
      }
      static async requestPermission() {
        permission = "granted";
        return permission;
      }
      title: string;
      body?: string;
      tag?: string;
      onclick: (() => void) | null = null;
      constructor(title: string, opts: NotificationOptions = {}) {
        this.title = title;
        this.body = opts.body;
        this.tag = opts.tag;
        window.__notes.push(this);
      }
      close() {}
    }
    Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
    Document.prototype.hasFocus = () => !window.__away;
  });

  const first = await agentCall(server.url, "/api/mocks", {
    project: "e2e",
    mock: "card",
    title: "Card",
    agent: "e2e",
    html: "<p>one</p>",
  });
  await page.goto(`${server.url}/project/e2e`);
  const bell = page.getByRole("button", { name: "Notifications" });
  await expect(bell).toHaveAttribute("data-bell", "off");
  await bell.click();
  await expect(bell).toHaveAttribute("data-bell", "on");
  expect(await page.evaluate(() => localStorage.getItem("mockpit-notify"))).toBe("on");

  await page.evaluate(() => (window.__away = true));
  const session = first.sessionId ?? first.post.sessionId;
  await agentCall(server.url, "/api/mocks", {
    project: "e2e",
    mock: "card",
    session,
    html: "<p>two</p>",
  });
  await agentCall(server.url, `/api/mocks/${first.mock.id}/asks`, {
    session,
    asks: [{ id: "tone", text: "Which tone?", options: [{ id: "a", label: "A" }] }],
  });

  await expect.poll(() => page.evaluate(() => window.__notes.length)).toBe(1);
  // Past the batch window: the burst stayed one notification.
  await page.waitForTimeout(2000);
  const notes = await page.evaluate(() =>
    window.__notes.map(({ title, body, tag }) => ({ title, body, tag })),
  );
  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe("mockpit · Card");
  expect(notes[0].body).toMatch(/^New question: Which tone\?/);
  expect(notes[0].tag).toBe(`mockpit:${first.mock.id}`);

  await page.evaluate(() => window.__notes[0].onclick?.());
  await expect(page).toHaveURL(/\/project\/e2e\/card$/);
});
