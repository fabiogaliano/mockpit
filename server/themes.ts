// The workspace palette — the single source of truth shared by the server
// (html-surface token injection in surfacePage) and the viewer (chrome palette +
// shiki theme for markdown/diff). Runtime-agnostic: no node imports, so it
// bundles into the viewer (vite) and typechecks against workers.
//
// The theme is authored as ONE palette object per color scheme; the viewer-var
// set (--bg, --accent, …) and the html-token set (--color-* injected into the
// sandboxed iframe) are both DERIVED from it, so the two palettes can never
// drift. Mermaid follows the viewer vars (see MermaidPart); the terminal is
// intentionally theme-independent (always a dark terminal window).

export interface Accent {
  // Background fill, text/icon color, and border for a semantic state.
  bg: string;
  text: string;
  border: string;
}

export interface Palette {
  bg: string; // app background (deepest chrome)
  panel: string; // raised panel / code-block background
  surface: string; // card / html-part body background
  text: string; // primary text
  muted: string; // secondary text
  faint: string; // tertiary text (captions, hints)
  border: string; // default hairline border
  border2: string; // stronger border
  hover: string; // hover wash
  info: Accent; // also the accent color (links, focus)
  success: Accent;
  warning: Accent;
  danger: Accent;
}

export interface Theme {
  id: string;
  label: string;
  // Shiki theme names (bundled) for markdown code + diffs, by color scheme.
  shiki: { light: string; dark: string };
  light: Palette;
  dark: Palette;
}

// A resolved color scheme. The chrome resolves this from the OS via a CSS
// `@media (prefers-color-scheme)` query; surface iframes are separate documents
// that don't reliably inherit that resolution, so the viewer passes the mode it
// resolved into each frame to pin it to the chrome (see surfacePage / Card).
export type Mode = "light" | "dark";

// Viewer chrome variables (styles.css names). Accent maps to the info state.
function viewerVars(p: Palette): Record<string, string> {
  return {
    bg: p.bg,
    panel: p.panel,
    surface: p.surface,
    text: p.text,
    muted: p.muted,
    faint: p.faint,
    border: p.border,
    "border-2": p.border2,
    accent: p.info.text,
    "accent-bg": p.info.bg,
    hover: p.hover,
    danger: p.danger.text,
  };
}

// Html-part design tokens (surfacePage names — the agent-facing contract).
// Same variable NAMES in both schemes; only the values change.
function tokenVars(p: Palette): Record<string, string> {
  return {
    "color-background-primary": p.surface,
    "color-background-secondary": p.panel,
    "color-background-tertiary": p.bg,
    "color-background-info": p.info.bg,
    "color-background-success": p.success.bg,
    "color-background-warning": p.warning.bg,
    "color-background-danger": p.danger.bg,
    "color-text-primary": p.text,
    "color-text-secondary": p.muted,
    "color-text-tertiary": p.faint,
    "color-text-info": p.info.text,
    "color-text-success": p.success.text,
    "color-text-warning": p.warning.text,
    "color-text-danger": p.danger.text,
    "color-border-primary": p.border2,
    "color-border-secondary": p.border,
    "color-border-tertiary": p.border,
    "color-border-info": p.info.border,
    "color-border-success": p.success.border,
    "color-border-warning": p.warning.border,
    "color-border-danger": p.danger.border,
  };
}

// Terminal chrome. Always sourced from the theme's DARK palette (a terminal
// reads as a terminal — ANSI output assumes a dark backdrop — so it stays dark
// in light mode too), but tinted to the theme so it doesn't look foreign.
function termVars(dark: Palette): Record<string, string> {
  return {
    "term-bg": dark.bg,
    "term-bar": dark.panel,
    "term-fg": dark.text,
    "term-title": dark.muted,
  };
}

const block = (vars: Record<string, string>) =>
  Object.entries(vars)
    .map(([k, v]) => `--${k}: ${v};`)
    .join("");

