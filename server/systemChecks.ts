// What mockpit checks against a project's system, by string: on a `system`
// write (the system against itself) and on a publish (a page against the
// system). Pure and runtime-agnostic. Every check comes back as a nudge line,
// one per kind, with a count and the first instances; none blocks a write.

import { contrastRatio } from "./contrast.ts";
import {
  declaredNames,
  isColorValue,
  type Scale,
  scaleSteps,
  type System,
  TEXT_FIELDS,
} from "./system.ts";

const FIRST = 3;
const firstOf = (items: string[]) =>
  `${items.slice(0, FIRST).join(", ")}${items.length > FIRST ? `, +${items.length - FIRST} more` : ""}`;

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// `var(--x)` names a stylesheet reads.
function varsRead(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripComments(css).matchAll(/var\(\s*--([\w-]+)/g)) out.add(m[1]);
  return out;
}

// Custom properties a stylesheet declares.
function varsDeclared(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripComments(css).matchAll(/(?:^|[{;\s])--([\w-]+)\s*:/g)) out.add(m[1]);
  return out;
}

// Class selectors a stylesheet defines rules for.
export function classesDefined(css: string): Set<string> {
  const out = new Set<string>();
  const bare = stripComments(css).replace(/\{[^{}]*\}/g, "{}");
  for (const m of bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  return out;
}

// Top-level `selector{declarations}` rules, by normalized selector and body.
function flatRules(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const norm = (x: string) =>
    x
      .replace(/\s+/g, " ")
      .replace(/\s*([{};:,>])\s*/g, "$1")
      .trim();
  for (const m of stripComments(css).matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    out.set(norm(m[1]), norm(m[2]).replace(/;$/, ""));
  }
  return out;
}

// --- the system against itself -------------------------------------------------------

export interface PairResult {
  palette: string;
  mode: "light" | "dark";
  fg: string;
  bg: string;
  min: number;
  ratio: number | null;
}

// Every declared pair in every palette and mode. A value contrast.ts can't
// resolve is null: unchecked, never passed.
// Hidden palettes are left out unless `all`: the System page shows every palette's.
export function pairResults(system: System, all = false): PairResult[] {
  const constants = new Map(
    system.tokens
      .filter((t) => t.type === "color" && typeof t.value === "string")
      .map((t) => [t.name, t.value as string]),
  );
  const out: PairResult[] = [];
  const palettes = system.color.palettes.filter((p) => all || p.status !== "hidden");
  for (const p of palettes.length ? palettes : [null]) {
    for (const mode of ["light", "dark"] as const) {
      const value = (name: string) => p?.[mode][name] ?? constants.get(name);
      for (const [fg, bg, min] of system.color.pairs) {
        const f = value(fg);
        const b = value(bg);
        out.push({
          palette: p?.id ?? "",
          mode,
          fg,
          bg,
          min,
          ratio: f && b ? contrastRatio(f, b) : null,
        });
      }
    }
  }
  return out;
}

export function systemChecks(system: System): string[] {
  const out: string[] = [];
  const known = declaredNames(system);
  const roleNames = system.color.roles.map((r) => r.name);

  const results = pairResults(system);
  const failing = results.filter((r) => r.ratio !== null && r.ratio < r.min);
  if (failing.length)
    out.push(
      `contrast: ${failing.length} pair${failing.length === 1 ? "" : "s"} below their minimum: ${firstOf(
        failing.map(
          (r) =>
            `${r.fg} on ${r.bg} ${r.ratio!.toFixed(2)}:1 < ${r.min} (${r.palette || "tokens"} ${r.mode})`,
        ),
      )}`,
    );
  const unchecked = results.filter((r) => r.ratio === null);
  if (unchecked.length)
    out.push(
      `contrast: ${unchecked.length} pair${unchecked.length === 1 ? "" : "s"} unchecked (a value that isn't hex, rgb, hsl, oklch or oklab, or a missing one): ${firstOf(
        unchecked.map((r) => `${r.fg} on ${r.bg} (${r.palette || "tokens"} ${r.mode})`),
      )}`,
    );

  const missing: string[] = [];
  for (const p of system.color.palettes) {
    for (const mode of ["light", "dark"] as const) {
      const lacks = roleNames.filter((r) => p[mode][r] === undefined);
      if (lacks.length)
        missing.push(
          `${p.id} ${mode} lacks ${lacks.slice(0, 4).join(", ")}${lacks.length > 4 ? "…" : ""}`,
        );
    }
  }
  if (missing.length) out.push(`palettes missing a role: ${firstOf(missing)}`);
  const strangers = system.color.palettes.flatMap((p) =>
    Object.keys(p.light)
      .filter((k) => !roleNames.includes(k))
      .map((k) => `${p.id}.${k}`),
  );
  if (strangers.length && roleNames.length)
    out.push(`palette values for no declared role: ${firstOf(strangers)} (declare them in roles)`);
  const unknownPairs = system.color.pairs
    .flatMap(([fg, bg]) => [fg, bg])
    .filter((n) => !known.has(n));
  if (unknownPairs.length)
    out.push(`pairs name unknown tokens: ${firstOf([...new Set(unknownPairs)])}`);
  for (const [token, role] of Object.entries(system.color.as ?? {})) {
    if (!known.has(role)) out.push(`as.${token} points at "${role}", which nothing declares`);
  }

  const sheet = system.sheet?.css ?? "";
  if (sheet) {
    const own = varsDeclared(sheet);
    const undeclared = [...varsRead(sheet)].filter(
      (v) =>
        !known.has(v) &&
        !own.has(v) &&
        !v.startsWith("k-") &&
        !TEXT_FIELDS.some((f) => v.endsWith(`-${f}`) && known.has(v.slice(0, -f.length - 1))),
    );
    if (undeclared.length)
      out.push(
        `sheet reads var(--…) that neither the system nor the sheet declares (fine if every page sets them): ${firstOf(undeclared.map((v) => `--${v}`))}`,
      );
    const defined = classesDefined(sheet);
    const missingClasses = (system.sheet?.classes ?? [])
      .map((c) => c.name)
      .filter((c) => !defined.has(c));
    if (missingClasses.length)
      out.push(
        `indexed classes the sheet doesn't define: ${firstOf(missingClasses.map((c) => `.${c}`))}`,
      );
    const important = (stripComments(sheet).match(/!important/g) ?? []).length;
    if (important)
      out.push(
        `sheet uses !important ${important}×: inside a layer it beats every page rule, the opposite of what it does elsewhere`,
      );
  }

  for (const scale of system.scales) {
    const fails = zoomFailures(scale);
    if (fails.length)
      out.push(
        `scale ${scale.id} fails 200% zoom (WCAG 1.4.4): ${firstOf(fails)}; keep each step's largest size within 2.5× its smallest`,
      );
  }
  return out;
}

// A fluid step whose largest size is past 2.5× its smallest can't reach 200%
// at every width with browser zoom: the vw part doesn't grow with it.
export function zoomFailures(scale: Scale): string[] {
  if (scale.family !== "type" || !scale.fluid) return [];
  return scaleSteps(scale)
    .filter(({ min, max }) => Math.max(min, max) > 2.5 * Math.min(min, max))
    .map(({ step, min, max }) => `${step} ${min}px → ${max}px`);
}

// --- a page against the system ----------------------------------------------------------

const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)/g;
const STYLE_BLOCK_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTR_RE = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;

