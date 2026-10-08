// Design-system detection for `mockpit init`. Node built-ins only, so the CLI
// keeps its zero-runtime-dependency promise and can run straight from a
// checkout or from the packed npm tarball.
//
// The point of this file is that the agent never assembles a design set by
// hand: init reads what the repo already declares (Tailwind, shadcn, a `:root`
// token block, fonts), turns it into the project's DesignSettings, and writes a
// starter file the agent copies from. Everything here is deterministic — no
// model in the loop.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";

// The palette mapper lives in server/themes.ts so the server and the CLI can
// never disagree about what a repo's tokens mean. Node type-strips the .ts in a
// checkout; the packed CLI has only the compiled tree, hence the fallback.
async function loadThemes() {
  try {
    return await import("../server/themes.ts");
  } catch {
    return await import("../dist/server/themes.js");
  }
}

// Where repos actually keep their global stylesheet. Ordered by how likely the
// first hit is to be THE token file, because the first file with the most
// custom properties wins.
const CSS_ROOTS = [
  "src",
  "app",
  "styles",
  "css",
  "web/src",
  "web/app",
  "web/styles",
  "assets",
  "public",
  "",
];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  "vendor",
  "__snapshots__",
]);
const MAX_FILES = 200;
const MAX_DEPTH = 5;

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Walk a root for .css files (or what `match` accepts), bounded by MAX_FILES
// across the whole scan so a monorepo can't turn `mockpit init` into a
// full-disk crawl.
function findCssFiles(cwd, budget, match = (name) => name.endsWith(".css")) {
  const found = [];
  const walk = (dir, depth) => {
    if (found.length >= budget.left || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= budget.left) return;
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && match(e.name)) {
        budget.left--;
        found.push(full);
      }
    }
  };
  for (const root of CSS_ROOTS) {
    if (budget.left <= 0) break;
    const dir = root ? join(cwd, root) : cwd;
    if (!exists(dir)) continue;
    walk(dir, root ? 1 : 0);
  }
  return [...new Set(found)];
}

// --- minimal CSS block reader --------------------------------------------
// Only enough to pull declaration blocks out; it parses files we did not write
// and must never throw.

function readBlocks(css) {
  const out = [];
  const walk = (text) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open === -1) return;
      // Trailing statement at-rules (`@import …;`) sit in the same slice.
      const selector = text.slice(i, open).split(";").pop().trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        j++;
      }
      const body = text.slice(open + 1, depth === 0 ? j - 1 : text.length);
      if (body.includes("{")) walk(body);
      else out.push({ selector, body });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return out;
}

const TOKEN_SELECTOR = /^(:root|html|body|:host|\*|\.dark|:root\.dark|html\.dark|\[data-theme)/i;
const THEME_AT_RULE = /^@theme\b/i;

function customProps(body) {
  const props = [];
  const re = /--([\w-]+)\s*:\s*([^;]+)/g;
  let m;
  while ((m = re.exec(body))) props.push([m[1], m[2].trim()]);
  return props;
}

// The raw token text injected into every html surface for this project. Token
// blocks (`:root`, `.dark`, …) are kept verbatim so the repo's own values —
// including `--radius` and anything mockpit doesn't map — reach the sandbox.
// `@theme` blocks are NOT valid CSS outside Tailwind's compiler, so only their
// resolvable declarations (not the `var(--x)` aliases Tailwind re-exports) are
// folded into `:root`.
function extractTokens(css) {
  const blocks = readBlocks(css);
  const pieces = [];
  const themeProps = [];
  let count = 0;
  for (const b of blocks) {
    const props = customProps(b.body);
    if (props.length === 0) continue;
    if (TOKEN_SELECTOR.test(b.selector)) {
      pieces.push(`${b.selector}{${b.body.trim()}}`);
      count += props.length;
    } else if (THEME_AT_RULE.test(b.selector)) {
      for (const [name, value] of props) {
        if (value.startsWith("var(")) continue;
        themeProps.push(`--${name}: ${value};`);
        count++;
      }
    }
  }
  if (themeProps.length) pieces.unshift(`:root{${themeProps.join("")}}`);
  return { text: pieces.join("\n"), count };
}

// Font families the repo declares: @font-face names plus any `font-family` /
// `--font-*` token. Reported so the brief guide can tell the agent which
// families are actually available in the frame.
function extractFonts(css) {
  const fonts = new Set();
  const add = (value) => {
    const first = value
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "");
    if (first && !/^(inherit|initial|unset|var\()/.test(first) && !first.startsWith("-apple")) {
      fonts.add(first);
    }
  };
  for (const m of css.matchAll(/@font-face\s*\{[^}]*font-family\s*:\s*([^;}]+)/gi)) add(m[1]);
  for (const m of css.matchAll(/--font(?:-family)?[\w-]*\s*:\s*([^;}]+)/gi)) add(m[1]);
  for (const m of css.matchAll(/(?:^|[;{])\s*font-family\s*:\s*([^;}]+)/gi)) add(m[1]);
  return [...fonts].slice(0, 8);
}

