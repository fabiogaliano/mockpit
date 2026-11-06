// The project's system: a shared stylesheet, typed tokens, scales, palettes,
// project knobs and checks. Every render in the project wears it, the brief
// indexes it, and every write is checked against it. This module owns the
// model, its validation, scale expansion, what `mockpit init` read turned into
// repo-owned tokens, and the CSS a frame gets. Mockpit picks no look here: it
// expands scales and emits what the agent wrote.
//
// Runtime-agnostic (no node imports): the Worker and SqlStore's migration
// import it.

import { CHROME_TOKENS, type ChromeColors, normalizeCssColor, repoCustomProps } from "./themes.ts";
import { explicitKnob } from "./knobs.ts";
import type {
  AnswerStanding,
  Ask,
  AskAnswer,
  DesignFiles,
  IconSetRef,
  Knobs,
  KnobValue,
  ProjectKit,
} from "./types.ts";

// Versions published from now on render with cascade layers; older ones keep
// the cascade they were approved under (absent on a version means 1).
export const CURRENT_CONTRACT = 2;

export const SYSTEM_LIMITS = {
  sheet: 128_000,
  tokens: 400,
  palettes: 40,
  roles: 120,
  pairs: 200,
  revisions: 30,
  classes: 200,
  fonts: 12,
  scales: 12,
  steps: 16,
  note: 300,
  summary: 400,
} as const;

export type ChromeRole = (typeof CHROME_TOKENS)[number];

export interface SystemClass {
  name: string;
  note: string;
}

export interface SystemFont {
  family: string;
  // A stylesheet on the CDN allowlist (Google Fonts, …); baked into each frame.
  href?: string;
}

export const TOKEN_TYPES = [
  "color",
  "dimension",
  "font",
  "weight",
  "number",
  "shadow",
  "duration",
  "easing",
  "text",
] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

// The fields of a "text" token, each emitted as `--<name>-<field>`.
export const TEXT_FIELDS = ["font", "size", "line", "weight", "tracking"] as const;

export interface Token {
  // The custom property, without `--`.
  name: string;
  type: TokenType;
  value: string | Record<string, string>;
  note?: string;
  // Set on the tokens a scale produced.
  scale?: string;
  // Derived from what init read; only rerunning init changes it.
  owner?: "repo";
}

export interface Scale {
  id: string;
  family: "type" | "space";
  prefix: string;
  // Step names in order, and which one is the base (exponent 0).
  steps: string[];
  zero: string;
  // px and multiplier at the smallest width.
  base: number;
  ratio: number;
  // A clamp() per step between the two widths.
  fluid?: { minWidth: number; maxWidth: number; maxBase: number; maxRatio: number };
}

export interface Role {
  name: string;
  note: string;
  owner?: "repo";
}

export type PaletteStatus = "default" | "kept" | "open" | "hidden";
export const PALETTE_STATUSES: readonly PaletteStatus[] = ["default", "kept", "open", "hidden"];

export interface Palette {
  id: string;
  label: string;
  note: string;
  light: Record<string, string>;
  dark: Record<string, string>;
  // Which color-scheme each mode really is: a palette dark in both modes says so.
  scheme?: { light: "light" | "dark"; dark: "light" | "dark" };
  status: PaletteStatus;
  // The one palette derived from the repo's `:root` and `.dark` blocks.
  owner?: "repo";
}

export interface SystemAddition {
  knob: string;
  value: string;
  rev: number;
  style: string;
}

// What `mockpit init` read from the repo.
export interface RepoRead {
  detected: { tailwind: boolean; shadcn: boolean; cssVars: number; fonts: string[] } | null;
  // Raw `:root{…}` (and `.dark{…}`) text, injected into every frame.
  cssVars: string;
  // The repo's Tailwind entry stylesheet reduced to what the browser build
  // compiles; empty when the repo isn't on Tailwind v4.
  tailwindCss: string;
  // What init removed from it: the utilities those provide are missing.
  strippedImports: string[];
  designFiles: DesignFiles | null;
  // Names init saw but couldn't type, so they resolve only from the raw block.
  untyped?: string[];
}

export interface System {
  project: string;
  rev: number;
  updatedAt: string;
  sheet: { css: string; classes: SystemClass[] } | null;
  fonts: SystemFont[];
  tokens: Token[];
  scales: Scale[];
  color: {
    roles: Role[];
    palettes: Palette[];
    // WCAG 2.2 ratios to clear: [foreground, background, minimum].
    pairs: [string, string, number][];
    // Points mockpit's `--color-*` tokens at project roles, so the base styles
    // and bundled kits wear the palette too.
    as?: Partial<Record<ChromeRole, string>>;
  };
  knobs: Knobs;
  settled: Record<string, KnobValue>;
  additions: SystemAddition[];
  // "tailwind" (the repo's utilities), "none", or a bundled or project kit id.
  kit: string;
  projectKits: ProjectKit[];
  iconSets: IconSetRef[];
  repo: RepoRead | null;
}

export interface SystemRevisionHead {
  rev: number;
  at: string;
  sessionId: string | null;
  summary: string;
}

export const emptySystem = (project: string): System => ({
  project,
  rev: 0,
  updatedAt: new Date().toISOString(),
  sheet: null,
  fonts: [],
  tokens: [],
  scales: [],
  color: { roles: [], palettes: [], pairs: [] },
  knobs: {},
  settled: {},
  additions: [],
  kit: "none",
  projectKits: [],
  iconSets: [],
  repo: null,
});

// A stored system, with anything an older or partial row lacks filled in.
export function normalizeSystem(project: string, raw: unknown): System {
  const base = emptySystem(project);
  if (!raw || typeof raw !== "object") return base;
  const s = raw as Partial<System>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const obj = <T extends object>(v: unknown, fallback: T): T =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback;
  const color = obj<Partial<System["color"]>>(s.color, {});
  return {
    ...base,
    rev: typeof s.rev === "number" ? s.rev : 0,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : base.updatedAt,
    sheet:
      s.sheet && typeof s.sheet.css === "string"
        ? { css: s.sheet.css, classes: arr(s.sheet.classes) }
        : null,
    fonts: arr(s.fonts),
    tokens: arr(s.tokens),
    scales: arr(s.scales),
    color: {
      roles: arr(color.roles),
      palettes: arr(color.palettes),
      pairs: arr(color.pairs),
      ...(color.as && typeof color.as === "object" ? { as: color.as } : {}),
    },
    knobs: obj(s.knobs, {}),
    settled: obj(s.settled, {}),
    additions: arr(s.additions),
    kit: typeof s.kit === "string" ? s.kit : "none",
    projectKits: arr(s.projectKits),
    iconSets: arr(s.iconSets),
    repo: s.repo && typeof s.repo === "object" ? normalizeRepo(s.repo) : null,
  };
}

function normalizeRepo(r: Partial<RepoRead>): RepoRead {
  return {
    detected: r.detected ?? null,
    cssVars: typeof r.cssVars === "string" ? r.cssVars : "",
    tailwindCss: typeof r.tailwindCss === "string" ? r.tailwindCss : "",
    strippedImports: Array.isArray(r.strippedImports) ? r.strippedImports : [],
    designFiles: r.designFiles ?? null,
    ...(Array.isArray(r.untyped) && r.untyped.length ? { untyped: r.untyped } : {}),
  };
}

// --- names and values ---------------------------------------------------------

const NAME_RE = /^[a-z][a-z0-9-]{0,47}$/;
const RESERVED = new Set<string>(CHROME_TOKENS);

export function checkName(name: unknown, what: string): string | null {
  if (typeof name !== "string" || !NAME_RE.test(name))
    return `${what} "${String(name)}" must match ^[a-z][a-z0-9-]{0,47}$`;
  if (name.startsWith("k-")) return `${what} "${name}": the k- prefix is reserved for knobs`;
  if (RESERVED.has(name)) return `${what} "${name}" is one of mockpit's own tokens`;
  return null;
}

