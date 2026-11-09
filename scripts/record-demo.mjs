// Regenerates the README stills, dark: docs/mockpit-board.png (the HALDE shop on the Board,
// where its link lands) and docs/mockpit-question.png (Focus on its first question, the
// answers side by side). The film comes from scripts/film/.
//
//   node scripts/record-demo.mjs

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { boot, publishShop, ROOT, screenPath, setTheme, sleep } from "./demo-session.mjs";

execFileSync("npm", ["run", "build:viewer"], { cwd: ROOT, stdio: "inherit" });

const { base, api, stop } = await boot();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
try {
  const { session } = await publishShop(api);
  // Over HTTP nothing takes the stills the Board shows, so the CLI's worker takes them.
  const { queueRetakes } = await import("../bin/poster.js");
  queueRetakes({ base, client: "cli/record-demo", session, project: "demo/halde" });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    colorScheme: "dark",
  });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await setTheme(page, api, base, "dark");
  const shoot = async (name) => {
    const path = join(ROOT, "docs", `mockpit-${name}.png`);
    await page.screenshot({ path });
    console.log(path);
  };

  // The worker needs a few seconds per still; the Board picks each up as it lands.
  await page.goto(`${base}${screenPath}`);
  await page.waitForFunction(
    () => {
      const frames = [...document.querySelectorAll(".bf")];
      return frames.length >= 6 && frames.every((f) => f.querySelector("img")?.naturalWidth);
    },
    undefined,
    { timeout: 120_000 },
  );
  // A still that lands late swaps its image in; let the last one paint.
  await sleep(3000);
  await page.evaluate(() =>
    Promise.all([...document.querySelectorAll(".bf img")].map((i) => i.decode())),
  );
  await page.mouse.move(1430, 890);
  await shoot("board");

  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Side by side" }).click();
  await page.locator(".sbs-cell iframe").first().waitFor();
  await sleep(3500); // the row's frames report their heights
  // The still is about the row, so the pointer's card actions stay out of it.
  await page.addStyleTag({ content: ".optic,.holdtimer{visibility:hidden!important}" });
  await page.mouse.move(1430, 890);
  await sleep(400);
  await shoot("question");
} finally {
  await browser.close();
  stop();
}
