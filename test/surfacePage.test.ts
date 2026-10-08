import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  BRIDGE_JS,
  escapeHtml,
  KNOB_VALUE_SOURCE,
  knobCss,
  knobPreamble,
  knobVars,
  KNOBS_JS,
  PARTS_JS,
  renderHtmlPage,
  renderMermaidPage,
  renderSandboxedPart,
  STATIC_ASSET_PREFIX,
  staticAsset,
} from "../server/surfacePage.ts";
import { themeById } from "../server/themes.ts";

const ORIGIN = "http://localhost:4000";

// Pull the CSP value out of the rendered <meta> tag.
function csp(html: string): string {
  const m = html.match(/Content-Security-Policy" content="([^"]*)"/);
  assert.ok(m, "rendered page must carry a CSP meta tag");
  return m![1];
}

// Parse the rendered <meta http-equiv> CSP into directive -> source tokens.
// Asserting on exact source tokens (array membership) rather than substring-
// matching the policy string keeps these checks precise and avoids the
// URL-substring-sanitization shape static analysis (correctly) distrusts.
function cspDirectives(doc: string): Record<string, string[]> {
  const m = /content="([^"]*)"/.exec(doc.slice(doc.indexOf("Content-Security-Policy")));
  const policy = m ? m[1] : "";
  const out: Record<string, string[]> = {};
  for (const directive of policy.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name) out[name] = sources;
  }
  return out;
}

// The CDN allowlist html surfaces may load from. This is a deliberate, fixed set —
// the test pins it so widening it (a new origin, a wildcard) is a conscious edit
// that updates this list, never an accident.
const ALLOWED_CDNS = [
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

test("the CSP locks down default-src and allowlists exactly the known CDNs", () => {
  const policy = csp(renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN }));

  // nothing loads unless a later directive re-permits it
  assert.ok(policy.includes("default-src 'none'"), "default-src must be 'none'");

  // script/style are inline + the allowlist, and every CDN appears
  for (const cdn of ALLOWED_CDNS) {
    assert.ok(policy.includes(cdn), `CSP should allow ${cdn}`);
  }

  // the sandbox runs at an opaque origin, so the server origin is what lets
  // uploaded assets embed — it must be present in img/media, and only there
  assert.ok(/img-src[^;]*\bhttp:\/\/localhost:4000\b/.test(policy), "origin missing from img-src");
  assert.ok(
    /media-src[^;]*\bhttp:\/\/localhost:4000\b/.test(policy),
    "origin missing from media-src",
  );
});

test("the CSP never permits same-origin escapes, eval, or a wildcard host", () => {
  const policy = csp(renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN }));

  assert.ok(!policy.includes("'self'"), "'self' would defeat the opaque-origin sandbox");
  assert.ok(!policy.includes("'unsafe-eval'"), "eval must stay disallowed");
  // a bare * host source would make the allowlist meaningless
  assert.ok(!/(^|[\s;])\*([\s;]|$)/.test(policy), "no wildcard host source");
  // connect-src is limited to the named CDNs — no bare `https:` scheme source
  // that would open fetch/XHR to any host (the `https://…` CDN URLs are fine)
  const connect = policy.match(/connect-src([^;]*)/)?.[1] ?? "";
  assert.ok(!/https:(?!\/)/.test(connect), "connect-src must not open all of https:");
});

test("the document title is HTML-escaped so a crafted title can't break out", () => {
  const page = renderHtmlPage({
    title: `</title><script>alert(1)</script>`,
    html: "<p>body</p>",
    origin: ORIGIN,
  });
  // the literal closing tag + script must be entity-escaped, not live markup
  assert.ok(page.includes("&lt;/title&gt;&lt;script&gt;"), "title must be escaped");
  assert.ok(!page.includes("<title></title><script>alert(1)"), "title must not break out");
});

test("the surface html is embedded verbatim — the sandbox, not escaping, is the guard", () => {
  const body = `<div class="card"><button onclick="x()">go</button></div>`;
  const page = renderHtmlPage({ title: "t", html: body, origin: ORIGIN });
  assert.ok(page.includes(body), "trusted surface markup must pass through unaltered");
});

// The bridge is no longer inlined: every surface document loads it from one
// content-hashed `/asset/bridge.<hash>.js`, so the bytes are fetched once per
// workspace instead of once per surface, version, theme and mode.
function assetPaths(doc: string, ext: "js" | "css"): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?:src|href)="${ORIGIN}(${STATIC_ASSET_PREFIX}[^"]+\\.${ext})"`, "g");
  for (const m of doc.matchAll(re)) out.push(m[1]);
  return out;
}

