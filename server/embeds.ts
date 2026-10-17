// Page composition: `<mockpit-embed slug="…" variant="…" version="…">` tags in a
// page item's html are expanded server-side by inlining the referenced variant
// version's first html surface body. Snapshot semantics — publish resolves a
// missing `version` to the component's current one and stores the resolved list
// on the post, so a page keeps rendering what it was composed from.
//
// Runtime-agnostic (no node imports) and string-only: the result is handed to
// renderHtmlPage, which serves it from /s/:id under the sandbox CSP header, so
// an inlined component body is exactly as contained as the page's own markup.
// `<mockpit-slot>`, the tag's first name, is still read: "slot" now means a
// part with alternative fills (fills.ts).

import type { Embed } from "./types.ts";

export interface EmbedTag {
  raw: string;
  slug: string;
  variant: string;
  version: number | null;
}

const EMBED_TAG = /<mockpit-(?:embed|slot)\b([^>]*?)(?:\/>|>\s*<\/mockpit-(?:embed|slot)\s*>|>)/gi;
const ATTR = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

export function parseEmbedTags(html: string): EmbedTag[] {
  const tags: EmbedTag[] = [];
  EMBED_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_TAG.exec(html))) {
    const attrs = attributes(m[1] ?? "");
    const slug = attrs.slug ?? "";
    if (!slug) continue;
    const version = Number(attrs.version);
    tags.push({
      raw: m[0],
      slug,
      variant: attrs.variant || "default",
      version: Number.isInteger(version) && version > 0 ? version : null,
    });
  }
  return tags;
}

// The embed list to store on a page post: every tag with its version resolved
// (a missing one pins to the component's current version at publish time).
export function resolveEmbeds(
  html: string,
  currentVersion: (slug: string, variant: string) => number | null,
): Embed[] {
  const embeds: Embed[] = [];
  for (const tag of parseEmbedTags(html)) {
    const version = tag.version ?? currentVersion(tag.slug, tag.variant);
    if (version == null) continue;
    embeds.push({ slug: tag.slug, variant: tag.variant, version });
  }
  return embeds;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Replace each tag with the resolved body. An unresolvable embed renders as an
// empty marked-up placeholder rather than vanishing, so a broken reference is
// visible in review instead of silently changing the layout.
export function expandEmbeds(
  html: string,
  body: (slot: { slug: string; variant: string; version: number | null }) => string | null,
): string {
  EMBED_TAG.lastIndex = 0;
  return html.replace(EMBED_TAG, (raw, attrRaw: string) => {
    const attrs = attributes(attrRaw ?? "");
    const slug = attrs.slug ?? "";
    if (!slug) return raw;
    const variant = attrs.variant || "default";
    const parsed = Number(attrs.version);
    const version = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    const resolved = body({ slug, variant, version });
    const label = `data-mockpit-embed="${escapeAttr(slug)}" data-mockpit-variant="${escapeAttr(
      variant,
    )}"${version == null ? "" : ` data-mockpit-version="${version}"`}`;
    return resolved == null
      ? `<div ${label} data-mockpit-missing="1"></div>`
      : `<div ${label}>${resolved}</div>`;
  });
}
