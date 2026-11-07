// Slots: a part with alternative swaps, declared in the agent's own markup.
//
//   <section data-part="entry" data-swap="dots">…</section>
//   <section data-part="entry" data-swap="skeleton">…</section>
//
// Elements sharing a `data-part` name with two or more distinct `data-swap`
// values make one slot. The first swap in document order is the default unless
// one carries `data-swap-default`. A swap may hold further slots: the scan
// records, for each slot, the swap it sits in, so the viewer can ask about it
// only while that swap is chosen.
//
// String-only and runtime-agnostic, like parts.ts: identity is read from the
// markup, never from a DOM. The scan is a tolerant tag walker, not a parser:
// it tracks open elements to know containment and each swap's extent, skips
// comments and raw-text elements, and treats an unclosed element as ending at
// the next close of an outer one.

import type { KnobConfig, Knobs, Surface } from "./types.ts";

export interface Swap {
  name: string;
  label?: string;
}

export interface SlotInfo {
  part: string;
  label?: string;
  swaps: Swap[];
  default: string;
  // The swap this slot sits inside, or null at the top of the screen.
  parent: { part: string; swap: string } | null;
}

interface Range {
  part: string;
  swap: string;
  start: number;
  // Just past the element's close tag (or the end of the markup when unclosed).
  end: number;
  // The open tag's extent, to strip the swap attributes from a kept swap.
  tagEnd: number;
}

export interface SwapScan {
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
// Longest names first, and each must end at the name's end: `data-swap`
// must not match the start of `data-swap-label`.
const ATTR =
  /\s(data-part-label|data-part|data-swap-label|data-swap-default|data-swap)(?=[\s=/>]|$)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
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
  swap: Range | null;
}

export function scanSwaps(html: string): SwapScan {
  const { slots, ranges } = scanAll(html);
  const real = slots.filter((s) => s.swaps.length >= 2);
  const isSlot = new Set(real.map((s) => s.part));
  return { slots: real, ranges: ranges.filter((r) => isSlot.has(r.part)) };
}

