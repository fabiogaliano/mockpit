import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.ts";
import { GUIDE_TOPICS, iconsLine, renderBriefGuide } from "../server/designGuide.ts";
import { SqlStore } from "../server/sqlStore.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
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

// A typical shadcn install: 34 components.
const SHADCN_UI = `accordion alert alert-dialog aspect-ratio avatar badge breadcrumb button
  calendar card carousel chart checkbox collapsible command context-menu dialog drawer
  dropdown-menu form hover-card input input-otp label menubar navigation-menu pagination
  popover progress radio-group resizable scroll-area select separator sheet`.split(/\s+/);

const allFiles = (over: { cssVars?: boolean; iconLibrary?: string } = {}): DesignSettings =>
  design({
    designFiles: {
      designMd: {
        name: "Heritage",
        colors: { primary: "#1A1C1E", secondary: "#6C7278", tertiary: "#B8422E" },
        typography: { h1: { fontFamily: "Public Sans" }, label: { fontFamily: "Space Grotesk" } },
        rounded: { sm: "4px", md: "8px" },
        spacing: { sm: "8px" },
        components: { "button-primary": { backgroundColor: "#B8422E" } },
        headings: ["Overview", "Colors", "Do's and Don'ts"],
        dos: `- Do use Boston Clay only for the primary action.\n\n${"- Don't stack cards. ".repeat(80)}`,
      },
      tokens: {
        files: ["tokens/base.tokens.json"],
        count: 212,
        cssVars: over.cssVars ?? false,
        values: {
          "space.1": "4px",
          "color.primary.hover": "#123",
          "color.primary": "#1A1C1E",
          "color.background": "#F7F5F2",
          "color.foreground": "#1A1C1E",
          "color.border": "#E3E0DA",
          "radius.md": "8px",
          "font.family.sans": "Public Sans",
          "space.2": "8px",
        },
      },
      shadcn: {
        style: "new-york",
        baseColor: "neutral",
        iconLibrary: over.iconLibrary ?? "lucide",
        components: SHADCN_UI,
      },
    },
  });

test("the repo's design files follow the palette: DESIGN.md, tokens, shadcn", () => {
  const brief = renderBriefGuide(allFiles());
  const section = brief.slice(brief.indexOf("Repo design files"), brief.indexOf("Kit:"));
  assert.ok(brief.indexOf("This project's palette") < brief.indexOf("Repo design files"));
  assert.match(section, /DESIGN\.md "Heritage": colors primary #1A1C1E, secondary #6C7278/);
  assert.match(section, /fonts Public Sans, Space Grotesk/);
  assert.match(section, /Do's and Don'ts:\n- Do use Boston Clay/);
  assert.ok(!section.includes("\n\n- Don't"), "blank lines in the repo's prose are folded");
  // The DTCG file is not CSS, so the brief must not promise var(--…).
  assert.match(section, /212 tokens, token names \(not CSS vars\)/);
  assert.match(section, /`color\.primary` #1A1C1E/);
  assert.ok(!section.includes("color.primary.hover"), "the shortest matching name wins");
  assert.match(section, /shadcn new-york, base neutral, icons lucide: accordion, alert,/);
  assert.doesNotMatch(section, /icons add lucide/, "lucide is bundled");

  const vars = renderBriefGuide(allFiles({ cssVars: true }));
  assert.match(vars, /`--color-primary` #1A1C1E/);
  assert.match(vars, /the rest resolve as CSS custom properties with the same names/);

  const tabler = renderBriefGuide(allFiles({ iconLibrary: "tabler" }));
  assert.match(tabler, /icons tabler \(`mockpit icons add tabler`\)/);
  const installed = renderBriefGuide({
    ...allFiles({ iconLibrary: "tabler" }),
    iconSets: [{ prefix: "tabler", assetId: "a", count: 1 }],
  });
  assert.doesNotMatch(installed, /mockpit icons add tabler`\)/);

  assert.ok(!renderBriefGuide(design()).includes("Repo design files"));
});

test("the brief fits in 6,000 characters with all three design files present", () => {
  for (const kit of ["builtin", "tailwind", "none"] as const) {
    const brief = renderBriefGuide({
      ...allFiles(),
      kit,
      palette: { light: theme.light, dark: theme.dark },
      detected: { tailwind: true, shadcn: true, cssVars: 24, fonts: ["Inter", "Mono"] },
      cssVars: ":root{--radius:0.5rem}",
      tailwindCss: '@import "tailwindcss";',
      strippedImports: ["tw-animate-css", "shadcn/tailwind.css"],
      iconSets: [{ prefix: "tabler", assetId: "asset1", count: 5000 }],
    });
    assert.ok(brief.length <= 6000, `${kit} brief is ${brief.length} characters`);
  }
});

test("the design PUT stores clean design files for the brief and refuses past 32k", async () => {
  const app = createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html><head></head><body>viewer</body></html>",
    setupText: "# setup",
  });
  const put = (designFiles: unknown) =>
    app.request("/api/projects/demo/design", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kit: "builtin", designFiles }),
    });

  const ok = await put({
    shadcn: {
      style: "new-york",
      baseColor: 7,
      iconLibrary: "lucide",
      components: ["button", 3, "card", ...Array(200).fill("x")],
      extra: "dropped",
    },
    tokens: { files: ["tokens.json"], count: "2", cssVars: "yes", values: { a: "1", b: {} } },
  });
  assert.equal(ok.status, 200);
  const stored = ((await ok.json()) as DesignSettings).designFiles;
  assert.equal(stored?.shadcn?.baseColor, "");
  assert.equal(stored?.shadcn?.components.length, 80);
  assert.deepEqual(stored?.shadcn?.components.slice(0, 2), ["button", "card"]);
  assert.deepEqual(stored?.tokens, {
    files: ["tokens.json"],
    count: 2,
    cssVars: false,
    values: { a: "1" },
  });
  const brief = await (await app.request("/agent-howto?project=demo")).text();
  assert.match(brief, /shadcn new-york, icons lucide: button, card/);

  const values = Object.fromEntries(
    Array.from({ length: 400 }, (_, i) => [`token.${i}.${"n".repeat(60)}`, "v".repeat(100)]),
  );
  const big = await put({ tokens: { files: [], count: 400, cssVars: false, values } });
  assert.equal(big.status, 400);
  assert.match(((await big.json()) as { error: string }).error, /at most 32000/);

  assert.equal((await put("nope")).status, 400);
  const cleared = await put(undefined);
  assert.equal(((await cleared.json()) as DesignSettings).designFiles, null);
});
