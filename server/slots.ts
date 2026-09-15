// Page composition: `<sideshow-slot slug="…" variant="…" version="…">` tags in a
// page item's html are expanded server-side by inlining the referenced variant
// version's first html surface body. Snapshot semantics — publish resolves a
// missing `version` to the component's current one and stores the resolved list
// on the post, so a page keeps rendering what it was composed from.
//
// Runtime-agnostic (no node imports) and string-only: the result is handed to
// renderHtmlPage, which serves it from /s/:id under the sandbox CSP header, so
// an inlined component body is exactly as contained as the page's own markup.

import type { Slot } from "./types.ts";

export interface SlotTag {
  raw: string;
  slug: string;
  variant: string;
  version: number | null;
}

const SLOT_TAG = /<sideshow-slot\b([^>]*?)(?:\/>|>\s*<\/sideshow-slot\s*>|>)/gi;
const ATTR = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

export function parseSlotTags(html: string): SlotTag[] {
  const tags: SlotTag[] = [];
  SLOT_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLOT_TAG.exec(html))) {
    const attrs = attributes(m[1] ?? "");
    const slug = attrs.slug ?? attrs.item ?? "";
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

// The slot list to store on a page post: every tag with its version resolved
// (a missing one pins to the component's current version at publish time).
export function resolveSlots(
  html: string,
  currentVersion: (slug: string, variant: string) => number | null,
): Slot[] {
  const slots: Slot[] = [];
  for (const tag of parseSlotTags(html)) {
    const version = tag.version ?? currentVersion(tag.slug, tag.variant);
    if (version == null) continue;
    slots.push({ slug: tag.slug, variant: tag.variant, version });
  }
  return slots;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Replace each tag with the resolved body. An unresolvable slot renders as an
// empty marked-up placeholder rather than vanishing, so a broken reference is
// visible in review instead of silently changing the layout.
export function expandSlots(
  html: string,
  body: (slot: { slug: string; variant: string; version: number | null }) => string | null,
): string {
  SLOT_TAG.lastIndex = 0;
  return html.replace(SLOT_TAG, (raw, attrRaw: string) => {
    const attrs = attributes(attrRaw ?? "");
    const slug = attrs.slug ?? attrs.item ?? "";
    if (!slug) return raw;
    const variant = attrs.variant || "default";
    const parsed = Number(attrs.version);
    const version = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    const resolved = body({ slug, variant, version });
    const label = `data-sideshow-slot="${escapeAttr(slug)}" data-sideshow-variant="${escapeAttr(
      variant,
    )}"${version == null ? "" : ` data-sideshow-version="${version}"`}`;
    return resolved == null
      ? `<div ${label} data-sideshow-missing="1"></div>`
      : `<div ${label}>${resolved}</div>`;
  });
}
