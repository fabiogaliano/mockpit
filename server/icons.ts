// Icons by name: an agent writes `<i icon="lucide:check"></i>` and the server
// inlines the SVG from an Iconify JSON set at render time, so an icon costs the
// agent its name and the frame needs no fetch. Runtime-agnostic (no node
// imports): it runs inside renderHtmlPage on the Worker too.

// The subset of the Iconify JSON format (https://iconify.design/docs/types/)
// this renderer reads. Sets carry more (info, categories, chars); none of it
// affects how an icon draws.
export interface IconifyProps {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
}

export interface IconifyJSON extends Pick<IconifyProps, "width" | "height" | "left" | "top"> {
  prefix: string;
  icons: Record<string, IconifyProps & { body: string; hidden?: boolean }>;
  aliases?: Record<string, IconifyProps & { parent: string; hidden?: boolean }>;
}

// One icon ready to inline: its body and the viewBox it draws in.
export interface IconifyIcon {
  body: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export type IconResolver = (prefix: string, name: string) => IconifyIcon | null;

// Served with the server rather than installed per project: lucide (ISC) is
// what agents reach for by default, mage (Apache-2.0) is what `mockpit init`
// used to upload as a sprite, so mocks written against it keep rendering.
export const BUNDLED_ICON_PREFIXES = ["lucide", "mage"] as const;

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const isIconName = (s: unknown): s is string => typeof s === "string" && NAME_RE.test(s);

/** A parsed set, or null when `raw` is not a usable Iconify JSON set. */
export function parseIconSet(raw: unknown): IconifyJSON | null {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const set = data as Partial<IconifyJSON>;
  if (!isIconName(set.prefix) || !set.icons || typeof set.icons !== "object") return null;
  return set as IconifyJSON;
}

/** Icons a listing should show: hidden ones exist only so old names keep resolving. */
export const iconCount = (set: IconifyJSON): number =>
  Object.values(set.icons).filter((i) => !i.hidden).length;

// Bundled sets are imported on first use, not at module load: they are ~600 KB
// of JSON each, and a workspace that never renders an icon never pays for it.
let bundled: Promise<Map<string, IconifyJSON>> | undefined;
export function bundledIconSets(): Promise<Map<string, IconifyJSON>> {
  bundled ??= (async () => {
    const out = new Map<string, IconifyJSON>();
    const loaders: Record<(typeof BUNDLED_ICON_PREFIXES)[number], () => Promise<unknown>> = {
      lucide: () => import("@iconify-json/lucide/icons.json", { with: { type: "json" } }),
      mage: () => import("@iconify-json/mage/icons.json", { with: { type: "json" } }),
    };
    for (const prefix of BUNDLED_ICON_PREFIXES) {
      try {
        const mod = (await loaders[prefix]()) as { default: unknown };
        const set = parseIconSet(mod.default);
        if (set) out.set(prefix, set);
      } catch (err) {
        // A missing package costs that set's icons, never the render.
        console.warn(`[mockpit] bundled icon set ${prefix} unavailable`, err);
      }
    }
    return out;
  })();
  return bundled;
}

const MAX_ALIAS_DEPTH = 8;

/** Resolve `name` in `set`, following aliases and applying their transforms. */
export function iconFromSet(set: IconifyJSON, name: string): IconifyIcon | null {
  // Aliases stack: the outermost alias's box wins, flips toggle, rotations add.
  let box: IconifyProps = {};
  let rotate = 0;
  let hFlip = false;
  let vFlip = false;
  let current = name;
  for (let depth = 0; depth <= MAX_ALIAS_DEPTH; depth++) {
    const icon = Object.hasOwn(set.icons, current) ? set.icons[current] : undefined;
    const alias =
      !icon && set.aliases && Object.hasOwn(set.aliases, current)
        ? set.aliases[current]
        : undefined;
    const props = icon ?? alias;
    if (!props) return null;
    box = { width: props.width, height: props.height, left: props.left, top: props.top, ...box };
    for (const k of ["width", "height", "left", "top"] as const) {
      if (box[k] === undefined) delete box[k];
    }
    rotate += props.rotate ?? 0;
    if (props.hFlip) hFlip = !hFlip;
    if (props.vFlip) vFlip = !vFlip;
    if (icon) {
      const width = box.width ?? set.width ?? 16;
      const height = box.height ?? set.height ?? 16;
      const left = box.left ?? set.left ?? 0;
      const top = box.top ?? set.top ?? 0;
      return transform({ body: icon.body, left, top, width, height }, rotate % 4, hFlip, vFlip);
    }
    current = alias!.parent;
  }
  return null;
}

function transform(icon: IconifyIcon, rotate: number, hFlip: boolean, vFlip: boolean) {
  let { body, left, top, width, height } = icon;
  const flips = [
    hFlip ? `translate(${2 * left + width} 0) scale(-1 1)` : "",
    vFlip ? `translate(0 ${2 * top + height}) scale(1 -1)` : "",
  ].filter(Boolean);
  if (flips.length) body = `<g transform="${flips.join(" ")}">${body}</g>`;
  if (rotate) {
    const cx = left + width / 2;
    const cy = top + height / 2;
    body = `<g transform="rotate(${rotate * 90} ${cx} ${cy})">${body}</g>`;
    // A quarter turn swaps the box's sides around its center.
    if (rotate % 2 === 1) {
      [width, height] = [height, width];
      left = cx - width / 2;
      top = cy - height / 2;
    }
  }
  return { body, left, top, width, height };
}

/** A resolver over in-memory sets; earlier sets win a prefix. */
export function resolverFor(sets: Iterable<IconifyJSON>): IconResolver {
  const byPrefix = new Map<string, IconifyJSON>();
  for (const set of sets) if (!byPrefix.has(set.prefix)) byPrefix.set(set.prefix, set);
  return (prefix, name) => {
    const set = byPrefix.get(prefix);
    return set ? iconFromSet(set, name) : null;
  };
}

// --- expansion -------------------------------------------------------------

// Script, style and comment bodies are not markup: an icon attribute inside a
// JS string must stay a string, or the inlined quotes would break the script.
const OPAQUE_RE = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi;
const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*?)`;
const TAG_RE = new RegExp(`<([a-zA-Z][\\w-]*)(?:\\s${ATTRS})?(\\/?)>`, "g");
// The pre-expansion form `mockpit init` taught: a sprite reference.
const SPRITE_RE = new RegExp(
  `<svg\\b${ATTRS}>\\s*<use\\b${ATTRS}\\/?>\\s*(?:<\\/use>\\s*)?<\\/svg\\s*>`,
  "gi",
);
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

interface Attr {
  name: string;
  raw: string;
  value: string | null;
}

function parseAttrs(text: string): Attr[] {
  const out: Attr[] = [];
  for (const m of text.matchAll(ATTR_RE)) {
    out.push({ name: m[1].toLowerCase(), raw: m[0], value: m[2] ?? m[3] ?? m[4] ?? null });
  }
  return out;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const viewBox = (i: IconifyIcon) => `${fmt(i.left)} ${fmt(i.top)} ${fmt(i.width)} ${fmt(i.height)}`;

// The element's own attributes survive (data-part, style, title…); `class`
// gains `icon` for the 1em sizing, and a decorative icon is hidden from
// assistive tech unless the author labelled it.
function svgFor(attrs: Attr[], icon: IconifyIcon | null): string {
  const kept = attrs.filter((a) => a.name !== "icon" && a.name !== "class");
  const cls = attrs.find((a) => a.name === "class")?.value?.trim();
  const has = (n: string) => attrs.some((a) => a.name === n);
  const extra = [
    `class="${!cls ? "icon" : cls.split(/\s+/).includes("icon") ? cls : `icon ${cls}`}"`,
    ...kept.map((a) => a.raw),
    has("viewbox") ? "" : `viewBox="${icon ? viewBox(icon) : "0 0 24 24"}"`,
    has("aria-hidden") || has("role")
      ? ""
      : has("aria-label") || has("aria-labelledby")
        ? 'role="img"'
        : 'aria-hidden="true"',
  ].filter(Boolean);
  return `<svg ${extra.join(" ")}>${icon?.body ?? ""}</svg>`;
}

function expandSegment(html: string, resolve: IconResolver, unknown: Set<string>): string {
  const lookup = (prefix: string, name: string) => {
    const icon = resolve(prefix, name);
    if (!icon) unknown.add(`${prefix}:${name}`);
    return icon;
  };
  const sprites = html.replace(SPRITE_RE, (whole, svgAttrs: string, useAttrs: string) => {
    const href = parseAttrs(useAttrs).find((a) => a.name === "href" || a.name === "xlink:href");
    const m = href?.value?.match(/^#mage-(.+)$/);
    if (!m || !isIconName(m[1])) return whole;
    const icon = lookup("mage", m[1]);
    return icon ? svgFor(parseAttrs(svgAttrs), icon) : whole;
  });
  let out = "";
  let last = 0;
  for (const m of sprites.matchAll(TAG_RE)) {
    const attrs = m[2] ? parseAttrs(m[2]) : [];
    const spec = attrs.find((a) => a.name === "icon")?.value;
    const colon = spec?.indexOf(":") ?? -1;
    if (!spec || colon < 0) continue;
    const prefix = spec.slice(0, colon);
    const name = spec.slice(colon + 1);
    if (!isIconName(prefix) || !isIconName(name)) continue;
    let end = m.index + m[0].length;
    // Only an empty element is an icon; one with content is left alone so
    // nothing the author wrote is dropped.
    if (!m[3]) {
      const close = new RegExp(`^\\s*<\\/${m[1]}\\s*>`, "i").exec(sprites.slice(end));
      if (!close) continue;
      end += close[0].length;
    }
    out += sprites.slice(last, m.index) + svgFor(attrs, lookup(prefix, name));
    last = end;
  }
  return out + sprites.slice(last);
}

/**
 * Inline every `icon="prefix:name"` element (and the older
 * `<svg><use href="#mage-name"/></svg>` sprite form) as an `<svg>`. Names the
 * resolver does not know render as an empty 1em box and are listed in
 * `unknown`, in first-seen order.
 */
// Cheap pre-check so html without icons never loads a set.
export const mayHaveIcons = (html: string): boolean =>
  html.includes("icon=") || html.includes("#mage-");

export function expandIcons(
  html: string,
  resolve: IconResolver,
): { html: string; unknown: string[] } {
  if (!mayHaveIcons(html)) return { html, unknown: [] };
  const unknown = new Set<string>();
  let out = "";
  let last = 0;
  for (const m of html.matchAll(OPAQUE_RE)) {
    out += expandSegment(html.slice(last, m.index), resolve, unknown) + m[0];
    last = m.index + m[0].length;
  }
  out += expandSegment(html.slice(last), resolve, unknown);
  return { html: out, unknown: [...unknown] };
}