test("the host bridge globals and resize reporter ship in the linked bridge asset", () => {
  const page = renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN });
  const scripts = assetPaths(page, "js");
  const bridgePath = scripts.find((p) => p.startsWith(`${STATIC_ASSET_PREFIX}bridge.`));
  assert.ok(bridgePath, "page must link the bridge asset");
  // content-hashed: a byte change moves the URL, so an immutable cache entry
  // can never pair a stale bridge with a fresh document
  assert.match(bridgePath!, /^\/asset\/bridge\.[a-z0-9]+\.js$/);
  const asset = staticAsset(bridgePath!);
  assert.ok(asset, "the linked path must resolve to a registered asset");
  assert.equal(asset!.body, BRIDGE_JS);
  // a break here silently kills the publish->comment loop, so pin the contract
  assert.ok(asset!.body.includes("window.sendPrompt"), "sendPrompt bridge missing");
  assert.ok(asset!.body.includes("window.openLink"), "openLink bridge missing");
  assert.ok(asset!.body.includes("type: 'resize'"), "resize reporter missing");
  // the page itself carries none of those bytes any more
  assert.ok(!page.includes("window.sendPrompt"), "bridge must not be inlined");
});

test("every asset URL a surface document references resolves to registered bytes", () => {
  const page = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    kits: ["slides"],
  });
  const paths = [...assetPaths(page, "js"), ...assetPaths(page, "css")];
  assert.ok(paths.length >= 3, "bridge + base css + kit css are all external");
  for (const path of paths) {
    const asset = staticAsset(path);
    assert.ok(asset, `unresolved asset reference: ${path}`);
    assert.equal(asset!.path, path);
    assert.ok(asset!.body.length > 0);
  }
});

test("theme tokens are injected and any theme id renders the one dialkit palette", () => {
  // a retired theme id still injects tokens rather than crashing
  const retired = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    theme: "gruvbox",
  });
  assert.ok(retired.includes("--color-background-primary:"), "token CSS missing");

  // an unknown id or no theme both render the same tokens, never crash
  const unknown = renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN, theme: "bogus" });
  const none = renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN });
  assert.ok(unknown.includes("--color-text-primary:"));
  assert.equal(
    none.match(/--color-text-primary:[^;]*/)?.[0],
    unknown.match(/--color-text-primary:[^;]*/)?.[0],
    "unknown theme should render identically to the default",
  );
});

test("a pinned mode forces color-scheme into both html surfaces and transparent rich frames", () => {
  const gh = renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN, mode: "dark" });
  // the document's used color-scheme is forced so the UA canvas/scrollbars/
  // controls follow it, overriding the static `color-scheme: light dark` default
  assert.ok(/:root\{color-scheme:dark\}/.test(gh), "color-scheme must be pinned to dark");
  // and EVERYTHING that flips by scheme is pinned: the theme tokens AND the kit's
  // own teal/coral SVG accents — so no `@media (prefers-color-scheme)` survives to
  // second-guess the scheme inside the frame
  assert.ok(
    !gh.includes("@media (prefers-color-scheme: dark)"),
    "pinned mode drops the media query",
  );
  assert.ok(gh.includes("--c-teal-bg: rgba(31, 169, 150, 0.18)"), "kit teal accent pinned to dark");

  // light pins the other way; absent mode keeps OS-driven theme vars and opts the
  // document into both UA color schemes so the browser can resolve the system mode.
  const light = renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN, mode: "light" });
  assert.ok(/:root\{color-scheme:light\}/.test(light), "color-scheme must be pinned to light");
  const auto = renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN });
  assert.ok(
    /:root\{color-scheme:light dark\}/.test(auto),
    "no mode → browser resolves light/dark from the OS",
  );
  assert.ok(auto.includes("@media (prefers-color-scheme: dark)"), "no mode → OS media query kept");

  // rich/comment frames pin the same way, color-scheme INCLUDED. A sandboxed
  // opaque-origin iframe defaults to `color-scheme: normal` (light), so without
  // this pin the UA paints a white canvas behind the transparent body and the
  // dark-mode text washes out. Pinning it makes the canvas track the dark card.
  const rich = renderSandboxedPart({ body: "x", css: "", origin: ORIGIN, mode: "dark" });
  const dark = themeById().dark;
  assert.ok(
    /:root\{color-scheme:dark\}/.test(rich),
    "rich frame must pin color-scheme so the UA canvas isn't white in dark mode",
  );
  assert.ok(
    !rich.includes("@media (prefers-color-scheme: dark)"),
    "rich tokens are pinned, no media query",
  );
  assert.ok(
    rich.includes(`--text: ${dark.text}`),
    "rich frame carries the pinned dark chrome vars",
  );
  // light pins light; an unpinned (no-mode) frame opts into both schemes so the
  // browser resolves the user's system mode instead of defaulting the canvas to light.
  assert.ok(
    /:root\{color-scheme:light\}/.test(
      renderSandboxedPart({ body: "x", css: "", origin: ORIGIN, mode: "light" }),
    ),
    "light mode pins color-scheme:light",
  );
  assert.ok(
    /:root\{color-scheme:light dark\}/.test(
      renderSandboxedPart({ body: "x", css: "", origin: ORIGIN }),
    ),
    "no mode → browser resolves light/dark from the OS",
  );
});