// The only ids the Tailwind v4 browser build resolves for `@import`; any other
// import, and every `@plugin` or `@config`, makes its compile throw, which
// would leave the frame with no utilities at all.
const TAILWIND_CORE_IMPORTS = new Set([
  "tailwindcss",
  ...["preflight", "theme", "utilities"].flatMap((f) => [
    `tailwindcss/${f}`,
    `tailwindcss/${f}.css`,
  ]),
]);
const TAILWIND_ENTRY = /@import\s+(?:url\(\s*)?["']tailwindcss["']/;
const TAILWIND_V3 = /@tailwind\s+(base|components|utilities)/;
const IMPORT_RULE =
  /@(import|plugin|config)\s+(url\(\s*(?:"[^"]*"|'[^']*'|[^)]*?)\s*\)|"[^"]*"|'[^']*')[^;]*;?/g;
const TAILWIND_CSS_MAX = 128_000;

const unquote = (s) =>
  s
    .replace(/^url\(\s*|\s*\)$/g, "")
    .trim()
    .replace(/^["']|["']$/g, "");

/**
 * The repo's Tailwind entry stylesheet reduced to what the browser build can
 * compile, so the frame gets the repo's own theme and `bg-card` works.
 * `{css, strippedImports}`, or null when the result would not compile or fit.
 */
export function tailwindSource(css) {
  // A v3 entry's theme lives in tailwind.config, which the browser build
  // cannot load; its `@apply border-border` would then throw.
  if (TAILWIND_V3.test(css)) return null;
  const stripped = [];
  let text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  text = text.replace(IMPORT_RULE, (rule, kind, target) => {
    const id = unquote(target);
    if (kind === "import" && TAILWIND_CORE_IMPORTS.has(id)) return rule;
    stripped.push(id);
    return "";
  });
  text = text.replace(/\n\s*\n(\s*\n)+/g, "\n\n").trim();
  if (!/@import\b/.test(text)) text = `@import "tailwindcss";\n${text}`;
  if (text.length > TAILWIND_CSS_MAX) return null;
  return { css: text, strippedImports: [...new Set(stripped)] };
}

function hasTailwind(cwd) {
  if (
    ["js", "cjs", "mjs", "ts", "cts", "mts"].some((ext) =>
      exists(join(cwd, `tailwind.config.${ext}`)),
    )
  ) {
    return true;
  }
  const pkg = readJson(join(cwd, "package.json"));
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  return Boolean(deps.tailwindcss || deps["@tailwindcss/vite"] || deps["@tailwindcss/postcss"]);
}

/**
 * Inspect a repo and derive the project's DesignSettings inputs.
 * Never throws on a hostile/odd tree — an undetectable repo returns the
 * builtin kit with no palette, which is a perfectly good starting point.
 */
export async function detectDesign(cwd) {
  const { paletteFromCssVars } = await loadThemes();
  const budget = { left: MAX_FILES };
  const cssFiles = findCssFiles(cwd, budget);

  let best = null;
  let entry = null;
  const fonts = new Set();
  for (const file of cssFiles) {
    let css;
    try {
      css = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (TAILWIND_ENTRY.test(css) || TAILWIND_V3.test(css)) {
      const count = customProps(css).length;
      if (!entry || count > entry.count) entry = { file, css, count };
    }
    if (!/@theme\b|:root\s*\{|\.dark\s*\{/.test(css)) continue;
    const tokens = extractTokens(css);
    for (const f of extractFonts(css)) fonts.add(f);
    if (tokens.count > 0 && (!best || tokens.count > best.count)) {
      best = { ...tokens, file };
    }
  }

  const tailwind = hasTailwind(cwd) || entry !== null;
  const shadcn = Boolean(readJson(join(cwd, "components.json"))?.aliases);
  const cssVars = best ? best.text : "";
  let tailwindFile = tailwind ? (entry?.file ?? best?.file ?? null) : null;
  let tw = null;
  if (tailwindFile) {
    try {
      tw = tailwindSource(entry ? entry.css : readFileSync(tailwindFile, "utf8"));
    } catch {
      tw = null;
    }
    if (!tw) tailwindFile = null;
  }
  const rel = (file) => relative(cwd, file) || basename(file);
  return {
    detected: {
      tailwind,
      shadcn,
      cssVars: best ? best.count : 0,
      fonts: [...fonts].slice(0, 8),
    },
    palette: cssVars ? paletteFromCssVars(cssVars) : null,
    cssVars,
    // Where the tokens came from, relative to the repo — `init` prints it so
    // the operator can see which file was imported.
    source: best ? rel(best.file) : null,
    kit: tailwind ? "tailwind" : "builtin",
    tailwindCss: tw ? tw.css : "",
    strippedImports: tw ? tw.strippedImports : [],
    tailwindSource: tailwindFile ? rel(tailwindFile) : null,
    designFiles: readDesignFiles(cwd, `${cssVars}\n${tw ? tw.css : ""}`),
  };
}

// --- design files ---------------------------------------------------------
// What a repo already says about its design, read as data for the brief:
// Google Labs' DESIGN.md, DTCG token files, and shadcn's components.json.
// Every reader here parses files we did not write and returns null, never
// throws, on anything it does not understand.

const DOS_MAX = 1_500;
const TOKENS_MAX = 400;
const COMPONENTS_MAX = 80;
const VALUE_MAX = 120;
// The design PUT refuses a larger designFiles blob; init sheds tokens first.
export const DESIGN_FILES_MAX = 32_000;

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function scalar(raw) {
  let v = raw.trim();
  if (v.startsWith('"') || v.startsWith("'")) {
    const end = v.indexOf(v[0], 1);
    return end === -1 ? v.slice(1) : v.slice(1, end);
  }
  // `primary: #fff` is a comment to YAML, but a color is what the author meant.
  const comment = v.search(/\s#/);
  if (comment !== -1) v = v.slice(0, comment).trim();
  return v;
}

// Block-style YAML maps only: `key: value` and `key:` over an indented block,
// any depth. Lists, anchors and flow collections are skipped, which is all a
// DESIGN.md front matter needs for its token maps.
function readYamlMap(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const m = line.match(/^(\s*)("[^"]*"|'[^']*'|[^:#\s][^:]*?)\s*:(?:\s+(.*))?$/);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const key = scalar(m[2]);
    const value = m[3] === undefined ? "" : scalar(m[3]);
    if (value === "" || value === "|" || value === ">") {
      parent[key] = {};
      stack.push({ indent, node: parent[key] });
    } else {
      parent[key] = value;
    }
  }
  return root;
}

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function pathGet(root, path) {
  let node = root;
  for (const k of path.split(".")) {
    if (!isMap(node) || !Object.hasOwn(node, k)) return undefined;
    node = node[k];
  }
  return node;
}

// `{colors.primary}` becomes the value it names, following a short chain.
function resolveRefs(root, value) {
  let v = value;
  for (let hop = 0; hop < 4; hop++) {
    const m = v.match(/^\{([\w.-]+)\}$/);
    const target = m ? pathGet(root, m[1]) : undefined;
    if (typeof target !== "string") break;
    v = target;
  }
  return v;
}

function flatMap(root, node, depth) {
  const out = {};
  if (!isMap(node)) return out;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string") out[k] = resolveRefs(root, v).slice(0, VALUE_MAX);
    else if (depth > 0 && isMap(v)) out[k] = flatMap(root, v, depth - 1);
  }
  return out;
}

/** A DESIGN.md's token maps, section headings and Do's and Don'ts text. */
export function readDesignMd(text) {
  try {
    const fm = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    const yaml = fm ? readYamlMap(fm[1]) : {};
    const body = fm ? text.slice(fm[0].length) : text;
    const headings = [...body.matchAll(/^##[ \t]+(.+?)[ \t#]*$/gm)].map((m) => m[1]).slice(0, 20);
    let dos = "";
    const start = body.search(/^##[ \t]+Do[’']?s[ \t]+(?:and|&)[ \t]+Don[’']?ts\b/im);
    if (start !== -1) {
      const rest = body.slice(start).replace(/^.*(?:\r?\n|$)/, "");
      const next = rest.search(/^##\s/m);
      dos = (next === -1 ? rest : rest.slice(0, next)).trim().slice(0, DOS_MAX);
    }
    return {
      name: typeof yaml.name === "string" ? yaml.name.slice(0, VALUE_MAX) : "",
      colors: flatMap(yaml, yaml.colors, 0),
      typography: flatMap(yaml, yaml.typography, 1),
      rounded: flatMap(yaml, yaml.rounded, 0),
      spacing: flatMap(yaml, yaml.spacing, 0),
      components: flatMap(yaml, yaml.components, 1),
      headings,
      dos,
    };
  } catch {
    return null;
  }
}

const TOKEN_TYPES = new Set(["color", "dimension", "fontFamily", "fontWeight", "number"]);
const isTokenFile = (name) =>
  name === "tokens.json" || name === "design-tokens.json" || name.endsWith(".tokens.json");

// DTCG 2025.10 values may be structured; the brief wants one CSS-like string.
function tokenText(v) {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(tokenText).join(", ");
  if (isMap(v)) {
    if (typeof v.hex === "string") return v.hex;
    if (v.value !== undefined && typeof v.unit === "string") return `${v.value}${v.unit}`;
    if (typeof v.colorSpace === "string" && Array.isArray(v.components)) {
      return `color(${v.colorSpace} ${v.components.join(" ")})`;
    }
  }
  return null;
}

function collectTokens(node, path, inherited, out) {
  if (!isMap(node)) return;
  const type = typeof node.$type === "string" ? node.$type : inherited;
  if (Object.hasOwn(node, "$value")) {
    out.set(path.join("."), { type, value: node.$value });
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (!k.startsWith("$")) collectTokens(v, [...path, k], type, out);
  }
}

// `{a.b}` or `{"$ref": "#/a/b/$value"}` gives `a.b`; a plain value gives null.
function aliasTarget(value) {
  if (typeof value === "string") return value.match(/^\{([^{}]+)\}$/)?.[1] ?? null;
  if (isMap(value) && typeof value.$ref === "string") {
    return value.$ref
      .replace(/^#\//, "")
      .replace(/\/\$value$/, "")
      .split("/")
      .join(".");
  }
  return null;
}

/** DTCG token files flattened to `name -> value`, `{count, values}` or null. */
export function readTokenFiles(files) {
  const all = new Map();
  for (const file of files) {
    const json = readJson(file);
    if (isMap(json)) collectTokens(json, [], undefined, all);
  }
  const values = {};
  let count = 0;
  for (const [name, token] of all) {
    let { type, value } = token;
    // One level deep: an alias to an alias stays a reference.
    const target = aliasTarget(value);
    if (target && all.has(target)) {
      type ??= all.get(target).type;
      value = all.get(target).value;
    }
    if (!TOKEN_TYPES.has(type)) continue;
    const ref = aliasTarget(value);
    const text = ref ? `{${ref}}` : tokenText(value);
    if (text === null) continue;
    count++;
    if (count <= TOKENS_MAX) values[name] = text.slice(0, VALUE_MAX);
  }
  return count ? { count, values } : null;
}

// tsconfig is JSONC: comments and trailing commas, outside strings.
function readJsonc(path) {
  const text = readText(path);
  if (text === null) return null;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else out += ch;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

// Where shadcn put its components: the `ui` alias mapped through tsconfig
// `paths`, then the two layouts the shadcn CLI writes by default.
function uiDirs(cwd, alias) {
  const dirs = [];
  if (alias) {
    const compiler = readJsonc(join(cwd, "tsconfig.json"))?.compilerOptions ?? {};
    const base = join(cwd, typeof compiler.baseUrl === "string" ? compiler.baseUrl : ".");
    for (const [pattern, targets] of Object.entries(isMap(compiler.paths) ? compiler.paths : {})) {
      const prefix = pattern.replace(/\*$/, "");
      if (!pattern.endsWith("*") || !alias.startsWith(prefix) || !Array.isArray(targets)) continue;
      for (const t of targets) {
        if (typeof t !== "string") continue;
        dirs.push(join(base, t.replace(/\*$/, ""), alias.slice(prefix.length)));
      }
    }
    if (!/^[@~#]/.test(alias)) dirs.push(join(cwd, alias));
  }
  dirs.push(join(cwd, "src", "components", "ui"), join(cwd, "components", "ui"));
  return dirs;
}

function readShadcn(cwd) {
  const config = readJson(join(cwd, "components.json"));
  if (!isMap(config)) return null;
  const aliases = isMap(config.aliases) ? config.aliases : {};
  let alias = "";
  if (typeof aliases.ui === "string") alias = aliases.ui;
  else if (typeof aliases.components === "string") alias = `${aliases.components}/ui`;
  let components = [];
  for (const dir of uiDirs(cwd, alias)) {
    try {
      components = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() || /\.(tsx|ts|jsx|js|vue|svelte)$/.test(e.name))
        .map((e) => e.name.replace(/\.[^.]+$/, ""))
        .filter((n) => !n.startsWith(".") && n !== "index");
      break;
    } catch {
      // not this layout
    }
  }
  const str = (v) => (typeof v === "string" ? v.slice(0, 60) : "");
  return {
    style: str(config.style),
    baseColor: str(isMap(config.tailwind) ? config.tailwind.baseColor : ""),
    iconLibrary: str(config.iconLibrary),
    components: [...new Set(components)].sort().slice(0, COMPONENTS_MAX),
  };
}

/**
 * The repo's own design descriptions: DESIGN.md at the root, DTCG token
 * files, and shadcn's components.json. `css` is the stylesheet text the frame
 * gets, to tell whether token names also exist as CSS custom properties.
 * Null when the repo has none of them.
 */
export function readDesignFiles(cwd, css = "") {
  const files = {};
  const md = readText(join(cwd, "DESIGN.md"));
  const designMd = md === null ? null : readDesignMd(md);
  if (designMd) files.designMd = designMd;
  const tokenFiles = findCssFiles(cwd, { left: MAX_FILES }, isTokenFile);
  const tokens = tokenFiles.length ? readTokenFiles(tokenFiles) : null;
  if (tokens) {
    const names = Object.keys(tokens.values);
    // A DTCG file emits no CSS by itself: `var(--name)` works only for a
    // token whose dashed name the frame's stylesheet declares.
    const declared = new Set(customProps(css).map(([name]) => name));
    files.tokens = {
      files: tokenFiles.map((f) => relative(cwd, f)).slice(0, 20),
      count: tokens.count,
      cssVars:
        tokens.count === names.length && names.every((n) => declared.has(n.replace(/\./g, "-"))),
      values: tokens.values,
    };
    // Tokens are the one unbounded part; shed them until the blob fits.
    while (JSON.stringify(files).length > DESIGN_FILES_MAX && names.length) {
      for (const n of names.splice(Math.floor(names.length / 2))) delete files.tokens.values[n];
    }
  }
  const shadcn = readShadcn(cwd);
  if (shadcn) files.shadcn = shadcn;
  return Object.keys(files).length ? files : null;
}

// --- icon sets ------------------------------------------------------------

// Icon packages a repo may already use, mapped to the Iconify prefix that
// draws the same icons. react-icons bundles many sets under one name, so it
// maps to none.
const ICON_PACKAGES = [
  [/^@iconify-json\/([a-z0-9][a-z0-9-]*)$/, (m) => m[1]],
  [/^lucide(-[a-z-]+)?$/, () => "lucide"],
  [/^@tabler\/icons/, () => "tabler"],
  [/^@phosphor-icons\//, () => "ph"],
  [/^@heroicons\//, () => "heroicons"],
];

function dirNames(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * The Iconify prefixes this repo's own icon packages correspond to, read from
 * package.json and the top level of node_modules. `[{prefix, from}]`, one per
 * prefix.
 */
export function detectIconSets(cwd) {
  const pkg = readJson(join(cwd, "package.json"));
  const names = new Set(Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }));
  const modules = join(cwd, "node_modules");
  for (const name of dirNames(modules)) {
    if (!name.startsWith("@")) names.add(name);
    else for (const sub of dirNames(join(modules, name))) names.add(`${name}/${sub}`);
  }
  const found = new Map();
  for (const name of [...names].sort()) {
    for (const [re, toPrefix] of ICON_PACKAGES) {
      const m = name.match(re);
      if (!m) continue;
      const prefix = toPrefix(m);
      if (!found.has(prefix)) found.set(prefix, { prefix, from: name });
    }
  }
  return [...found.values()];
}

// Only what draws an icon; info, categories and search hints are dropped so a
// large set stays under the asset size limit.
function slimIconSet(set) {
  const out = { prefix: set.prefix, icons: set.icons };
  for (const k of ["aliases", "width", "height", "left", "top"]) {
    if (set[k] !== undefined) out[k] = set[k];
  }
  return out;
}

function readIconSet(path, prefix) {
  const set = readJson(path);
  return set && set.prefix === prefix && set.icons && typeof set.icons === "object" ? set : null;
}

const versionParts = (v) => v.split(/[.@-]/).map((n) => Number(n) || 0);
const newestFirst = (a, b) => {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  return 0;
};

// Installed copies that cost a directory listing at most: the project (and
// its parents, as Node resolves), the global npm root, and bun's cache. The
// pnpm store is content-addressed, so it is not searched.
function localIconSetPaths(prefix, cwd) {
  const paths = [];
  const file = `@iconify-json/${prefix}/icons.json`;
  try {
    paths.push(createRequire(join(cwd, "noop.js")).resolve(file));
  } catch {
    // not installed in the project
  }
  try {
    const root = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (root) paths.push(join(root, file));
  } catch {
    // no npm on PATH
  }
  const bunCache = join(homedir(), ".bun", "install", "cache", "@iconify-json");
  const cached = dirNames(bunCache)
    .filter((d) => d.startsWith(`${prefix}@`))
    .map((d) => d.slice(prefix.length + 1))
    .sort(newestFirst);
  for (const version of cached) paths.push(join(bunCache, `${prefix}@${version}`, "icons.json"));
  return paths;
}

export const ICONIFY_CDN = "https://cdn.jsdelivr.net/npm";

/**
 * Find the Iconify JSON set for `prefix`: an installed copy if one is cheap to
 * reach, else jsDelivr. Resolves `{ set, source }`; rejects with a one-line
 * message when the set does not exist or cannot be fetched.
 */
export async function findIconSet(prefix, cwd) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(prefix)) {
    throw new Error(`"${prefix}" is not an Iconify prefix (lowercase, e.g. lucide)`);
  }
  for (const path of localIconSetPaths(prefix, cwd)) {
    const set = readIconSet(path, prefix);
    if (set) return { set: slimIconSet(set), source: path };
  }
  const url = `${ICONIFY_CDN}/@iconify-json/${prefix}/icons.json`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    const why = err?.cause?.code ?? err?.name ?? "network error";
    throw new Error(`could not fetch ${prefix} from jsDelivr (${why})`);
  }
  if (res.status === 404) {
    throw new Error(`no icon set "${prefix}" on jsDelivr (@iconify-json/${prefix})`);
  }
  if (!res.ok) throw new Error(`could not fetch ${prefix} from jsDelivr (${res.status})`);
  const set = await res.json().catch(() => null);
  if (!set || set.prefix !== prefix || !set.icons) {
    throw new Error(`@iconify-json/${prefix} on jsDelivr is not an Iconify set`);
  }
  return { set: slimIconSet(set), source: url };
}

// --- starter file ---------------------------------------------------------

// The starter is the whole point of init from the agent's side: one file that
// already speaks the project's kit, tokens and icons, so the first publish is a
// copy-and-edit rather than a guess. Two bodies, because the class vocabulary
// differs: Tailwind's utilities vs the builtin kit's components.
// The theme classes resolve because the frame compiles the repo's own Tailwind
// entry stylesheet (`tailwindCss`).
const TAILWIND_BODY = `<section class="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-card-foreground">
  <h2 class="text-lg font-semibold">Title</h2>
  <p class="text-sm text-muted-foreground">Body copy.</p>
  <div class="flex gap-2">
    <button class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">ICON_SLOT Action</button>
    <button class="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium">Cancel</button>
  </div>
</section>`;

const BUILTIN_BODY = `<section class="card">
  <div class="card-header">
    <h2 class="card-title">Title</h2>
    <p class="card-desc">Body copy.</p>
  </div>
  <div class="card-footer">
    <button class="btn btn-primary">ICON_SLOT Action</button>
    <button class="btn btn-ghost">Cancel</button>
  </div>
</section>`;

// Basecoat 1.x: a card is header/section/footer children and variants are
// `data-variant`, not the builtin's `.btn-primary` classes.
const BASECOAT_BODY = `<div class="card">
  <header>
    <h2>Title</h2>
    <p>Body copy.</p>
  </header>
  <footer>
    <button class="btn">ICON_SLOT Action</button>
    <button class="btn" data-variant="ghost">Cancel</button>
  </footer>
</div>`;

const STARTER_TOKENS = [
  "background",
  "foreground",
  "card",
  "primary",
  "muted-foreground",
  "border",
  "radius",
  "font-sans",
];

/**
 * The text of `.mockpit/starter.html` — a body fragment (never a full
 * document; that is the html contract) showing the project's kit classes, its
 * tokens, and one icon in use. `iconSets` are the prefixes the server resolves
 * for this project.
 */
export function renderStarter(design, iconSets = ["lucide", "mage"]) {
  const kit = design?.kit ?? "builtin";
  const bodies = { tailwind: TAILWIND_BODY, basecoat: BASECOAT_BODY };
  const body = (bodies[kit] ?? BUILTIN_BODY).replace("ICON_SLOT", '<i icon="lucide:check"></i>');
  // Show the tokens an agent reaches for first. A repo's block is usually led
  // by sizing/easing tokens, so surface the semantic colors ahead of them.
  const props = customProps(design?.cssVars ?? "");
  const rank = (name) => {
    const i = STARTER_TOKENS.indexOf(name);
    return i === -1 ? STARTER_TOKENS.length : i;
  };
  const tokens = props
    .slice()
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .slice(0, 6)
    .map(([name, value]) => `       var(--${name}) = ${value}`)
    .join("\n");
  return `<!-- .mockpit/starter.html — copy this, don't publish it as-is.
     Send the BODY FRAGMENT only; mockpit wraps it in a themed sandbox.
     kit: ${kit} · icons: ${iconSets.join(", ")}, as <i icon="prefix:name"></i>
${tokens ? `     tokens imported from this repo:\n${tokens}\n` : ""}     Colors come from these vars or from mockpit's --color-* tokens
     (--color-text-primary, --color-background-primary, …), never a hardcoded
     hex — every surface has to read in both light and dark. -->
${body}
`;
}
