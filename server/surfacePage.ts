import { CDN_ALLOWLIST, checkCdnUrl } from "./cdn.ts";
import { CORE_CSS, KITS, kitAssets } from "./kits.ts";
import { expandIcons, type IconResolver } from "./icons.ts";
import type { DesignSettings, ProjectKit } from "./types.ts";
import {
  type Mode,
  type Palette,
  schemeCss,
  type Theme,
  themeById,
  tokenThemeCss,
  viewerThemeCss,
} from "./themes.ts";

// The kit's two custom SVG accent ramps (teal, coral) aren't in the theme
// palette, so they carry their own light/dark values. Like the theme tokens
// they pin to a forced mode (no media query) when one is given, else flip with
// the OS — kept in sync via the shared schemeCss. Dark overrides only bg/text;
// the line color is shared, so it's repeated in both maps.
const KIT_ACCENTS_LIGHT: Record<string, string> = {
  "c-teal-bg": "#e1f4f1",
  "c-teal-line": "#1fa996",
  "c-teal-text": "#0c6e62",
  "c-coral-bg": "#fdece5",
  "c-coral-line": "#e8835e",
  "c-coral-text": "#a44f28",
};
const KIT_ACCENTS_DARK: Record<string, string> = {
  ...KIT_ACCENTS_LIGHT,
  "c-teal-bg": "rgba(31, 169, 150, 0.18)",
  "c-teal-text": "#6fd0c2",
  "c-coral-bg": "rgba(232, 131, 94, 0.18)",
  "c-coral-text": "#f0a987",
};
const kitAccentCss = (mode?: Mode): string => schemeCss(KIT_ACCENTS_LIGHT, KIT_ACCENTS_DARK, mode);

// Force the document's used color-scheme so the UA-painted canvas, scrollbars,
// and native form controls follow the same scheme as the theme vars (the vars
// alone don't drive those). Pinned frames get a single scheme; unpinned/direct
// loads opt into both schemes so the browser can resolve the user's system mode.
const colorSchemeCss = (mode?: Mode): string => `:root{color-scheme:${mode ?? "light dark"}}`;

const cdns = CDN_ALLOWLIST.join(" ");

// `origin` is the server's own origin, added to img/media so uploaded assets
// (served at <origin>/a/:id) embed by URL. It is needed because the iframe runs
// at an opaque origin (sandbox without allow-same-origin), so `'self'` matches
// nothing, and a local http origin isn't covered by the `https:` source.
// `${origin}/asset/` is the fixed, content-hashed path the bridge script and the
// static stylesheets are served from (see registerAsset). It is deliberately a
// single directory of server-authored, workspace-data-free files: nothing an
// agent or a user can write is ever reachable under it, so widening script-src
// to it grants the sandbox no capability beyond running our own bridge.
function buildCsp(origin: string): string {
  const assets = `${origin}${STATIC_ASSET_PREFIX}`;
  return [
    `default-src 'none'`,
    `script-src 'unsafe-inline' ${assets} ${cdns}`,
    `style-src 'unsafe-inline' ${assets} ${cdns}`,
    `font-src ${cdns} data:`,
    `img-src https: data: blob: ${origin}`,
    `connect-src ${cdns}`,
    `media-src https: data: blob: ${origin}`,
  ].join("; ");
}

// Static design tokens exposed to html surfaces — fonts and radii. The COLOR tokens
// (--color-*) are theme-dependent and injected separately by renderHtmlPage via
// tokenThemeCss(theme); names match Claude's widget surface either way so agents
// reuse the same muscle memory.
const TOKENS_CSS = `
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
}
html { box-sizing: border-box; scrollbar-width: none; }
html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; }
*, *::before, *::after { box-sizing: inherit; }
body {
  margin: 0;
  padding: 16px;
  background: var(--color-background-primary);
  color: var(--color-text-primary);
  font: 16px/1.6 var(--font-sans);
}
`;

// Surface kit: element defaults and SVG utility classes baked into every
// html-surface doc so agents publish compact markup instead of hand-writing inline
// CSS. Documented as a reference table in guide/topics/html.md — keep the
// two in sync. Note: CSS rules override SVG presentation attributes, so bare
// element selectors here must never set properties surfaces commonly set via
// attributes (fill/font-size on text, etc.) — that's why text styling is
// opt-in via classes.
const KIT_CSS = `
:root { color-scheme: light dark; }
button {
  font: 500 14px/1.4 var(--font-sans);
  color: var(--color-text-primary);
  background: none;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  padding: 6px 14px;
  cursor: pointer;
}
button:hover { background: var(--color-background-secondary); }
input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea {
  font: 14px/1.4 var(--font-sans);
  color: var(--color-text-primary);
  background: var(--color-background-primary);
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  padding: 6px 10px;
  outline: none;
}
input:focus, select:focus, textarea:focus { border-color: var(--color-border-info); }
input::placeholder, textarea::placeholder { color: var(--color-text-tertiary); }
textarea { resize: vertical; }
input[type=checkbox], input[type=radio], input[type=range], progress {
  accent-color: var(--color-border-info);
}
svg { font-family: var(--font-sans); fill: var(--color-text-primary); }
.t { font-size: 14px; }
.ts { font-size: 12px; fill: var(--color-text-secondary); }
.th { font-size: 14px; font-weight: 500; }
.box { fill: var(--color-background-secondary); stroke: var(--color-border-tertiary); rx: 8px; }
.arr { stroke: var(--color-text-secondary); stroke-width: 1.2; fill: none; }
.leader { stroke: var(--color-border-secondary); stroke-width: 1; stroke-dasharray: 3 4; fill: none; }
.node { cursor: pointer; }
.node:hover { opacity: 0.75; }
.c-blue, .c-blue .box { fill: var(--color-background-info); stroke: var(--color-border-info); }
.c-blue text, text.c-blue { fill: var(--color-text-info); stroke: none; }
.c-teal, .c-teal .box { fill: var(--c-teal-bg); stroke: var(--c-teal-line); }
.c-teal text, text.c-teal { fill: var(--c-teal-text); stroke: none; }
.c-amber, .c-amber .box { fill: var(--color-background-warning); stroke: var(--color-border-warning); }
.c-amber text, text.c-amber { fill: var(--color-text-warning); stroke: none; }
.c-coral, .c-coral .box { fill: var(--c-coral-bg); stroke: var(--c-coral-line); }
.c-coral text, text.c-coral { fill: var(--c-coral-text); stroke: none; }
.c-green, .c-green .box { fill: var(--color-background-success); stroke: var(--color-border-success); }
.c-green text, text.c-green { fill: var(--color-text-success); stroke: none; }
.c-red, .c-red .box { fill: var(--color-background-danger); stroke: var(--color-border-danger); }
.c-red text, text.c-red { fill: var(--color-text-danger); stroke: none; }
.c-gray, .c-gray .box { fill: var(--color-background-secondary); stroke: var(--color-border-secondary); }
.c-gray text, text.c-gray { fill: var(--color-text-secondary); stroke: none; }
`;

