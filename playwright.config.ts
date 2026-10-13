import { defineConfig, devices } from "@playwright/test";

// Viewer e2e suite — runs with `npm run test:e2e`, kept out of `npm test`.
// WebKit is the point: the iframe resize bridge has WebKit-specific quirks
// (see CLAUDE.md), so both engines must pass.
const MOBILE = /mobile\.spec\.ts$/;
// Viewport is the screen less Safari's own chrome.
const IPAD_MINI = {
  ...devices["iPad Mini"],
  viewport: { width: 744, height: 1063 },
  screen: { width: 744, height: 1133 },
  userAgent: devices["Desktop Safari"].userAgent,
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/globalSetup.ts",
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    { name: "chromium", testIgnore: MOBILE, use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", testIgnore: MOBILE, use: { ...devices["Desktop Safari"] } },
    // The mobile baseline: real WebKit at the devices the viewer must work on.
    // iPadOS Safari sends a desktop user agent, so the iPads carry one too.
    { name: "iphone", testMatch: MOBILE, use: { ...devices["iPhone 13 Pro"] } },
    { name: "ipad-mini-6", testMatch: MOBILE, use: IPAD_MINI },
    {
      name: "ipad-mini-6-landscape",
      testMatch: MOBILE,
      use: {
        ...IPAD_MINI,
        viewport: { width: 1133, height: 674 },
        screen: { width: 1133, height: 744 },
      },
    },
  ],
});
