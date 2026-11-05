// Regenerates the README stills, dark: docs/mockpit-question.png (the first question on
// the HALDE shop, its answers as pictures) and docs/mockpit-preview.png (the product page
// previewing an answer before it's picked). The README gif and the film come from
// scripts/film/.
//
//   node scripts/record-demo.mjs

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { boot, publishShop, ROOT, screenPath, setTheme, sleep } from "./demo-session.mjs";

execFileSync("npm", ["run", "build:viewer"], { cwd: ROOT, stdio: "inherit" });

const { base, api, stop } = await boot();
const browser = await chromium.launch();
try {
  await publishShop(api);
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

  await page.goto(`${base}${screenPath}`);
  await page.locator('.opt[data-option="editorial"] iframe').waitFor();
  await page.locator(".frame.on iframe").waitFor();
  await sleep(2000); // thumbnails and the stage frame report their heights
  await page.mouse.move(0, 0);
  await shoot("question");

  // The product page, one answer in, previewing a colour before picking it.
  await page.getByText("Product", { exact: true }).first().click();
  await sleep(1200);
  const answer = (label) => page.locator(".opt:visible", { hasText: label }).first();
  await answer("Gallery").click();
  await sleep(500);
  await page.locator("button.qsend").click();
  await answer("White").locator("iframe").waitFor();
  await sleep(1500);
  // The still is about the preview, so the pointer's card actions stay out of it.
  await page.addStyleTag({ content: ".optic,.holdtimer{visibility:hidden!important}" });
  await answer("Bone").hover();
  await sleep(1500);
  await shoot("preview");
} finally {
  await browser.close();
  stop();
}
