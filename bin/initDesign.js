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

// Walk a root for .css files, bounded by MAX_FILES across the whole scan so a
// monorepo can't turn `mockpit init` into a full-disk crawl.
function findCssFiles(cwd, budget) {
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
      } else if (e.isFile() && e.name.endsWith(".css")) {
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
  let tailwindInCss = false;
  const fonts = new Set();
  for (const file of cssFiles) {
    let css;
    try {
      css = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (/@import\s+["']tailwindcss|@tailwind\s+(base|utilities)/.test(css)) tailwindInCss = true;
    if (!/@theme\b|:root\s*\{|\.dark\s*\{/.test(css)) continue;
    const tokens = extractTokens(css);
    for (const f of extractFonts(css)) fonts.add(f);
    if (tokens.count > 0 && (!best || tokens.count > best.count)) {
      best = { ...tokens, file };
    }
  }

  const tailwind = hasTailwind(cwd) || tailwindInCss;
  const shadcn = Boolean(readJson(join(cwd, "components.json"))?.aliases);
  const cssVars = best ? best.text : "";
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
    source: best ? relative(cwd, best.file) || basename(best.file) : null,
    kit: tailwind ? "tailwind" : "builtin",
  };
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
// Utilities only, with the repo's own custom properties reached through
// arbitrary values: the sandbox loads Tailwind's browser build and the repo's
// `:root` tokens, but NOT the repo's compiled theme — so `bg-background` would
// resolve to nothing while `bg-[var(--background)]` is exact.
const TAILWIND_BODY = `<section class="flex flex-col gap-3 rounded-xl border p-6 bg-[var(--card,var(--color-background-primary))] border-[var(--border,var(--color-border-secondary))]">
  <h2 class="text-lg font-semibold">Title</h2>
  <p class="text-sm text-[var(--muted-foreground,var(--color-text-secondary))]">Body copy.</p>
  <div class="flex gap-2">
    <button class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-[var(--primary,var(--color-text-info))] text-[var(--primary-foreground,var(--color-background-primary))]">ICON_SLOT Action</button>
    <button class="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium border-[var(--border,var(--color-border-secondary))]">Cancel</button>
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
  const body = (kit === "tailwind" ? TAILWIND_BODY : BUILTIN_BODY).replace(
    "ICON_SLOT",
    '<i icon="lucide:check"></i>',
  );
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
