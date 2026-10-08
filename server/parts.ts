// The parts an agent marked in its html (`data-part`, optional `data-part-label`
// and `data-part-key`). Read server-side from the markup string with a regex —
// geometry is the bridge's job, identity is declared, so no DOM is needed.

import type { Surface } from "./types.ts";

export interface PartInfo {
  name: string;
  label?: string;
  // Instance keys seen for this part, in document order.
  keys?: string[];
}

export interface PartChanges {
  vanished: string[];
  renamed: { from: string; to: string }[];
}

const TAG_RE = /<[A-Za-z][\w:-]*(\s[^<>]*)?>/g;
const ATTR_RE = /\sdata-part(-label|-key)?\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const MAX_PARTS = 200;

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

export function partsInHtml(html: string): PartInfo[] {
  const byName = new Map<string, PartInfo>();
  for (const tag of html.matchAll(TAG_RE)) {
    const attrs = tag[1];
    if (!attrs || !attrs.includes("data-part")) continue;
    let name: string | undefined;
    let label: string | undefined;
    let key: string | undefined;
    for (const a of attrs.matchAll(ATTR_RE)) {
      const value = decode(a[2] ?? a[3] ?? a[4] ?? "").slice(0, 200);
      if (a[1] === "-label") label = value;
      else if (a[1] === "-key") key = value;
      else name = value;
    }
    if (!name) continue;
    let part = byName.get(name);
    if (!part) {
      if (byName.size >= MAX_PARTS) break;
      part = { name };
      byName.set(name, part);
    }
    if (label && !part.label) part.label = label;
    if (key) {
      part.keys ??= [];
      if (!part.keys.includes(key)) part.keys.push(key);
    }
  }
  return [...byName.values()];
}

export function partsInSurfaces(surfaces: Surface[]): PartInfo[] {
  return mergeParts(surfaces.flatMap((s) => (s.kind === "html" ? [partsInHtml(s.html)] : [])));
}

// Union several part lists by name, first occurrence first.
export function mergeParts(lists: PartInfo[][]): PartInfo[] {
  const byName = new Map<string, PartInfo>();
  for (const list of lists) {
    for (const p of list) {
      const have = byName.get(p.name);
      if (!have) {
        byName.set(p.name, { ...p, ...(p.keys ? { keys: [...p.keys] } : {}) });
        continue;
      }
      if (p.label && !have.label) have.label = p.label;
      for (const k of p.keys ?? []) {
        have.keys ??= [];
        if (!have.keys.includes(k)) have.keys.push(k);
      }
    }
  }
  return [...byName.values()];
}

// What happened to the previous version's parts. A part that disappeared but
// whose key or label reappears under a new name was renamed — comments anchored
// on it re-anchor by key, so the agent should know which name it now answers to.
export function diffParts(before: PartInfo[], after: PartInfo[]): PartChanges {
  const afterNames = new Set(after.map((p) => p.name));
  const beforeNames = new Set(before.map((p) => p.name));
  const added = after.filter((p) => !beforeNames.has(p.name));
  const vanished: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const taken = new Set<string>();
  for (const old of before) {
    if (afterNames.has(old.name)) continue;
    const match = added.find(
      (p) =>
        !taken.has(p.name) &&
        ((old.keys ?? []).some((k) => (p.keys ?? []).includes(k)) ||
          (!!old.label && old.label === p.label)),
    );
    if (match) {
      taken.add(match.name);
      renamed.push({ from: old.name, to: match.name });
    } else vanished.push(old.name);
  }
  return { vanished, renamed };
}

// --- part-scoped revisions ---
// A revision that touches one part should cost that part, not the whole
// document: the agent sends new outer html for `data-part="name"` and the
// server splices it into the current html. Located with a small tokenizer
// rather than the regex above, because a splice must know where the element
// ENDS, and a `>` in a quoted attribute, a comment or script text must not
// fool it.

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
// Their content is text up to the matching close tag, so tags inside are not tags.
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title", "xmp"]);

interface Tag {
  type: "open" | "close";
  name: string;
  start: number;
  end: number;
  // Open tags only: the text between the name and `>`.
  attrs: string;
  selfClosing: boolean;
}