test("a mermaid page pins mermaid's derived colors to the scheme so the whole diagram flips", () => {
  const theme = themeById();
  const dark = renderMermaidPage({
    mermaid: "graph TD; A-->B",
    origin: ORIGIN,
    theme: "dialkit",
    mode: "dark",
  });
  const light = renderMermaidPage({
    mermaid: "graph TD; A-->B",
    origin: ORIGIN,
    theme: "dialkit",
    mode: "light",
  });

  // themeVariables is embedded as a JSON literal in the loader; pull it back out.
  const varsOf = (page: string): Record<string, unknown> => {
    const m = page.match(/themeVariables: (\{.*?\}),\n\s*themeCSS:/s);
    assert.ok(m, "themeVariables literal not found in the mermaid loader");
    return JSON.parse(m[1]);
  };
  const dv = varsOf(dark);
  const lv = varsOf(light);

  // darkMode is pinned to the resolved scheme. Unset, mermaid derives every
  // variable we don't set (row stripes, cScale ramps, edge-label bg) for a
  // light canvas, so they never flip — the original "some of it changes" bug.
  assert.equal(dv.darkMode, true, "dark page pins darkMode:true");
  assert.equal(lv.darkMode, false, "light page pins darkMode:false");

  // background is the real card surface, not mermaid's hardcoded #f4f4f4, so the
  // invert-derived colors track the theme — and it flips between schemes.
  assert.equal(dv.background, theme.dark.surface);
  assert.equal(lv.background, theme.light.surface);
  assert.notEqual(dv.background, lv.background, "background flips with the scheme");

  // arrowheadColor used to default to invert(background) and stayed dark in both
  // modes while its edge flipped; now it's pinned to the line color so the whole
  // edge reads as one color in either scheme.
  assert.equal(dv.arrowheadColor, theme.dark.muted);
  assert.equal(dv.arrowheadColor, dv.lineColor, "dark arrowhead matches the edge it caps");
  assert.equal(lv.arrowheadColor, lv.lineColor, "light arrowhead matches the edge it caps");

  // the text colors mermaid would otherwise invert()-derive are pinned to our
  // text token, so every label reads as the viewer's text color in both modes.
  for (const k of [
    "nodeTextColor",
    "titleColor",
    "classText",
    "secondaryTextColor",
    "tertiaryTextColor",
  ]) {
    assert.equal(dv[k], theme.dark.text, `${k} pinned to text (dark)`);
    assert.equal(lv[k], theme.light.text, `${k} pinned to text (light)`);
  }
});

test("a no-mode mermaid page chooses the user's system scheme in the iframe", () => {
  const auto = renderMermaidPage({ mermaid: "graph TD; A-->B", origin: ORIGIN, theme: "dialkit" });
  assert.ok(
    auto.includes("matchMedia('(prefers-color-scheme: dark)')"),
    "direct no-mode mermaid load should read the browser's system scheme",
  );
  assert.ok(auto.includes('"darkMode":true'), "auto loader embeds dark mermaid variables");
  assert.ok(auto.includes('"darkMode":false'), "auto loader embeds light mermaid variables");
  assert.ok(
    /:root\{color-scheme:light dark\}/.test(auto),
    "the document itself opts into system light/dark",
  );
});

test("renderSandboxedPart embeds the body and css inside the sandbox doc", () => {
  const doc = renderSandboxedPart({
    body: "<p>hello</p>",
    css: "p{color:red}",
    origin: ORIGIN,
  });
  assert.ok(doc.includes("<p>hello</p>"), "body is present");
  assert.ok(doc.includes("p{color:red}"), "css is present");
  // srcdoc's base URL is about:srcdoc, so relative URLs (e.g. a markdown image
  // at /a/:id) need an explicit base pinned to the origin to resolve.
  assert.ok(doc.includes(`<base href="${ORIGIN}/">`), "base href pins the origin");
  // the resize/openLink bridge is linked (not inlined) so it can self-size
  assert.ok(
    /<script src="http:\/\/localhost:4000\/asset\/bridge\.[a-z0-9]+\.js"><\/script>/.test(doc),
    "bridge is linked",
  );
  // chrome theme vars are injected (viewerThemeCss) so the surface matches the viewer
  assert.ok(doc.includes("--bg:"), "theme vars are injected");
});