// What a value inside a custom property may hold: the characters CSS values
// need, nothing that ends a declaration or a block, and no function that fetches.
const VALUE_RE = /^[#\w\s(),.%/+*'"-]{1,300}$/;
const FETCH_RE = /\b(url|image|image-set|src|expression)\s*\(/i;
export const isSafeValue = (v: unknown): v is string =>
  typeof v === "string" && VALUE_RE.test(v) && !FETCH_RE.test(v);

const NUM = "-?(\\d+\\.?\\d*|\\.\\d+)";
const DIMENSION_RE = new RegExp(
  `^(0|${NUM}(px|rem|em|%|vw|vh|vi|vb|vmin|vmax|ch|ex|lh|rlh|cqi|cqw|svh|dvh|lvh))$`,
);
const DURATION_RE = new RegExp(`^${NUM}(ms|s)$`);
const MATH_RE = /^(calc|clamp|min|max|var)\(/;

function checkValue(type: TokenType, value: unknown, name: string): string | null {
  if (type === "text") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return `token "${name}": a text token's value is {font, size, line, weight, tracking}`;
    for (const [field, v] of Object.entries(value)) {
      if (!(TEXT_FIELDS as readonly string[]).includes(field))
        return `token "${name}": unknown text field "${field}" (${TEXT_FIELDS.join(", ")})`;
      if (!isSafeValue(v)) return `token "${name}.${field}": not a plain CSS value`;
    }
    return null;
  }
  if (!isSafeValue(value)) return `token "${name}": not a plain CSS value`;
  const v = value.trim();
  const ok =
    type === "color"
      ? isColorValue(v) || MATH_RE.test(v) || v.startsWith("color-mix(")
      : type === "dimension"
        ? DIMENSION_RE.test(v) || MATH_RE.test(v)
        : type === "duration"
          ? DURATION_RE.test(v) || v.startsWith("var(")
          : type === "weight"
            ? /^([1-9]00|[1-9]\d{0,2}|normal|bold|bolder|lighter)$/.test(v) || v.startsWith("var(")
            : type === "number"
              ? new RegExp(`^${NUM}$`).test(v) || MATH_RE.test(v)
              : true;
  return ok ? null : `token "${name}": "${v}" is not a ${type}`;
}

const NAMED_COLORS = new Set(
  "transparent currentcolor black white red green blue yellow orange purple pink gray grey silver maroon olive lime aqua teal navy fuchsia cyan magenta brown gold indigo violet coral salmon crimson tomato khaki plum orchid tan beige ivory lavender linen azure snow mintcream honeydew seashell wheat chocolate sienna peru firebrick darkred darkgreen darkblue darkgray darkgrey lightgray lightgrey dimgray dimgrey slategray slategrey whitesmoke gainsboro".split(
    " ",
  ),
);

// A colour literal or a colour function; not a var() or a dimension.
export function isColorValue(v: string): boolean {
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/.test(s)) return [4, 5, 7, 9].includes(s.length);
  if (/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/.test(s)) return true;
  return NAMED_COLORS.has(s);
}

// --- scales ------------------------------------------------------------------

const round = (n: number, places = 3) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};
const rem = (px: number) => `${round(px / 16, 4)}rem`;

// Each step's px at the smallest and largest width (equal for a fixed scale).
export function scaleSteps(scale: Scale): { step: string; min: number; max: number }[] {
  const zero = scale.steps.indexOf(scale.zero);
  return scale.steps.map((step, i) => {
    const e = i - zero;
    const min = scale.base * scale.ratio ** e;
    const max = scale.fluid ? scale.fluid.maxBase * scale.fluid.maxRatio ** e : min;
    return { step, min: round(min, 2), max: round(max, 2) };
  });
}

// One step's CSS value: rem for a fixed scale, a clamp() between the widths for
// a fluid one (the slope runs through both endpoints).
export function stepValue(scale: Scale, min: number, max: number): string {
  if (!scale.fluid || min === max) return rem(min);
  const { minWidth, maxWidth } = scale.fluid;
  const slope = (max - min) / (maxWidth - minWidth);
  const intercept = min - slope * minWidth;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return `clamp(${rem(lo)}, ${rem(intercept)} + ${round(slope * 100, 4)}vw, ${rem(hi)})`;
}

export function expandScale(scale: Scale): Token[] {
  return scaleSteps(scale).map(({ step, min, max }) => ({
    name: `${scale.prefix}-${step}`,
    type: "dimension" as const,
    value: stepValue(scale, min, max),
    scale: scale.id,
  }));
}

function checkScale(raw: unknown): Scale | string {
  if (!raw || typeof raw !== "object") return "a scale is an object";
  const s = raw as Partial<Scale>;
  if (typeof s.id !== "string" || !NAME_RE.test(s.id))
    return `scale id "${String(s.id)}" must match ^[a-z][a-z0-9-]{0,47}$`;
  if (s.family !== "type" && s.family !== "space")
    return `scale "${s.id}": family is "type" or "space"`;
  const prefixError = checkName(s.prefix, `scale "${s.id}" prefix`);
  if (prefixError) return prefixError;
  if (!Array.isArray(s.steps) || s.steps.length < 2 || s.steps.length > SYSTEM_LIMITS.steps)
    return `scale "${s.id}": 2 to ${SYSTEM_LIMITS.steps} steps`;
  if (!s.steps.every((x) => typeof x === "string" && /^[a-z0-9][a-z0-9-]{0,11}$/.test(x)))
    return `scale "${s.id}": step names are short lowercase words (xs, sm, base, 2xl)`;
  if (new Set(s.steps).size !== s.steps.length) return `scale "${s.id}": a step is named twice`;
  if (typeof s.zero !== "string" || !s.steps.includes(s.zero))
    return `scale "${s.id}": zero names the base step, one of ${s.steps.join(", ")}`;
  const positive = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n > 0;
  if (!positive(s.base) || s.base > 512) return `scale "${s.id}": base is px, above 0`;
  if (!positive(s.ratio) || s.ratio < 1 || s.ratio > 4)
    return `scale "${s.id}": ratio is between 1 and 4`;
  let fluid: Scale["fluid"];
  if (s.fluid !== undefined) {
    const f = s.fluid as Partial<NonNullable<Scale["fluid"]>>;
    if (
      !f ||
      !positive(f.minWidth) ||
      !positive(f.maxWidth) ||
      f.maxWidth <= f.minWidth ||
      !positive(f.maxBase) ||
      !positive(f.maxRatio) ||
      f.maxRatio < 1 ||
      f.maxRatio > 4
    )
      return `scale "${s.id}": fluid is {minWidth, maxWidth, maxBase, maxRatio}, maxWidth above minWidth`;
    fluid = {
      minWidth: f.minWidth,
      maxWidth: f.maxWidth,
      maxBase: f.maxBase,
      maxRatio: f.maxRatio,
    };
  }
  return {
    id: s.id,
    family: s.family,
    prefix: s.prefix as string,
    steps: [...s.steps],
    zero: s.zero,
    base: s.base,
    ratio: s.ratio,
    ...(fluid ? { fluid } : {}),
  };
}

// --- the repo's own tokens ---------------------------------------------------------

// Tailwind's theme namespaces, longest first so `font-weight-` beats `font-`.
const TAILWIND_NAMESPACES: [RegExp, TokenType][] = [
  [/^font-weight-/, "weight"],
  [/^(font|font-family)-/, "font"],
  [/^text-[a-z0-9-]+$/, "dimension"],
  [/^(spacing|spacing-.+)$/, "dimension"],
  [/^(radius|radius-.+)$/, "dimension"],
  [/^(shadow|shadow-.+|inset-shadow-.+|drop-shadow-.+)$/, "shadow"],
  [/^ease-/, "easing"],
  [/^(leading|tracking)-/, "dimension"],
  [/^(breakpoint|container)-/, "dimension"],
];

