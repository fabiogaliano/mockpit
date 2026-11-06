// The System place's type and space specimen: the scales drawn with the project's
// own fonts and tokens, so it is a document of its own, rendered through
// renderHtmlPage and served under the sandbox CSP like any surface. Names and
// values are agent data: they go in as escaped text and as `var(--name)` of names
// the system already validated. Runtime-agnostic.

import { escapeHtml } from "./surfacePage.ts";
import { type System, scaleSteps } from "./system.ts";

const SAMPLE = "Every render wears it";

const CSS = `
body{margin:0;padding:16px 20px;font-family:var(--font-sans,system-ui);color:var(--color-text-primary)}
.sp-h{font:600 11px/1.4 var(--font-mono,ui-monospace);letter-spacing:.04em;text-transform:uppercase;color:var(--color-text-tertiary);margin:18px 0 8px}
.sp-h:first-child{margin-top:0}
.sp-row{display:grid;grid-template-columns:minmax(120px,180px) 1fr;align-items:baseline;gap:12px;padding:4px 0}
.sp-lb{font:400 12px/1.4 var(--font-mono,ui-monospace);color:var(--color-text-secondary);white-space:nowrap}
.sp-lb b{font-weight:400;color:var(--color-text-tertiary)}
.sp-tx{line-height:1.15;overflow-wrap:anywhere}
.sp-bar{display:block;height:12px;border-radius:2px;background:var(--color-text-info,currentColor);opacity:.7}
.sp-none{font-size:13px;color:var(--color-text-secondary)}
`;

// Each label's px follows the frame's width, so a fluid step reads what it is here.
const MEASURE_JS = `<script>(function(){function m(){document.querySelectorAll("[data-sp]").forEach(function(r){var t=r.querySelector("[data-sp-of]");var o=r.querySelector("b");if(!t||!o)return;var cs=getComputedStyle(t);var v=r.getAttribute("data-sp")==="space"?t.getBoundingClientRect().width:parseFloat(cs.fontSize);o.textContent=" "+Math.round(v*10)/10+"px"})}addEventListener("load",m);addEventListener("resize",m)})();</script>`;

export function specimenHtml(system: System): string {
  const out: string[] = [`<style>${CSS}</style>`];
  const type = system.scales.filter((s) => s.family === "type");
  const space = system.scales.filter((s) => s.family === "space");
  for (const scale of type) {
    out.push(`<div class="sp-h">${escapeHtml(scale.id)}</div>`);
    for (const { step } of [...scaleSteps(scale)].reverse()) {
      const name = `${scale.prefix}-${step}`;
      out.push(
        `<div class="sp-row" data-sp="type"><span class="sp-lb">--${escapeHtml(name)}<b></b></span><span class="sp-tx" data-sp-of style="font-size:var(--${name})">${SAMPLE}</span></div>`,
      );
    }
  }
  for (const scale of space) {
    out.push(`<div class="sp-h">${escapeHtml(scale.id)}</div>`);
    for (const { step } of scaleSteps(scale)) {
      const name = `${scale.prefix}-${step}`;
      out.push(
        `<div class="sp-row" data-sp="space"><span class="sp-lb">--${escapeHtml(name)}<b></b></span><span><i class="sp-bar" data-sp-of style="width:var(--${name})"></i></span></div>`,
      );
    }
  }
  if (system.fonts.length) out.push(`<div class="sp-h">fonts</div>`);
  for (const f of system.fonts) {
    out.push(
      `<div class="sp-row"><span class="sp-lb">${escapeHtml(f.family)}</span><span class="sp-tx" style="font-family:${escapeHtml(JSON.stringify(f.family))};font-size:20px">${SAMPLE}</span></div>`,
    );
  }
  if (out.length === 1) out.push(`<p class="sp-none">No scales or fonts yet.</p>`);
  out.push(MEASURE_JS);
  return out.join("\n");
}