test("renderSandboxedPart uses a tighter CSP than html surfaces: no connect-src, no CDN", () => {
  const d = cspDirectives(renderSandboxedPart({ body: "x", css: "", origin: ORIGIN }));
  assert.deepEqual(d["default-src"], ["'none'"], "locked-down default");
  // script-src is EXACTLY inline + the one server-authored asset directory —
  // no CDN sources leak in, and nothing agent- or user-written is reachable there
  assert.deepEqual(
    d["script-src"],
    ["'unsafe-inline'", `${ORIGIN}${STATIC_ASSET_PREFIX}`],
    "only the bridge asset runs",
  );
  // a contained script must have no way to phone home
  assert.ok(!("connect-src" in d), "no connect-src");
  // uploaded images still embed by absolute origin URL
  assert.ok(d["img-src"]?.includes(ORIGIN), "origin allowed for images");
});

test("html surfaces keep their CDN allowlist (rich-surface tightening did not leak)", () => {
  const html = cspDirectives(renderHtmlPage({ title: "t", html: "<b>x</b>", origin: ORIGIN }));
  const rich = cspDirectives(renderSandboxedPart({ body: "x", css: "", origin: ORIGIN }));
  // rich surfaces lock script-src to the inline bridge alone; html surfaces add the
  // CDN sources on top, so html's source list is strictly larger. (Asserting on
  // the count rather than a host literal keeps this off the URL-substring path.)
  assert.deepEqual(
    rich["script-src"],
    ["'unsafe-inline'", `${ORIGIN}${STATIC_ASSET_PREFIX}`],
    "rich = inline + the bridge asset directory only",
  );
  assert.ok(
    html["script-src"].length > rich["script-src"].length,
    "html surfaces keep extra (CDN) script sources",
  );
  assert.ok("connect-src" in html, "html surfaces still have connect-src");
});

test("the board origin is never a connect/script source — img/media only", () => {
  // The server origin is deliberately in img-src/media-src so uploaded assets
  // embed by URL. It must NEVER reach connect-src or script-src: that origin
  // serves the authenticated board API and the comment->agent channel, so a
  // contained script that could fetch it would defeat the whole sandbox. This
  // is the exact exfil hole the existing 'self'/wildcard/`https:` checks miss —
  // localhost:4000 is none of those, so it would slip past them.
  for (const make of [
    () => renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN }),
    () => renderSandboxedPart({ body: "x", css: "", origin: ORIGIN }),
  ]) {
    const d = cspDirectives(make());
    assert.ok(
      !(d["connect-src"] ?? []).includes(ORIGIN),
      "board origin must not be a connect source",
    );
    assert.ok(
      !(d["script-src"] ?? []).includes(ORIGIN),
      "board origin must not be a script source",
    );
    // it is present where it's meant to be, so this test can't pass vacuously
    assert.ok(d["img-src"]?.includes(ORIGIN), "board origin should still embed images");
  }
});

test("escapeHtml neutralizes markup metacharacters", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert(1)">`),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
  assert.equal(escapeHtml("a & b"), "a &amp; b");
});