function typeByValue(v: string): TokenType | null {
  const s = v.trim();
  if (
    isColorValue(s) ||
    normalizeCssColor(s)?.startsWith("hsl(") ||
    normalizeCssColor(s)?.startsWith("rgb(")
  )
    return "color";
  if (DIMENSION_RE.test(s)) return "dimension";
  if (DURATION_RE.test(s)) return "duration";
  if (/^cubic-bezier\(|^steps\(|^(linear|ease|ease-in|ease-out|ease-in-out)$/.test(s))
    return "easing";
  return null;
}

// A repo colour as a usable CSS colour, or null when it isn't one. The value
// reaches the viewer's swatches, so a colour is also a plain value: a prefix
// that looks like a colour can still carry a url().
function repoColor(raw: string): string | null {
  const v = normalizeCssColor(raw);
  if (!v || !isSafeValue(v)) return null;
  return isColorValue(v) ? v : null;
}

// Replaces every repo-owned token, role and palette with what `repo` says now.
// Colours of the `:root` and `.dark` blocks become roles and the `repo`
// palette; a colour with no dark value is a constant. Other families are typed
// by Tailwind's namespace or a DTCG file's type. A system-owned name the repo
// now brings is reported, not overwritten.
export function deriveRepoTokens(system: System): { system: System; clashes: string[] } {
  const previousRepo = system.color.palettes.find((p) => p.owner === "repo");
  const keepTokens = system.tokens.filter((t) => t.owner !== "repo");
  const keepRoles = system.color.roles.filter((r) => r.owner !== "repo");
  const keepPalettes = system.color.palettes.filter((p) => p.owner !== "repo");
  const repo = system.repo;
  if (!repo) {
    return {
      system: {
        ...system,
        tokens: keepTokens,
        color: { ...system.color, roles: keepRoles, palettes: keepPalettes },
      },
      clashes: [],
    };
  }
  const { light, dark } = repoCustomProps(`${repo.cssVars}\n${repo.tailwindCss}`);
  const taken = new Set<string>([
    ...keepTokens.map((t) => t.name),
    ...keepRoles.map((r) => r.name),
    ...system.scales.flatMap((s) => s.steps.map((x) => `${s.prefix}-${x}`)),
  ]);
  const clashes: string[] = [];
  const tokens: Token[] = [];
  const roles: Role[] = [];
  const paletteLight: Record<string, string> = {};
  const paletteDark: Record<string, string> = {};
  const untyped: string[] = [];
  const claim = (name: string): boolean => {
    if (!NAME_RE.test(name) || RESERVED.has(name) || name.startsWith("k-")) return false;
    if (taken.has(name)) {
      clashes.push(name);
      return false;
    }
    taken.add(name);
    return true;
  };
  // shadcn and its kin name things through one indirection
  // (`--background: var(--t-bg)`): a name is what the one it points at is, per mode,
  // since a dark block may redefine only the target.
  const target = (v: string | undefined) =>
    v === undefined ? null : (/^var\(\s*--([a-z0-9-]+)\s*\)$/i.exec(v.trim())?.[1] ?? null);
  const hop = (v: string | undefined, mode: "light" | "dark"): string | undefined => {
    const to = target(v);
    if (!to) return v;
    return (mode === "dark" ? (dark[to] ?? light[to]) : light[to]) ?? v;
  };
  const namespace = (name: string) =>
    TAILWIND_NAMESPACES.find(([re]) => re.test(name))?.[1] ?? null;
  for (const name of new Set([...Object.keys(light), ...Object.keys(dark)])) {
    const lv = hop(light[name], "light");
    const dv =
      dark[name] !== undefined
        ? hop(dark[name], "dark")
        : target(light[name])
          ? hop(light[name], "dark")
          : undefined;
    const l = lv !== undefined ? repoColor(lv) : null;
    const d = dv !== undefined ? repoColor(dv) : null;
    if (l || d) {
      if (!claim(name)) continue;
      if (d && d !== l) {
        roles.push({ name, note: "", owner: "repo" });
        paletteLight[name] = l ?? d;
        paletteDark[name] = d;
      } else {
        tokens.push({ name, type: "color", value: (l ?? d)!, owner: "repo" });
      }
      continue;
    }
    const raw = light[name] ?? dark[name];
    const to = target(raw);
    const pointed = to ? hop(raw, "light") : undefined;
    const type =
      namespace(name) ??
      (to && pointed !== undefined && pointed !== raw
        ? (namespace(to) ?? typeByValue(pointed))
        : null);
    if (!type || !isSafeValue(raw) || checkValue(type, raw, name)) {
      if (untyped.length < 200) untyped.push(name);
      continue;
    }
    if (claim(name)) tokens.push({ name, type, value: raw.trim(), owner: "repo" });
  }
  const dtcg = repo.designFiles?.tokens;
  if (dtcg) {
    for (const [dotted, value] of Object.entries(dtcg.values)) {
      const name = dotted.replace(/\./g, "-").toLowerCase();
      if (taken.has(name) && tokens.some((t) => t.name === name)) continue;
      const declared = dtcg.types?.[dotted];
      const type = declared ? dtcgType(declared) : typeByValue(value);
      if (!type || value.startsWith("{") || checkValue(type, value, name)) {
        if (untyped.length < 200) untyped.push(name);
        continue;
      }
      if (claim(name)) tokens.push({ name, type, value, owner: "repo" });
    }
  }
  const palettes = [...keepPalettes];
  if (roles.length) {
    const hasDefault = keepPalettes.some((p) => p.status === "default");
    // Rereading the repo keeps what the user made of its palette (a Hide stays);
    // it is the default only while no other palette is.
    const was = previousRepo?.status;
    const status: PaletteStatus =
      was === undefined
        ? hasDefault
          ? "kept"
          : "default"
        : was === "default" && hasDefault
          ? "kept"
          : was;
    palettes.unshift({
      id: "repo",
      label: "Repo",
      note: "The repo's :root and .dark blocks",
      light: paletteLight,
      dark: paletteDark,
      ...(previousRepo?.scheme ? { scheme: previousRepo.scheme } : {}),
      status,
      owner: "repo",
    });
  }
  return {
    system: {
      ...system,
      tokens: [...tokens.slice(0, SYSTEM_LIMITS.tokens), ...keepTokens],
      color: { ...system.color, roles: [...roles, ...keepRoles], palettes },
      repo: { ...repo, ...(untyped.length ? { untyped } : { untyped: undefined }) },
    },
    clashes,
  };
}

function dtcgType(t: string): TokenType | null {
  switch (t) {
    case "color":
      return "color";
    case "dimension":
      return "dimension";
    case "fontFamily":
      return "font";
    case "fontWeight":
      return "weight";
    case "number":
      return "number";
    case "shadow":
      return "shadow";
    case "duration":
      return "duration";
    case "cubicBezier":
      return "easing";
    default:
      return null;
  }
}

// --- migration ---------------------------------------------------------------

// The old per-project design settings (`design:<project>`), as a system. Its
// six-role palette is not carried as colours: each value that a derived role
// holds points mockpit's matching `--color-*` token at that role.
export function systemFromDesignSettings(project: string, raw: unknown): System {
  const old = (raw && typeof raw === "object" ? raw : {}) as {
    detected?: RepoRead["detected"];
    palette?: { light?: ChromeColors } | null;
    kit?: string;
    cssVars?: string;
    tailwindCss?: string;
    strippedImports?: string[];
    iconSets?: IconSetRef[];
    projectKits?: ProjectKit[];
    designFiles?: DesignFiles | null;
    updatedAt?: string;
  };
  const hasRepo = !!(old.detected || old.cssVars || old.tailwindCss || old.designFiles);
  const base: System = {
    ...emptySystem(project),
    updatedAt: old.updatedAt ?? new Date().toISOString(),
    kit: typeof old.kit === "string" ? old.kit : "none",
    projectKits: Array.isArray(old.projectKits) ? old.projectKits : [],
    iconSets: Array.isArray(old.iconSets) ? old.iconSets : [],
    repo: hasRepo
      ? normalizeRepo({
          detected: old.detected ?? null,
          cssVars: old.cssVars ?? "",
          tailwindCss: old.tailwindCss ?? "",
          strippedImports: old.strippedImports ?? [],
          designFiles: old.designFiles ?? null,
        })
      : null,
  };
  const { system } = deriveRepoTokens(base);
  const p = old.palette?.light;
  if (!p) return system;
  // Each name that holds a colour in light: the repo palette's roles and the repo's
  // constant colours. A value two names hold says nothing about which was meant.
  const holders = new Map<string, string[]>();
  const hold = (name: string, value: string) => {
    const key = value.trim().toLowerCase();
    holders.set(key, [...(holders.get(key) ?? []), name]);
  };
  const repoPalette = system.color.palettes.find((x) => x.owner === "repo");
  for (const [role, value] of Object.entries(repoPalette?.light ?? {})) hold(role, value);
  for (const t of system.tokens)
    if (t.owner === "repo" && t.type === "color" && typeof t.value === "string")
      hold(t.name, t.value);
  const pairs: [ChromeRole, string][] = [
    ["color-background-primary", p.surface],
    ["color-background-secondary", p.panel],
    ["color-text-primary", p.text],
    ["color-text-secondary", p.muted],
    ["color-border-secondary", p.border],
    ["color-text-info", p.info?.text],
    ["color-text-danger", p.danger?.text],
  ];
  const as: Partial<Record<ChromeRole, string>> = {};
  for (const [token, value] of pairs) {
    if (!value) continue;
    const names = holders.get(value.trim().toLowerCase()) ?? [];
    if (names.length === 1) as[token] = names[0];
  }
  return Object.keys(as).length ? { ...system, color: { ...system.color, as } } : system;
}

// --- writes ------------------------------------------------------------------

// What a `system` write may carry. Each present part replaces its part; tokens,
// scales and palettes are upserted by name or id, and `remove` takes them out.
export interface SystemWrite {
  sheet?: unknown;
  classes?: unknown;
  fonts?: unknown;
  tokens?: unknown;
  scales?: unknown;
  roles?: unknown;
  palettes?: unknown;
  pairs?: unknown;
  as?: unknown;
  knobs?: unknown;
  remove?: unknown;
  // Tier-internal (CLI): what `init`, `kit add` and `icons add` write.
  repo?: unknown;
  kit?: unknown;
  projectKits?: unknown;
  removeKits?: unknown;
  iconSets?: unknown;
}

export const SYSTEM_WRITE_KEYS = [
  "sheet",
  "classes",
  "fonts",
  "tokens",
  "scales",
  "roles",
  "palettes",
  "pairs",
  "as",
  "knobs",
  "remove",
  "repo",
  "kit",
  "projectKits",
  "removeKits",
  "iconSets",
] as const;

// Notes, labels and values are printed one per line in the brief, where a newline
// would start a heading or break a table row.
export const oneLine = (v: string): string => v.replace(/\s+/g, " ").trim();

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

// The sheet is as trusted as page html (it runs in the same sandbox), so this
// checks correctness, not safety.
export function checkSheet(css: string): string | null {
  if (css.length > SYSTEM_LIMITS.sheet) return `sheet is over ${SYSTEM_LIMITS.sheet / 1000} KB`;
  if (/<\/style/i.test(css)) return "sheet must not contain </style";
  const bare = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  if (/@import\b/i.test(bare))
    return "sheet must not @import: put web fonts in `fonts` ({family, href})";
  let depth = 0;
  for (const ch of bare) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return "sheet has a } with no {";
  }
  if (depth !== 0) return "sheet has an unclosed {";
  return null;
}

function checkClasses(raw: unknown): SystemClass[] | string {
  if (!Array.isArray(raw)) return "classes is a list of {name, note}";
  if (raw.length > SYSTEM_LIMITS.classes) return `at most ${SYSTEM_LIMITS.classes} classes`;
  const out: SystemClass[] = [];
  for (const c of raw) {
    const item = typeof c === "string" ? { name: c, note: "" } : c;
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      !/^\.?-?[_a-zA-Z][\w-]{0,63}$/.test(item.name)
    )
      return `class "${String(isRecord(item) ? item.name : item)}" is not a class name`;
    const name = item.name.replace(/^\./, "");
    if (out.some((x) => x.name === name)) return `class "${name}" is listed twice`;
    out.push({ name, note: oneLine(str(item.note, SYSTEM_LIMITS.note)) });
  }
  return out;
}

