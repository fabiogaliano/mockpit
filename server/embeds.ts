// Composition: `<mockpit-embed slug="…" variant="…" version="…">` tags in any
// mock's html are expanded server-side by inlining the referenced variant
// version's first html surface body, recursively, so a component can be built
// from components. A tag without `version` follows the version in use when the
// variant it resolves to is accepted, else its latest; one without `variant`
// follows the component's accepted variant.
// Publish records the versions it saw on the post (`Post.embeds`), so what a
// version rendered with stays answerable.
//
// Runtime-agnostic (no node imports) and string-only: the result is handed to
// renderHtmlPage, which serves it from /s/:id under the sandbox CSP header, so
// an inlined component body is exactly as contained as the page's own markup.
// `<mockpit-slot>`, the tag's first name, is still read: "slot" now means a
// part with alternative fills (fills.ts).

import type { Embed } from "./types.ts";

export interface EmbedTag {
  slug: string;
  // null: the component's accepted variant.
  variant: string | null;
  // null: the version in use if accepted, else the latest.
  version: number | null;
}

// What a tag resolved to: the variant and version shown, and its html body.
// `attrs` (pre-escaped) go on the wrapper: the component's settled knob values,
// so the page shows the component as decided. `stamp` names those values for
// the embeds key, so deciding something on a component re-renders its pages.
export interface ResolvedEmbed {
  variant: string;
  version: number;
  html: string;
  attrs?: string;
  stamp?: string;
}

export type EmbedResolver = (tag: EmbedTag) => Promise<ResolvedEmbed | null>;

// Deep enough for page › section › component › control; past it a chain is
// almost certainly a mistake and costs a render each time.
export const MAX_EMBED_DEPTH = 6;

const EMBED_TAG = /<mockpit-(?:embed|slot)\b([^>]*?)(?:\/>|>\s*<\/mockpit-(?:embed|slot)\s*>|>)/gi;
const ATTR = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

function tagOf(attrRaw: string): EmbedTag | null {
  const attrs = attributes(attrRaw);
  const slug = attrs.slug ?? "";
  if (!slug) return null;
  const version = Number(attrs.version);
  return {
    slug,
    variant: attrs.variant || null,
    version: Number.isInteger(version) && version > 0 ? version : null,
  };
}

export function parseEmbedTags(html: string): EmbedTag[] {
  const tags: EmbedTag[] = [];
  EMBED_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_TAG.exec(html))) {
    const tag = tagOf(m[1] ?? "");
    if (tag) tags.push(tag);
  }
  return tags;
}

export const hasEmbedTags = (html: string): boolean => /<mockpit-(?:embed|slot)\b/i.test(html);

// The html with every reference to mock `from` pointed at `to`: the slug of
// each embed tag naming it, and each data-goto naming it ("from" or
// "from:<state>"). What a slug rename writes into every stored version, so
// each version still renders the same component it did.
export function renameSlugRefs(html: string, from: string, to: string): string {
  if (!html.includes(from)) return html;
  EMBED_TAG.lastIndex = 0;
  return html
    .replace(EMBED_TAG, (tag: string, raw: string = "") => {
      if ((attributes(raw).slug ?? "") !== from) return tag;
      const next = raw.replace(
        /(^|\s)(slug\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i,
        (_m, lead: string, key: string) => `${lead}${key}"${to}"`,
      );
      return tag.replace(raw, () => next);
    })
    .replace(
      /(\sdata-goto\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi,
      (m: string, key: string, dq?: string, sq?: string) => {
        const value = dq ?? sq ?? "";
        // "next" and "prev" are directions, never a mock.
        if (value === "next" || value === "prev") return m;
        const colon = value.indexOf(":");
        const mock = (colon < 0 ? value : value.slice(0, colon)).trim();
        if (mock !== from) return m;
        const q = dq === undefined ? "'" : '"';
        return `${key}${q}${to}${colon < 0 ? "" : value.slice(colon)}${q}`;
      },
    );
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export interface Expanded {
  html: string;
  // Every embed rendered, nested ones included, in document order.
  used: Embed[];
  // Each used embed's settled-values stamp, in the same order.
  stamps: string[];
  // The first slug chain that loops back on itself (["page", "card", "page"]).
  cycle: string[] | null;
}

// Replace each tag with its resolved body, expanding that body's own tags in
// turn. `stack` is the chain of slugs being expanded (the root mock's first),
// so a component that reaches back up renders a marked placeholder instead of
// recursing. An unresolvable embed renders as an empty marked-up placeholder
// rather than vanishing, so a broken reference is visible in review instead of
// silently changing the layout.
export async function expandHtml(
  html: string,
  resolve: EmbedResolver,
  stack: string[],
): Promise<Expanded> {
  const used: Embed[] = [];
  const stamps: string[] = [];
  let cycle: string[] | null = null;
  const matches: { tag: EmbedTag | null }[] = [];
  EMBED_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_TAG.exec(html))) matches.push({ tag: tagOf(m[1] ?? "") });

  const bodies: (string | null)[] = [];
  for (const { tag } of matches) {
    if (!tag) {
      bodies.push(null);
      continue;
    }
    const label = (variant: string | null, version: number | null) =>
      `data-mockpit-embed="${escapeAttr(tag.slug)}"${
        variant ? ` data-mockpit-variant="${escapeAttr(variant)}"` : ""
      }${version == null ? "" : ` data-mockpit-version="${version}"`}`;
    if (stack.includes(tag.slug)) {
      cycle ??= [...stack.slice(stack.indexOf(tag.slug)), tag.slug];
      bodies.push(`<div ${label(tag.variant, tag.version)} data-mockpit-cycle="1"></div>`);
      continue;
    }
    if (stack.length >= MAX_EMBED_DEPTH) {
      bodies.push(`<div ${label(tag.variant, tag.version)} data-mockpit-too-deep="1"></div>`);
      continue;
    }
    const resolved = await resolve(tag);
    if (!resolved) {
      bodies.push(`<div ${label(tag.variant, tag.version)} data-mockpit-missing="1"></div>`);
      continue;
    }
    used.push({
      slug: tag.slug,
      variant: resolved.variant,
      version: resolved.version,
      ...(tag.version != null ? { pinned: true as const } : {}),
    });
    stamps.push(resolved.stamp ?? "");
    const inner = await expandHtml(resolved.html, resolve, [...stack, tag.slug]);
    used.push(...inner.used);
    stamps.push(...inner.stamps);
    cycle ??= inner.cycle;
    bodies.push(
      `<div ${label(resolved.variant, resolved.version)}${resolved.attrs ?? ""}>${inner.html}</div>`,
    );
  }
  let i = 0;
  EMBED_TAG.lastIndex = 0;
  const out = html.replace(EMBED_TAG, (raw) => bodies[i++] ?? raw);
  return { html: out, used, stamps, cycle };
}

// A short, stable key for what a document's embeds resolved to: part of the
// render cache key and of the frame URL, so a component's new version reloads
// every page that shows it and a stale document is never served as current.
export function embedsKey({ used, stamps }: Pick<Expanded, "used" | "stamps">): string {
  let h = 0x811c9dc5;
  const s = used.map((e, i) => `${e.slug}:${e.variant}@${e.version}:${stamps[i] ?? ""}`).join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