// Shared SVG defs injected into every html-surface doc. Inline SVGs anywhere in
// the document can reference these by id; the arrowhead inherits the
// referencing line's stroke color via context-stroke.
const SVG_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs></svg>`;

// Bridge to the host viewer: sendPrompt/openLink/copyToClipboard mirror
// Claude's widget globals, and a ResizeObserver reports content height so the
// parent can size the sandboxed (opaque-origin) iframe. copyToClipboard posts
// to the parent (trusted origin) which has clipboard API access; the sandbox
// itself is opaque-origin so navigator.clipboard is unavailable there.
// Exported so the resize-guard regression test can run the exact shipped script
// in a vm, instead of scraping it back out of rendered HTML.
export const BRIDGE_JS = `
window.sendPrompt = function (text) {
  parent.postMessage({ __mockpit: true, type: 'send-prompt', text: String(text) }, '*');
};
window.openLink = function (url) {
  parent.postMessage({ __mockpit: true, type: 'open-link', url: String(url) }, '*');
};
window.copyToClipboard = function (text) {
  parent.postMessage({ __mockpit: true, type: 'copy', text: String(text) }, '*');
};
document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (a && /^https?:/.test(a.href)) { e.preventDefault(); window.openLink(a.href); }
});
// Cmd+Option+Up/Down switches sessions in the sidebar, but keydowns fire in
// whichever document holds focus — once the user clicks into a surface, this
// sandboxed iframe swallows them. Forward just that combo to the host.
document.addEventListener('keydown', function (e) {
  if (!e.metaKey || !e.altKey || e.ctrlKey || e.shiftKey) return;
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  parent.postMessage({ __mockpit: true, type: 'switch-session', key: e.key }, '*');
});
// Report content height to the parent so it can size this iframe, while
// breaking a feedback loop that can peg a CPU core.
//
// The loop: the parent sets the iframe's height to whatever we report, but some
// content's height *inverts* with the frame's height — a scrollbar that appears
// at height A reflows the content to height B, then disappears at B and reflows
// back to A (or any 100vh / percentage-derived layout). The ResizeObserver then
// fires on every flip, so reported heights alternate A, B, A, B... forever. With
// a cheap surface that's a brief blip; with a heavy one (a big syntax-highlighted
// diff/markdown surface) each relayout is expensive and the tab sits at 100% CPU
// until the surface unmounts.
//
// A plain h !== __lastH guard can't stop this: in a 2-cycle every value differs
// from the one immediately before it. So we remember the previous height too and
// defer a return to it *if it recurs faster than a human could* (< 250ms) — that's
// the runaway. The deferred pass keeps one trailing re-measure and reports the
// taller height in the pair, so an ordinary font/image reflow can't leave the
// frame permanently clipped.
var __lastH = 0;
var __prevH = 0;
var __lastT = 0;
var __seenH = 0;
var __trailTimer = 0;
var __trailH = 0;
var __FLIP_MS = 250;
var __TRAIL_MS = 350;
function __now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
function __measureHeight() {
  return document.body
    ? document.body.scrollHeight
    : document.documentElement.scrollHeight;
}
function __postHeight(h, t) {
  __prevH = __lastH;
  __lastH = h;
  __lastT = t;
  parent.postMessage({ __mockpit: true, type: 'resize', height: h }, '*');
}
function __clearTrailing() {
  if (__trailTimer && typeof clearTimeout !== 'undefined') clearTimeout(__trailTimer);
  __trailTimer = 0;
  __trailH = 0;
}
function __flushTrailing() {
  __trailTimer = 0;
  var measured = __measureHeight();
  if (measured > 0) __seenH = measured;
  var target = Math.max(__trailH || 0, measured || 0);
  __trailH = 0;
  if (target <= 0 || target === __lastH) return;
  __postHeight(target, __now());
}
function __scheduleTrailing(h, reset) {
  __trailH = Math.max(__trailH || 0, h || 0, __lastH || 0);
  if (__trailTimer) {
    if (!reset) return;
    if (typeof clearTimeout !== 'undefined') clearTimeout(__trailTimer);
  }
  __trailTimer = setTimeout(__flushTrailing, __TRAIL_MS);
}
function __report() {
  var h = __measureHeight();
  if (h <= 0) return; // no content yet
  var changed = h !== __seenH;
  __seenH = h;
  if (h === __lastH) return; // unchanged
  var t = __now();
  if (h === __prevH && (__trailTimer || t - __lastT < __FLIP_MS)) {
    __scheduleTrailing(h, true); // rapid A<->B flip: defer one settled report
    return;
  }
  __clearTrailing();
  __postHeight(h, t);
}
if (document.readyState === 'complete') __report();
else window.addEventListener('load', function () { requestAnimationFrame(__report); });
setTimeout(__report, 60);
setTimeout(__report, 350);
setTimeout(__report, 1500);
setTimeout(__report, 3000);
setTimeout(__report, 6000);
setTimeout(__report, 10000);
if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
  document.fonts.ready.then(function () { __report(); });
}
if (window.ResizeObserver) {
  window.__ssRO = new ResizeObserver(__report);
  window.__ssRO.observe(document.documentElement);
  if (document.body) window.__ssRO.observe(document.body);
}
`;

// Hit test: the viewer's marker overlay lives in the trusted origin ABOVE the
// sandboxed frame, so when the operator drops a pin it knows the normalized
// point but nothing about what sits under it. This answers that question over
// one narrow message — the viewer asks, we reply with data (a css path, a text
// snippet, a normalized rect) that it renders as text nodes only.
//
// Narrow-channel rules, both directions:
//   - we only answer `parent`, so a nested frame or a popup can't harvest the
//     document by spamming hit tests;
//   - the reply is DATA, never markup, and `text` is clamped so a surface can't
//     use a pin as a megaphone into the viewer's chrome.
//
// Coordinates are normalized against the DOCUMENT box (clientWidth ×
// body.scrollHeight), i.e. the same box the resize bridge reports and the
// viewer sizes the iframe to — so an anchor drawn over the frame maps 1:1
// whatever the viewport preset scales it to.
//
// Kept separate from BRIDGE_JS: the resize half is a load-bearing, WebKit-
// quirked script with its own regression test that runs it verbatim in a vm.
export const HIT_TEST_JS = `
(function () {
  var MAX_DEPTH = 6;
  var MAX_TEXT = 60;
  function docBox() {
    var w = document.documentElement.clientWidth || 1;
    var h = (document.body && document.body.scrollHeight) || document.documentElement.scrollHeight || 1;
    return { w: w, h: h };
  }
  function ident(v) { return typeof v === 'string' && /^[A-Za-z][\\w-]*$/.test(v); }
  function cssPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      var tag = el.tagName.toLowerCase();
      if (ident(el.id)) { parts.unshift(tag + '#' + el.id); break; }
      var sel = tag;
      var cls = (el.getAttribute('class') || '').split(/\\s+/).filter(ident).slice(0, 2);
      if (cls.length) sel += '.' + cls.join('.');
      var p = el.parentElement;
      if (p) {
        var sibs = [];
        for (var i = 0; i < p.children.length; i++) {
          if (p.children[i].tagName === el.tagName) sibs.push(p.children[i]);
        }
        if (sibs.length > 1) sel += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
      parts.unshift(sel);
      if (parts.length >= MAX_DEPTH) break;
      el = p;
    }
    return parts.join(' > ');
  }
  function firstLine(el) {
    var t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    var line = t.split('\\n')[0].trim();
    return line.length > MAX_TEXT ? line.slice(0, MAX_TEXT - 1) + '\\u2026' : line;
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent || parent === window) return;
    var d = e.data;
    if (!d || d.__mockpit !== true || d.type !== 'hit-test') return;
    var box = docBox();
    var px = Math.max(0, Math.min(1, Number(d.x) || 0)) * box.w;
    var py = Math.max(0, Math.min(1, Number(d.y) || 0)) * box.h;
    var el = document.elementFromPoint(px - (window.scrollX || 0), py - (window.scrollY || 0));
    var reply = { __mockpit: true, type: 'hit-test-result', ref: d.ref, path: '', text: '', rect: [0, 0, 0, 0] };
    if (el && el.nodeType === 1) {
      var r = el.getBoundingClientRect();
      reply.path = cssPath(el);
      reply.text = firstLine(el);
      reply.rect = [
        (r.left + (window.scrollX || 0)) / box.w,
        (r.top + (window.scrollY || 0)) / box.h,
        r.width / box.w,
        r.height / box.h,
      ];
    }
    parent.postMessage(reply, '*');
  });
})();
`;

// ---------------------------------------------------------------------------
// Stage bridge: parts and knobs (html surfaces only)
// ---------------------------------------------------------------------------
//
// The message protocol between a surface frame and the trusted host. Every
// message, in both directions, is a plain object carrying `__mockpit: true` and
// a `type`. The frame only acts on messages whose source is its parent; the host
// must only accept messages whose source is a frame it created, and must treat
// every field as untrusted data (text nodes and numbers, never markup).
//
// frame → host
//   resize           {height}                    body.scrollHeight (BRIDGE_JS)
//   send-prompt      {text}                      window.sendPrompt (BRIDGE_JS)
//   open-link        {url}                       http(s) link click / openLink (BRIDGE_JS)
//   copy             {text}                      window.copyToClipboard (BRIDGE_JS)
//   switch-session   {key}                       Cmd+Opt+ArrowUp/Down (BRIDGE_JS)
//   hit-test-result  {ref, path, text, rect}     reply to hit-test (HIT_TEST_JS)
//   parts            {version, parts, height, scroll:{x,y}, viewport:{w,h}}  (PARTS_JS)
//       parts[i] = {name, label, key, box:{x,y,w,h}, visible, fixed, depth, parent, order}
//       box is in DOCUMENT px (viewport rect + scroll), so the host draws
//       (box − scroll) × scale, which is also right for fixed and sticky parts.
//       label falls back to name; key is null unless data-part-key is set;
//       parent is the nearest enclosing part's name (null at top level), depth
//       counts enclosing parts, order is document order. Invisible parts
//       (display:none, visibility:hidden, zero size) are listed with
//       visible:false. `version` is the post version the document was rendered
//       for: a reloading frame keeps its contentWindow, so the host must drop
//       reports whose version is not the one it loaded. Sent on load, on
//       50/150/400/1000ms timers, and on any layout-affecting change; never
//       twice in a row with identical content.
//   hit              {ref, part, key}            reply to hit; part = name|null
//
// host → frame
//   hit-test   {ref, x, y}      x,y normalized 0..1 of the document box (Mark tool)
//   hit        {ref, x, y}      x,y in document px; answered with the deepest
//                               [data-part] under the point by the page's own
//                               stacking (elementFromPoint), not overlay order
//   highlight  {parts:[name]}   outline these parts, replacing the previous set;
//                               never triggers a parts report
//   clear      {}               remove every highlight
//   scroll     {dx, dy}         scrollBy in document px (a wheel over the host's
//                               overlay, forwarded)
//   knobs      {values}         {path: value}, merged into the current values
//                               and applied exactly like the `?k=` preamble
//
// Knobs (`/s/:id?k=`, validated by the route against the mock's declared knobs,
// and the `knobs` command): for each path, dots become "-" in names, and
//   --k-<path>            on <html style>: numbers as-is, booleans 1/0, strings
//                         raw when they are plain CSS tokens, else a quoted CSS
//                         string; an object value ({x, y}) spreads one level
//                         into --k-<path>-<field>
//   data-k-<path>         on <html>: numbers, "true"/"false", strings; objects
//                         get none
//   [data-k-bind="<path>"]  textContent = the value (objects as JSON)
//   window `mockpit:knobs` CustomEvent, detail {values} = every current value,
//                         fired at DOMContentLoaded and after each command.
// Structural options are pre-rendered by the agent and switched with CSS on
// `html[data-k-<path>="…"]`.

// Shared by the server-side preamble and the in-frame script so a baked value and
// a live one land identically; the unit test runs this source to prove it.
const KNOB_VALUE_JS = `
var __kPathRe = /^[A-Za-z_][\\w-]{0,63}(\\.[A-Za-z_][\\w-]{0,63}){0,3}$/;
var __kTokenRe = /^[#\\w(),.%/+-][#\\w\\s(),.%/+-]*$/;
function __kName(path) { return path.replace(/\\./g, '-'); }
function __kCssString(s) {
  return '"' + s.replace(/[\\\\"]/g, function (c) { return '\\\\' + c; })
    .replace(/[\\u0000-\\u001f\\u007f]/g, function (c) { return '\\\\' + c.charCodeAt(0).toString(16) + ' '; }) + '"';
}
function __kCss(v) {
  if (typeof v === 'number') return isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'string') return __kTokenRe.test(v) ? v : __kCssString(v);
  return null;
}
function __kVars(path, v) {
  var name = __kName(path);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    var out = [];
    for (var f in v) {
      if (!Object.prototype.hasOwnProperty.call(v, f) || !/^[A-Za-z_][\\w-]{0,63}$/.test(f)) continue;
      var c = __kCss(v[f]);
      if (c !== null) out.push([name + '-' + f, c]);
    }
    return out;
  }
  var css = __kCss(v);
  return css === null ? [] : [[name, css]];
}
function __kAttr(v) {
  if (typeof v === 'number') return isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  return null;
}
`;

// Parts: measure every element the agent marked with data-part and report it.
// Kept apart from BRIDGE_JS for the same reason HIT_TEST_JS is (that script runs
// verbatim in a vm regression test), and html-only because only agent markup
// carries parts.
export const PARTS_JS = `
(function () {
  if (window.parent === window) return;
  var HL = 'mockpit-part-hl';
  var MAX_PARTS = 200;
  var MAX_TEXT = 200;
  var doc = window.__mockpitDoc || {};
  var version = typeof doc.version === 'number' ? doc.version : null;
  function text(v) { return v == null ? null : String(v).slice(0, MAX_TEXT); }
  function isFixed(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  }
  function collect() {
    var sx = window.scrollX || 0, sy = window.scrollY || 0;
    var els = document.querySelectorAll('[data-part]');
    var parts = [];
    for (var i = 0; i < els.length && parts.length < MAX_PARTS; i++) {
      var el = els[i];
      var name = text(el.getAttribute('data-part'));
      if (!name) continue;
      var r = el.getBoundingClientRect();
      var depth = 0;
      for (var p = el.parentElement; p; p = p.parentElement) if (p.hasAttribute('data-part')) depth++;
      var outer = el.parentElement && el.parentElement.closest('[data-part]');
      parts.push({
        name: name,
        label: text(el.getAttribute('data-part-label')) || name,
        key: text(el.getAttribute('data-part-key')),
        box: { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height },
        visible: (r.width > 0 || r.height > 0) && getComputedStyle(el).visibility !== 'hidden',
        fixed: isFixed(el),
        depth: depth,
        parent: outer ? text(outer.getAttribute('data-part')) : null,
        order: i,
      });
    }
    return {
      version: version,
      parts: parts,
      height: document.body ? document.body.scrollHeight : document.documentElement.scrollHeight,
      scroll: { x: sx, y: sy },
      viewport: { w: innerWidth, h: innerHeight },
    };
  }
  var last = '';
  var timer = 0;
  // setTimeout, not rAF: a hidden cross-origin frame may have rendering (and
  // with it rAF and ResizeObserver) throttled, but timers still run.
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = 0;
      var m = collect();
      var key = JSON.stringify(m);
      if (key === last) return;
      last = key;
      m.__mockpit = true;
      m.type = 'parts';
      parent.postMessage(m, '*');
    }, 0);
  }

  var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
  var observed = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  function observeAll() {
    if (!ro || !observed) return;
    // html/body too: a non-part sibling growing moves parts without resizing them.
    var els = [document.documentElement, document.body].concat([].slice.call(document.querySelectorAll('[data-part]')));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el && !observed.has(el)) { observed.add(el); ro.observe(el); }
    }
  }
  var moTimer = 0;
  var mo = new MutationObserver(function () {
    clearTimeout(moTimer);
    moTimer = setTimeout(function () { observeAll(); schedule(); }, 40);
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  // Transforms and transitions move boxes without resizing or mutating anything.
  document.addEventListener('animationend', schedule, true);
  document.addEventListener('transitionend', schedule, true);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  observeAll();
  schedule();
  // WebKit: RO's initial callback may never fire in a sandboxed frame.
  function settle() {
    schedule();
    [50, 150, 400, 1000].forEach(function (ms) { setTimeout(schedule, ms); });
  }
  if (document.readyState === 'complete') settle();
  else window.addEventListener('load', settle);

  function setHighlight(names) {
    var on = document.querySelectorAll('.' + HL);
    for (var i = 0; i < on.length; i++) on[i].classList.remove(HL);
    if (names && names.length) {
      var want = {};
      for (var k = 0; k < names.length && k < MAX_PARTS; k++) want[String(names[k])] = true;
      var els = document.querySelectorAll('[data-part]');
      for (var j = 0; j < els.length; j++) {
        if (want[els[j].getAttribute('data-part')] === true) els[j].classList.add(HL);
      }
    }
    // Our own class flip must not look like the agent's page changing.
    mo.takeRecords();
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.__mockpit !== true) return;
    if (d.type === 'highlight') setHighlight(Array.isArray(d.parts) ? d.parts : []);
    else if (d.type === 'clear') setHighlight(null);
    else if (d.type === 'scroll') window.scrollBy(Number(d.dx) || 0, Number(d.dy) || 0);
    else if (d.type === 'hit') {
      var el = document.elementFromPoint(
        (Number(d.x) || 0) - (window.scrollX || 0),
        (Number(d.y) || 0) - (window.scrollY || 0)
      );
      var part = el && el.closest ? el.closest('[data-part]') : null;
      parent.postMessage({
        __mockpit: true,
        type: 'hit',
        ref: d.ref,
        part: part ? text(part.getAttribute('data-part')) : null,
        key: part ? text(part.getAttribute('data-part-key')) : null,
      }, '*');
    }
  });
})();
`;

// Knobs: the `?k=` values are already on <html> (see knobPreamble); this binds
// text, announces them, and applies the host's live `knobs` commands.
export const KNOBS_JS = `
(function () {
${KNOB_VALUE_JS}
  var doc = window.__mockpitDoc || {};
  var current = {};
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function bind(path, v) {
    var els = document.querySelectorAll('[data-k-bind]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-k-bind') !== path) continue;
      els[i].textContent = v && typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  }
  function apply(values, live) {
    var root = document.documentElement;
    for (var path in values) {
      if (!own(values, path) || !__kPathRe.test(path)) continue;
      var v = values[path];
      if (v === null || v === undefined) continue;
      current[path] = v;
      if (live) {
        var vars = __kVars(path, v);
        if (!vars.length) root.style.removeProperty('--k-' + __kName(path));
        for (var i = 0; i < vars.length; i++) root.style.setProperty('--k-' + vars[i][0], vars[i][1]);
        var attr = __kAttr(v);
        if (attr === null) root.removeAttribute('data-k-' + __kName(path));
        else root.setAttribute('data-k-' + __kName(path), attr);
      }
      bind(path, v);
    }
    window.dispatchEvent(new CustomEvent('mockpit:knobs', {
      detail: { values: JSON.parse(JSON.stringify(current)) },
    }));
  }
  function initial() { apply(doc.knobs && typeof doc.knobs === 'object' ? doc.knobs : {}, false); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initial);
  else initial();
  window.addEventListener('message', function (e) {
    if (e.source !== parent || parent === window) return;
    var d = e.data;
    if (!d || d.__mockpit !== true || d.type !== 'knobs') return;
    if (d.values && typeof d.values === 'object' && !Array.isArray(d.values)) apply(d.values, true);
  });
})();
`;

// Server-side twins of KNOB_VALUE_JS, used to bake `?k=` into the document.
const KNOB_PATH_RE = /^[A-Za-z_][\w-]{0,63}(\.[A-Za-z_][\w-]{0,63}){0,3}$/;
const KNOB_TOKEN_RE = /^[#\w(),.%/+-][#\w\s(),.%/+-]*$/;
const KNOB_FIELD_RE = /^[A-Za-z_][\w-]{0,63}$/;
const knobName = (path: string) => path.replace(/\./g, "-");
const knobCssString = (s: string) =>
  `"${s
    .replace(/[\\"]/g, (c) => `\\${c}`)
    // oxlint-disable-next-line no-control-regex -- control characters are exactly what must be escaped
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

export function knobCss(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return KNOB_TOKEN_RE.test(v) ? v : knobCssString(v);
  return null;
}

export function knobVars(path: string, v: unknown): [string, string][] {
  const name = knobName(path);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: [string, string][] = [];
    for (const [field, inner] of Object.entries(v)) {
      if (!KNOB_FIELD_RE.test(field)) continue;
      const css = knobCss(inner);
      if (css !== null) out.push([`${name}-${field}`, css]);
    }
    return out;
  }
  const css = knobCss(v);
  return css === null ? [] : [[name, css]];
}

export function knobAttr(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  return null;
}

// The source of KNOB_VALUE_JS, for the parity test.
export const KNOB_VALUE_SOURCE = KNOB_VALUE_JS;

// JSON inside an inline <script>: `<` can't open `</script>` or `<!--`, and the
// two JS line terminators that JSON allows can't end the statement early.
const scriptJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

// The `<html>` open tag with the baked knob attributes and vars, plus the head
// script that hands the version and the values to PARTS_JS / KNOBS_JS. Values
// are agent/user data: attributes go through escapeHtml, CSS values through
// knobCss (quoted unless plain tokens) and then escapeHtml as the style
// attribute, and the JSON through scriptJson.
export function knobPreamble(
  version: number | undefined,
  knobs: Record<string, unknown> | undefined,
): { htmlTag: string; headScript: string } {
  const attrs: string[] = [];
  const vars: string[] = [];
  const values: Record<string, unknown> = {};
  for (const [path, v] of Object.entries(knobs ?? {})) {
    if (!KNOB_PATH_RE.test(path) || v === null || v === undefined) continue;
    values[path] = v;
    const attr = knobAttr(v);
    if (attr !== null) attrs.push(` data-k-${knobName(path)}="${escapeHtml(attr)}"`);
    for (const [name, css] of knobVars(path, v)) vars.push(`--k-${name}:${css}`);
  }
  const style = vars.length ? ` style="${escapeHtml(vars.join(";"))}"` : "";
  return {
    htmlTag: `<html lang="en"${attrs.join("")}${style}>`,
    headScript: `<script>window.__mockpitDoc=${scriptJson({ version: version ?? null, knobs: values })};</script>`,
  };
}

// Our own highlight, shipped in the base stylesheet so turning it on is a class
// flip rather than a DOM insertion the parts observer would report.
const PART_HIGHLIGHT_CSS = `.mockpit-part-hl{outline:2px solid #8b7bff !important;outline-offset:2px}`;

// Tailwind's browser build, pinned to a major (jsdelivr is already on the CDN
// allowlist, so this needs no CSP widening). Injected only when a project's
// design settings say `kit: "tailwind"`, i.e. the repo itself is a Tailwind
// repo — so the agent writes the same classes it writes in the codebase.
const TAILWIND_CDN = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";

// Sizing for the `<svg class="icon">` that icons.ts inlines for every
// `icon="prefix:name"`. Fill and stroke are left to the icon body, which
// declares them per set and draws in currentColor.
const ICON_CSS = `.icon{width:1em;height:1em;flex:none;vertical-align:-0.125em}`;

// ---------------------------------------------------------------------------
// Content-hashed static assets for surface documents
// ---------------------------------------------------------------------------
//
// The bridge script and the theme-independent stylesheets used to be inlined
// into EVERY surface document — ~11 KB of identical bytes per surface, paid
// again for every post, every version, every theme and every mode. They are
// served instead from `/asset/<name>.<hash>.<ext>`, so the browser fetches each
// one once and reuses it across the whole workspace.
//
// The hash is derived from the content at module load (FNV-1a — no crypto, no
// async, runtime-agnostic), so an upgrade that changes a byte changes the URL:
// a surface document cached as immutable for a year can never pair with stale
// asset bytes.
//
// Only content that does NOT depend on the theme or the resolved mode lives
// here. Theme tokens are per (theme, mode) and stay inline in the document,
// where they are already covered by its cache key.

const fnv1a = (input: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
};

export interface StaticAsset {
  path: string;
  contentType: string;
  body: string;
}

// Every path is registered at module load, so a document served from a
// long-lived cache after a restart always finds the asset it references.
export const STATIC_ASSET_PREFIX = "/asset/";
const STATIC_ASSETS = new Map<string, StaticAsset>();

function registerAsset(name: string, ext: "js" | "css", body: string): string {
  const path = `${STATIC_ASSET_PREFIX}${name}.${fnv1a(body)}.${ext}`;
  STATIC_ASSETS.set(path, {
    path,
    contentType: ext === "js" ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8",
    body,
  });
  return path;
}

export const staticAsset = (path: string): StaticAsset | null => STATIC_ASSETS.get(path) ?? null;

const BRIDGE_PATH = registerAsset("bridge", "js", BRIDGE_JS);
const HIT_TEST_PATH = registerAsset("hit-test", "js", HIT_TEST_JS);
const PARTS_PATH = registerAsset("parts", "js", PARTS_JS);
const KNOBS_PATH = registerAsset("knobs", "js", KNOBS_JS);
// The base html-surface stylesheet: static design tokens + the surface kit.
const BASE_CSS_PATH = registerAsset(
  "base",
  "css",
  `${TOKENS_CSS}${KIT_CSS}${PART_HIGHLIGHT_CSS}${ICON_CSS}`,
);
const KIT_CORE_PATH = registerAsset("kit-core", "css", CORE_CSS);
const KIT_PATHS = new Map(KITS.map((k) => [k.id, registerAsset(`kit-${k.id}`, "css", k.css)]));

const scriptTag = (origin: string, path: string) => `<script src="${origin}${path}"></script>`;
const styleTag = (origin: string, path: string) =>
  `<link rel="stylesheet" href="${origin}${path}">`;

// A kit as one document references it: our own content-hashed stylesheet,
// a library on the CDN allowlist, or both (a reference kit's theme bridge).
interface ResolvedKit {
  id: string;
  cssPath?: string;
  href?: string;
  script?: string;
}

// The same resolution kitAssets does (known ids, first occurrence wins), but
// yielding one stylesheet per kit instead of one concatenated string. Project
// kit URLs are re-checked here as well as on write: a stored setting is the
// last thing between a URL and a tag in the document.
function resolveKits(
  ids: readonly string[] | undefined,
  projectKits: readonly ProjectKit[] = [],
): ResolvedKit[] {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const chosen: ResolvedKit[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const kit = KITS.find((k) => k.id === id);
    if (kit) {
      seen.add(id);
      chosen.push({ id, cssPath: KIT_PATHS.get(id), href: kit.href, script: kit.script });
      continue;
    }
    const own = projectKits.find((k) => k.id === id);
    if (!own) continue;
    const href = checkCdnUrl(own.href, "kit url");
    if ("error" in href) continue;
    const script = own.script ? checkCdnUrl(own.script, "kit script") : null;
    seen.add(id);
    chosen.push({ id, href: href.url, script: script && "url" in script ? script.url : undefined });
  }
  return chosen;
}

// Everything a project's DesignSettings contributes to one html-surface doc.
// Kept in one place so the ordering rule is visible: the project's own tokens
// land AFTER mockpit's, because a repo that declares `--radius` or a brand
// color should win inside its own project's surfaces.
function designAssets(design: DesignSettings | null | undefined): {
  css: string;
  kits: string[];
  projectKits: ProjectKit[];
  headScripts: string;
} {
  if (!design) return { css: "", kits: [], projectKits: [], headScripts: "" };
  const raw = design.cssVars?.trim() ?? "";
  // `cssVars` is stored as the repo's raw block; accept either the full
  // `:root{…}` text or a bare declaration list.
  const vars = raw ? (raw.includes("{") ? raw : `:root{${raw}}`) : "";
  const kit = design.kit;
  return {
    css: vars,
    kits: kit && kit !== "tailwind" && kit !== "none" ? [kit] : [],
    projectKits: Array.isArray(design.projectKits) ? design.projectKits : [],
    headScripts: kit === "tailwind" ? `<script src="${TAILWIND_CDN}"></script>` : "",
  };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Wrap one html surface in the themed, sandboxed document the iframe loads. The
// workspace's color tokens (theme-dependent) are injected first so the static base
// + kit resolve against them; `theme` defaults to the github preset.
// CSP for a rich surface (markdown/mermaid/diff). These render markup our own
// libraries produced — they never load CDN scripts and never need the network,
// so the policy is *tighter* than an html surface's: only the inline bridge runs,
// and there is no `connect-src`, so even if a sanitizer regression let agent
// markup execute, the script is boxed into an opaque origin with no way to
// phone home. `img-src origin` lets inline markdown images at <origin>/a/:id
// load (the iframe is opaque-origin, so `'self'` matches nothing — same reason
// buildCsp adds it explicitly).
function buildRichCsp(origin: string): string {
  return [
    `default-src 'none'`,
    // Same fixed same-origin asset directory as buildCsp — only the bridge
    // script lives there. Still no connect-src.
    `script-src 'unsafe-inline' ${origin}${STATIC_ASSET_PREFIX}`,
    `style-src 'unsafe-inline'`,
    `img-src https: data: blob: ${origin}`,
    `font-src data:`,
  ].join("; ");
}

// Wrap pre-rendered, *untrusted* markup (markdown HTML, a mermaid SVG, a diff's
// SSR output) in the same opaque-origin sandbox html surfaces get. The markup was
// built as a STRING in the trusted viewer (string building is not a DOM sink),
// and only becomes live DOM here, inside the iframe — so a markdown-it / shiki /
// mermaid / DOMPurify / @pierre-diffs sanitizer bypass can no longer reach the
// workspace. `css` is the surface-specific stylesheet (prose/diff/mermaid rules);
// chrome theme vars come from viewerThemeCss so the surface matches the viewer.
// `mode` PINS those vars (and any shiki dark-flip the css carries) to the
// scheme the chrome resolved, so this frame can't diverge from it — and that
// includes `color-scheme`. A sandboxed, opaque-origin iframe loaded by URL
// defaults to `color-scheme: normal` (i.e. light): in dark mode the UA paints a
// WHITE canvas behind the transparent body, and the dark-mode text (--text) is
// washed out over it. (An earlier note here assumed omitting the property kept
// the frame transparent; it doesn't — it just leaves the canvas light.) Pinning
// the scheme, exactly as an html surface does, makes the UA canvas track the
// card so the frame reads as transparent in both schemes.
export function renderSandboxedPart(doc: {
  body: string;
  css: string;
  origin: string;
  theme?: Theme | string;
  mode?: Mode;
}): string {
  const theme =
    typeof doc.theme === "string" || doc.theme == null ? themeById(doc.theme) : doc.theme;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${buildRichCsp(doc.origin)}">
<!-- srcdoc's base URL is about:srcdoc, so relative URLs (e.g. a markdown
     image at /a/:id) would not resolve; pin the base to the server origin.
     img-src in buildRichCsp allows that origin. (html surfaces don't need this —
     they load via /s/:id, whose URL is already the base.) -->
<base href="${doc.origin}/">
<style>${viewerThemeCss(theme, doc.mode)}${doc.css}${colorSchemeCss(doc.mode)}</style>
</head>
<body>
${doc.body}
${scriptTag(doc.origin, BRIDGE_PATH)}
</body>
</html>`;
}

// Mermaid can't run without a DOM, so it can't be server-rendered like the
// other rich surfaces; instead the server emits a self-rendering doc that loads
// mermaid from the CDN allowlist and renders inside the sandboxed iframe (the
// "(B)" path). Unlike the other rich surfaces it needs CDN script/connect access,
// so it uses the html-surface CSP (buildCsp), NOT the tight rich CSP. mermaid's
// own DOMPurify (securityLevel 'strict') runs first; the opaque origin is the
// second boundary. Theme colors are baked into the diagram at render time, so —
// like shiki's flip — they're PINNED to the chrome-resolved mode the viewer
// passed. On a direct no-mode load, the iframe's own JS chooses the user's
// system scheme before mermaid renders.

const MERMAID_CSS = `
body { margin: 0; padding: 14px 16px; background: transparent; text-align: center; }
svg { max-width: 100%; height: auto; }
.mmd-error {
  text-align: left; color: var(--danger);
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.mmd-error pre {
  margin: 6px 0 0; padding: 8px 10px; color: var(--text);
  background: var(--panel); border: 0.5px solid var(--border);
  border-radius: 8px; overflow: auto; white-space: pre-wrap;
}
`;

// Mermaid `base` theme variables + themeCSS derived from the resolved palette,
// so the diagram matches mockpit's look instead of mermaid's stock theme.
// Mirrors mockpitTheme() in the old viewer MermaidPart, but reads palette
// fields directly rather than getComputedStyle.
//
// `mode` must match the scheme `p` was resolved into (renderMermaidPage picks
// the palette off the same mode): mermaid's `base` theme DERIVES every variable
// we don't set here, and many of those derivations branch on a `darkMode` flag
// (row stripes, the cScale/surface color ramps, the edge-label background).
// Leave it unset and they're all computed for a light canvas, so they never
// flip — "some of the diagram changes on toggle, but not all of it."
function mermaidThemeVars(
  p: Palette,
  mode?: Mode,
): {
  themeVariables: Record<string, string | boolean>;
  themeCSS: string;
} {
  const text = p.text;
  const muted = p.muted;
  const border = p.border2;
  const panel = p.panel;
  const surface = p.surface;
  const bg = p.bg;
  const accent = p.info.text;
  const accentBg = p.info.bg;
  return {
    themeVariables: {
      // Pin the scheme so mermaid's darkMode-branched derivations resolve the
      // same way the palette we read from did (both come from `mode`).
      darkMode: mode === "dark",
      fontFamily: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`,
      fontSize: "14px",
      // The canvas mermaid derives against. Several colors default to
      // invert(background) — most visibly `arrowheadColor` — so a pinned value
      // here is what lets them track the theme instead of inverting the
      // hardcoded #f4f4f4 default (which stays light in both modes). Use the
      // real backdrop the SVG sits on (the card surface).
      background: surface,
      primaryColor: panel,
      primaryBorderColor: border,
      primaryTextColor: text,
      secondaryColor: surface,
      tertiaryColor: bg,
      mainBkg: panel,
      nodeBorder: border,
      lineColor: muted,
      // Arrowheads default to invert(background); point them at the line color
      // so the whole edge reads as one color in both schemes.
      arrowheadColor: muted,
      textColor: text,
      // Text colors mermaid would otherwise invert()-derive from box/canvas
      // colors. Pin them to our text token so every label — node, title,
      // cluster, class-member — reads as the viewer's text color in both modes.
      nodeTextColor: text,
      titleColor: text,
      classText: text,
      secondaryTextColor: text,
      tertiaryTextColor: text,
      clusterBkg: bg,
      clusterBorder: border,
      edgeLabelBackground: bg,
      actorBkg: panel,
      actorBorder: border,
      actorTextColor: text,
      actorLineColor: muted,
      signalColor: muted,
      signalTextColor: text,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: border,
      labelTextColor: text,
      loopTextColor: text,
      noteBkgColor: accentBg,
      noteBorderColor: border,
      noteTextColor: text,
      sequenceNumberColor: surface,
    },
    themeCSS: `
      .node rect, .node polygon, rect.actor, .labelBox { rx: 8px; ry: 8px; }
      .node rect, rect.actor { stroke-width: 1px; }
      .edgePath .path, .flowchart-link, .actor-line,
      .messageLine0, .messageLine1 { stroke-width: 1px; }
      .node.accent > rect, .node.accent > polygon, .node.accent > circle,
      .node.accent > path { fill: ${accentBg}; stroke: ${accent}; }
      .node.accent .nodeLabel, .node.accent span, .node.accent text { fill: ${accent}; color: ${accent}; }
      .flowchart-link.accentLine, .edgePath.accentLine > .path { stroke: ${accent}; }
    `,
  };
}