const NAME_RE = /[A-Za-z][\w:.-]*/y;

// Where the close tag of a raw-text element starts, or the end of the string.
function rawTextEnd(html: string, name: string, from: number): number {
  const close = new RegExp(`</${name}[\\s/>]`, "ig");
  close.lastIndex = from;
  return close.exec(html)?.index ?? html.length;
}

function* tags(html: string): Generator<Tag> {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) return;
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      if (close < 0) return;
      i = close + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const close = html.indexOf(">", lt + 2);
      if (close < 0) return;
      i = close + 1;
      continue;
    }
    const isClose = html[lt + 1] === "/";
    NAME_RE.lastIndex = lt + (isClose ? 2 : 1);
    const m = NAME_RE.exec(html);
    if (!m) {
      i = lt + 1;
      continue;
    }
    const name = m[0].toLowerCase();
    const nameEnd = lt + (isClose ? 2 : 1) + m[0].length;
    const end = tagEnd(html, nameEnd);
    if (end < 0) return;
    if (isClose) {
      yield { type: "close", name, start: lt, end, attrs: "", selfClosing: false };
      i = end;
      continue;
    }
    const attrs = html.slice(nameEnd, end - 1);
    const selfClosing = /\/\s*$/.test(attrs);
    yield { type: "open", name, start: lt, end, attrs, selfClosing };
    i = RAW_TEXT_TAGS.has(name) && !selfClosing ? rawTextEnd(html, name, end) : end;
  }
}

// Index just past the `>` that ends a tag, skipping quoted attribute values.
function tagEnd(html: string, from: number): number {
  let i = from;
  while (i < html.length) {
    const ch = html[i];
    if (ch === ">") return i + 1;
    i++;
    if (ch !== "=") continue;
    while (i < html.length && /\s/.test(html[i])) i++;
    const q = html[i];
    if (q !== '"' && q !== "'") continue;
    const close = html.indexOf(q, i + 1);
    if (close < 0) return -1;
    i = close + 1;
  }
  return -1;
}

interface PartElement {
  name: string;
  key?: string;
  open: Tag;
}

function partElements(html: string): PartElement[] {
  const out: PartElement[] = [];
  for (const tag of tags(html)) {
    if (tag.type !== "open" || !tag.attrs.includes("data-part")) continue;
    let name: string | undefined;
    let key: string | undefined;
    for (const a of ` ${tag.attrs}`.matchAll(ATTR_RE)) {
      const value = decode(a[2] ?? a[3] ?? a[4] ?? "");
      if (a[1] === "-key") key = value;
      else if (!a[1]) name = value;
    }
    if (name) out.push({ name, key, open: tag });
  }
  return out;
}

type Range = { start: number; end: number } | { error: string };

const label = (el: { name: string; key?: string }) => (el.key ? `${el.name}#${el.key}` : el.name);

// The outer-html range of one part element: from its open tag to the close
// tag that balances it, counting only tags of the same name so unrelated
// sloppy markup inside does not matter.
function elementRange(html: string, el: PartElement): Range {
  const { open } = el;
  if (open.selfClosing || VOID_TAGS.has(open.name)) return { start: open.start, end: open.end };
  const unclosed = {
    error: `part "${label(el)}": <${open.name}> is never closed; balance the markup or revise the whole html`,
  };
  if (RAW_TEXT_TAGS.has(open.name)) {
    const at = rawTextEnd(html, open.name, open.end);
    const end = at < html.length ? html.indexOf(">", at) : -1;
    return end < 0 ? unclosed : { start: open.start, end: end + 1 };
  }
  let depth = 1;
  for (const tag of tags(html.slice(open.end))) {
    if (tag.name !== open.name) continue;
    if (tag.type === "open") {
      if (!tag.selfClosing) depth++;
    } else if (--depth === 0) {
      return { start: open.start, end: open.end + tag.end };
    }
  }
  return unclosed;
}