function checkFonts(raw: unknown, checkUrl: (url: string) => string | null): SystemFont[] | string {
  if (!Array.isArray(raw)) return "fonts is a list of {family, href?}";
  if (raw.length > SYSTEM_LIMITS.fonts) return `at most ${SYSTEM_LIMITS.fonts} fonts`;
  const out: SystemFont[] = [];
  for (const f of raw) {
    if (!isRecord(f) || typeof f.family !== "string" || !isSafeValue(f.family))
      return "a font is {family, href?}";
    if (f.href !== undefined) {
      if (typeof f.href !== "string") return `font "${f.family}": href is a URL`;
      const error = checkUrl(f.href);
      if (error) return `font "${f.family}": ${error}`;
    }
    out.push({
      family: oneLine(f.family),
      ...(typeof f.href === "string" ? { href: f.href } : {}),
    });
  }
  return out;
}

function checkToken(raw: unknown): Token | string {
  if (!isRecord(raw)) return "a token is {name, type, value, note?}";
  const nameError = checkName(raw.name, "token");
  if (nameError) return nameError;
  const name = raw.name as string;
  if (!(TOKEN_TYPES as readonly string[]).includes(raw.type as string))
    return `token "${name}": type is one of ${TOKEN_TYPES.join(", ")}`;
  const type = raw.type as TokenType;
  const valueError = checkValue(type, raw.value, name);
  if (valueError) return valueError;
  return {
    name,
    type,
    value:
      type === "text"
        ? Object.fromEntries(
            Object.entries(raw.value as Record<string, string>).map(([k, v]) => [k, oneLine(v)]),
          )
        : oneLine(raw.value as string),
    ...(typeof raw.note === "string" && raw.note.trim()
      ? { note: oneLine(raw.note).slice(0, SYSTEM_LIMITS.note) }
      : {}),
  };
}

function checkRole(raw: unknown): Role | string {
  const item = typeof raw === "string" ? { name: raw, note: "" } : raw;
  if (!isRecord(item)) return "a role is {name, note}";
  const error = checkName(item.name, "role");
  if (error) return error;
  return { name: item.name as string, note: oneLine(str(item.note, SYSTEM_LIMITS.note)) };
}

function checkPalette(raw: unknown, previous: Palette | undefined): Palette | string {
  if (!isRecord(raw)) return "a palette is {id, label, note, light, dark, scheme?}";
  if (typeof raw.id !== "string" || !NAME_RE.test(raw.id))
    return `palette id "${String(raw.id)}" must match ^[a-z][a-z0-9-]{0,47}$`;
  const id = raw.id;
  const values = (v: unknown, mode: string): Record<string, string> | string => {
    if (v === undefined && previous) return previous[mode as "light" | "dark"];
    if (!isRecord(v)) return `palette "${id}": ${mode} is {role: colour}`;
    const out: Record<string, string> = {};
    for (const [role, value] of Object.entries(v)) {
      if (!NAME_RE.test(role)) return `palette "${id}": role "${role}" is not a name`;
      if (!isSafeValue(value)) return `palette "${id}" ${mode}.${role}: not a plain CSS colour`;
      out[role] = oneLine(value);
    }
    return out;
  };
  const light = values(raw.light, "light");
  if (typeof light === "string") return light;
  const dark = values(raw.dark ?? (previous ? undefined : raw.light), "dark");
  if (typeof dark === "string") return dark;
  let scheme: Palette["scheme"] = previous?.scheme;
  if (raw.scheme !== undefined) {
    const s = raw.scheme as Partial<NonNullable<Palette["scheme"]>> | null;
    const ok = (x: unknown) => x === "light" || x === "dark";
    if (s !== null && (!isRecord(s) || !ok(s.light) || !ok(s.dark)))
      return `palette "${id}": scheme is {light: "light"|"dark", dark: "light"|"dark"}`;
    scheme = s ? { light: s.light!, dark: s.dark! } : undefined;
  }
  const status = raw.status ?? previous?.status ?? "open";
  if (!PALETTE_STATUSES.includes(status as PaletteStatus))
    return `palette "${id}": status is one of ${PALETTE_STATUSES.join(", ")}`;
  return {
    id,
    label: oneLine(str(raw.label, 60)) || previous?.label || id,
    note:
      raw.note === undefined ? (previous?.note ?? "") : oneLine(str(raw.note, SYSTEM_LIMITS.note)),
    light,
    dark,
    ...(scheme ? { scheme } : {}),
    status: status as PaletteStatus,
  };
}

function checkPairs(raw: unknown): System["color"]["pairs"] | string {
  if (!Array.isArray(raw)) return "pairs is a list of [foreground, background, minimum]";
  if (raw.length > SYSTEM_LIMITS.pairs) return `at most ${SYSTEM_LIMITS.pairs} pairs`;
  const out: System["color"]["pairs"] = [];
  for (const p of raw) {
    const [fg, bg, min] = Array.isArray(p) ? p : [];
    if (typeof fg !== "string" || typeof bg !== "string" || !NAME_RE.test(fg) || !NAME_RE.test(bg))
      return "a pair is [foreground, background, minimum], by token or role name";
    const ratio = min === undefined ? 4.5 : min;
    if (typeof ratio !== "number" || ratio < 1 || ratio > 21)
      return `pair ${fg} on ${bg}: minimum is a ratio from 1 to 21`;
    out.push([fg, bg, ratio]);
  }
  return out;
}

function checkAs(raw: unknown): Partial<Record<ChromeRole, string>> | undefined | string {
  if (raw === null) return undefined;
  if (!isRecord(raw))
    return `as is {mockpit token: role}, e.g. {"color-background-primary": "surface"}`;
  const out: Partial<Record<ChromeRole, string>> = {};
  for (const [token, role] of Object.entries(raw)) {
    const key = token.replace(/^--/, "");
    if (!RESERVED.has(key))
      return `as: "${token}" is not one of mockpit's tokens (${CHROME_TOKENS.slice(0, 4).join(", ")}, …)`;
    if (typeof role !== "string" || !NAME_RE.test(role))
      return `as.${key}: name a role or colour token`;
    out[key as ChromeRole] = role;
  }
  return out;
}

export interface WriteContext {
  // Checks a URL against the CDN allowlist: null when fine, else why not.
  checkUrl(url: string): string | null;
  checkKnobs(raw: unknown): { ok: true; value: Knobs } | { ok: false; error: string };
  checkKit(raw: unknown): ProjectKit | string;
  kitIds: readonly string[];
  // Knob paths some design in the project already declares, path → design slug.
  designKnobPaths: Map<string, string>;
}

const OWNED_BY_REPO = "owned by the repo: change the code and rerun `mockpit init`";

