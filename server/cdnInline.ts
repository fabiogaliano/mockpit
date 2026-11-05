// Bakes what an html surface links from the CDN allowlist into its document: fonts as
// data: URLs, stylesheets and classic scripts inline. Nothing a sandboxed frame fetches
// is cached or shared in Chrome, while its version-pinned document comes from disk
// cache, so a byte in the document is paid once and a byte behind a link on every load
// of every frame.
//
// Everything here degrades to the link the agent wrote, which still works: the CSP
// allows the same hosts. What may not happen is a doc with a passing failure kept for a
// year, so `complete` says whether every fetch came back; a document that isn't complete
// isn't stored or served as immutable. Leaving a tag because of what it is (a module, too
// large, past the cap) gives the same answer every time, so it doesn't count.
//
// Runtime-agnostic: runs on the Worker. Works on the document as text, since there is
// no DOM here, and only reaches what the document itself would have loaded.

import { CDN_ALLOWLIST, checkCdnUrl } from "./cdn.ts";

// What one document may grow by. The largest common single-file libraries (three, d3,
// a tailwind build) fit under it with a font or two, while a document stays small enough
// that a render cache of 32 MB still holds dozens.
export const MAX_INLINE_BYTES = 1024 * 1024;
// A held-up CDN must not hold the frame up for long: past the document's deadline the
// render goes out with links, and the fetch carries on to fill the cache for the next one.
const FETCH_TIMEOUT_MS = 3000;
const DOC_DEADLINE_MS = 4000;
// A CDN that is down is asked again after this, not by every frame on the screen.
const RETRY_AFTER_MS = 60_000;
const MAX_REDIRECTS = 3;
const MAX_IMPORT_DEPTH = 3;
// Beside the 32 MB render cache, inside the Worker's 128 MB isolate.
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
const MAX_FAILED_URLS = 512;

// Google Fonts picks its CSS by User-Agent. Always one modern one: every browser that
// runs the viewer takes variable woff2 and unicode-range, the answer is the smallest of
// them, and the document can't vary by who asked, since its cache key doesn't.
const FONT_CSS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type Fetched =
  // `url` is where it ended up after redirects: relative URLs inside resolve against it.
  | { kind: "ok"; url: string; contentType: string; bytes: Uint8Array }
  | { kind: "too-big" }
  | { kind: "failed" };

type Held = Exclude<Fetched, { kind: "failed" }>;

export interface InlineResult {
  doc: string;
  complete: boolean;
}

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(parts.join(""));
}

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get("content-length")) > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// Each hop is checked against the allowlist before it is followed, so a CDN can't
// walk the server to a host the frame itself would be refused.
async function fetchFromCdn(url: string, signal: AbortSignal): Promise<Fetched> {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkCdnUrl(at, "url");
    if ("error" in checked) return { kind: "failed" };
    const headers: Record<string, string> =
      new URL(at).hostname === "fonts.googleapis.com" ? { "user-agent": FONT_CSS_UA } : {};
    const res = await fetch(checked.url, { redirect: "manual", signal, headers });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const to = res.headers.get("location");
      if (!to) return { kind: "failed" };
      at = new URL(to, at).href;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { kind: "failed" };
    }
    const bytes = await readCapped(res, MAX_INLINE_BYTES);
    if (!bytes) return { kind: "too-big" };
    return {
      kind: "ok",
      url: at,
      contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
      bytes,
    };
  }
  return { kind: "failed" };
}

// --- a tag at a time, since regexes over html would rewrite markup inside a script's
// strings, a comment or a template, which the browser wouldn't have loaded ---

interface Tag {
  name: string;
  attrs: Map<string, string>;
  // Just past the `>`.
  end: number;
}

const decodeAttr = (s: string): string =>
  s
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