// "name" or "name#key".
function parseTarget(target: string): { name: string; key?: string } {
  const hash = target.lastIndexOf("#");
  if (hash <= 0) return { name: target };
  return { name: target.slice(0, hash), key: target.slice(hash + 1) };
}

function present(elements: PartElement[]): string {
  const names = [...new Set(elements.map((e) => e.name))];
  return names.length ? names.join(", ") : "none (mark parts with data-part)";
}

function matches(elements: PartElement[], target: string): PartElement[] {
  const { name, key } = parseTarget(target);
  const found = elements.filter((e) => e.name === name && (key === undefined || e.key === key));
  // A part name may itself contain "#".
  if (key !== undefined && found.length === 0) return elements.filter((e) => e.name === target);
  return found;
}

function resolve(html: string, elements: PartElement[], target: string): Range {
  const found = matches(elements, target);
  if (found.length === 0) {
    const { name, key } = parseTarget(target);
    const instances = elements.filter((e) => e.name === name);
    if (key !== undefined && instances.length) {
      return {
        error: `part "${name}" has no key "${key}"; instances: ${instances.map(label).join(", ")}`,
      };
    }
    return { error: `no part "${target}"; parts present: ${present(elements)}` };
  }
  if (found.length > 1) {
    return {
      error: found.every((e) => e.key !== undefined)
        ? `part "${target}" has ${found.length} instances; target one: ${found.map(label).join(", ")}`
        : `part "${target}" has ${found.length} instances without data-part-key; key them or revise the whole html`,
    };
  }
  return elementRange(html, found[0]);
}

// Replace the outer html of one part. `target` is "name" or "name#key".
export function splicePart(
  html: string,
  target: string,
  replacement: string,
): { html: string } | { error: string } {
  const range = resolve(html, partElements(html), target);
  if ("error" in range) return range;
  return { html: html.slice(0, range.start) + replacement + html.slice(range.end) };
}

export type PartSplice =
  | { ok: true; surfaces: Surface[]; applied: string[] }
  | { ok: false; error: string };

// Apply several part edits to a version's html surfaces. Every target is
// located in the ORIGINAL markup, so the result does not depend on the order
// the edits were listed in; overlapping targets are refused rather than guessed.
export function spliceParts(surfaces: Surface[], edits: Record<string, string>): PartSplice {
  const docs = surfaces.flatMap((s, i) => (s.kind === "html" ? [{ i, surface: s }] : []));
  if (docs.length === 0) {
    return { ok: false, error: "parts needs an html surface; this variant has none" };
  }
  const elements = docs.map((d) => partElements(d.surface.html));
  const ranges = new Map<number, { start: number; end: number; target: string }[]>();
  for (const target of Object.keys(edits)) {
    const where = elements.flatMap((els, n) => (matches(els, target).length ? [n] : []));
    if (where.length > 1) {
      return {
        ok: false,
        error: `part "${target}" is in several html surfaces (${where.map((n) => docs[n].i).join(", ")}); edit one with edit_surface`,
      };
    }
    // With no match, the surface that has the bare name explains the bad key.
    const { name } = parseTarget(target);
    const n = where[0] ?? elements.findIndex((els) => els.some((e) => e.name === name));
    const range: Range =
      n < 0
        ? { error: `no part "${target}"; parts present: ${present(elements.flat())}` }
        : resolve(docs[n].surface.html, elements[n], target);
    if ("error" in range) return { ok: false, error: range.error };
    const list = ranges.get(n) ?? [];
    const overlap = list.find((r) => r.start < range.end && range.start < r.end);
    if (overlap) {
      return { ok: false, error: `parts "${overlap.target}" and "${target}" overlap; send one` };
    }
    list.push({ ...range, target });
    ranges.set(n, list);
  }
  const next = [...surfaces];
  for (const [n, list] of ranges) {
    const { i, surface } = docs[n];
    let html = surface.html;
    for (const r of list.toSorted((a, b) => b.start - a.start)) {
      html = html.slice(0, r.start) + edits[r.target] + html.slice(r.end);
    }
    next[i] = { ...surface, html };
  }
  return { ok: true, surfaces: next, applied: Object.keys(edits) };
}