// Who emits each custom property: every token (a text token by its fields), every
// scale step, every role, and every name the repo's own blocks declare. More than
// one entry under a name is a clash: the last declaration would silently win.
function nameOwners(system: System): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (name: string, who: string) => {
    const list = out.get(name);
    if (!list) out.set(name, [who]);
    else if (!list.includes(who)) list.push(who);
  };
  for (const t of system.tokens) {
    if (t.scale) {
      const step = system.scales.find((sc) => sc.id === t.scale);
      add(
        t.name,
        `step "${step ? t.name.slice(step.prefix.length + 1) : t.name}" of scale "${t.scale}"`,
      );
    } else if (t.type === "text" && typeof t.value === "object") {
      for (const f of Object.keys(t.value)) add(`${t.name}-${f}`, `text token "${t.name}"`);
    } else add(t.name, `${t.owner === "repo" ? "repo " : ""}token "${t.name}"`);
  }
  for (const r of system.color.roles)
    add(r.name, `${r.owner === "repo" ? "repo " : ""}role "${r.name}"`);
  const repo = system.repo;
  if (repo) {
    const own = new Set([
      ...system.tokens.filter((t) => t.owner === "repo").map((t) => t.name),
      ...system.color.roles.filter((r) => r.owner === "repo").map((r) => r.name),
    ]);
    const { light, dark } = repoCustomProps(`${repo.cssVars}\n${repo.tailwindCss}`);
    for (const name of new Set([...Object.keys(light), ...Object.keys(dark)])) {
      if (!own.has(name)) add(name, `the repo's own --${name}`);
    }
  }
  return out;
}

// How to free a name, by what holds it now.
function freeingHint(who: string): string {
  if (who.startsWith("step "))
    return `remove ${who.replace(/^step "[^"]*" of /, "")} or give it another prefix`;
  if (who.startsWith("role ")) return `write \`roles\` without ${who.slice(5)}`;
  if (who.startsWith("token ") || who.startsWith("text token "))
    return `remove ${who} with \`mockpit system --remove '{"tokens":["${who.match(/"([^"]+)"/)?.[1] ?? ""}"]}'\``;
  return "rename it";
}

// The first name the write gave a second owner, said with both. Clashes already
// stored are left to the write that fixes them, so they never lock the system.
function newClash(before: System, after: System): string | null {
  const was = nameOwners(before);
  for (const [name, who] of nameOwners(after)) {
    if (who.length < 2) continue;
    if ((was.get(name)?.length ?? 0) >= who.length) continue;
    const byRepo = (w: string) => w.startsWith("repo ") || w.startsWith("the repo");
    const added = who.find((w) => !was.get(name)?.includes(w)) ?? who[1];
    const mine = who.find((w) => !byRepo(w));
    const hint = !who.some(byRepo)
      ? ""
      : byRepo(added)
        ? mine
          ? ` (${freeingHint(mine)})`
          : ""
        : added.startsWith("step ")
          ? ` (the repo owns it: give ${added.replace(/^step "[^"]*" of /, "")} another prefix)`
          : " (the repo owns it: pick another name)";
    return `"--${name}" would have two owners, ${who[0]} and ${who[1]}: a name has one owner${hint}`;
  }
  return null;
}

// Palette keys a palette may not value: mockpit's own names, knob names, and
// names a non-colour token or a scale step emits. Roles, repo-owned included, are
// what palettes are for.
function badPaletteKeys(system: System): Map<string, string> {
  const owned = new Map<string, string>();
  for (const t of system.tokens) {
    if (t.scale) owned.set(t.name, `a step of scale "${t.scale}"`);
    else if (t.type === "text" && typeof t.value === "object")
      for (const f of Object.keys(t.value)) owned.set(`${t.name}-${f}`, `text token "${t.name}"`);
    else if (t.type !== "color") owned.set(t.name, `${t.type} token "${t.name}"`);
  }
  const out = new Map<string, string>();
  for (const p of system.color.palettes) {
    for (const key of new Set([...Object.keys(p.light), ...Object.keys(p.dark)])) {
      const why = RESERVED.has(key)
        ? "one of mockpit's own tokens"
        : key.startsWith("k-")
          ? "a knob name"
          : owned.get(key);
      if (why) out.set(`${p.id}\u0000${key}`, `palette "${p.id}" values "${key}", ${why}`);
    }
  }
  return out;
}

