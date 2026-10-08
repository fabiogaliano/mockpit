import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBriefGuide } from "../server/designGuide.ts";
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
  iconsAssetId: null,
  updatedAt: "2026-09-15T00:00:00.000Z",
  ...over,
});

test("a project that never ran init gets the generic brief", () => {
  const brief = renderBriefGuide(null);
  assert.match(brief, /No design system imported yet — run `mockpit init`/);
  assert.match(brief, /using the workspace theme/);
  assert.match(brief, /Kit: none/);
  assert.match(brief, /Icons: none configured/);
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
  const tailwind = renderBriefGuide(design({ kit: "tailwind" }));
  assert.match(tailwind, /Kit: tailwind/);
  assert.match(tailwind, /bg-\[var\(--card\)\]/, "tokens are reached through arbitrary values");

  const builtin = renderBriefGuide(design({ kit: "builtin" }));
  assert.match(builtin, /Kit: builtin/);
  assert.match(builtin, /\.btn-primary/);

  const none = renderBriefGuide(design({ kit: "none" }));
  assert.match(none, /kits: \[\.\.\.\]/, "the opt-in kits are named instead");
});

test("injected css vars and an uploaded sprite are announced", () => {
  const brief = renderBriefGuide(
    design({ cssVars: ":root{--radius:0.5rem}", iconsAssetId: "asset1" }),
  );
  assert.match(brief, /injected verbatim/);
  assert.match(brief, /mage sprite is loaded in every frame/);
});