// Pinned mermaid CDN module (within CDN_ALLOWLIST). Pinned to a major so a
// breaking mermaid release can't silently change rendering; bump deliberately.
const MERMAID_CDN = "https://esm.sh/mermaid@11";

export function renderMermaidPage(doc: {
  mermaid: string;
  origin: string;
  theme?: Theme | string;
  mode?: Mode;
}): string {
  const theme =
    typeof doc.theme === "string" || doc.theme == null ? themeById(doc.theme) : doc.theme;
  const enc = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  const pinned = doc.mode
    ? mermaidThemeVars(doc.mode === "dark" ? theme.dark : theme.light, doc.mode)
    : null;
  const light = pinned ? null : mermaidThemeVars(theme.light, "light");
  const dark = pinned ? null : mermaidThemeVars(theme.dark, "dark");
  const autoTheme = pinned
    ? ""
    : `const __mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
const __systemDark = !!(__mql && __mql.matches);
const themeVariables = __systemDark ? ${enc(dark!.themeVariables)} : ${enc(light!.themeVariables)};
const themeCSS = __systemDark ? ${enc(dark!.themeCSS)} : ${enc(light!.themeCSS)};`;
  const themeConfig = pinned
    ? `themeVariables: ${enc(pinned.themeVariables)},\n  themeCSS: ${enc(pinned.themeCSS)},`
    : `themeVariables,\n  themeCSS,`;
  // Embed source + theme as JS literals; escape `<` so a `</script>` in the
  // diagram source can't break out of the module script.
  const loader = `
import mermaid from ${enc(MERMAID_CDN)};
const src = ${enc(doc.mermaid ?? "")};
${autoTheme}
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  theme: 'base',
  ${themeConfig}
});
const el = document.getElementById('m');
try {
  const { svg } = await mermaid.render('mmd-svg', src);
  el.innerHTML = svg;
} catch (e) {
  // Match the old viewer fallback: a message plus the source echoed so the
  // agent can see what failed. textContent keeps the source inert.
  el.className = 'mmd-error';
  el.textContent = 'Couldn\\u2019t render diagram \\u2014 ' + (e && e.message ? e.message : 'parse error');
  const pre = document.createElement('pre');
  pre.textContent = src;
  el.appendChild(pre);
}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${buildCsp(doc.origin)}">
<base href="${doc.origin}/">
<style>${viewerThemeCss(theme, doc.mode)}${MERMAID_CSS}${colorSchemeCss(doc.mode)}</style>
</head>
<body>
<div id="m"></div>
<script type="module">${loader}</script>
${scriptTag(doc.origin, BRIDGE_PATH)}
</body>
</html>`;
}

