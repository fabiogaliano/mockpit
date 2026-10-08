import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  detectDesign,
  detectIconSets,
  readDesignMd,
  renderStarter,
  tailwindSource,
  // @ts-expect-error — the CLI side is plain JS with JSDoc types
} from "../bin/initDesign.js";

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

// The shape `shadcn init` writes for Tailwind v4.
const SHADCN_V4 = `@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import url("https://fonts.googleapis.com/css2?family=Inter");
@import "./fonts.css" layer(base);
@plugin "@tailwindcss/typography";
@config "../tailwind.config.js";

/* the theme */
@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-card: var(--card);
  --color-border: var(--border);
}

:root {
  --card: oklch(1 0 0);
  --border: oklch(0.92 0 0);
  --radius: 0.625rem;
}

.dark {
  --card: oklch(0.2 0 0);
}

@layer base {
  * { @apply border-border; }
}
`;

test("detectDesign hands a Tailwind v4 repo's entry stylesheet to the browser build", async () => {
  const cwd = repo({
    "package.json": JSON.stringify({ dependencies: { tailwindcss: "^4" } }),
    "src/tokens.css": ":root{--a:1}",
    "src/app/globals.css": SHADCN_V4,
  });
  const design = await detectDesign(cwd);
  assert.equal(design.tailwindSource, join("src", "app", "globals.css"));
  assert.deepEqual(design.strippedImports, [
    "tw-animate-css",
    "shadcn/tailwind.css",
    "https://fonts.googleapis.com/css2?family=Inter",
    "./fonts.css",
    "@tailwindcss/typography",
    "../tailwind.config.js",
  ]);
  const css: string = design.tailwindCss;
  assert.ok(css.startsWith('@import "tailwindcss";'));
  assert.equal(css.match(/@import|@plugin|@config/g)?.length, 1, "only the core import is left");
  assert.ok(!css.includes("/*"), "comments are stripped");
  for (const kept of [
    "@custom-variant dark",
    "@theme inline",
    "--card: oklch(0.2 0 0)",
    "@apply",
  ]) {
    assert.ok(css.includes(kept), kept);
  }
});