// Pull the real resize bridge out of a rendered sandboxed surface and run it in a
// vm with a fake DOM, so we exercise the SHIPPED code (not a copy). The driver
// feeds the height the content "reports" at a given clock time and captures what
// the bridge posts to the parent.
function loadResizeBridge() {
  // BRIDGE_JS is exactly what ships inside <script>…</script> in every surface
  // page; run it verbatim. (That it's embedded in the page is covered separately
  // by the "host bridge globals and resize reporter are present" test.)
  const src = BRIDGE_JS;

  const posted: number[] = [];
  const clock = { scrollHeight: 0, now: 0 };
  type Timer = { id: number; due: number; fn: () => void; cancelled?: boolean };
  const timers: Timer[] = [];
  let nextTimer = 1;
  const noop = () => 0;
  const runUntil = (ms: number) => {
    while (true) {
      let next: Timer | undefined;
      for (const timer of timers) {
        if (timer.cancelled || timer.due > ms) continue;
        if (!next || timer.due < next.due || (timer.due === next.due && timer.id < next.id)) {
          next = timer;
        }
      }
      if (!next) break;
      next.cancelled = true;
      clock.now = next.due;
      next.fn();
    }
    clock.now = ms;
  };
  const ctx: Record<string, unknown> = {
    parent: {
      postMessage: (msg: { type?: string; height?: number }) => {
        if (msg && msg.type === "resize") posted.push(msg.height!);
      },
    },
    performance: { now: () => clock.now },
    setTimeout: (fn: () => void, delay = 0) => {
      const timer = { id: nextTimer++, due: clock.now + delay, fn };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: (id: number) => {
      const timer = timers.find((candidate) => candidate.id === id);
      if (timer) timer.cancelled = true;
    },
    requestAnimationFrame: noop,
    document: {
      readyState: "loading", // take the load-listener branch, not an eval-time __report()
      body: {
        get scrollHeight() {
          return clock.scrollHeight;
        },
      },
      documentElement: {},
      addEventListener: noop,
    },
    window: { addEventListener: noop }, // no ResizeObserver -> RO wiring is skipped
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const report = ctx.__report as () => void;
  return {
    posted,
    at(height: number, ms: number) {
      runUntil(ms);
      clock.scrollHeight = height;
      report();
    },
    setHeight(height: number, ms: number) {
      runUntil(ms);
      clock.scrollHeight = height;
    },
    runUntil,
  };
}

// Regression: a surface whose height inverts with the frame height (a scrollbar
// that toggles at a threshold, a 100vh/% layout) makes the parent's "size the
// iframe to the reported height" feed back into the content's height, so reports
// alternate A, B, A, B... forever. A plain `h !== lastH` guard can't stop it
// (each value differs from the one before), and on a heavy surface the per-frame
// relayout pegs a CPU core. The bridge must break the rapid 2-cycle, but a
// one-off A→B→A font/image reflow must still finish at the final A.
test("resize bridge breaks a rapid 2-cycle and rests on the taller height", () => {
  const b = loadResizeBridge();

  b.at(100, 1600);
  b.at(200, 1616);
  assert.deepEqual(b.posted, [100, 200]);

  // Keep flipping for long enough that a simple "within 250ms" guard would start
  // posting again. The active trailing debounce should keep suppressing until the
  // pair goes quiet, then leave the already-posted taller height in place.
  for (let i = 0; i < 40; i++) {
    b.at(i % 2 === 0 ? 100 : 200, 1632 + i * 16);
  }
  b.runUntil(3000);

  assert.deepEqual(
    b.posted,
    [100, 200],
    "a rapid A<->B oscillation must stop after the first cycle",
  );

  b.at(150, 5000);
  assert.deepEqual(
    b.posted,
    [100, 200, 150],
    "a later third height is a genuine resize, not stale oscillation state",
  );
});

test("resize bridge defers a suppressed A→B→A reflow instead of losing the final height", () => {
  const b = loadResizeBridge();

  b.at(320, 1600);
  b.at(180, 1616);
  b.at(320, 1632);
  assert.deepEqual(b.posted, [320, 180], "the rapid return is suppressed immediately");

  b.runUntil(2100);
  assert.deepEqual(
    b.posted,
    [320, 180, 320],
    "the trailing re-measure reports the final taller height",
  );
});

test("resize bridge allows a slow genuine return to an oscillation endpoint", () => {
  const b = loadResizeBridge();

  b.at(100, 1600);
  b.at(200, 1616);
  b.at(100, 1632);
  b.runUntil(2100);
  assert.deepEqual(b.posted, [100, 200], "the rapid return is suppressed");

  b.at(100, 5000);
  assert.deepEqual(
    b.posted,
    [100, 200, 100],
    "after the debounce window, the same lower endpoint can be a genuine resize",
  );
});

test("resize bridge late timers catch height growth after the 1500ms warm-up", () => {
  const b = loadResizeBridge();

  b.at(100, 0);
  b.runUntil(1500);
  b.setHeight(260, 2200); // no ResizeObserver fire: simulate a missed late settle
  assert.deepEqual(b.posted, [100]);

  b.runUntil(3000);
  assert.deepEqual(b.posted, [100, 260], "the 3000ms safety timer reports growth");

  b.setHeight(420, 4200); // after the first late safety net has already fired
  b.runUntil(6000);
  assert.deepEqual(b.posted, [100, 260, 420], "the 6000ms safety timer reports growth");

  b.setHeight(640, 7500); // after both earlier late safety nets have fired
  b.runUntil(10000);
  assert.deepEqual(b.posted, [100, 260, 420, 640], "the 10000ms safety timer reports growth");
});

// A project's imported design system reaches the frame through the surface
// document itself — this is the only place `mockpit init`'s output is applied,
// so the ordering rule (the repo's tokens land after mockpit's) is load-bearing.
test("a project's design injects its tokens and kit into the frame", () => {
  const page = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    design: {
      detected: null,
      palette: null,
      kit: "tailwind",
      // a bare declaration list, the other spelling init can store
      cssVars: "--radius: 0.5rem; --brand: #0af;",
      tailwindCss: "",
      strippedImports: [],
      iconSets: [],
      projectKits: [],
      updatedAt: "2026-09-15T00:00:00.000Z",
    },
  });
  assert.match(page, /<style>:root\{--radius: 0\.5rem; --brand: #0af;\}/, "wrapped in :root");
  assert.match(page, /<script src="https:\/\/cdn\./, "the tailwind kit loads its CDN build");
  // icons are inlined at render, so no html surface ever reads back from the
  // workspace origin
  assert.equal(cspDirectives(page)["connect-src"].includes(ORIGIN), false);

  const builtin = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    design: {
      detected: null,
      palette: null,
      kit: "builtin",
      cssVars: ":root{--radius:2px}",
      tailwindCss: "",
      strippedImports: [],
      iconSets: [],
      projectKits: [],
      updatedAt: "2026-09-15T00:00:00.000Z",
    },
  });
  assert.match(
    builtin,
    /<style>:root\{--radius:2px\}/,
    "an already-wrapped block is not rewrapped",
  );
  assert.ok(!builtin.includes('<script src="https://cdn.'), "no CDN for the CSS-only kit");
  // the builtin kit is a kit like any other, so it arrives as a linked asset
  assert.match(builtin, /href="[^"]*\/asset\/kit-builtin\.[a-z0-9]+\.css"/);
});

// The browser build compiles the style tags present when its script runs, and
// a shadcn repo themes dark through a `.dark` ancestor.
test("a Tailwind project's stylesheet reaches the browser build, before it, with .dark", () => {
  const design = {
    detected: null,
    palette: null,
    kit: "tailwind" as const,
    cssVars: ":root{--card:#fff}\n.dark{--card:#111}",
    tailwindCss: '@import "tailwindcss";\n:root{--card:#fff}\n.dark{--card:#111}\n</style><b>',
    strippedImports: ["tw-animate-css"],
    iconSets: [],
    projectKits: [],
    updatedAt: "2026-10-08T00:00:00.000Z",
  };
  const dark = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    design,
    mode: "dark",
  });
  const style = dark.indexOf('<style type="text/tailwindcss">@import "tailwindcss";');
  const script = dark.indexOf('<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">');
  assert.ok(style > 0 && script > style, "the stylesheet precedes the browser build");
  assert.ok(!dark.includes("<style>:root{--card:#fff}"), "cssVars is not injected beside it");
  assert.ok(!dark.includes("</style><b>"), "the stylesheet cannot close its own tag");
  assert.match(dark, /<html class="dark" lang="en"/);
  assert.match(dark, /--color-background-primary/, "mockpit's tokens still load");

  const light = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    design,
    mode: "light",
  });
  assert.match(light, /<html lang="en"/);

  const v3 = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    design: { ...design, tailwindCss: "" },
  });
  assert.ok(!v3.includes("text/tailwindcss"));
  assert.match(v3, /<style>:root\{--card:#fff\}/, "without a stylesheet the tokens still load");
});