function readTag(doc: string, start: number): Tag | null {
  let i = start + 1;
  const nameStart = i;
  while (i < doc.length && !isSpace(doc[i]) && doc[i] !== ">" && doc[i] !== "/") i++;
  const name = doc.slice(nameStart, i).toLowerCase();
  const attrs = new Map<string, string>();
  while (i < doc.length) {
    while (i < doc.length && (isSpace(doc[i]) || doc[i] === "/")) i++;
    if (doc[i] === ">") return { name, attrs, end: i + 1 };
    const keyStart = i;
    while (i < doc.length && !isSpace(doc[i]) && !"=>/".includes(doc[i])) i++;
    const key = doc.slice(keyStart, i).toLowerCase();
    while (i < doc.length && isSpace(doc[i])) i++;
    let value = "";
    if (doc[i] === "=") {
      i++;
      while (i < doc.length && isSpace(doc[i])) i++;
      const q = doc[i];
      if (q === '"' || q === "'") {
        const close = doc.indexOf(q, i + 1);
        if (close < 0) return null;
        value = doc.slice(i + 1, close);
        i = close + 1;
      } else {
        const valueStart = i;
        while (i < doc.length && !isSpace(doc[i]) && doc[i] !== ">") i++;
        value = doc.slice(valueStart, i);
      }
    }
    if (key) attrs.set(key, decodeAttr(value));
    else i++;
  }
  return null;
}

const closeOf = (
  doc: string,
  name: string,
  from: number,
): { start: number; end: number } | null => {
  const re = new RegExp(`</${name}\\s*>`, "gi");
  re.lastIndex = from;
  const m = re.exec(doc);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
};

// The elements whose contents the browser doesn't parse as markup, or doesn't load.
const OPAQUE = new Set([
  "template",
  "textarea",
  "title",
  "noscript",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
]);

// A tag with anything else on it (an id a script looks for, an onload, a title, `disabled`)
// means something an inline copy wouldn't.
const STYLESHEET_ATTRS = new Set([
  "rel",
  "href",
  "type",
  "media",
  "crossorigin",
  "integrity",
  "referrerpolicy",
]);
const SCRIPT_ATTRS = new Set([
  "src",
  "type",
  "async",
  "defer",
  "charset",
  "crossorigin",
  "integrity",
  "referrerpolicy",
]);
const onlyThese = (attrs: Map<string, string>, known: Set<string>) =>
  [...attrs.keys()].every((k) => known.has(k));

const absolutize = (raw: string, base?: string): string | null => {
  const url = raw.trim();
  if (!base && !/^(https:)?\/\//i.test(url)) return null;
  try {
    return new URL(url, base ?? "https://x/").href;
  } catch {
    return null;
  }
};

// Whether a URL is one the frame would have fetched from the allowlist.
const onCdn = (raw: string, base?: string): string | null => {
  const abs = absolutize(raw, base);
  if (!abs) return null;
  const checked = checkCdnUrl(abs, "url");
  return "url" in checked ? checked.url : null;
};

// --- subresource integrity: an inline copy mustn't lose what the tag promised ---

const SRI_ALGOS: Record<string, string> = {
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
};
async function passesIntegrity(integrity: string | undefined, bytes: Uint8Array): Promise<boolean> {
  if (!integrity?.trim()) return true;
  for (const token of integrity.trim().split(/\s+/)) {
    const [algo, want] = [token.slice(0, token.indexOf("-")), token.slice(token.indexOf("-") + 1)];
    const name = SRI_ALGOS[algo];
    if (!name) continue;
    const digest = await crypto.subtle.digest(name, new Uint8Array(bytes));
    if (toBase64(new Uint8Array(digest)) === want.split("?")[0]) return true;
  }
  return false;
}

// --- text that goes back into the document ---

// `<!--` opens a parser state in which the closing tag may not close, and `\x3c` reads the
// same in a string, a template or a regex. `<\/` is the usual way past an early close.
const safeScript = (js: string): string =>
  js
    .replace(/\n?\/\/[#@] sourceMappingURL=[^\n]*\s*$/, "")
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "\\x3c!--");
const safeStyle = (css: string): string =>
  css.replace(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/, "").replace(/<\/style/gi, "<\\/style");

// A script that finds its own URL or loads siblings relative to it would look in the wrong
// place once inline, so it keeps its link.
const needsItsUrl = (js: string): boolean => /\bcurrentScript\b|\bimport\s*\(/.test(js);

// --- which subsets of a font ---

// The characters a document's own text could need. Numeric entities count; named ones are
// nearly all Latin, which is always inlined anyway.
function charsOf(text: string): Set<number> {
  const out = new Set<number>();
  for (const ch of text) out.add(ch.codePointAt(0) as number);
  for (const m of text.matchAll(/&#(x[0-9a-f]+|\d+);/gi)) {
    const v = m[1];
    out.add(v[0] === "x" || v[0] === "X" ? parseInt(v.slice(1), 16) : parseInt(v, 10));
  }
  return out;
}

// One `U+0041-005A, U+0100` list as [from, to] pairs. Wildcards (`U+4??`) count as their span.
function parseUnicodeRange(raw: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of raw.split(",")) {
    const m = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!m) continue;
    const from = parseInt(m[1].replace(/\?/g, "0"), 16);
    const to = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, "f"), 16);
    out.push([from, to]);
  }
  return out;
}