// Applies one write to a system, or says why it can't. Revision bookkeeping is
// the caller's.
export function applySystemWrite(
  current: System,
  write: SystemWrite,
  ctx: WriteContext,
): { system: System; clashes: string[] } | { error: string } {
  let next: System = { ...current, color: { ...current.color } };
  const repoNames = new Set([
    ...current.tokens.filter((t) => t.owner === "repo").map((t) => t.name),
    ...current.color.roles.filter((r) => r.owner === "repo").map((r) => r.name),
  ]);

  if (write.sheet !== undefined || write.classes !== undefined) {
    if (write.sheet !== undefined && write.sheet !== null && typeof write.sheet !== "string")
      return { error: "sheet is css text" };
    const css =
      write.sheet === undefined
        ? (current.sheet?.css ?? "")
        : ((write.sheet as string | null) ?? "");
    const error = checkSheet(css);
    if (error) return { error };
    let classes = current.sheet?.classes ?? [];
    if (write.classes !== undefined) {
      const checked = checkClasses(write.classes);
      if (typeof checked === "string") return { error: checked };
      classes = checked;
    }
    next.sheet = css.trim() || classes.length ? { css, classes } : null;
  }
  if (write.fonts !== undefined) {
    const fonts = checkFonts(write.fonts, ctx.checkUrl);
    if (typeof fonts === "string") return { error: fonts };
    next.fonts = fonts;
  }

  const remove = isRecord(write.remove) ? write.remove : write.remove === undefined ? {} : null;
  if (remove === null) return { error: "remove is {tokens?, palettes?, scales?}, lists of names" };
  const names = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  for (const name of names(remove.tokens)) {
    if (repoNames.has(name)) return { error: `token "${name}" is ${OWNED_BY_REPO}` };
    if (!next.tokens.some((t) => t.name === name && !t.scale))
      return { error: `no token "${name}" to remove` };
  }
  for (const id of names(remove.palettes)) {
    if (id === "repo") return { error: `palette "repo" is ${OWNED_BY_REPO}` };
    if (!next.color.palettes.some((p) => p.id === id))
      return { error: `no palette "${id}" to remove` };
  }
  for (const id of names(remove.scales)) {
    if (!next.scales.some((s) => s.id === id)) return { error: `no scale "${id}" to remove` };
  }
  const goneTokens = new Set(names(remove.tokens));
  const goneScales = new Set(names(remove.scales));
  next.tokens = next.tokens.filter(
    (t) => !goneTokens.has(t.name) && !(t.scale && goneScales.has(t.scale)),
  );
  next.scales = next.scales.filter((s) => !goneScales.has(s.id));
  const gonePalettes = new Set(names(remove.palettes));
  next.color.palettes = next.color.palettes.filter((p) => !gonePalettes.has(p.id));

  if (write.scales !== undefined) {
    if (!Array.isArray(write.scales)) return { error: "scales is a list of scales" };
    const scales = [...next.scales];
    for (const raw of write.scales) {
      const scale = checkScale(raw);
      if (typeof scale === "string") return { error: scale };
      const at = scales.findIndex((s) => s.id === scale.id);
      if (at >= 0) scales[at] = scale;
      else scales.push(scale);
    }
    if (scales.length > SYSTEM_LIMITS.scales)
      return { error: `at most ${SYSTEM_LIMITS.scales} scales` };
    next.scales = scales;
  }
  // Scale tokens are always what their scale says now.
  next.tokens = [...next.tokens.filter((t) => !t.scale), ...next.scales.flatMap(expandScale)];

  if (write.tokens !== undefined) {
    if (!Array.isArray(write.tokens))
      return { error: "tokens is a list of {name, type, value, note?}" };
    const tokens = [...next.tokens];
    for (const raw of write.tokens) {
      const token = checkToken(raw);
      if (typeof token === "string") return { error: token };
      if (repoNames.has(token.name)) return { error: `token "${token.name}" is ${OWNED_BY_REPO}` };
      const at = tokens.findIndex((t) => t.name === token.name);
      if (at >= 0 && tokens[at].scale)
        return { error: `token "${token.name}" is a step of scale "${tokens[at].scale}"` };
      if (at >= 0) tokens[at] = token;
      else tokens.push(token);
    }
    next.tokens = tokens;
  }
  if (next.tokens.length > SYSTEM_LIMITS.tokens)
    return { error: `at most ${SYSTEM_LIMITS.tokens} tokens` };

  if (write.roles !== undefined) {
    if (!Array.isArray(write.roles)) return { error: "roles is a list of {name, note}" };
    const roles: Role[] = current.color.roles.filter((r) => r.owner === "repo");
    for (const raw of write.roles) {
      const role = checkRole(raw);
      if (typeof role === "string") return { error: role };
      if (repoNames.has(role.name)) return { error: `role "${role.name}" is ${OWNED_BY_REPO}` };
      if (roles.some((r) => r.name === role.name))
        return { error: `role "${role.name}" is listed twice` };
      roles.push(role);
    }
    if (roles.length > SYSTEM_LIMITS.roles)
      return { error: `at most ${SYSTEM_LIMITS.roles} roles` };
    next.color.roles = roles;
  }

  if (write.palettes !== undefined) {
    if (!Array.isArray(write.palettes)) return { error: "palettes is a list of palettes" };
    const palettes = [...next.color.palettes];
    for (const raw of write.palettes) {
      const id = isRecord(raw) ? raw.id : undefined;
      if (id === "repo") return { error: `palette "repo" is ${OWNED_BY_REPO}` };
      const at = palettes.findIndex((p) => p.id === id);
      const palette = checkPalette(raw, at >= 0 ? palettes[at] : undefined);
      if (typeof palette === "string") return { error: palette };
      if (at >= 0) palettes[at] = palette;
      else palettes.push(palette);
    }
    if (palettes.length > SYSTEM_LIMITS.palettes)
      return { error: `at most ${SYSTEM_LIMITS.palettes} palettes` };
    next.color.palettes = withOneDefault(palettes, write.palettes as unknown[]);
  }
  if (write.pairs !== undefined) {
    const pairs = checkPairs(write.pairs);
    if (typeof pairs === "string") return { error: pairs };
    next.color.pairs = pairs;
  }
  if (write.as !== undefined) {
    const as = checkAs(write.as);
    if (typeof as === "string") return { error: as };
    const { as: _gone, ...rest } = next.color;
    next.color = as ? { ...rest, as } : rest;
  }

  if (write.knobs !== undefined) {
    const checked = ctx.checkKnobs(write.knobs);
    if (!checked.ok) return { error: checked.error };
    for (const path of Object.keys(checked.value)) {
      const design = ctx.designKnobPaths.get(path);
      if (design)
        return {
          error: `project knob "${path}" collides with design "${design}"'s knob "${path}"`,
        };
    }
    next.knobs = checked.value;
    next.settled = Object.fromEntries(
      Object.entries(next.settled).filter(([p]) => Object.hasOwn(checked.value, p)),
    );
  }

  if (
    write.kit !== undefined ||
    write.projectKits !== undefined ||
    write.removeKits !== undefined
  ) {
    let projectKits = [...next.projectKits];
    if (write.projectKits !== undefined) {
      if (!Array.isArray(write.projectKits)) return { error: "projectKits is a list of kits" };
      for (const raw of write.projectKits) {
        const kit = ctx.checkKit(raw);
        if (typeof kit === "string") return { error: kit };
        projectKits = [...projectKits.filter((k) => k.id !== kit.id), kit];
      }
    }
    for (const id of names(write.removeKits)) {
      if (!projectKits.some((k) => k.id === id))
        return { error: `${current.project} has no kit "${id}"` };
      projectKits = projectKits.filter((k) => k.id !== id);
      if (next.kit === id) next.kit = "none";
    }
    if (projectKits.length > 16) return { error: "at most 16 project kits" };
    next.projectKits = projectKits;
    if (write.kit !== undefined) {
      const kit = write.kit === null ? "none" : write.kit;
      const known = ["tailwind", "none", ...ctx.kitIds, ...projectKits.map((k) => k.id)];
      if (typeof kit !== "string" || !known.includes(kit))
        return { error: `unknown kit "${String(kit)}" — known: ${known.join(", ")}` };
      next.kit = kit;
    }
  }
  if (write.iconSets !== undefined) next.iconSets = write.iconSets as IconSetRef[];

  let clashes: string[] = [];
  if (write.repo !== undefined) {
    next.repo = write.repo === null ? null : normalizeRepo(write.repo as Partial<RepoRead>);
    const derived = deriveRepoTokens(next);
    if (derived.clashes.length) {
      const owners = nameOwners(next);
      const each = derived.clashes.slice(0, 6).map((n) => {
        const who = owners.get(n)?.find((w) => !w.startsWith("repo ") && !w.startsWith("the repo"));
        return who ? `"--${n}" (${who}: ${freeingHint(who)})` : `"--${n}"`;
      });
      return {
        error: `the repo now declares ${each.join(", ")}${derived.clashes.length > 6 ? `, +${derived.clashes.length - 6} more` : ""}, which the system already owns. Free ${derived.clashes.length > 1 ? "them" : "it"}, then rerun \`mockpit init\``,
      };
    }
    next = derived.system;
    clashes = derived.clashes;
  }

  const clash = newClash(current, next);
  if (clash) return { error: clash };
  const wasBad = badPaletteKeys(current);
  for (const [key, why] of badPaletteKeys(next)) {
    if (!wasBad.has(key)) return { error: `${why}: a palette values roles` };
  }
  return { system: { ...next, updatedAt: new Date().toISOString() }, clashes };
}

// Asking one palette to be the default makes the one that was the default kept.
function withOneDefault(palettes: Palette[], written: unknown[]): Palette[] {
  const asked = written
    .filter((p): p is Record<string, unknown> => isRecord(p) && p.status === "default")
    .map((p) => p.id as string)
    .at(-1);
  if (!asked) return palettes;
  return palettes.map((p) =>
    p.id === asked ? p : p.status === "default" ? { ...p, status: "kept" as const } : p,
  );
}

// Restoring a revision brings back everything but what the repo owns, which
// stays as init last read it (its palette keeps the status it had then).
//
// An agent's restore (`keepDecided`) also keeps what the user decided: every
// palette's status, a default or kept palette the old revision lacks, the settled
// project knobs and the knobs and answer styles those values need. `kept` says it.
export function restoreSystem(
  current: System,
  old: System,
  opts: { keepDecided?: boolean } = {},
): { system: System; kept: string[] } {
  let restored: System = {
    ...old,
    project: current.project,
    rev: current.rev,
    repo: current.repo,
    tokens: old.tokens.filter((t) => t.owner !== "repo"),
    color: {
      ...old.color,
      roles: old.color.roles.filter((r) => r.owner !== "repo"),
    },
    updatedAt: new Date().toISOString(),
  };
  restored = deriveRepoTokens(restored).system;
  if (!opts.keepDecided) return { system: restored, kept: [] };

  const kept: string[] = [];
  const now = new Map(current.color.palettes.map((p) => [p.id, p]));
  let palettes = restored.color.palettes.map((p) => {
    const was = now.get(p.id);
    if (!was || was.status === p.status) return p;
    kept.push(`palette "${p.id}" stays ${was.status}`);
    return { ...p, status: was.status };
  });
  for (const p of current.color.palettes) {
    if (palettes.some((x) => x.id === p.id)) continue;
    if (p.status !== "default" && p.status !== "kept") continue;
    palettes.push(p);
    kept.push(`palette "${p.id}" stays ${p.status}`);
  }
  // Statuses came from two revisions: the current default is the one.
  const def = current.color.palettes.find((p) => p.status === "default")?.id;
  if (def && palettes.some((p) => p.id === def))
    palettes = palettes.map((p) =>
      p.status === "default" && p.id !== def ? { ...p, status: "kept" as const } : p,
    );

  const knobs = { ...restored.knobs };
  const settled: Record<string, KnobValue> = {};
  const additions = [...restored.additions];
  for (const [path, value] of Object.entries(current.settled)) {
    settled[path] = value;
    if (!Object.hasOwn(knobs, path) && Object.hasOwn(current.knobs, path))
      knobs[path] = current.knobs[path];
    for (const a of current.additions) {
      if (a.knob !== path || a.value !== String(value)) continue;
      if (!additions.some((x) => x.knob === a.knob && x.value === a.value)) additions.push(a);
    }
    if (JSON.stringify(old.settled[path]) !== JSON.stringify(value))
      kept.push(`project knob "${path}" stays settled on ${JSON.stringify(value)}`);
  }
  return {
    system: {
      ...restored,
      color: { ...restored.color, palettes },
      knobs,
      settled: { ...restored.settled, ...settled },
      additions,
    },
    kept,
  };
}

// --- what changed, in words ----------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Key order differs between a stored system and one a write built, so equality
// is on sorted keys.
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

// Whether two systems differ in anything but their revision bookkeeping.
export function systemDiffers(before: System, after: System): boolean {
  const strip = ({ rev: _r, updatedAt: _u, ...rest }: System) => rest;
  return stableJson(strip(before)) !== stableJson(strip(after));
}