// `:root` light + a `prefers-color-scheme: dark` override — emitted as a
// <style> so the automatic OS light/dark flip keeps working with no JS. When
// `mode` is given the scheme is PINNED to it instead: a single flat `:root`
// block with no media query, so the document renders that mode regardless of
// the OS preference. The viewer uses this to force a surface iframe to the mode
// the chrome already resolved, since an iframe is a separate document whose
// `prefers-color-scheme` evaluation can diverge from its embedder's.
export function schemeCss(
  light: Record<string, string>,
  dark: Record<string, string>,
  mode?: Mode,
): string {
  if (mode === "light") return `:root{${block(light)}}`;
  if (mode === "dark") return `:root{${block(dark)}}`;
  return `:root{${block(light)}}@media (prefers-color-scheme: dark){:root{${block(dark)}}}`;
}

// Viewer chrome palette CSS (injected into the viewer document head). The
// scheme-flipping chrome vars, plus the terminal vars which are scheme-
// independent (always the dark palette) so they sit outside the media query.
// `mode` pins the scheme (see schemeCss) — used for the rich-part iframes the
// chrome renders via renderSandboxedPart, not the chrome's own <head>.
export function viewerThemeCss(t: Theme, mode?: Mode): string {
  return `${schemeCss(viewerVars(t.light), viewerVars(t.dark), mode)}:root{${block(termVars(t.dark))}}`;
}

// Html-part token CSS (injected into each sandboxed surface iframe). `mode`
// pins the scheme so the iframe matches the chrome (see schemeCss).
export function tokenThemeCss(t: Theme, mode?: Mode): string {
  return schemeCss(tokenVars(t.light), tokenVars(t.dark), mode);
}

// The one theme: dialkit's visual language (plan D9). Dark is dialkit's own
// palette; light is the prototype's light chrome with the same accents
// (docs/tmp/mockups/concepts/7-rethink/final/final.css, home.css). The prototype
// has no danger colour, so red is the one value picked here rather than copied.
export const DIALKIT: Theme = {
  id: "dialkit",
  label: "dialkit",
  shiki: { light: "github-light", dark: "github-dark" },
  light: {
    bg: "#fafafa",
    panel: "#f2f2f2",
    surface: "#ffffff",
    text: "#1a1a1a",
    muted: "#73726c",
    faint: "#a6a49d",
    border: "#e6e6e6",
    border2: "#d6d6d6",
    hover: "#ebebeb",
    info: { bg: "rgba(37, 99, 235, 0.1)", text: "#2563eb", border: "#2563eb" },
    success: { bg: "rgba(43, 147, 72, 0.12)", text: "#2b9348", border: "#2b9348" },
    warning: { bg: "#fff8e6", text: "#e8590c", border: "#f0e0b8" },
    danger: { bg: "rgba(220, 38, 38, 0.1)", text: "#dc2626", border: "#dc2626" },
  },
  dark: {
    bg: "#0f0f0f",
    panel: "#1f1f1f",
    surface: "#131313",
    text: "#f5f5f5",
    muted: "#8f8f8f",
    faint: "#5e5e5e",
    border: "#242424",
    border2: "#3a3a3a",
    hover: "#262626",
    info: { bg: "rgba(139, 123, 255, 0.16)", text: "#8b7bff", border: "#8b7bff" },
    success: { bg: "rgba(74, 222, 128, 0.14)", text: "#4ade80", border: "#4ade80" },
    warning: { bg: "#2a2312", text: "#e8590c", border: "#4a3c1c" },
    danger: { bg: "rgba(248, 113, 113, 0.14)", text: "#f87171", border: "#f87171" },
  },
};

export const THEMES: Theme[] = [DIALKIT];

export const DEFAULT_THEME_ID = DIALKIT.id;

// The workspace setting is just the mode; dark is the prototype's default.
export const DEFAULT_MODE: Mode = "dark";
export const isMode = (v: unknown): v is Mode => v === "light" || v === "dark";

// Any id resolves to the one theme, so stale ids persisted by older builds
// (and `?theme=` on cached URLs) keep rendering.
export function themeById(_id?: string | null): Theme {
  return DIALKIT;
}