// A family's subsets are inlined when the text needs them, and Latin always, because a page
// builds text in script that its markup doesn't show: numbers, names, a date. The rest stay
// in the stylesheet as links. The browser fetches one of those only if a character in its
// range turns up, so what isn't inlined still renders right and costs nothing until then.
function subsetWanted(range: string | undefined, chars: Set<number>): boolean {
  if (!range) return true;
  const spans = parseUnicodeRange(range);
  const has = (cp: number) => spans.some(([a, b]) => cp >= a && cp <= b);
  if (has(0x41)) return true;
  for (const cp of chars) if (cp > 0x7f && has(cp)) return true;
  return false;
}

// --- stylesheets ---

const decl = (face: string, name: string): string | undefined =>
  new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;}]+)`, "i").exec(face)?.[1]?.trim();

// In what one src list offers, the one file worth inlining: woff2, else woff.
function fontFileIn(src: string, base?: string): { url: string; format: "woff2" | "woff" } | null {
  const entries = [...src.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)([^,]*)/gi)].map(
    (m) => ({ raw: m[1] ?? m[2] ?? m[3] ?? "", rest: m[4] ?? "" }),
  );
  for (const format of ["woff2", "woff"] as const) {
    const hit = entries.find(
      (e) =>
        new RegExp(`format\\(\\s*["']?${format}["']?\\s*\\)`, "i").test(e.rest) ||
        new RegExp(`\\.${format}(\\?|#|$)`, "i").test(e.raw),
    );
    const url = hit && onCdn(hit.raw, base);
    if (url) return { url, format };
  }
  return null;
}

const FONT_MAGIC = { woff2: "wOF2", woff: "wOFF" };

