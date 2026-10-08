import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { GUIDE_TOPICS, iconsLine, renderBriefGuide } from "../server/designGuide.ts";
import { themeById } from "../server/themes.ts";
import type { DesignSettings } from "../server/types.ts";

// The brief is regenerated from the project's STORED design, so what an agent
// is told about is what is actually injected into its frames. These tests pin
// that link, not the prose.

const theme = themeById(null);

const design = (over: Partial<DesignSettings> = {}): DesignSettings => ({
  detected: null,
  palette: null,
  kit: "none",
  cssVars: "",
  tailwindCss: "",
  strippedImports: [],
  iconSets: [],
  projectKits: [],
  updatedAt: "2026-09-15T00:00:00.000Z",
  ...over,
});

test("a project that never ran init gets the generic brief", () => {
  const brief = renderBriefGuide(null);
  assert.match(brief, /No design system imported yet\. Run `mockpit init`/);
  assert.match(brief, /the workspace theme/);
  assert.match(brief, /Kit: none/);
  assert.match(brief, /<i icon="lucide:check"><\/i>/);
  assert.match(brief, /Sets: lucide, mage\./, "the bundled sets are always named");
  // the workflow is always present: it is what the brief exists to teach
  assert.match(brief, /mockpit publish --mock writer/);
  assert.match(brief, /mockpit wait/);
});

test("the brief reports what init detected", () => {
  const brief = renderBriefGuide(
    design({ detected: { tailwind: true, shadcn: true, cssVars: 24, fonts: ["Inter", "Mono"] } }),
  );
  assert.match(
    brief,
    /Imported from this repo: tailwind · shadcn · 24 tokens · fonts: Inter, Mono/,
  );

  const nothing = renderBriefGuide(
    design({ detected: { tailwind: false, shadcn: false, cssVars: 0, fonts: [] } }),
  );
  assert.match(nothing, /Imported from this repo: nothing detectable/);
});

test("the palette table carries the project's real values", () => {
  const brief = renderBriefGuide(design({ palette: { light: theme.light, dark: theme.dark } }));
  assert.ok(brief.includes(`| surface | \`${theme.light.surface}\``));
  assert.ok(brief.includes(`| accent | \`${theme.light.info.text}\``));
  assert.ok(brief.includes("`--color-text-danger`"));
});

test("each kit mode documents the vocabulary that mode actually injects", () => {
  const tailwind = renderBriefGuide(
    design({
      kit: "tailwind",
      tailwindCss: '@import "tailwindcss";',
      strippedImports: ["tw-animate-css"],
    }),
  );
  assert.match(tailwind, /Kit: tailwind/);
  assert.match(tailwind, /`bg-card`/, "the repo's theme classes are written as in the repo");
  assert.match(tailwind, /not available: `tw-animate-css`/);
  assert.ok(!/bg-\[var/.test(tailwind), "no arbitrary-value detour");

  const noTheme = renderBriefGuide(design({ kit: "tailwind" }));
  assert.match(noTheme, /theme did not import/);
  assert.ok(!noTheme.includes("`bg-card`"), "theme classes are not promised without a theme");

  const builtin = renderBriefGuide(design({ kit: "builtin" }));
  assert.match(builtin, /Kit: builtin/);
  assert.match(builtin, /\.btn-primary/);

  const none = renderBriefGuide(design({ kit: "none" }));
  assert.match(none, /kits: \[\.\.\.\]/, "the opt-in kits are named instead");
});

test("injected css vars and installed icon sets are announced", () => {
  const brief = renderBriefGuide(
    design({
      cssVars: ":root{--radius:0.5rem}",
      iconSets: [{ prefix: "tabler", assetId: "asset1", count: 5000 }],
    }),
  );
  assert.match(brief, /own `:root` block is injected/);
  assert.match(brief, /Sets: tabler, lucide, mage\./);
  assert.match(brief, /mockpit icons add <prefix>/);
});

// The brief is the one document an agent reads before its first publish; the
// point of it is that it stays small. ~1.5k tokens is the ceiling.
test("the brief fits in 6,000 characters for every kit, with a palette", () => {
  for (const kit of ["builtin", "tailwind", "none"] as const) {
    const brief = renderBriefGuide(
      design({
        kit,
        palette: { light: theme.light, dark: theme.dark },
        detected: { tailwind: true, shadcn: true, cssVars: 24, fonts: ["Inter", "Mono"] },
        cssVars: ":root{--radius:0.5rem}",
        tailwindCss: '@import "tailwindcss";',
        strippedImports: ["tw-animate-css", "shadcn/tailwind.css"],
        iconSets: [{ prefix: "tabler", assetId: "asset1", count: 5000 }],
      }),
    );
    assert.ok(brief.length <= 6000, `${kit} brief is ${brief.length} characters`);
  }
});

test("the brief covers the loop, the reply and the trust rule", () => {
  const brief = renderBriefGuide(null);
  for (const needle of [
    "data-part",
    "Two renders needed to show a choice",
    "userFeedback",
    "mockpit watch",
    "mockpit wait --timeout 1",
    "exactly once",
    "decision",
    "body fragment",
    "Never hardcode a color",
    "cdnjs.cloudflare.com",
    ".mockpit/starter.html",
    "never override system",
  ]) {
    assert.ok(brief.includes(needle), needle);
  }
});

test("the brief lists every topic, and each topic ships as guide/topics/<id>.md", () => {
  const brief = renderBriefGuide(null);
  for (const id of GUIDE_TOPICS) {
    assert.match(brief, new RegExp(`^- ${id}: `, "m"));
    const body = readFileSync(new URL(`../guide/topics/${id}.md`, import.meta.url), "utf8");
    assert.match(body, new RegExp(`^# mockpit topic: ${id}\n`));
  }
});

test("the icons line names the syntax and the bundled sets even before init", () => {
  assert.match(iconsLine(design()), /^Icons: `<i icon="lucide:check"><\/i>`/);
  assert.match(iconsLine(null), /Sets: lucide, mage\./);
});