test("a surface with no project design injects nothing at all", () => {
  const page = renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN, design: null });
  assert.ok(!page.includes("kit-builtin"));
  assert.equal(cspDirectives(page)["connect-src"].includes(`${ORIGIN}/a/`), false);
});

// --- stage bridge: parts and knobs -----------------------------------------------

test("an html surface links the parts and knobs bridges and tags the document version", () => {
  const page = renderHtmlPage({ title: "t", html: "<p>x</p>", origin: ORIGIN, version: 7 });
  const scripts = assetPaths(page, "js");
  for (const [name, body] of [
    ["parts", PARTS_JS],
    ["knobs", KNOBS_JS],
  ] as const) {
    const path = scripts.find((p) => p.startsWith(`${STATIC_ASSET_PREFIX}${name}.`));
    assert.ok(path, `${name} bridge must be linked`);
    assert.equal(staticAsset(path!)!.body, body);
  }
  assert.ok(page.includes('window.__mockpitDoc={"version":7,"knobs":{}}'));
  // the highlight is a class in the base stylesheet, not a style element the
  // parts observer would see being inserted
  const base = assetPaths(page, "css").find((p) => p.startsWith(`${STATIC_ASSET_PREFIX}base.`));
  assert.ok(staticAsset(base!)!.body.includes(".mockpit-part-hl{"));
  // rich kinds carry no agent markup, so no parts
  const rich = renderSandboxedPart({ body: "x", css: "", origin: ORIGIN });
  assert.ok(!rich.includes("/asset/parts."), "rich frames do not load the parts bridge");
});