// Every part carrying `data-swap`, a lone swap included: a splice may add the
// second swap that makes it a slot.
function scanAll(html: string): SwapScan {
  const ranges: Range[] = [];
  // Per part, in document order: each swap element and the swap it sits in.
  const seen = new Map<
    string,
    { label?: string; swaps: Swap[]; defaults: string[]; parent: SlotInfo["parent"] }
  >();
  const stack: Open[] = [];
  const close = (i: number, end: number) => {
    for (let j = stack.length - 1; j >= i; j--) {
      const f = stack[j].swap;
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
    let swap: Range | null = null;
    const part = attrs["data-part"];
    const name = attrs["data-swap"];
    if (part && name && PATH_SEGMENT.test(part)) {
      swap = { part, swap: name, start: m.index, end: html.length, tagEnd: TOKEN.lastIndex };
      ranges.push(swap);
      let slot = seen.get(part);
      if (!slot && seen.size < MAX_SLOTS) {
        const outer = [...stack].reverse().find((o) => o.swap)?.swap ?? null;
        slot = {
          swaps: [],
          defaults: [],
          parent: outer ? { part: outer.part, swap: outer.swap } : null,
        };
        seen.set(part, slot);
      }
      if (slot) {
        if (attrs["data-part-label"] && !slot.label) slot.label = attrs["data-part-label"];
        if (!slot.swaps.some((f) => f.name === name)) {
          slot.swaps.push({
            name,
            ...(attrs["data-swap-label"] ? { label: attrs["data-swap-label"] } : {}),
          });
        }
        if ("data-swap-default" in attrs) slot.defaults.push(name);
      }
    }
    if (VOID.has(tag) || m[4] === "/") {
      if (swap) swap.end = TOKEN.lastIndex;
      continue;
    }
    if (RAW.has(tag)) {
      // Skip to the matching close: markup inside script or style is text.
      const endTag = new RegExp(`</${tag}\\s*>`, "gi");
      endTag.lastIndex = TOKEN.lastIndex;
      const e = endTag.exec(html);
      TOKEN.lastIndex = e ? endTag.lastIndex : html.length;
      if (swap) swap.end = TOKEN.lastIndex;
      continue;
    }
    stack.push({ tag, swap });
  }
  const slots: SlotInfo[] = [];
  for (const [part, s] of seen) {
    slots.push({
      part,
      ...(s.label ? { label: s.label } : {}),
      swaps: s.swaps,
      default: s.defaults[0] ?? s.swaps[0].name,
      parent: s.parent,
    });
  }
  return { slots, ranges };
}

// Each slot is a select knob at its part's path: the swaps are its options and
// the default swap is its value. A knob the agent declares at the same path
// wins (to relabel the options), so these are merged under declared knobs.
export function slotKnobs(slots: SlotInfo[]): Knobs {
  const out: Knobs = {};
  for (const s of slots) {
    const config: KnobConfig = {
      type: "select",
      options: s.swaps.map((f) => (f.label ? { value: f.name, label: f.label } : f.name)),
      value: s.default,
    };
    out[s.part] = config;
  }
  return out;
}

export const cssString = (s: string) =>
  `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r<>]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

// Shows only the chosen swap of each slot, keyed on the `data-k-<part>`
// attribute the knob runtime keeps on <html>. The chosen swap is never styled:
// only the others are hidden, so a swap keeps whatever display the agent gave it.
export function slotCss(slots: SlotInfo[]): string {
  const rules: string[] = [];
  for (const s of slots) {
    const attr = `data-k-${s.part}`;
    for (const f of s.swaps) {
      const el = `[data-part=${cssString(s.part)}][data-swap=${cssString(f.name)}]`;
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

const SWAP_ATTRS =
  /\s(data-swap-label|data-swap-default|data-swap)(?=[\s=/>]|$)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

// The screen as chosen: every slot reduced to its chosen swap, the others cut
// out with whatever they contained, and the swap attributes dropped from the
// swaps that stay. `chosen` maps a slot's part to a swap; a slot it does not
// name keeps its default.
export function composeSwaps(html: string, chosen: Record<string, string>): string {
  const { slots, ranges } = scanSwaps(html);
  const pick = new Map(slots.map((s) => [s.part, chosen[s.part] ?? s.default]));
  const cut = ranges.filter((r) => pick.get(r.part) !== r.swap);
  const kept = ranges.filter((r) => pick.get(r.part) === r.swap);
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
      text: html.slice(r.start, r.tagEnd).replace(SWAP_ATTRS, ""),
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
    for (const slot of scanSwaps(sf.html).slots) {
      if (!out.some((o) => o.part === slot.part)) out.push(slot);
    }
  }
  bySurfaces.set(surfaces, out);
  return out;
}

const attrValue = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const FIRST_TAG = /^(?:\s|<!--[\s\S]*?-->)*<([A-Za-z][\w:-]*)((?:\s[^<>]*?)?)(\/?)>/;

// The replacement must be one element marked as that swap: the marks are added
// when missing and a contradicting one is refused, so a splice cannot quietly
// land in another slot.
function markSwap(html: string, part: string, swap: string): string | { error: string } {
  const m = FIRST_TAG.exec(html);
  if (!m) return { error: `swap "${part}#${swap}" must be html starting with its element` };
  const attrs = attributes(m[2] ?? "");
  if (attrs["data-part"] !== undefined && attrs["data-part"] !== part) {
    return { error: `swap "${part}#${swap}" is marked data-part="${attrs["data-part"]}"` };
  }
  if (attrs["data-swap"] !== undefined && attrs["data-swap"] !== swap) {
    return { error: `swap "${part}#${swap}" is marked data-swap="${attrs["data-swap"]}"` };
  }
  const add =
    (attrs["data-part"] === undefined ? ` data-part="${attrValue(part)}"` : "") +
    (attrs["data-swap"] === undefined ? ` data-swap="${attrValue(swap)}"` : "");
  const at = m.index + m[0].indexOf("<") + 1 + m[1].length;
  return html.slice(0, at) + add + html.slice(at);
}

// The name a plain part's own markup goes by once an answer adds a swap to it.
export const AS_IS_SWAP = "as-is";

// How many elements declare this part, swaps counted once each. A swap can only be
// added to a part that is one thing or already has swaps.
export function partOccurrences(html: string, part: string): number {
  if (scanAll(html).ranges.some((r) => r.part === part)) return 1;
  let n = 0;
  walkOpenTags(html, (attrs) => {
    if (attrs["data-part"] === part) n++;
  });
  return n;
}

function walkOpenTags(
  html: string,
  visit: (attrs: Record<string, string>, tagNameEnd: number) => void,
): void {
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    if (m[0].startsWith("<!--") || m[1]) continue;
    const tag = m[2].toLowerCase();
    const end = TOKEN.lastIndex;
    visit(attributes(m[3] ?? ""), m.index + 1 + m[2].length);
    TOKEN.lastIndex = end;
    if (RAW.has(tag)) {
      const endTag = new RegExp(`</${tag}\\s*>`, "gi");
      endTag.lastIndex = end;
      const e = endTag.exec(html);
      TOKEN.lastIndex = e ? endTag.lastIndex : html.length;
    }
  }
}

// Adds a swap at render time, leaving the html as it was when it can't: a version
// without this part has nothing to swap, and one with its own swap of this name
// already says what that value means.
export function addSwap(html: string, part: string, swap: string, markup: string): string {
  const ranges = scanAll(html).ranges.filter((r) => r.part === part);
  if (ranges.some((r) => r.swap === swap)) return html;
  let base = html;
  if (ranges.length === 0) {
    const at: number[] = [];
    walkOpenTags(html, (attrs, tagNameEnd) => {
      if (attrs["data-part"] === part) at.push(tagNameEnd);
    });
    if (at.length !== 1) return html;
    base = `${html.slice(0, at[0])} data-swap="${AS_IS_SWAP}" data-swap-default${html.slice(at[0])}`;
  }
  const spliced = spliceSwaps([{ kind: "html", html: base }], { [`${part}#${swap}`]: markup });
  const surface = spliced.ok ? spliced.surfaces[0] : undefined;
  return surface?.kind === "html" ? surface.html : html;
}

