// The project-aware brief: what `mockpit guide --brief` and MCP
// `get_design_guide` return. It exists because the generic guide is a document
// an agent reads once and then paraphrases badly; this one is regenerated from
// the project's STORED design settings, so the palette values, the kit, and the
// icon set an agent is told about are the ones actually injected into its
// frames. Budget is ~900 tokens — anything that isn't project-specific belongs
// in guide/*.md, and craft guidance belongs in the skills it points at.
//
// Runtime-agnostic (no node imports): served from app.ts on the Worker too.

import { BUNDLED_ICON_PREFIXES } from "./icons.ts";
import { KITS } from "./kits.ts";
import type { Palette } from "./themes.ts";
import type { DesignSettings } from "./types.ts";

const KIT_CLASSES = new Map(KITS.map((k) => [k.id, k.classes]));

// Only the rows an agent actually composes with; the full Palette has more.
const paletteRows = (p: Palette): string =>
  [
    `| surface | \`${p.surface}\` | \`--color-background-primary\` |`,
    `| panel | \`${p.panel}\` | \`--color-background-secondary\` |`,
    `| text | \`${p.text}\` | \`--color-text-primary\` |`,
    `| muted | \`${p.muted}\` | \`--color-text-secondary\` |`,
    `| border | \`${p.border}\` | \`--color-border-secondary\` |`,
    `| accent | \`${p.info.text}\` | \`--color-text-info\` |`,
    `| danger | \`${p.danger.text}\` | \`--color-text-danger\` |`,
  ].join("\n");

function kitSection(design: DesignSettings | null): string {
  if (design?.kit === "tailwind") {
    return [
      "**Kit: tailwind.** The sandbox loads the Tailwind browser build, so write",
      "utility classes exactly as you would in the repo. The repo's compiled theme",
      "is NOT loaded — only its custom properties — so reach tokens through",
      "arbitrary values: `bg-[var(--card)]`, not `bg-card`.",
    ].join("\n");
  }
  if (design?.kit === "builtin") {
    return [
      "**Kit: builtin** (CSS only, shadcn-shaped class names, no build step):",
      "",
      `\`${KIT_CLASSES.get("builtin") ?? ""}\` — plus \`.btn-primary\`/\`.btn-ghost\`/\`.btn-destructive\`,`,
      "`.card-header`/`.card-title`/`.card-desc`/`.card-footer`, `.badge-secondary`/`.badge-outline`,",
      "`.tabs-list`/`.tab.on`/`.tab-panel.on`, `.dialog-header`/`.dialog-footer`, `.field`/`.label`.",
      "Every class is driven by the tokens above, so it re-themes for free.",
    ].join("\n");
  }
  return [
    "**Kit: none.** No component vocabulary is injected — style from the",
    "`--color-*` tokens above. Opt a surface into a bundled kit with",
    `\`kits: [...]\`: ${KITS.map((k) => `\`${k.id}\``).join(", ")}.`,
  ].join("\n");
}

function detectedLine(design: DesignSettings | null): string {
  const d = design?.detected;
  if (!d) return "No design system imported yet — run `mockpit init` in the repo.";
  const bits = [
    d.tailwind ? "tailwind" : null,
    d.shadcn ? "shadcn" : null,
    d.cssVars ? `${d.cssVars} tokens` : null,
    d.fonts.length ? `fonts: ${d.fonts.join(", ")}` : null,
  ].filter(Boolean);
  return `Imported from this repo: ${bits.length ? bits.join(" · ") : "nothing detectable"}.`;
}

/**
 * The compact, project-aware design brief. `design` is the stored
 * `design:<project>` settings, or null for a project that never ran
 * `mockpit init`.
 */
export function renderBriefGuide(design: DesignSettings | null): string {
  const palette = design?.palette?.light ?? null;
  const iconSets = [
    ...new Set([...(design?.iconSets ?? []).map((s) => s.prefix), ...BUNDLED_ICON_PREFIXES]),
  ];
  const icons = `Icons: \`<i icon="lucide:check"></i>\` becomes an inline svg, 1em, in currentColor; its other attributes are kept. Sets: ${iconSets.join(", ")}. Add any Iconify set with \`mockpit icons add <prefix>\` (tabler, ph, heroicons, …).`;

  return `# mockpit — design brief

${detectedLine(design)}

## Workflow

A **mock** is a component or a page. It has **states** (moments of it, named in
the user's words: "Writing", "Lab open"), each state has **variants** (parallel
designs), and each variant has numbered **versions**. Address mocks by slug.

\`\`\`sh
mockpit publish --mock writer --state "Writing" --variant quiet --html writing.html
mockpit publish --mock writer --state "Writing" --variant dark  --html writing-dark.html
mockpit ask     --mock writer "Which look?" --option Quiet=quiet --option Dark=dark
mockpit wait                                          # blocks; returns the user's one batched reply
mockpit revise  --mock writer --state "Writing" --variant dark --html v2.html
mockpit export  --mock writer
\`\`\`

Mark the parts you want feedback on: \`data-part="body"\` (optional
\`data-part-label\`, and \`data-part-key\` to keep identity across a rename). The
same name in two states is the same part. Two renders needed to show a choice →
publish variants and \`ask\`; one render plus a control → declare a knob
(\`--knobs '{"body.size":[17,14,22,1]}'\`, tunekit's shape), read in CSS as
\`var(--k-body-size)\`.

\`wait\` returns \`{mock, reply: {answers, mix, tuned, comments, text}, comments,
accepted, archived}\`: answers pick structure, \`tuned\` are knob values to write
back into source, \`mix\` takes a part from another variant, \`comments\` are
anchored on parts. Never re-publish a near-duplicate, always \`revise\`.

## HTML contract

1. Send a **body fragment** — no \`<!doctype>\`/\`<html>\`/\`<head>\`/\`<body>\`; the server wraps it in a themed, sandboxed iframe.
2. **Keep content in normal flow** — never \`position: fixed\`, never absolute layers over a fixed height; the frame measures the document box to size itself. Grid-stack (\`grid-area: 1/1\`) to overlap.
3. **Never hardcode a color.** Drive every color from the tokens below so light and dark both work. \`<style>\`/\`<script>\` are allowed; external loads only from the CDN allowlist.

## This project's palette

| role | value | token |
| --- | --- | --- |
${palette ? paletteRows(palette) : "| — | using the workspace theme | `--color-*` |"}

${design?.cssVars ? "The repo's own `:root` block is injected verbatim too, so `var(--radius)`, `var(--primary)` and friends resolve inside the frame." : ""}

## Kit

${kitSection(design ?? null)}

${icons}

## Starter

\`.mockpit/starter.html\` in the repo is a working fragment on this exact kit,
these tokens, and an icon. Copy it rather than starting from a blank file.

## Craft

For how the thing should LOOK and BEHAVE, use your own design skills —
\`frontend-design.md\` and \`web-interface-guidelines.md\`. This brief deliberately
does not restate them.
`;
}