export const themeOptions = () => THEMES.map((t) => ({ id: t.id, label: t.label }));

// --- Imported project palettes -------------------------------------------
//
// `mockpit init` reads a repo's own design tokens (a `:root{}` / `@theme`
// block from Tailwind or shadcn) and stores them per project. The raw text is
// injected verbatim into the html-surface sandbox, but the VIEWER chrome and
// the `--color-*` contract still need a Palette — so the recognised token
// names are mapped onto one here, runtime-agnostic like the rest of this file.
//
// Anything the repo doesn't declare falls back per field to the default theme,
// so a partial import can never leave a color undefined (an undefined token
// renders as unstyled black-on-white, which reads as "mockpit is broken"
// rather than "your repo declares no border color").

// Colour values arrive in three dialects: real CSS colors (`#fff`,
// `oklch(...)`), shadcn's channel-only triplets (`0 0% 100%`, meant to be
// wrapped by `hsl(var(--x))` at the use site), and bare rgb triplets. Only the
// first is usable as-is, so the other two are re-wrapped into a function.
function normalizeCssColor(raw: string): string | null {
  const v = raw.trim().replace(/\s*!important$/, "");
  if (!v) return null;
  if (v.startsWith("var(")) return null; // an indirection we can't resolve here
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^[a-z-]+\(/i.test(v)) return v; // oklch() / hsl() / rgb() / color-mix() / …
  // `H S% L%` or `H S% L% / A` — shadcn's pre-v4 channel form.
  if (/^-?[\d.]+(deg|turn|rad)?\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/.test(v)) {
    return `hsl(${v})`;
  }
  // `R G B` or `R G B / A` — Tailwind's channel form for rgb(var(--x)).
  if (/^\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?(\s*\/\s*[\d.]+%?)?$/.test(v)) {
    return `rgb(${v})`;
  }
  if (/^[a-z]+$/i.test(v)) return v; // named color (white, transparent, …)
  return null;
}

interface CssBlock {
  selector: string;
  dark: boolean;
  declarations: string;
}

const DARK_SELECTOR = /(^|[\s,.[:])dark\b|prefers-color-scheme\s*:\s*dark/i;

// Walk `selector { … }` blocks, recursing into at-rules so a
// `@media (prefers-color-scheme: dark) { :root { … } }` inherits the dark flag.
// Deliberately tolerant: this parses files we did not write and must never
// throw, so anything it can't understand is simply skipped.
function collectBlocks(css: string, dark: boolean, out: CssBlock[]): void {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) return;
    // Everything since the previous block can include statement at-rules
    // (`@import …;`, `@custom-variant dark (…);`) whose text would otherwise be
    // read as part of this selector — and `@custom-variant dark` would then
    // misfile the next block as a dark override. Keep only the last statement.
    const selector = css.slice(i, open).split(";").pop()!.trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      const ch = css[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, depth === 0 ? j - 1 : css.length);
    const isDark = dark || DARK_SELECTOR.test(selector);
    if (body.includes("{")) collectBlocks(body, isDark, out);
    else out.push({ selector, dark: isDark, declarations: body });
    i = j;
  }
}

function readCustomProps(declarations: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const re = /--([\w-]+)\s*:\s*([^;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(declarations))) vars[m[1]] = m[2].trim();
  return vars;
}

// Ordered lookup: first declared name wins, so a repo that defines both
// `--card` and `--background` gets the more specific one for a surface.
function pick(vars: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const raw = vars[name];
    if (raw == null) continue;
    const color = normalizeCssColor(raw);
    if (color) return color;
  }
  return null;
}

function accentFrom(
  vars: Record<string, string>,
  bg: string[],
  text: string[],
  border: string[],
  fallback: Accent,
): Accent {
  return {
    bg: pick(vars, bg) ?? fallback.bg,
    text: pick(vars, text) ?? fallback.text,
    border: pick(vars, border) ?? fallback.border,
  };
}