export type SwapSplice =
  | { ok: true; surfaces: Surface[]; applied: string[] }
  | { ok: false; error: string };

// Replace one swap of a slot, or add it after the slot's last swap, keyed
// "part#swap". Like spliceParts, every target is located in the original
// markup and overlapping edits are refused.
export function spliceSwaps(surfaces: Surface[], edits: Record<string, string>): SwapSplice {
  const docs = surfaces.flatMap((s, i) => (s.kind === "html" ? [{ i, surface: s }] : []));
  if (docs.length === 0) {
    return { ok: false, error: "swaps needs an html surface; this alternative has none" };
  }
  const scans = docs.map((d) => scanAll(d.surface.html).ranges);
  const plan = new Map<number, { start: number; end: number; text: string; n: number }[]>();
  const targets = Object.keys(edits);
  for (const [n, target] of targets.entries()) {
    const at = target.indexOf("#");
    const part = at > 0 ? target.slice(0, at) : "";
    const swap = at > 0 ? target.slice(at + 1).trim() : "";
    if (!PATH_SEGMENT.test(part) || !swap) {
      return {
        ok: false,
        error: `swaps keys are "part#swap", e.g. "entry#skeleton" (got "${target}")`,
      };
    }
    const where = scans.flatMap((rs, d) => (rs.some((r) => r.part === part) ? [d] : []));
    if (where.length === 0) {
      return {
        ok: false,
        error: `no swaps of "${part}"; mark its alternatives data-part="${part}" data-swap="<name>" with html or parts first`,
      };
    }
    if (where.length > 1) {
      return {
        ok: false,
        error: `swaps of "${part}" are in several html surfaces; revise with surfaces`,
      };
    }
    const d = where[0];
    const own = scans[d].filter((r) => r.part === part);
    const same = own.filter((r) => r.swap === swap);
    if (same.length > 1) {
      return {
        ok: false,
        error: `swap "${target}" appears ${same.length} times; revise with html or parts`,
      };
    }
    const text = markSwap(edits[target], part, swap);
    if (typeof text !== "string") return { ok: false, error: text.error };
    const edit = same.length
      ? { start: same[0].start, end: same[0].end, text, n }
      : (() => {
          const end = Math.max(...own.map((r) => r.end));
          return { start: end, end, text: `\n${text}`, n };
        })();
    const list = plan.get(d) ?? [];
    const clash = list.find((e) => e.start < edit.end && edit.start < e.end);
    if (clash) {
      return { ok: false, error: `swaps "${targets[clash.n]}" and "${target}" overlap; send one` };
    }
    list.push(edit);
    plan.set(d, list);
  }
  const next = [...surfaces];
  for (const [d, list] of plan) {
    const { i, surface } = docs[d];
    let html = surface.html;
    // From the end, and same-place additions last-listed first, so they land in listed order.
    for (const e of list.toSorted((a, b) => b.start - a.start || b.n - a.n)) {
      html = html.slice(0, e.start) + e.text + html.slice(e.end);
    }
    next[i] = { ...surface, html };
  }
  return { ok: true, surfaces: next, applied: targets };
}