export function renderHtmlPage(doc: {
  title: string;
  html: string;
  origin: string;
  theme?: Theme | string;
  // Pins the iframe's color scheme to the one the chrome resolved (see Mode).
  // Omitted → the scheme follows the OS via tokenThemeCss's media query.
  mode?: Mode;
  // Opt-in kits (kits.ts): their CSS/JS is injected after the base kit. The JS
  // is plain inline script — same trust level as the bridge, already covered by
  // the html-surface CSP's `script-src 'unsafe-inline'`. Unknown ids are ignored.
  kits?: string[];
  // The post's project design settings (`design:<project>`), imported from the
  // repo by `mockpit init`. Null/absent → the surface renders exactly as it
  // did before this existed.
  design?: DesignSettings | null;
  // The post version this document renders; tagged on every parts report.
  version?: number;
  // Validated `?k=` values (the route checks them against the declared knobs).
  knobs?: Record<string, unknown>;
  // Resolves `icon="prefix:name"` against the bundled and project-installed
  // sets. Absent → icons render as empty boxes.
  resolveIcon?: IconResolver;
}): string {
  const theme =
    typeof doc.theme === "string" || doc.theme == null ? themeById(doc.theme) : doc.theme;
  const design = designAssets(doc.design);
  const preamble = knobPreamble(doc.version, doc.knobs);
  // The project kit is appended, so with both present its components win over
  // a surface-requested kit's same-named classes.
  const kitIds = [...(doc.kits ?? []), ...design.kits];
  const kits = resolveKits(kitIds, design.projectKits);
  const kit = kitAssets(kitIds);
  // Document order still decides the cascade, so the externalized stylesheets
  // sit exactly where their inlined text used to: theme tokens, base, kit
  // accents, kit(s), then the project's own vars (which must win last).
  const styles = [
    `<style>${tokenThemeCss(theme, doc.mode)}</style>`,
    styleTag(doc.origin, BASE_CSS_PATH),
    `<style>${kitAccentCss(doc.mode)}</style>`,
    ...(kits.some((k) => !k.href) ? [styleTag(doc.origin, KIT_CORE_PATH)] : []),
    ...kits.flatMap((k) => [
      ...(k.href ? [`<link rel="stylesheet" href="${escapeHtml(k.href)}">`] : []),
      ...(k.cssPath ? [styleTag(doc.origin, k.cssPath)] : []),
    ]),
    `<style>${design.css}${colorSchemeCss(doc.mode)}</style>`,
  ].join("\n");
  return `<!doctype html>
${preamble.htmlTag}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${buildCsp(doc.origin)}">
<title>${escapeHtml(doc.title)}</title>
${preamble.headScript}
${styles}
${design.headScripts}
${kits.flatMap((k) => (k.script ? [`<script src="${escapeHtml(k.script)}" defer></script>`] : [])).join("\n")}
</head>
<body>
${SVG_DEFS}
${expandIcons(doc.html, doc.resolveIcon ?? (() => null)).html}
${scriptTag(doc.origin, BRIDGE_PATH)}
${scriptTag(doc.origin, HIT_TEST_PATH)}
${scriptTag(doc.origin, KNOBS_PATH)}
${scriptTag(doc.origin, PARTS_PATH)}
${kit.js ? `<script>${kit.js}</script>` : ""}
</body>
</html>`;
}