test("tailwindSource adds the core import and refuses what would not compile", () => {
  assert.equal(
    tailwindSource(":root{--card:#fff}")!.css,
    '@import "tailwindcss";\n:root{--card:#fff}',
  );
  const core = '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities";';
  assert.equal(tailwindSource(core)!.css, core, "core entries are kept as written");
  assert.equal(tailwindSource("@tailwind base;\n@tailwind utilities;"), null, "a v3 entry");
  assert.equal(tailwindSource(`:root{--x:"${"a".repeat(130_000)}"}`), null, "too large to cut");
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

test("detectIconSets maps the repo's icon packages to Iconify prefixes", () => {
  const cwd = mkdtempSync(join(tmpdir(), "mockpit-icons-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      dependencies: { "lucide-react": "1", "react-icons": "5" },
      devDependencies: { "@iconify-json/carbon": "1" },
    }),
  );
  for (const dir of ["@tabler/icons-react", "@phosphor-icons/react", "@heroicons/react"]) {
    mkdirSync(join(cwd, "node_modules", dir), { recursive: true });
  }
  const found = detectIconSets(cwd);
  assert.deepEqual(found.map((f: { prefix: string }) => f.prefix).sort(), [
    "carbon",
    "heroicons",
    "lucide",
    "ph",
    "tabler",
  ]);
  assert.equal(
    found.find((f: { prefix: string }) => f.prefix === "lucide").from,
    "lucide-react",
    "react-icons maps to no set",
  );
  assert.deepEqual(detectIconSets(join(cwd, "missing")), [], "an empty dir is not a crash");
});

test("renderStarter is a body fragment on the project's own kit and tokens", () => {
  const builtin = renderStarter(
    { kit: "builtin", cssVars: ":root{--radius:0.5rem;--primary:#0af}" },
    ["tabler", "lucide", "mage"],
  );
  // the html contract: a fragment, never a document
  assert.ok(!builtin.includes("<!doctype"));
  assert.ok(!/<html|<body/i.test(builtin));
  assert.match(builtin, /kit: builtin · icons: tabler, lucide, mage/);
  assert.match(builtin, /<button class="btn btn-primary"><i icon="lucide:check"><\/i> Action/);
  assert.match(builtin, /var\(--primary\) = #0af/);
  assert.match(builtin, /never a hardcoded/);

  const tailwind = renderStarter({ kit: "tailwind", cssVars: "" });
  assert.match(tailwind, /kit: tailwind · icons: lucide, mage/);
  assert.ok(!tailwind.includes("<use href="), "the sprite form is gone");
  assert.match(tailwind, /bg-card .*text-card-foreground/, "the repo's own theme classes");
  assert.match(tailwind, /bg-primary .*text-primary-foreground/);
  assert.ok(!tailwind.includes("[var("), "no arbitrary values");
  assert.ok(!tailwind.includes("tokens imported from this repo"));

  const basecoat = renderStarter({ kit: "basecoat", cssVars: "" });
  assert.match(basecoat, /<button class="btn" data-variant="ghost">Cancel/);
  assert.ok(!basecoat.includes("btn-primary"), "1.x has no variant classes");
});

const DESIGN_MD = `---
version: alpha
name: Heritage
colors:
  primary: "#1A1C1E"
  tertiary: '#B8422E'
  on-tertiary: "#FFFFFF"  # text on clay
  neutral: #F7F5F2
typography:
  h1:
    fontFamily: Public Sans
    fontSize: 3rem
rounded:
  sm: 4px
spacing:
  md: 16px
components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.sm}"
    padding: 12px
omitted:
  - Elevation
---

## Overview

Architectural minimalism.

## Do's and Don'ts

- Do use Boston Clay only for the primary action.
- Don't stack cards.

## Appendix

Not part of the rules.
`;

test("readDesignFiles reads DESIGN.md front matter, references and Do's and Don'ts", async () => {
  const cwd = repo({ "DESIGN.md": DESIGN_MD });
  const md = (await detectDesign(cwd)).designFiles.designMd;
  assert.equal(md.name, "Heritage");
  assert.deepEqual(md.colors, {
    primary: "#1A1C1E",
    tertiary: "#B8422E",
    "on-tertiary": "#FFFFFF",
    neutral: "#F7F5F2",
  });
  assert.deepEqual(md.typography, { h1: { fontFamily: "Public Sans", fontSize: "3rem" } });
  assert.deepEqual(md.rounded, { sm: "4px" });
  assert.deepEqual(md.spacing, { md: "16px" });
  assert.deepEqual(md.components["button-primary"], {
    backgroundColor: "#B8422E",
    textColor: "#FFFFFF",
    rounded: "4px",
    padding: "12px",
  });
  assert.deepEqual(md.headings, ["Overview", "Do's and Don'ts", "Appendix"]);
  assert.equal(md.dos, "- Do use Boston Clay only for the primary action.\n- Don't stack cards.");
});

test("readDesignMd never throws on a malformed file", () => {
  for (const text of [
    "",
    "---\n",
    "---\ncolors: [unclosed\n  : :\n\t- x\n---\n## Do's & Don'ts\n- keep",
    '---\ncolors:\n  primary: "{colors.primary}"\n  loop: "{colors.loop}"\n---\n',
    "no front matter\n## Colors\n",
    "\u0000\u0001---",
  ]) {
    const md = readDesignMd(text);
    assert.ok(md && typeof md === "object", JSON.stringify(text));
  }
  assert.equal(readDesignMd("---\ncolors: [x\n---\n## Do's & Don'ts\n- keep").dos, "- keep");
  assert.deepEqual(readDesignMd("no front matter\n## Colors\n").colors, {});
});

test("readDesignFiles flattens DTCG tokens and resolves aliases one level", async () => {
  const cwd = repo({
    "tokens/base.tokens.json": JSON.stringify({
      color: {
        $type: "color",
        blue: { 500: { $value: "#2563eb" } },
        brand: { $value: { colorSpace: "srgb", components: [1, 0, 0], hex: "#ff0000" } },
        primary: { $value: "{color.blue.500}" },
        accent: { $value: { $ref: "#/color/primary/$value" } },
      },
      radius: { md: { $type: "dimension", $value: { value: 8, unit: "px" } } },
      font: { sans: { $type: "fontFamily", $value: ["Inter", "sans-serif"] } },
      shadow: { sm: { $type: "shadow", $value: { blur: "2px" } } },
    }),
    "design-tokens.json": JSON.stringify({ space: { 1: { $type: "number", $value: 4 } } }),
    "node_modules/x/tokens.json": JSON.stringify({ skipped: { $type: "number", $value: 1 } }),
    "broken.tokens.json": "{ not json",
  });
  const tokens = (await detectDesign(cwd)).designFiles.tokens;
  assert.deepEqual(tokens.values, {
    "space.1": "4",
    "color.blue.500": "#2563eb",
    "color.brand": "#ff0000",
    "color.primary": "#2563eb",
    "color.accent": "{color.blue.500}",
    "radius.md": "8px",
    "font.sans": "Inter, sans-serif",
  });
  assert.equal(tokens.count, 7);
  assert.equal(tokens.cssVars, false, "a DTCG file alone declares no CSS vars");

  const emitted = repo({
    "tokens.json": JSON.stringify({ color: { primary: { $type: "color", $value: "#123" } } }),
    "src/index.css": ":root { --color-primary: #123; }",
  });
  assert.equal((await detectDesign(emitted)).designFiles.tokens.cssVars, true);
});

test("readDesignFiles caps tokens at 400 and keeps the count", async () => {
  const many = Object.fromEntries(
    Array.from({ length: 450 }, (_, i) => [`t${i}`, { $type: "number", $value: i }]),
  );
  const cwd = repo({ "tokens.json": JSON.stringify({ n: many }) });
  const tokens = (await detectDesign(cwd)).designFiles.tokens;
  assert.equal(tokens.count, 450);
  assert.equal(Object.keys(tokens.values).length, 400);
});

test("readDesignFiles lists shadcn components through the tsconfig @/ alias", async () => {
  const cwd = repo({
    "components.json": JSON.stringify({
      style: "new-york",
      tailwind: { css: "app/globals.css", baseColor: "zinc" },
      iconLibrary: "tabler",
      aliases: { components: "@/components", ui: "@/components/ui" },
    }),
    "tsconfig.json": `{
      // JSONC, as tsc writes it
      "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./web/*"], }, },
    }`,
    "web/components/ui/button.tsx": "",
    "web/components/ui/card.tsx": "",
    "web/components/ui/index.ts": "",
    "web/components/ui/sidebar/index.tsx": "",
  });
  const design = await detectDesign(cwd);
  assert.deepEqual(design.designFiles.shadcn, {
    style: "new-york",
    baseColor: "zinc",
    iconLibrary: "tabler",
    components: ["button", "card", "sidebar"],
  });
  assert.equal(design.designFiles.designMd, undefined);
  assert.equal(design.designFiles.tokens, undefined);

  const fallback = repo({
    "components.json": JSON.stringify({ aliases: { ui: "@/components/ui" } }),
    "src/components/ui/dialog.tsx": "",
  });
  assert.deepEqual((await detectDesign(fallback)).designFiles.shadcn.components, ["dialog"]);
  assert.equal((await detectDesign(repo({}))).designFiles, null);
});
