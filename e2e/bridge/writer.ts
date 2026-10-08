// The Writer mock from docs/tmp/experiments/parts-bridge (serve.mjs), as surface
// html for the real /s/:id renderer: four states whose parts cover the hard
// cases (sticky, late-inserted, transformed, fixed, nested, inline-wrapping),
// plus a v2 that moves `trim` inside `lab` and grows the title.

export const STATES = ["rest", "lab", "panel", "ghost"] as const;
export type State = (typeof STATES)[number];

export const EXPECTED: Record<State, string[]> = {
  rest: ["chrome", "title", "body", "word", "versions", "toast"],
  lab: ["chrome", "title", "body", "word", "versions", "lab", "trim"],
  panel: ["chrome", "panel", "versions", "title", "body", "word"],
  ghost: ["chrome", "title", "body", "word", "menu", "versions", "ghost"],
};

// Declared on the mock (size, label) and on the rest variant (face). The face
// option is pre-rendered: both tag lines ship, CSS on html[data-k-face] picks one.
export const MOCK_KNOBS = { size: [17, 12, 24], label: "312 words" };
export const VARIANT_KNOBS = { face: { type: "select", options: ["serif", "mono"] } };

const P = [
  "Writer keeps the alternatives instead. Each word you hesitate over grows a small drawer of versions, yours and a few the lab suggests, so the choice can wait until the paragraph around it is finished.",
  "Deciding late is not indecision. It is giving the sentence enough context to tell you which word it wanted all along.",
  "When the draft is done, the drawers close, the dots disappear, and what remains reads as if it had always been written that way.",
];