function paletteFrom(vars: Record<string, string>, fallback: Palette): Palette {
  return {
    bg: pick(vars, ["background", "color-background", "body-background"]) ?? fallback.bg,
    panel: pick(vars, ["muted", "secondary", "color-muted", "popover"]) ?? fallback.panel,
    surface: pick(vars, ["card", "popover", "background", "color-background"]) ?? fallback.surface,
    text: pick(vars, ["foreground", "color-foreground", "card-foreground"]) ?? fallback.text,
    muted: pick(vars, ["muted-foreground", "secondary-foreground"]) ?? fallback.muted,
    faint: pick(vars, ["muted-foreground", "secondary-foreground"]) ?? fallback.faint,
    border: pick(vars, ["border", "color-border", "input"]) ?? fallback.border,
    border2: pick(vars, ["input", "ring", "border", "color-border"]) ?? fallback.border2,
    hover: pick(vars, ["accent", "muted", "secondary"]) ?? fallback.hover,
    // `info` doubles as the accent/link color everywhere in the viewer, so it
    // is the one that must track the project's brand: primary for ink, accent
    // for the wash, ring for the focus edge.
    info: accentFrom(
      vars,
      ["accent", "primary-foreground", "secondary"],
      ["primary", "ring", "accent-foreground"],
      ["ring", "primary", "border"],
      fallback.info,
    ),
    // Tailwind/shadcn ship no success or warning token, so these stay on the
    // default theme unless a repo happens to declare them.
    success: accentFrom(
      vars,
      ["success-background", "success-bg"],
      ["success", "success-foreground"],
      ["success-border", "success"],
      fallback.success,
    ),
    warning: accentFrom(
      vars,
      ["warning-background", "warning-bg"],
      ["warning", "warning-foreground"],
      ["warning-border", "warning"],
      fallback.warning,
    ),
    danger: accentFrom(
      vars,
      ["destructive-background", "destructive-bg", "danger-bg"],
      ["destructive", "danger", "destructive-foreground"],
      ["destructive-border", "destructive", "danger"],
      fallback.danger,
    ),
  };
}

// Map a repo's CSS custom properties onto the two Palettes a theme needs.
// Returns null when the text declares no recognisable color token at all —
// the caller (`mockpit init`) then keeps the default theme rather than
// storing a palette that is 100% fallback.
//
// `--radius` is intentionally NOT mapped: Palette carries colors only, and the
// raw block is injected into the sandbox verbatim, so the repo's radius reaches
// surfaces through `var(--radius)` without a second source of truth.
export function paletteFromCssVars(cssVars: string): { light: Palette; dark: Palette } | null {
  if (!cssVars || !cssVars.trim()) return null;
  const blocks: CssBlock[] = [];
  // Strip comments first so a commented-out token can't win the ordered pick.
  collectBlocks(cssVars.replace(/\/\*[\s\S]*?\*\//g, ""), false, blocks);
  // A bare declaration list (no selector) is treated as the light root, so
  // callers may pass either `:root{…}` or just its contents.
  if (blocks.length === 0) blocks.push({ selector: ":root", dark: false, declarations: cssVars });

  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const b of blocks) {
    const vars = readCustomProps(b.declarations);
    Object.assign(b.dark ? dark : light, vars);
  }
  const base = themeById(DEFAULT_THEME_ID);
  const lightPalette = paletteFrom(light, base.light);
  // Dark inherits the light declarations first: a repo that only overrides
  // `--background`/`--foreground` in `.dark` still gets its brand `--primary`.
  // A repo with no dark block at all is single-palette (Loom, for one, is
  // dark-only with everything in `:root`) — reusing the same values in both
  // schemes keeps it looking like itself, where falling back to the default
  // theme's dark would make the two modes look like two different products.
  const darkPalette = paletteFrom({ ...light, ...dark }, base.dark);
  const recognised =
    JSON.stringify(lightPalette) !== JSON.stringify(base.light) ||
    JSON.stringify(darkPalette) !== JSON.stringify(base.dark);
  return recognised ? { light: lightPalette, dark: darkPalette } : null;
}
