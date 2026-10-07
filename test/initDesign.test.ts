import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error — the CLI side is plain JS with JSDoc types
import { buildIconSprite, detectDesign, renderStarter } from "../bin/initDesign.js";

// `mockpit init`'s detection half: deterministic, no model in the loop, and it
// parses files we did not write — so it must never throw, whatever the repo
// looks like.

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-init-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

const SHADCN_CSS = `
@import "tailwindcss";
:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --card: #ffffff;
  --border: 214 32% 91%;
  --primary: oklch(0.55 0.2 260);
  --radius: 0.5rem;
  --font-sans: Inter, sans-serif;
}
.dark { --background: 222 47% 11%; --foreground: 210 40% 98%; }
body { font-family: "Inter", system-ui; }
`;

test("detectDesign reads a shadcn/Tailwind repo's tokens, fonts, and kit", async () => {
  const cwd = repo({
    "package.json": JSON.stringify({ devDependencies: { tailwindcss: "^4" } }),
    "components.json": JSON.stringify({ aliases: { components: "@/components" } }),
    "src/styles/globals.css": SHADCN_CSS,
  });
  const design = await detectDesign(cwd);

  assert.equal(design.detected.tailwind, true);
  assert.equal(design.detected.shadcn, true);
  assert.ok(design.detected.cssVars >= 6, "counts the custom properties it imported");
  assert.ok(design.detected.fonts.includes("Inter"));
  assert.equal(design.kit, "tailwind", "a Tailwind repo writes Tailwind classes in the frame");
  assert.equal(design.source, join("src", "styles", "globals.css"));
  assert.ok(design.cssVars.includes("--primary"), "the raw block is kept for injection");
  // mapped through server/themes.ts, so the server and the CLI can't disagree
  assert.equal(design.palette!.light.bg, "hsl(0 0% 100%)");
  assert.equal(design.palette!.dark.bg, "hsl(222 47% 11%)");
});

test("detectDesign falls back to the builtin kit for a repo with nothing to find", async () => {
  const design = await detectDesign(repo({ "readme.md": "# hi" }));
  assert.deepEqual(design.detected, { tailwind: false, shadcn: false, cssVars: 0, fonts: [] });
  assert.equal(design.palette, null);
  assert.equal(design.cssVars, "");
  assert.equal(design.source, null);
  assert.equal(design.kit, "builtin");
});

test("detectDesign detects Tailwind from a config file or a stylesheet import", async () => {
  const byConfig = await detectDesign(repo({ "tailwind.config.ts": "export default {}" }));
  assert.equal(byConfig.detected.tailwind, true);

  const byCss = await detectDesign(repo({ "app/app.css": "@tailwind base;\n:root{--x:#fff}" }));
  assert.equal(byCss.detected.tailwind, true);
  assert.equal(byCss.kit, "tailwind");
});

test("detectDesign picks the file with the most tokens and ignores junk", async () => {
  const cwd = repo({
    "src/small.css": ":root{--background:#fff}",
    "src/tokens.css": ":root{--background:#111;--foreground:#eee;--border:#333;--primary:#0af}",
    "node_modules/pkg/big.css": ":root{--a:1;--b:2;--c:3;--d:4;--e:5;--f:6;--g:7}",
    "src/broken.css": ":root { --background: #fff", // unbalanced on purpose
    "package.json": "{not json",
  });
  const design = await detectDesign(cwd);
  assert.equal(design.source, join("src", "tokens.css"), "node_modules is never scanned");
  assert.equal(design.palette!.light.bg, "#111");
  assert.equal(design.detected.tailwind, false, "an unreadable package.json is not a crash");
});

test("buildIconSprite builds symbols from the bundled mage set", () => {
  const all = buildIconSprite();
  assert.ok(all.count > 0);
  assert.match(all.svg, /^<svg\b/);
  assert.match(all.svg, /<symbol id="mage-[a-z0-9-]+" viewBox="[^"]+">/);

  const subset = buildIconSprite({ names: ["check"] });
  assert.equal(subset.count, 1);
  assert.match(subset.svg, /id="mage-check"/);
  assert.equal(buildIconSprite({ names: ["not-an-icon"] }).count, 0);
});

test("renderStarter is a body fragment on the project's own kit and tokens", () => {
  const builtin = renderStarter(
    { kit: "builtin", cssVars: ":root{--radius:0.5rem;--primary:#0af}" },
    ["check"],
  );
  // the html contract: a fragment, never a document
  assert.ok(!builtin.includes("<!doctype"));
  assert.ok(!/<html|<body/i.test(builtin));
  assert.match(builtin, /kit: builtin · icons: mage/);
  assert.match(builtin, /<use href="#mage-check"\/>/);
  assert.match(builtin, /var\(--primary\) = #0af/);
  assert.match(builtin, /never a hardcoded/);

  const tailwind = renderStarter({ kit: "tailwind", cssVars: "" }, []);
  assert.match(tailwind, /kit: tailwind/);
  assert.ok(!tailwind.includes("<use href="), "no sprite, no icon markup");
  assert.ok(!tailwind.includes("tokens imported from this repo"));
});