// The CSS a page carries: its style blocks and style attributes.
function pageCss(html: string): { blocks: string; inline: string } {
  const blocks = [...html.matchAll(STYLE_BLOCK_RE)].map((m) => m[1]).join("\n");
  const inline = [...html.matchAll(STYLE_ATTR_RE)].map((m) => m[2] ?? m[3] ?? "").join(";\n");
  return { blocks, inline };
}

const pxOf = (v: string): number | null => {
  const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(v.trim());
  if (!m) return null;
  return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
};

export function pageChecks(system: System, htmls: string[], what = "page"): string[] {
  const out: string[] = [];
  const css = htmls.map(pageCss);
  const all = css.map((c) => `${c.blocks}\n${c.inline}`).join("\n");
  if (!all.trim()) return out;
  const bare = stripComments(all);

  const hasColour =
    system.color.palettes.length > 0 || system.tokens.some((t) => t.type === "color");
  if (hasColour) {
    const literals = [...bare.replace(/--[\w-]+\s*:[^;}]*/g, "").matchAll(COLOR_LITERAL_RE)]
      .map((m) => m[0])
      .filter((v) => isColorValue(v));
    if (literals.length)
      out.push(
        `${what} has ${literals.length} colour literal${literals.length === 1 ? "" : "s"} where the system has colours: ${firstOf([...new Set(literals)])}; use a role or token`,
      );
  }

  const own = new Set([
    ...system.tokens.filter((t) => t.owner !== "repo").map((t) => t.name),
    ...system.color.roles.map((r) => r.name),
  ]);
  const redeclared = [...varsDeclared(bare)].filter((v) => own.has(v));
  if (redeclared.length)
    out.push(
      `${what} redeclares system names: ${firstOf(redeclared.map((v) => `--${v}`))}; change them in the system`,
    );

  // A rule copied from the sheet, same selector and same body, is the inlined
  // kit habit; a page restyling a sheet class is an override, which is fine.
  const sheetRules = flatRules(system.sheet?.css ?? "");
  if (sheetRules.size) {
    const copied = [...flatRules(css.map((c) => c.blocks).join("\n"))].filter(
      ([selector, body]) => sheetRules.get(selector) === body,
    );
    if (copied.length)
      out.push(
        `${what} copies ${copied.length} rule${copied.length === 1 ? "" : "s"} the system sheet already has: ${firstOf(copied.map(([sel]) => sel))}; the sheet is in every frame, so drop the copy`,
      );
  }

  const typeScale = system.scales.filter((s) => s.family === "type");
  const spaceScale = system.scales.filter((s) => s.family === "space");
  const sizes = (scales: Scale[]) =>
    scales.flatMap((s) => scaleSteps(s).flatMap(({ min, max }) => [min, max]));
  // A plain dimension token is a size the system declares too.
  const dimensions = system.tokens.flatMap((t) =>
    t.type === "dimension" && !t.scale && typeof t.value === "string"
      ? [pxOf(t.value)].filter((x): x is number => x !== null)
      : [],
  );
  const offScale = (prop: RegExp, scales: Scale[], label: string, extra: number[] = []) => {
    if (!scales.length) return;
    const allowed = [...sizes(scales), ...extra];
    const off: string[] = [];
    for (const m of bare.matchAll(prop)) {
      for (const part of m[1].trim().split(/\s+/)) {
        const px = pxOf(part);
        if (px === null || px === 0) continue;
        // A negative margin pulls by a step of the scale.
        if (!allowed.some((a) => Math.abs(a - Math.abs(px)) < 0.6)) off.push(part);
      }
    }
    if (off.length)
      out.push(
        `${what} has ${off.length} ${label} value${off.length === 1 ? "" : "s"} off the ${scales.map((s) => s.id).join("/")} scale: ${firstOf([...new Set(off)])}; use var(--${scales[0].prefix}-…)`,
      );
  };
  offScale(/font-size\s*:\s*([^;}"']+)/gi, typeScale, "font-size");
  offScale(
    /(?:^|[;{\s])(?:gap|row-gap|column-gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\s*:\s*([^;}"']+)/gi,
    spaceScale,
    "spacing",
    dimensions,
  );
  return out;
}

// A component's spec should open with one line saying what it is for: the brief's
// component index prints that line.
export function purposeNudge(slug: string, purpose: string | null | undefined): string | null {
  const first = (purpose ?? "").split("\n")[0].trim();
  if (first && first.length <= 100) return null;
  return `give ${slug} a one-line purpose as the first line of what it is for (\`edit --purpose\`); the brief lists it${first ? ` (now ${first.length} characters, at most 100)` : ""}`;
}