export function createCdnInliner() {
  const cache = new Map<string, Held>();
  let cacheBytes = 0;
  const inFlight = new Map<string, Promise<Fetched>>();
  const failedAt = new Map<string, number>();

  const remember = (url: string, got: Held) => {
    cache.set(url, got);
    cacheBytes += got.kind === "ok" ? got.bytes.length : 0;
    while (cacheBytes > MAX_CACHE_BYTES && cache.size > 1) {
      const oldest = cache.keys().next().value as string;
      const drop = cache.get(oldest);
      cacheBytes -= drop?.kind === "ok" ? drop.bytes.length : 0;
      cache.delete(oldest);
    }
  };

  const start = (url: string): Promise<Fetched> => {
    const running = inFlight.get(url);
    if (running) return running;
    const task = fetchFromCdn(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
      .catch((): Fetched => ({ kind: "failed" }))
      .then((got) => {
        inFlight.delete(url);
        if (got.kind === "failed") {
          failedAt.set(url, Date.now());
          if (failedAt.size > MAX_FAILED_URLS) {
            failedAt.delete(failedAt.keys().next().value as string);
          }
        } else remember(url, got);
        return got;
      });
    inFlight.set(url, task);
    return task;
  };

  const get = (url: string, deadline: number): Promise<Fetched> => {
    const held = cache.get(url);
    if (held) {
      cache.delete(url);
      cache.set(url, held);
      return Promise.resolve(held);
    }
    const failed = failedAt.get(url);
    if (failed !== undefined) {
      if (Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve({ kind: "failed" });
      failedAt.delete(url);
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      void start(url);
      return Promise.resolve({ kind: "failed" });
    }
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      start(url).finally(() => clearTimeout(timer)),
      new Promise<Fetched>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "failed" }), left);
      }),
    ]);
  };

  async function inline(doc: string, text: string): Promise<InlineResult> {
    const deadline = Date.now() + DOC_DEADLINE_MS;
    const chars = charsOf(text);
    let budget = MAX_INLINE_BYTES;
    let complete = true;

    const fetchOr = async (url: string): Promise<Fetched> => {
      const got = await get(url, deadline);
      if (got.kind === "failed") complete = false;
      return got;
    };

    // One stylesheet's text with its imports followed and its fonts baked in. Every
    // relative URL moves to absolute first: inline, it would resolve against the document.
    // An @import that stays has to come before every rule or the browser ignores it, so
    // those go first in the result.
    async function rewriteCss(
      css: string,
      base: string | undefined,
      depth: number,
    ): Promise<{ imports: string; body: string }> {
      const absolute = base
        ? css.replace(
            /\/\*[\s\S]*?\*\/|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi,
            (m, a, b, c) => {
              if (m.startsWith("/*")) return m;
              const raw: string = a ?? b ?? c ?? "";
              if (!raw || /^(data:|#|[a-z][a-z0-9+.-]*:)/i.test(raw)) return m;
              const abs = absolutize(raw, base);
              return abs ? `url("${abs}")` : m;
            },
          )
        : css;

      let imports = "";
      let importedBody = "";
      let rest = "";
      let last = 0;
      const importRe =
        /\/\*[\s\S]*?\*\/|@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi;
      for (const m of absolute.matchAll(importRe)) {
        if (m[0].startsWith("/*")) continue;
        const at = m.index;
        rest += absolute.slice(last, at);
        last = at + m[0].length;
        const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
        const url = onCdn(raw, base);
        // A media or layer qualifier would need wrapping, so it keeps its link.
        const qualified = !!m[6]?.trim();
        if (!url || qualified || depth >= MAX_IMPORT_DEPTH) {
          imports += `${m[0]}\n`;
          continue;
        }
        const inlined = await fetchStylesheet(url, undefined, depth + 1);
        if (inlined === null) {
          imports += `${m[0]}\n`;
          continue;
        }
        imports += inlined.imports;
        importedBody += `${inlined.body}\n`;
      }
      rest += absolute.slice(last);
      return { imports, body: `${importedBody}${await rewriteFaces(rest, base)}` };
    }

    // The same file named once per weight is one variable font: Google Fonts answers
    // `wght@400;600` with two faces and one URL. Baked in twice it would cost twice, so
    // they become one face spanning the weights.
    async function rewriteFaces(css: string, base: string | undefined): Promise<string> {
      const faceRe = /\/\*[\s\S]*?\*\/|@font-face\s*\{[^}]*\}/gi;
      const faces = [...css.matchAll(faceRe)].filter((m) => !m[0].startsWith("/*"));
      if (faces.length === 0) return css;
      const groups = new Map<string, number[]>();
      for (const m of faces) {
        const src = decl(m[0], "src");
        const file = src && fontFileIn(src, base);
        const weight = Number(decl(m[0], "font-weight"));
        if (!file || !Number.isFinite(weight)) continue;
        const key = [
          file.url,
          decl(m[0], "font-family"),
          decl(m[0], "font-style"),
          decl(m[0], "font-stretch"),
          decl(m[0], "unicode-range"),
        ].join("|");
        groups.set(key, [...(groups.get(key) ?? []), m.index]);
      }
      const weightsAt = new Map<number, string>();
      const mergedAway = new Set<number>();
      for (const at of groups.values()) {
        if (at.length < 2) continue;
        const weights = at.map((i) =>
          Number(decl(css.slice(i, css.indexOf("}", i)), "font-weight")),
        );
        weightsAt.set(at[0], `${Math.min(...weights)} ${Math.max(...weights)}`);
        for (const i of at.slice(1)) mergedAway.add(i);
      }

      let out = "";
      let last = 0;
      for (const m of faces) {
        out += css.slice(last, m.index);
        last = m.index + m[0].length;
        if (mergedAway.has(m.index)) continue;
        let face = m[0];
        const span = weightsAt.get(m.index);
        if (span) face = face.replace(/font-weight\s*:\s*[^;}]+/i, `font-weight: ${span}`);
        const src = decl(face, "src");
        const file = src && fontFileIn(src, base);
        if (file && subsetWanted(decl(face, "unicode-range"), chars)) {
          const got = await fetchOr(file.url);
          if (got.kind === "ok") {
            const magic = String.fromCharCode(...got.bytes.subarray(0, 4));
            const size = Math.ceil((got.bytes.length * 4) / 3) + 64;
            if (magic === FONT_MAGIC[file.format] && size <= budget) {
              budget -= size;
              const data = `url(data:font/${file.format};base64,${toBase64(got.bytes)}) format("${file.format}")`;
              // The list may run to several lines; all of it goes, for the one file kept.
              face = face.replace(/(^|[;{\s])src\s*:[^;}]+/i, `$1src: ${data}`);
            }
          }
        }
        out += face;
      }
      return out + css.slice(last);
    }

    async function fetchStylesheet(
      url: string,
      integrity: string | undefined,
      depth: number,
    ): Promise<{ imports: string; body: string } | null> {
      const got = await fetchOr(url);
      if (got.kind !== "ok" || !got.contentType.includes("text/css")) return null;
      if (!(await passesIntegrity(integrity, got.bytes))) return null;
      if (got.bytes.length > budget) return null;
      budget -= got.bytes.length;
      return rewriteCss(new TextDecoder().decode(got.bytes), got.url, depth);
    }

    let out = "";
    let copied = 0;
    let deferred = "";
    const splice = (from: number, to: number, withText: string) => {
      out += doc.slice(copied, from) + withText;
      copied = to;
    };

    let i = 0;
    while (i < doc.length) {
      const lt = doc.indexOf("<", i);
      if (lt < 0) break;
      if (doc.startsWith("<!--", lt)) {
        const close = doc.indexOf("-->", lt + 4);
        if (close < 0) break;
        i = close + 3;
        continue;
      }
      if (!/[a-z]/i.test(doc[lt + 1] ?? "")) {
        i = lt + 1;
        continue;
      }
      const tag = readTag(doc, lt);
      if (!tag) break;
      i = tag.end;

      if (tag.name === "script") {
        const close = closeOf(doc, "script", tag.end);
        if (!close) break;
        i = close.end;
        const src = tag.attrs.get("src");
        const url = src ? onCdn(src) : null;
        if (!url || !onlyThese(tag.attrs, SCRIPT_ATTRS)) continue;
        const type = (tag.attrs.get("type") ?? "").trim().toLowerCase();
        if (type && !/^(text|application)\/(java|ecma)script$/.test(type)) continue;
        const got = await fetchOr(url);
        if (got.kind !== "ok" || !/javascript|ecmascript/.test(got.contentType)) continue;
        if (!(await passesIntegrity(tag.attrs.get("integrity"), got.bytes))) continue;
        const js = new TextDecoder().decode(got.bytes);
        if (got.bytes.length > budget || needsItsUrl(js)) continue;
        budget -= got.bytes.length;
        const inlined = `<script>${safeScript(js)}</script>`;
        // An inline script can't wait, so what was deferred goes where deferred scripts
        // run: after the rest of the document has parsed.
        if (tag.attrs.has("defer") || tag.attrs.has("async")) {
          deferred += `${inlined}\n`;
          splice(lt, close.end, "");
        } else splice(lt, close.end, inlined);
        continue;
      }

      if (tag.name === "style") {
        const close = closeOf(doc, "style", tag.end);
        if (!close) break;
        i = close.end;
        const type = (tag.attrs.get("type") ?? "").trim().toLowerCase();
        if (type && type !== "text/css") continue;
        const css = doc.slice(tag.end, close.start);
        if (!CDN_ALLOWLIST.some((o) => css.includes(o.slice(6)))) continue;
        const { imports, body } = await rewriteCss(css, undefined, 0);
        splice(tag.end, close.start, safeStyle(imports + body));
        continue;
      }

      if (tag.name === "link") {
        const rel = (tag.attrs.get("rel") ?? "").trim().toLowerCase();
        const href = tag.attrs.get("href");
        const url = href ? onCdn(href) : null;
        if (!url) continue;
        // A connection opened ahead for a font that's now in the document: every frame
        // would still pay for it, and a link left in place loses only a round trip.
        if (rel === "preconnect" || rel === "dns-prefetch") {
          splice(lt, tag.end, "");
          continue;
        }
        if (rel !== "stylesheet" || !onlyThese(tag.attrs, STYLESHEET_ATTRS)) continue;
        const got = await fetchStylesheet(url, tag.attrs.get("integrity"), 0);
        if (!got) continue;
        const media = tag.attrs.get("media");
        const attr = media
          ? ` media="${media.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`
          : "";
        splice(lt, tag.end, `<style${attr}>${safeStyle(got.imports + got.body)}</style>`);
        continue;
      }

      if (OPAQUE.has(tag.name)) {
        const close = closeOf(doc, tag.name, tag.end);
        if (!close) break;
        i = close.end;
      }
    }
    if (copied === 0 && !deferred) return { doc, complete };
    let result = out + doc.slice(copied);
    if (deferred) {
      const bodyEnd = result.lastIndexOf("</body>");
      result =
        bodyEnd < 0
          ? result + deferred
          : `${result.slice(0, bodyEnd)}${deferred}${result.slice(bodyEnd)}`;
    }
    return { doc: result, complete };
  }

  return { inline };
}
