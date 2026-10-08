// The Writer mock of the final prototype (docs/tmp/mockups/concepts/7-rethink/
// final), published through the agent's HTTP tier: four UI states in three looks,
// marked parts, knobs, and the three questions an agent would ask about it.

import { agentCall } from "./fixtures.ts";

export const PROJECT = "e2e";
export const STATES = ["At rest", "Lab open", "Panel", "Ghost"] as const;
export const LOOKS = ["quiet", "dark", "editorial"] as const;
// Plain body text in one surface: it must never show up in the trusted document.
export const MARKER = "AGENT-MARKUP-7f3a";

const PALETTE = {
  quiet: { bg: "#fbfaf7", fg: "#222", face: "system-ui, sans-serif", title: 32 },
  dark: { bg: "#17181b", fg: "#eee", face: "system-ui, sans-serif", title: 32 },
  editorial: { bg: "#f4efe6", fg: "#1d1a16", face: "Georgia, serif", title: 46 },
} as const;

export function writerHtml(
  state: string,
  look: (typeof LOOKS)[number],
  opts: { title?: string; marker?: boolean } = {},
): string {
  const p = PALETTE[look];
  const versions =
    look === "editorial"
      ? `<aside class="v" data-part="versions" data-part-label="Versions">In the margin: friction · tension</aside>`
      : `<div class="v" data-part="versions" data-part-label="Versions">Yours: friction · <b>tension</b> · trouble</div>`;
  const lab =
    state === "Lab open"
      ? `<div class="lab" data-part="lab" data-part-label="Lab">Lab · tone plainer
  <div class="trim" data-part="trim" data-part-label="Trim">Trim −10% · −25%</div></div>`
      : "";
  const panel = state === "Panel" ? `<p class="side">History panel</p>` : "";
  const ghost = state === "Ghost" ? `<p class="ghost">The next sentence is forming…</p>` : "";
  return `<style>
body{margin:0;font:16px/1.5 ${p.face};background:${p.bg};color:${p.fg}}
.page{padding:28px 40px}
h1{font-size:${p.title}px;margin:0 0 14px}
.v{border-radius:8px;padding:8px 12px;margin:12px 0;background:#8882}
aside.v{width:220px;padding:16px}
html[data-k-versions-layout="inline"] .v{display:inline-block}
.lab{border:1px solid #8886;border-radius:10px;padding:12px;margin-top:16px}
.trim{margin-top:8px;font-size:13px}
.ghost{opacity:.5;font-style:italic}
</style>
<div class="page">
  <h1 data-part="title" data-part-label="Title">${opts.title ?? "Decide Late, Draft Early"}</h1>
  <div data-part="body" data-part-label="Body">
    <p>Every draft holds a quiet tension between what you meant and what reached the page. (${state}, ${look})</p>
    ${opts.marker ? `<p>${MARKER}</p>` : ""}
  </div>
  ${versions}${panel}${ghost}${lab}
</div>`;
}

export interface Seeded {
  mockId: string;
  session: string;
  posts: Record<string, string>; // `${state}/${look}` → post id
}

export async function seedWriter(server: string): Promise<Seeded> {
  let session = "";
  let mockId = "";
  const posts: Record<string, string> = {};
  for (const state of STATES) {
    for (const look of LOOKS) {
      const out = await agentCall(server, "/api/mocks", {
        project: PROJECT,
        mock: "writer",
        title: "Writer",
        state,
        variant: look,
        html: writerHtml(state, look, { marker: state === "At rest" && look === "quiet" }),
        ...(session
          ? { session }
          : {
              agent: "e2e",
              knobs: {
                size: [17, 12, 24],
                "versions.layout": { type: "select", options: ["drawer", "inline"] },
              },
            }),
      });
      session ||= out.sessionId ?? out.post.sessionId;
      mockId = out.mock.id;
      posts[`${state}/${look}`] = out.post.id;
    }
  }
  await agentCall(server, `/api/mocks/${mockId}/asks`, {
    session,
    asks: [
      {
        id: "look",
        text: "Which look should the Writer take?",
        scope: "mock",
        options: LOOKS.map((l) => ({ id: l, label: l[0].toUpperCase() + l.slice(1), variant: l })),
      },
      {
        id: "versions",
        text: "How should the versions open?",
        scope: "part",
        part: "versions",
        options: [
          { id: "drawer", label: "Drawer", set: { "versions.layout": "drawer" } },
          { id: "inline", label: "Inline", set: { "versions.layout": "inline" } },
        ],
      },
      {
        id: "trim",
        text: "Where does Trim live?",
        scope: "part",
        part: "trim",
        state: "Lab open",
        options: [
          { id: "below", label: "Below the lab" },
          { id: "inside", label: "Inside the lab" },
        ],
      },
    ],
  });
  return { mockId, session, posts };
}

export async function revise(
  server: string,
  mockId: string,
  body: { state: string; variant: string; html: string; prompt?: string; session?: string },
) {
  return agentCall(server, `/api/mocks/${mockId}/revise`, body);
}