export function writerHtml(state: State, v2 = false): string {
  const versions = `<div class="wr-well" data-part="versions" data-part-label="Versions well">
      <div class="wr-vlabel">Yours</div><div>friction · <b>tension</b> · trouble</div>
      <div class="wr-vlabel">Suggested</div><div>resistance · drag · hesitation</div></div>`;
  const menu =
    state === "ghost"
      ? `<span class="wr-menu" data-part="menu" data-part-label="Context menu"><span>Replace word</span><span>Ghost next sentence</span><span>Overflow…</span></span>`
      : "";
  const ghost =
    state === "ghost"
      ? ` <span class="wr-ghost" data-part="ghost" data-part-label="Ghost text">The sentence after this one is already forming, and it wraps across a line or two of the page.</span>`
      : "";
  const filler = Array.from({ length: 12 }, (_, i) => `<p>${P[i % 3]}</p>`).join("");
  const trim = `<div class="wr-trim" data-part="trim" data-part-label="Trim bar"><b>Trim</b><span>−10%</span><span>−25%</span><span>Tighten</span></div>`;
  const lab =
    state === "lab"
      ? `<div class="wr-labpill">Lab ▴</div>
         <div class="wr-labpop" data-part="lab" data-part-label="Lab popover"><div class="wr-labtitle">Lab</div>
           <div class="wr-row"><span>Tone</span><i>plainer</i></div><div class="wr-row"><span>Length</span><i>shorter</i></div>
           <div class="wr-row"><span>Voice</span><i>keep mine</i></div>${v2 ? trim : ""}</div>${v2 ? "" : trim}`
      : "";
  const panel =
    state === "panel"
      ? `<aside class="wr-panel" data-part="panel" data-part-label="Side panel"><div class="wr-vlabel">History</div>${versions}</aside>`
      : "";
  return `<style>
html,body{margin:0}
body{padding:0;font:17px/1.6 "Iowan Old Style",Palatino,Georgia,serif;font-size:calc(var(--k-size, 17) * 1px);background:#f1f0ec;color:#262522}
.wr-chrome{position:sticky;top:0;z-index:5;display:flex;gap:14px;align-items:center;padding:10px 20px;background:#e7e4dd;font:12px ui-monospace,Menlo,monospace;border-bottom:1px solid #d6d2c8}
.wr-chrome .sp{flex:1}.wr-pill{border:1px solid #2f6d62;color:#2f6d62;border-radius:99px;padding:1px 8px}
.wr-face-mono{display:none}
html[data-k-face="mono"] .wr-face-serif{display:none}
html[data-k-face="mono"] .wr-face-mono{display:inline}
.wr-page{display:flex;gap:24px;padding:28px 56px 80px}
.wr-sheet{flex:1;min-width:0}
.wr-title{--ts:${v2 ? 54 : 36}px;font-size:var(--ts);line-height:1.15;margin:0 0 18px;font-weight:600}
.font-ready .wr-title{font-family:ui-monospace,Menlo,monospace;font-size:calc(var(--ts) * 1.4)}
.wr-word{position:relative;border-bottom:2px dotted #2f6d62}
.wr-well{background:#e7e4dd;border-radius:8px;padding:10px 14px;font-size:14px;margin:14px 0}
.wr-vlabel{font:11px ui-monospace,Menlo,monospace;text-transform:uppercase;color:#7b776d;margin-top:4px}
.scaled{transform:scale(.9);transform-origin:0 0}
.wr-toast{background:#2f6d62;color:#fff;border-radius:6px;padding:8px 12px;font-size:14px;margin:0 0 14px;animation:slide .2s ease-out}
@keyframes slide{from{transform:translateY(-10px)}to{transform:none}}
.wr-labpill{position:fixed;left:20px;bottom:16px;background:#262522;color:#fff;border-radius:99px;padding:4px 12px;font-size:13px}
.wr-labpop{position:fixed;right:24px;bottom:72px;width:220px;background:#fff;border:1px solid #d6d2c8;border-radius:10px;padding:12px;box-shadow:0 8px 24px #0002;font-size:14px}
.wr-labtitle{font-weight:700;margin-bottom:6px}.wr-row{display:flex;justify-content:space-between}
.wr-trim{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:10px;background:#262522;color:#fff;border-radius:8px;padding:6px 12px;font-size:13px}
.wr-labpop .wr-trim{position:static;transform:none;margin-top:10px;flex-wrap:wrap}
.wr-panel{width:190px;flex:none;border-right:1px solid #d6d2c8;padding-right:16px}
.wr-panel .wr-well{margin:6px 0}
.wr-menu{position:absolute;left:0;top:1.6em;z-index:4;display:flex;flex-direction:column;background:#fff;border:1px solid #d6d2c8;border-radius:8px;padding:6px 10px;font:13px system-ui;white-space:nowrap;box-shadow:0 8px 24px #0002}
.wr-ghost{color:#9a958a;font-style:italic}
</style>
<div class="wr-chrome" data-part="chrome" data-part-label="Chrome bar"><b>Writer</b><span>Decide Late, Draft Early · draft 3</span><span class="sp"></span><span id="wr-label" data-k-bind="label">312 words</span><span class="wr-face-serif">Serif</span><span class="wr-face-mono">Mono</span><span class="wr-pill">Lab</span></div>
<div class="wr-page">${panel}<div class="wr-sheet">
<h1 class="wr-title" data-part="title" data-part-label="Title">Decide Late, Draft Early</h1>
<div id="toast-slot"></div>
<div class="wr-body" data-part="body" data-part-label="Body">
<p>Every draft holds a quiet <span class="wr-word" data-part="word" data-part-label="Hesitated word">tension${menu}</span> between what you meant and what reached the page. Most tools ask you to settle it at once: pick the word, commit the line, move on.</p>
${state === "panel" ? "" : `<div class="scaled">${versions}</div>`}
<p>${P[0]}${ghost}</p>
${filler}
</div></div></div>
${lab}
<script>
window.__knobEvents = [];
window.addEventListener('mockpit:knobs', function (e) { window.__knobEvents.push(e.detail.values); });
${state === "rest" ? `setTimeout(function(){var t=document.createElement('div');t.className='wr-toast';t.dataset.part='toast';t.dataset.partLabel='Saved toast';t.textContent='Draft 3 saved · 2 alternatives kept';document.getElementById('toast-slot').appendChild(t);},300);` : ""}
setTimeout(function(){document.documentElement.classList.add('font-ready');},600);
</script>`;
}
