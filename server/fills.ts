// Slots: a part with alternative fills, declared in the agent's own markup.
//
//   <section data-part="entry" data-fill="dots">…</section>
//   <section data-part="entry" data-fill="skeleton">…</section>
//
// Elements sharing a `data-part` name with two or more distinct `data-fill`
// values make one slot. The first fill in document order is the default unless
// one carries `data-fill-default`. A fill may hold further slots: the scan
// records, for each slot, the fill it sits in, so the viewer can ask about it
// only while that fill is chosen.
//
// String-only and runtime-agnostic, like parts.ts: identity is read from the
// markup, never from a DOM. The scan is a tolerant tag walker, not a parser:
// it tracks open elements to know containment and each fill's extent, skips
// comments and raw-text elements, and treats an unclosed element as ending at
// the next close of an outer one.

import type { KnobConfig, Knobs, Surface } from "./types.ts";

export interface Fill {
  name: string;
  label?: string;
}

export interface SlotInfo {
  part: string;
  label?: string;
  fills: Fill[];
  default: string;
  // The fill this slot sits inside, or null at the top of the screen.
  parent: { part: string; fill: string } | null;
}

interface Range {
  part: string;
  fill: string;
  start: number;
  // Just past the element's close tag (or the end of the markup when unclosed).
  end: number;
  // The open tag's extent, to strip the fill attributes from a kept fill.
  tagEnd: number;
}

export interface FillScan {
  slots: SlotInfo[];
  ranges: Range[];
}

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const RAW = new Set(["script", "style", "textarea", "title"]);
const TOKEN = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s[^<>]*?)?)(\/?)>/g;
// Longest names first, and each must end at the name's end: `data-fill`
// must not match the start of `data-fill-label`.
const ATTR =
  /\s(data-part-label|data-part|data-fill-label|data-fill-default|data-fill)(?=[\s=/>]|$)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
// A slot's knob path is its part name, so the name must be a valid path segment.
const PATH_SEGMENT = /^[A-Za-z_][\w-]{0,63}$/;
const MAX_SLOTS = 100;

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim()
    .slice(0, 200);

function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw))) out[m[1]] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

interface Open {
  tag: string;
  fill: Range | null;
}

export function scanFills(html: string): FillScan {
  const ranges: Range[] = [];
  // Per part, in document order: each fill element and the fill it sits in.
  const seen = new Map<
    string,
    { label?: string; fills: Fill[]; defaults: string[]; parent: SlotInfo["parent"] }
  >();
  const stack: Open[] = [];
  const close = (i: number, end: number) => {
    for (let j = stack.length - 1; j >= i; j--) {
      const f = stack[j].fill;
      if (f) f.end = end;
    }
    stack.length = i;
  };
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          close(i, TOKEN.lastIndex);
          break;
        }
      }
      continue;
    }
    const tag = m[2].toLowerCase();
    const attrs = attributes(m[3] ?? "");
    let fill: Range | null = null;
    const part = attrs["data-part"];
    const name = attrs["data-fill"];
    if (part && name && PATH_SEGMENT.test(part)) {
      fill = { part, fill: name, start: m.index, end: html.length, tagEnd: TOKEN.lastIndex };
      ranges.push(fill);
      let slot = seen.get(part);
      if (!slot && seen.size < MAX_SLOTS) {
        const outer = [...stack].reverse().find((o) => o.fill)?.fill ?? null;
        slot = {
          fills: [],
          defaults: [],
          parent: outer ? { part: outer.part, fill: outer.fill } : null,
        };
        seen.set(part, slot);
      }
      if (slot) {
        if (attrs["data-part-label"] && !slot.label) slot.label = attrs["data-part-label"];
        if (!slot.fills.some((f) => f.name === name)) {
          slot.fills.push({
            name,
            ...(attrs["data-fill-label"] ? { label: attrs["data-fill-label"] } : {}),
          });
        }
        if ("data-fill-default" in attrs) slot.defaults.push(name);
      }
    }
    if (VOID.has(tag) || m[4] === "/") {
      if (fill) fill.end = TOKEN.lastIndex;
      continue;
    }
    if (RAW.has(tag)) {
      // Skip to the matching close: markup inside script or style is text.
      const endTag = new RegExp(`</${tag}\\s*>`, "gi");
      endTag.lastIndex = TOKEN.lastIndex;
      const e = endTag.exec(html);
      TOKEN.lastIndex = e ? endTag.lastIndex : html.length;
      if (fill) fill.end = TOKEN.lastIndex;
      continue;
    }
    stack.push({ tag, fill });
  }
  const slots: SlotInfo[] = [];
  for (const [part, s] of seen) {
    if (s.fills.length < 2) continue;
    slots.push({
      part,
      ...(s.label ? { label: s.label } : {}),
      fills: s.fills,
      default: s.defaults[0] ?? s.fills[0].name,
      parent: s.parent,
    });
  }
  const isSlot = new Set(slots.map((s) => s.part));
  return { slots, ranges: ranges.filter((r) => isSlot.has(r.part)) };
}

