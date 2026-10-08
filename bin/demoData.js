// Seed content for `mockpit demo`: the Writer mock — four states of one
// writing app, each drawn in three looks, with its parts marked so the viewer
// can show questions, tuning and part comments. Dependency-free like the CLI.

const LOOKS = {
  quiet: {
    paper: "#fbfaf7",
    ink: "#1f1d1a",
    muted: "#8a857c",
    rule: "#e7e3dc",
    panel: "#f3f0ea",
    font: "Georgia, serif",
  },
  dark: {
    paper: "#17181b",
    ink: "#e9e7e2",
    muted: "#8d8f96",
    rule: "#2a2c31",
    panel: "#202227",
    font: "Georgia, serif",
  },
  editorial: {
    paper: "#fffdf8",
    ink: "#111",
    muted: "#6f6a60",
    rule: "#111",
    panel: "#f4efe4",
    font: "'Times New Roman', serif",
  },
};

const BODY = `<p>The fog came in before noon, the way it always did in late August, and by the time
Mara reached the pier the boats were only outlines.</p>
<p>She had promised herself she would finish the chapter before the light went. The light
was going. The chapter was not finished.</p>`;

const GHOST = " She sat on the bollard and wrote the last line anyway.";

// Knob values reach the render as --k-<path> custom properties (dots become
// dashes), so every knob below has a CSS fallback for the un-tuned render.
function render(state, variant) {
  const look = LOOKS[variant.name];
  const lab = state.label === "Lab open";
  const versions = state.label === "Versions open";
  const ghost = state.label === "Ghost text";
  const editorial = variant.name === "editorial";
  return `<div class="writer" style="--paper:${look.paper};--ink:${look.ink};--muted:${look.muted};--rule:${look.rule};--panel:${look.panel};font-family:${look.font};background:var(--paper);color:var(--ink);display:flex;min-height:420px;border-radius:10px;overflow:hidden">
  <main style="flex:1;padding:36px 44px;position:relative">
    <div data-part="trim" data-part-label="Trim" style="display:flex;justify-content:space-between;font:12px/1 system-ui;color:var(--muted);padding-bottom:14px;border-bottom:1px solid var(--rule)">
      <span>Chapter 7 · draft</span><span>1,284 words</span>
    </div>
    <h1 data-part="title" data-part-label="Title" style="font-size:${editorial ? "40px" : "28px"};font-weight:${editorial ? 700 : 500};letter-spacing:${editorial ? "-0.02em" : "0"};margin:26px 0 18px">The Pier</h1>
    <article data-part="body" data-part-label="Body" style="font-size:calc(var(--k-body-size, 17) * 1px);line-height:1.65;max-width:calc(var(--k-body-measure, 64) * 1ch)">
      ${BODY}${ghost ? `<p><span data-part="ghost" data-part-label="Ghost text" style="color:var(--muted);font-style:italic">${GHOST}</span></p>` : ""}
    </article>
    ${
      state.label === "Writing"
        ? `<div data-part="toast" data-part-label="Toast" style="position:absolute;right:20px;bottom:18px;font:12px system-ui;background:var(--panel);border:1px solid var(--rule);padding:8px 12px;border-radius:8px">Saved · 2s ago</div>`
        : ""
    }
  </main>
  ${
    lab
      ? `<aside data-part="lab" data-part-label="Lab" style="width:220px;background:var(--panel);border-left:1px solid var(--rule);padding:22px;font:13px/1.5 system-ui">
      <b>Lab</b><p style="color:var(--muted)">Try the paragraph three ways.</p>
      <div style="border:1px solid var(--rule);border-radius:6px;padding:8px;margin:6px 0">Shorter</div>
      <div style="border:1px solid var(--rule);border-radius:6px;padding:8px;margin:6px 0">Warmer</div>
      <div style="border:1px solid var(--rule);border-radius:6px;padding:8px;margin:6px 0">Plainer</div>
    </aside>`
      : ""
  }
  ${
    versions
      ? `<aside data-part="versions" data-part-label="Versions" style="width:200px;background:var(--panel);border-left:1px solid var(--rule);padding:22px;font:13px/1.6 system-ui">
      <b>Versions</b>
      <div style="margin-top:10px">v3 · now</div><div style="color:var(--muted)">v2 · 1h ago</div><div style="color:var(--muted)">v1 · yesterday</div>
    </aside>`
      : ""
  }
</div>`;
}

export const DEMO = {
  project: "demo/writer",
  agent: "designer",
  sessionTitle: "Writer redesign",
  slug: "writer",
  title: "Writer",
  states: [
    { label: "Writing" },
    { label: "Lab open" },
    { label: "Versions open" },
    { label: "Ghost text" },
  ],
  variants: [{ name: "quiet" }, { name: "dark" }, { name: "editorial" }],
  knobs: {
    "body.size": [17, 14, 22, 1],
    "body.measure": [64, 48, 80, 1],
    "trim.position": { type: "select", options: ["top", "bottom"], value: "top" },
    "toast.show": true,
  },
  asks: [
    {
      id: "look",
      text: "Which look?",
      scope: "mock",
      options: [
        { label: "Quiet", variant: "quiet" },
        { label: "Dark", variant: "dark" },
        { label: "Editorial", variant: "editorial" },
      ],
    },
    {
      id: "versions-layout",
      text: "Where should versions live?",
      scope: "state",
      state: "Versions open",
      options: [{ label: "Side drawer" }, { label: "In the margin" }],
    },
    {
      id: "trim",
      text: "Trim above or below the page?",
      scope: "part",
      part: "trim",
      options: [
        { label: "Above", set: { "trim.position": "top" } },
        { label: "Below", set: { "trim.position": "bottom" } },
      ],
    },
  ],
  render,
};