test("the parts bridge keeps the protocol the host codes against", () => {
  // report triggers, including WebKit's missing initial ResizeObserver callback
  for (const needle of [
    "type = 'parts'",
    "[50, 150, 400, 1000]",
    "new ResizeObserver",
    "new MutationObserver",
    "'animationend'",
    "'transitionend'",
    "document.fonts.ready",
    "addEventListener('scroll'",
    // our own highlight flip is swallowed before the observer callback runs
    "mo.takeRecords()",
    "elementFromPoint",
    "type: 'hit'",
    "e.source !== parent",
  ]) {
    assert.ok(PARTS_JS.includes(needle), `parts bridge lost ${needle}`);
  }
});

test("knob values are baked into the html tag and head script with every sink escaped", () => {
  const hostile = `a"b<c;d}e</script><script>alert(1)</script>`;
  const { htmlTag, headScript } = knobPreamble(3, {
    size: 18,
    face: "serif",
    "body.label": hostile,
    "card.on": true,
    pad: { x: 0.5, y: -1 },
  });
  // attributes: the value round-trips, nothing breaks out of the quotes or the tag
  assert.ok(htmlTag.startsWith('<html lang="en" '));
  assert.equal(htmlTag.indexOf("<", 1), -1, "no second tag can open inside <html>");
  assert.equal(htmlTag.indexOf(">"), htmlTag.length - 1, "the tag ends exactly once");
  assert.ok(htmlTag.includes(' data-k-size="18"'));
  assert.ok(htmlTag.includes(' data-k-face="serif"'));
  assert.ok(htmlTag.includes(' data-k-card-on="true"'));
  assert.ok(!htmlTag.includes("data-k-pad="), "objects get no attribute");
  const attrs = [...htmlTag.matchAll(/ ([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]);
  const unescape = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  const attr = Object.fromEntries(attrs.map(([k, v]) => [k, unescape(v)]));
  assert.equal(attr["data-k-body-label"], hostile);

  // CSS: numbers raw, a hostile string becomes ONE quoted CSS string, so its
  // `;` and `}` can't end the declaration or the block
  assert.equal(
    attr.style,
    [
      "--k-size:18",
      "--k-face:serif",
      `--k-body-label:"a\\"b<c;d}e</script><script>alert(1)</script>"`,
      "--k-card-on:1",
      "--k-pad-x:0.5",
      "--k-pad-y:-1",
    ].join(";"),
  );

  // script: one closing tag (its own), and the JSON parses back to the values
  assert.equal(headScript.match(/<\/script>/g)!.length, 1);
  assert.ok(
    !headScript.slice("<script>".length, -"</script>".length).includes("<"),
    "no `<` inside the script body",
  );
  const json = headScript.slice("<script>window.__mockpitDoc=".length, -";</script>".length);
  assert.deepEqual(JSON.parse(json), {
    version: 3,
    knobs: {
      size: 18,
      face: "serif",
      "body.label": hostile,
      "card.on": true,
      pad: { x: 0.5, y: -1 },
    },
  });
});

test("a knob string escapes quotes, backslashes and control characters as a CSS string", () => {
  assert.equal(knobCss("12px"), "12px");
  assert.equal(knobCss("#8b7bff"), "#8b7bff");
  assert.equal(knobCss("oklch(0.6 0.2 260 / 50%)"), "oklch(0.6 0.2 260 / 50%)");
  assert.equal(knobCss(""), '""');
  assert.equal(knobCss('say "hi"'), '"say \\"hi\\""');
  assert.equal(knobCss("a\\b"), '"a\\\\b"');
  assert.equal(knobCss("x;}y"), '"x;}y"');
  assert.equal(knobCss("tab\there:"), '"tab\\9 here:"');
  assert.equal(knobCss(false), "0");
  assert.equal(knobCss(Number.NaN), null);
  assert.equal(knobCss({ x: 1 }), null);
});

test("the in-frame knob mapping matches the server's for baked and live values alike", () => {
  const ctx: Record<string, any> = {};
  vm.createContext(ctx);
  vm.runInContext(KNOB_VALUE_SOURCE, ctx);
  const samples: unknown[] = [
    0,
    -2.5,
    true,
    false,
    "serif",
    "",
    "rgb(1, 2, 3)",
    'a"b<c;d}e',
    "back\\slash",
    "line\u0007bell",
    "café",
    { x: 1, y: "q;" },
    { stiffness: 200, damping: 20, type: "spring" },
    { "bad key": 1, ok: 2 },
  ];
  for (const v of samples) {
    const label = JSON.stringify(v);
    assert.equal(ctx.__kCss(v), knobCss(v), `css ${label}`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(ctx.__kVars("body.size", v))),
      knobVars("body.size", v),
      `vars ${label}`,
    );
  }
  assert.ok(ctx.__kPathRe.test("body.size") && !ctx.__kPathRe.test("a b"));
});

test("an html document carries the baked knobs on <html>", () => {
  const page = renderHtmlPage({
    title: "t",
    html: "<p>x</p>",
    origin: ORIGIN,
    version: 2,
    knobs: { size: 20, face: "mono" },
  });
  assert.ok(
    page.includes(
      '<html lang="en" data-k-size="20" data-k-face="mono" style="--k-size:20;--k-face:mono">',
    ),
  );
});

// --- /s/:id?k= -------------------------------------------------------------------

async function knobApp() {
  const { createApp } = await import("../server/app.ts");
  const { SqlStore } = await import("../server/sqlStore.ts");
  const { createSqliteStorage } = await import("../server/sqliteStorage.ts");
  const app = createApp({
    store: new SqlStore(createSqliteStorage()),
    viewerHtml: "<html><head></head><body>viewer</body></html>",
    topics: { html: "# guide" },
    setupText: "# setup",
  });
  const publish = async (body: Record<string, unknown>) => {
    const res = await app.request("/api/mocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: "demo", ...body }),
    });
    assert.ok(res.status < 300, `publish failed ${res.status}`);
    return (await res.json()) as { post: { id: string; version: number } };
  };
  const out = await publish({
    mock: "card",
    html: '<h1 data-part="title" data-k-bind="label">T</h1>',
    knobs: { size: [17, 12, 24], label: "Hello" },
    variantKnobs: { face: { type: "select", options: ["serif", "mono"] } },
  });
  const s = (k: unknown, extra = "") =>
    app.request(
      `/s/${out.post.id}?surface=0&ver=1&mode=dark${extra}&k=${encodeURIComponent(
        typeof k === "string" ? k : JSON.stringify(k),
      )}`,
    );
  return { app, publish, id: out.post.id, s };
}