export function describeChange(before: System, after: System): string[] {
  const out: string[] = [];
  const bSheet = before.sheet?.css ?? "";
  const aSheet = after.sheet?.css ?? "";
  if (bSheet !== aSheet)
    out.push(
      aSheet
        ? `sheet ${bSheet ? "changed" : "added"} (${(aSheet.length / 1000).toFixed(1)} KB)`
        : "sheet removed",
    );
  const bClasses = new Set((before.sheet?.classes ?? []).map((c) => c.name));
  const aClasses = new Set((after.sheet?.classes ?? []).map((c) => c.name));
  const addedClasses = [...aClasses].filter((c) => !bClasses.has(c)).length;
  const goneClasses = [...bClasses].filter((c) => !aClasses.has(c)).length;
  const bNotes = new Map((before.sheet?.classes ?? []).map((c) => [c.name, c.note]));
  const renoted = (after.sheet?.classes ?? []).filter(
    (c) => bNotes.has(c.name) && bNotes.get(c.name) !== c.note,
  ).length;
  if (addedClasses || goneClasses || renoted)
    out.push(
      `classes ${[addedClasses ? `+${addedClasses}` : "", goneClasses ? `−${goneClasses}` : "", renoted ? `${renoted} ${renoted === 1 ? "note" : "notes"} changed` : ""].filter(Boolean).join(" ")}`,
    );
  else {
    const order = (sys: System) => (sys.sheet?.classes ?? []).map((c) => c.name).join(" ");
    if (order(before) !== order(after)) out.push("classes reordered");
  }
  if (JSON.stringify(before.fonts) !== JSON.stringify(after.fonts))
    out.push(`fonts: ${after.fonts.map((f) => f.family).join(", ") || "none"}`);
  const diffBy = <T>(a: T[], b: T[], key: (x: T) => string) => {
    const am = new Map(a.map((x) => [key(x), JSON.stringify(x)]));
    const bm = new Map(b.map((x) => [key(x), JSON.stringify(x)]));
    let added = 0;
    let changed = 0;
    let removed = 0;
    for (const [k, v] of bm) {
      if (!am.has(k)) added++;
      else if (am.get(k) !== v) changed++;
    }
    for (const k of am.keys()) if (!bm.has(k)) removed++;
    return { added, changed, removed };
  };
  const counts = (label: string, d: { added: number; changed: number; removed: number }) => {
    const bits = [
      d.added ? `+${d.added}` : "",
      d.changed ? `${d.changed} changed` : "",
      d.removed ? `−${d.removed}` : "",
    ].filter(Boolean);
    if (bits.length) out.push(`${label} ${bits.join(", ")}`);
  };
  for (const s of after.scales) {
    const old = before.scales.find((x) => x.id === s.id);
    if (!old) out.push(`scale ${s.id} added`);
    else if (JSON.stringify(old) !== JSON.stringify(s)) {
      if (old.ratio !== s.ratio) out.push(`scale ${s.id} ratio ${old.ratio} → ${s.ratio}`);
      else if (old.base !== s.base) out.push(`scale ${s.id} base ${old.base} → ${s.base}`);
      else out.push(`scale ${s.id} changed`);
    }
  }
  for (const s of before.scales)
    if (!after.scales.some((x) => x.id === s.id)) out.push(`scale ${s.id} removed`);
  counts(
    "tokens",
    diffBy(
      before.tokens.filter((t) => !t.scale && !t.owner),
      after.tokens.filter((t) => !t.scale && !t.owner),
      (t) => t.name,
    ),
  );
  counts(
    "roles",
    diffBy(before.color.roles, after.color.roles, (r) => r.name),
  );
  for (const p of after.color.palettes) {
    const old = before.color.palettes.find((x) => x.id === p.id);
    if (!old) {
      out.push(`palette ${p.label} added`);
      continue;
    }
    let colours = 0;
    for (const mode of ["light", "dark"] as const) {
      for (const role of new Set([...Object.keys(old[mode]), ...Object.keys(p[mode])])) {
        if (old[mode][role] !== p[mode][role]) colours++;
      }
    }
    if (old.label !== p.label) out.push(`palette ${old.label} renamed ${p.label}`);
    if (old.note !== p.note) out.push(`palette ${p.label} note changed`);
    if (stableJson(old.scheme ?? null) !== stableJson(p.scheme ?? null))
      out.push(
        `palette ${p.label} scheme ${p.scheme ? `light ${p.scheme.light}, dark ${p.scheme.dark}` : "removed"}`,
      );
    if (colours) out.push(`${plural(colours, "colour")} in ${p.label}`);
    if (old.status !== p.status)
      out.push(`${p.label} ${p.status === "default" ? "is the default" : p.status}`);
  }
  for (const p of before.color.palettes)
    if (!after.color.palettes.some((x) => x.id === p.id)) out.push(`palette ${p.label} removed`);
  if (JSON.stringify(before.color.pairs) !== JSON.stringify(after.color.pairs))
    out.push(`${plural(after.color.pairs.length, "pair")} to check`);
  if (JSON.stringify(before.color.as ?? {}) !== JSON.stringify(after.color.as ?? {}))
    out.push("mockpit tokens remapped");
  if (JSON.stringify(before.knobs) !== JSON.stringify(after.knobs))
    out.push(`${plural(Object.keys(after.knobs).length, "project knob")}`);
  if (before.kit !== after.kit) out.push(`kit ${after.kit}`);
  counts(
    "project kits",
    diffBy(before.projectKits, after.projectKits, (k) => k.id),
  );
  counts(
    "icon sets",
    diffBy(before.iconSets, after.iconSets, (s) => s.prefix),
  );
  if (stableJson(before.repo) !== stableJson(after.repo)) out.push("read from the repo again");
  if (stableJson(before.settled) !== stableJson(after.settled))
    out.push(
      Object.keys(after.settled).length
        ? `${plural(Object.keys(after.settled).length, "project knob")} settled`
        : "no project knob settled",
    );
  // A real change never goes unsaid.
  if (out.length === 0 && systemDiffers(before, after)) out.push("system changed");
  return out;
}

// --- emission ------------------------------------------------------------------

export function defaultPalette(system: System): Palette | null {
  const visible = system.color.palettes;
  return (
    visible.find((p) => p.status === "default") ??
    visible.find((p) => p.status !== "hidden") ??
    null
  );
}

// The palette a frame wears: the one `?p=` names if it exists, else the default.
export function activePalette(system: System, id: string | undefined): Palette | null {
  return (id && system.color.palettes.find((p) => p.id === id)) || defaultPalette(system);
}

const decl = (name: string, value: string) => `--${name}:${value};`;

function tokenDecls(token: Token): string {
  if (token.type !== "text" || typeof token.value === "string")
    return decl(token.name, token.value as string);
  return Object.entries(token.value)
    .map(([field, v]) => decl(`${token.name}-${field}`, v))
    .join("");
}

export interface SystemCss {
  // The project sheet, as written.
  sheet: string;
  // Custom properties: the non-colour tokens, then the palette for the mode,
  // then the `as` map onto mockpit's own tokens.
  tokens: string;
  fonts: string[];
  // What `<html>` says about the palette.
  attrs: { scheme?: "light" | "dark"; palette?: string };
}

// The CSS a frame gets from the system. Repo-owned tokens aren't emitted: the
// repo's raw block (or compiled Tailwind) declares them already; nor are the
// repo palette's values while it is the one worn.
export function systemCss(
  system: System,
  opts: { mode?: "light" | "dark"; palette?: string; contract?: number },
): SystemCss {
  const own = system.tokens.filter((t) => t.owner !== "repo");
  const palette = activePalette(system, opts.palette);
  const block = (vars: string) => (vars ? `:root{${vars}}` : "");
  // The layout kit's default gap: the base step of the project's space scale.
  const space = system.scales.find((s) => s.family === "space");
  // First, so a token the project names layout-space wins.
  const constants =
    (space ? decl("layout-space", `var(--${space.prefix}-${space.zero})`) : "") +
    own.map(tokenDecls).join("");
  const paletteVars = (mode: "light" | "dark") =>
    palette && palette.owner !== "repo"
      ? Object.entries(palette[mode])
          .map(([role, value]) => decl(role, value))
          .join("")
      : "";
  // Old versions keep mockpit's own colours under their kits and base styles:
  // pointing them at the project's would change how an approved version looks.
  const as =
    (opts.contract ?? CURRENT_CONTRACT) >= 2
      ? Object.entries(system.color.as ?? {})
          .map(([token, role]) => decl(token, `var(--${role})`))
          .join("")
      : "";
  let colours: string;
  if (opts.mode) colours = block(paletteVars(opts.mode) + as);
  else {
    const light = paletteVars("light");
    const dark = paletteVars("dark");
    colours = `${block(light + as)}${dark ? `@media (prefers-color-scheme: dark){${block(dark)}}` : ""}`;
  }
  const scheme = palette?.scheme && opts.mode ? palette.scheme[opts.mode] : opts.mode;
  return {
    sheet: system.sheet?.css ?? "",
    tokens: `${block(constants)}${colours}`,
    fonts: system.fonts.flatMap((f) => (f.href ? [f.href] : [])),
    attrs: {
      ...(scheme ? { scheme } : {}),
      ...(palette ? { palette: palette.id } : {}),
    },
  };
}