// Each slot is a select knob at its part's path: the fills are its options and
// the default fill is its value. A knob the agent declares at the same path
// wins (to relabel the options), so these are merged under declared knobs.
export function slotKnobs(slots: SlotInfo[]): Knobs {
  const out: Knobs = {};
  for (const s of slots) {
    const config: KnobConfig = {
      type: "select",
      options: s.fills.map((f) => (f.label ? { value: f.name, label: f.label } : f.name)),
      value: s.default,
    };
    out[s.part] = config;
  }
  return out;
}

const cssString = (s: string) =>
  `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r<>]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

// Shows only the chosen fill of each slot, keyed on the `data-k-<part>`
// attribute the knob runtime keeps on <html>. The chosen fill is never styled:
// only the others are hidden, so a fill keeps whatever display the agent gave it.
export function slotCss(slots: SlotInfo[]): string {
  const rules: string[] = [];
  for (const s of slots) {
    const attr = `data-k-${s.part}`;
    for (const f of s.fills) {
      const el = `[data-part=${cssString(s.part)}][data-fill=${cssString(f.name)}]`;
      const chosen = `[${attr}=${cssString(f.name)}]`;
      rules.push(
        f.name === s.default
          ? `html[${attr}]:not(${chosen}) ${el}{display:none!important}`
          : `html:not(${chosen}) ${el}{display:none!important}`,
      );
    }
  }
  return rules.join("\n");
}

const FILL_ATTRS =
  /\s(data-fill-label|data-fill-default|data-fill)(?=[\s=/>]|$)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

// The screen as chosen: every slot reduced to its chosen fill, the others cut
// out with whatever they contained, and the fill attributes dropped from the
// fills that stay. `chosen` maps a slot's part to a fill; a slot it does not
// name keeps its default.
export function composeFills(html: string, chosen: Record<string, string>): string {
  const { slots, ranges } = scanFills(html);
  const pick = new Map(slots.map((s) => [s.part, chosen[s.part] ?? s.default]));
  const cut = ranges.filter((r) => pick.get(r.part) !== r.fill);
  const kept = ranges.filter((r) => pick.get(r.part) === r.fill);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const r of cut) {
    if (cut.some((o) => o !== r && o.start <= r.start && r.end <= o.end)) continue;
    edits.push({ start: r.start, end: r.end, text: "" });
  }
  for (const r of kept) {
    if (cut.some((o) => o.start <= r.start && r.end <= o.end)) continue;
    edits.push({
      start: r.start,
      end: r.tagEnd,
      text: html.slice(r.start, r.tagEnd).replace(FILL_ATTRS, ""),
    });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// A post's slots across its html surfaces (the first surface that declares a
// part wins), cached per surfaces array: a stored post never mutates it.
const bySurfaces = new WeakMap<Surface[], SlotInfo[]>();
export function slotsInSurfaces(surfaces: Surface[]): SlotInfo[] {
  const hit = bySurfaces.get(surfaces);
  if (hit) return hit;
  const out: SlotInfo[] = [];
  for (const sf of surfaces) {
    if (sf.kind !== "html") continue;
    for (const slot of scanFills(sf.html).slots) {
      if (!out.some((o) => o.part === slot.part)) out.push(slot);
    }
  }
  bySurfaces.set(surfaces, out);
  return out;
}