test("/s/:id?k= bakes declared mock and variant knobs under the sandbox CSP header", async () => {
  const { s } = await knobApp();
  const res = await s({ size: 20, face: "mono", label: 'a"b<c;d}e' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-security-policy"), "sandbox allow-scripts");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("cache-control") ?? "", /immutable/);
  const doc = await res.text();
  assert.ok(doc.includes(' data-k-size="20"'), "mock-level knob baked");
  assert.ok(doc.includes(' data-k-face="mono"'), "variant-level knob baked");
  assert.ok(doc.includes(' data-k-label="a&quot;b&lt;c;d}e"'), "string value escaped");
  // the html-surface CSP is unchanged by knobs: no connect-src widening
  const connect = cspDirectives(doc)["connect-src"];
  assert.deepEqual(connect, ALLOWED_CDNS);
});

test("/s/:id?k= refuses undeclared, out-of-range and malformed values with 400", async () => {
  const { s } = await knobApp();
  for (const [why, k] of [
    ["out of range", { size: 99 }],
    ["wrong type", { size: "20" }],
    ["not an option", { face: "comic" }],
    ["undeclared", { color: "#fff" }],
    ["not an object", [1, 2]],
    ["not JSON", "{size:"],
  ] as const) {
    const res = await s(k);
    assert.equal(res.status, 400, why);
    // the error never comes back as a document anything could execute in
    assert.equal(res.headers.get("content-security-policy"), "sandbox allow-scripts", why);
    assert.ok(!(await res.text()).includes("<html"), why);
  }
});

test("the render cache keys on the canonical knob values", async () => {
  const { app, id, s } = await knobApp();
  const plain = await (await app.request(`/s/${id}?surface=0&ver=1&mode=dark`)).text();
  const a = await (await s({ size: 20, face: "mono" })).text();
  const b = await (await s({ face: "mono", size: 20 })).text();
  const c = await (await s({ size: 21, face: "mono" })).text();
  // a cached plain document is never served for a knob URL, or vice versa
  assert.ok(!plain.includes("data-k-size"));
  assert.ok(a.includes(' data-k-size="20"'));
  assert.equal(a, b, "key order does not change the document");
  assert.ok(c.includes(' data-k-size="21"'), "different values are a different entry");
  const again = await (await app.request(`/s/${id}?surface=0&ver=1&mode=dark`)).text();
  assert.equal(again, plain);
  // an empty set is the plain document
  assert.equal(await (await s({})).text(), plain);
});

test("/s/:id?k= is revalidated against the knobs declared now, even for a pinned version", async () => {
  const { publish, s } = await knobApp();
  assert.equal((await s({ size: 20 })).status, 200);
  // a later publish narrows the mock-level knob; the cached document must not
  // keep serving a value the schema no longer allows
  await publish({
    mock: "card",
    state: undefined,
    variant: "other",
    html: "<p/>",
    knobs: { size: [14, 12, 16] },
  });
  assert.equal((await s({ size: 20 })).status, 400);
});