// What a Send decides for the whole project: a palette chosen by a question becomes
// the default (the one it replaces is kept, not lost), Keep and Hide on a palette's
// answer set its status, and an answer's `set` on a project knob settles it. Null
// when the reply changes nothing there.
export function systemAfterAnswers(
  system: System,
  asks: Ask[],
  answers: Record<string, AskAnswer>,
  standings: Record<string, AnswerStanding>,
): { system: System; changes: string[] } | null {
  const ids = new Set(system.color.palettes.map((p) => p.id));
  const status = new Map<string, PaletteStatus>();
  const settled: Record<string, KnobValue> = {};
  let chosenDefault: string | null = null;
  for (const ask of asks) {
    const picked = answers[ask.id] === undefined ? [] : [answers[ask.id]].flat();
    for (const id of picked) {
      const opt = ask.options.find((o) => o.id === id);
      if (opt?.palette && ids.has(opt.palette)) chosenDefault = opt.palette;
      for (const [path, v] of Object.entries(opt?.set ?? {})) {
        if (Object.hasOwn(system.knobs, path)) settled[path] = v;
      }
    }
    const st = standings[ask.id];
    if (!st) continue;
    const paletteOf = (optionId: string) => ask.options.find((o) => o.id === optionId)?.palette;
    for (const id of st.kept) {
      const p = paletteOf(id);
      if (p && ids.has(p)) status.set(p, "kept");
    }
    for (const h of st.hidden) {
      const p = paletteOf(h.id);
      if (p && ids.has(p)) status.set(p, "hidden");
    }
  }
  const changes: string[] = [];
  const was = defaultPalette(system);
  let palettes = system.color.palettes.map((p) => {
    const s = status.get(p.id);
    // The default leaves only by another becoming it.
    if (!s || s === p.status || p.status === "default" || p.id === chosenDefault) return p;
    changes.push(`palette "${p.id}" ${s}`);
    return { ...p, status: s };
  });
  if (chosenDefault && was?.id !== chosenDefault) {
    palettes = palettes.map((p) =>
      p.id === chosenDefault
        ? { ...p, status: "default" as const }
        : p.status === "default"
          ? { ...p, status: "kept" as const }
          : p,
    );
    changes.unshift(`palette "${chosenDefault}" is the default${was ? ` ("${was.id}" kept)` : ""}`);
  }
  const nextSettled = { ...system.settled };
  for (const [path, v] of Object.entries(settled)) {
    if (JSON.stringify(system.settled[path]) === JSON.stringify(v)) continue;
    nextSettled[path] = v;
    changes.push(`project knob "${path}" settled on ${JSON.stringify(v)}`);
  }
  if (changes.length === 0) return null;
  return {
    system: { ...system, color: { ...system.color, palettes }, settled: nextSettled },
    changes,
  };
}

// What every render of the project carries for its knobs: the settled value, else
// the knob's own (a select without one starts on its first option).
export function projectKnobValues(system: System | null): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  for (const [path, config] of Object.entries(system?.knobs ?? {})) {
    if (Object.hasOwn(system!.settled, path)) {
      out[path] = system!.settled[path];
      continue;
    }
    const k = explicitKnob(config) as { value?: KnobValue; options?: unknown[] };
    const first = k.options?.[0];
    const v =
      k.value ??
      (typeof first === "object" && first !== null ? (first as { value: string }).value : first);
    if (v !== undefined) out[path] = v as KnobValue;
  }
  return out;
}

// The system handed to code. Only what mockpit holds: what the repo owns is
// already in the code it came from. `css` is the default palette on :root (dark
// by media query) and each kept one under `[data-palette]`; `tokens` is the same
// as data.
export interface SystemExport {
  project: string;
  rev: number;
  sheet: string;
  css: string;
  tokens: {
    constants: Record<string, string | Record<string, string>>;
    palettes: Record<
      string,
      {
        label: string;
        status: PaletteStatus;
        light: Record<string, string>;
        dark: Record<string, string>;
      }
    >;
  };
  fonts: SystemFont[];
  knobs: Record<string, KnobValue>;
  // What each settled value draws, where an answer brought it: CSS keyed on the
  // knob's `data-k-<path>` attribute.
  additions: { knob: string; value: string; style: string }[];
}

export function systemExport(system: System): SystemExport {
  const own = system.tokens.filter((t) => t.owner !== "repo");
  const space = system.scales.find((s) => s.family === "space");
  // The default first: a kept palette's block, of equal specificity, must follow it.
  const palettes = system.color.palettes
    .filter((p) => p.owner !== "repo" && (p.status === "default" || p.status === "kept"))
    .sort((a, b) => Number(b.status === "default") - Number(a.status === "default"));
  const rule = (sel: string, decls: string[], indent = "") =>
    `${indent}${sel} {\n${decls.map((d) => `${indent}  ${d}\n`).join("")}${indent}}`;
  const roleDecls = (values: Record<string, string>) =>
    Object.entries(values).map(([role, v]) => decl(role, v));
  const blocks: string[] = [];
  const constants = [
    ...own.flatMap((t) =>
      tokenDecls(t)
        .split(/(?<=;)/)
        .filter(Boolean),
    ),
    ...(space ? [decl("layout-space", `var(--${space.prefix}-${space.zero})`)] : []),
  ];
  if (constants.length) blocks.push(rule(":root", constants));
  for (const p of palettes) {
    const sel = p.status === "default" ? ":root" : `[data-palette="${p.id}"]`;
    blocks.push(`/* ${p.label || p.id}${p.status === "default" ? ", the default" : ", kept"} */`);
    blocks.push(rule(sel, roleDecls(p.light)));
    if (Object.keys(p.dark).length) {
      blocks.push(
        `@media (prefers-color-scheme: dark) {\n${rule(sel, roleDecls(p.dark), "  ")}\n}`,
      );
    }
  }
  return {
    project: system.project,
    rev: system.rev,
    sheet: system.sheet?.css ?? "",
    css: blocks.length ? `${blocks.join("\n\n")}\n` : "",
    tokens: {
      constants: Object.fromEntries(own.map((t) => [t.name, t.value])),
      palettes: Object.fromEntries(
        palettes.map((p) => [
          p.id,
          { label: p.label, status: p.status, light: p.light, dark: p.dark },
        ]),
      ),
    },
    fonts: system.fonts,
    knobs: projectKnobValues(system),
    additions: system.additions
      .filter(
        (a) => Object.hasOwn(system.settled, a.knob) && String(system.settled[a.knob]) === a.value,
      )
      .map(({ knob, value, style }) => ({ knob, value, style })),
  };
}

// One line for a read of the whole project: what its renders wear.
export function systemLine(system: System, failing: number): string {
  const def = defaultPalette(system);
  const kept = system.color.palettes.filter((p) => p.status === "kept").map((p) => p.label || p.id);
  return [
    `r${system.rev}`,
    def ? `palette ${def.label || def.id}${kept.length ? ` (kept: ${kept.join(", ")})` : ""}` : "",
    system.tokens.length ? plural(system.tokens.length, "token") : "",
    system.scales.length ? plural(system.scales.length, "scale") : "",
    system.sheet ? plural(system.sheet.classes.length, "sheet class", "sheet classes") : "",
    Object.keys(system.knobs).length
      ? plural(Object.keys(system.knobs).length, "project knob")
      : "",
    failing ? `${plural(failing, "check")} failing` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// Every name the system declares, for the checks and the brief.
export function declaredNames(system: System): Set<string> {
  const out = new Set<string>();
  for (const t of system.tokens) {
    if (t.type === "text" && typeof t.value === "object") {
      for (const f of Object.keys(t.value)) out.add(`${t.name}-${f}`);
    } else out.add(t.name);
  }
  for (const r of system.color.roles) out.add(r.name);
  for (const p of system.color.palettes) {
    for (const k of Object.keys(p.light)) out.add(k);
    for (const k of Object.keys(p.dark)) out.add(k);
  }
  for (const name of CHROME_TOKENS) out.add(name);
  const repo = system.repo;
  if (repo) {
    const { light, dark } = repoCustomProps(`${repo.cssVars}\n${repo.tailwindCss}`);
    for (const k of Object.keys(light)) out.add(k);
    for (const k of Object.keys(dark)) out.add(k);
  }
  return out;
}

export const hasSystemContent = (s: System | null): boolean =>
  !!s &&
  !!(
    s.sheet ||
    s.tokens.length ||
    s.scales.length ||
    s.color.palettes.length ||
    s.fonts.length ||
    Object.keys(s.knobs).length
  );
