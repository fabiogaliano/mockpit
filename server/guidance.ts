// Guidance layers on top of the core brief: packs that ship with mockpit (off
// until a rules file names them), the user's own rules and the project's.
// Higher wins: project, then the user's, then packs, then core. The brief
// prints them in that order from the bottom up, so the last word an agent
// reads is the one that wins.
//
// Runtime-agnostic (no node imports): the Worker builds the brief too.

export const GUIDE_PACKS = ["design-craft"] as const;
export type GuidePack = (typeof GUIDE_PACKS)[number];

const isGuidePack = (id: string): id is GuidePack =>
  (GUIDE_PACKS as readonly string[]).includes(id);

// `rules:<project>` sits beside `design:<project>` and moves with a project
// rename. The user's own rules are not a project, so their key has no colon:
// a project named "user" can't collide with it.
export const RULES_SETTING = "rules";
export const USER_RULES_SETTING = "userRules";

// A rules file is read whole into every brief, so it stays a page, not a book.
export const MAX_RULES_CHARS = 6_000;

export interface RulesFile {
  packs: string[];
  body: string;
}

// `---\npacks: [design-craft]\n---` (or `packs: a, b`, or a `- a` list), then
// markdown. Anything else in the frontmatter is ignored rather than refused:
// the file is the user's, and a stray key must not cost them their rules.
export function parseRulesFile(text: string): RulesFile {
  const src = text.replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { packs: [], body: src.trim() };
  const packs: string[] = [];
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = /^packs\s*:\s*(.*)$/.exec(lines[i].trim());
    if (!kv) continue;
    const inline = kv[1].trim().replace(/^\[|\]$/g, "");
    if (inline) packs.push(...inline.split(","));
    for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) {
      packs.push(lines[j].replace(/^\s*-\s+/, ""));
    }
  }
  const names = packs.map((p) => p.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return { packs: [...new Set(names)], body: src.slice(m[0].length).trim() };
}

export interface GuidanceInput {
  // Pack bodies by id, read at boot like the topics.
  packs: Partial<Record<GuidePack, string>>;
  user: string | null;
  project: string | null;
}

// The layer files' own `## Rules` / `## Suggestions` sit one level under the
// layer's heading in the brief.
const demote = (md: string) => md.replace(/^(#{1,5}) /gm, "#$1 ");

/**
 * The guidance line and sections for the brief, or "" when only core is on:
 * a workspace that never wrote a rules file gets the brief it always had.
 */
export function guidanceSections(input: GuidanceInput): { line: string; body: string } {
  const user = input.user ? parseRulesFile(input.user) : null;
  const project = input.project ? parseRulesFile(input.project) : null;
  const named = [...new Set([...(user?.packs ?? []), ...(project?.packs ?? [])])];
  const on = named.filter((p): p is GuidePack => isGuidePack(p) && !!input.packs[p]);
  const unknown = named.filter((p) => !on.includes(p as GuidePack));

  const layers: { label: string; heading: string; text: string }[] = [
    ...on.map((p) => ({ label: p, heading: `Pack: ${p}`, text: input.packs[p]!.trim() })),
    ...(user?.body ? [{ label: "your rules", heading: "Your rules", text: user.body }] : []),
    ...(project?.body
      ? [{ label: "project", heading: "This project's rules", text: project.body }]
      : []),
  ];
  if (layers.length === 0 && unknown.length === 0) return { line: "", body: "" };

  const missing = unknown.length
    ? ` (unknown pack ${unknown.map((p) => `"${p}"`).join(", ")}; packs: ${GUIDE_PACKS.join(", ")})`
    : "";
  const line =
    `Guidance: ${["core", ...layers.map((l) => l.label)].join(" · ")}${missing}. ` +
    "Higher wins: project, then yours, then packs, then core; the user's own words beat " +
    "all of them. **Rules** are always followed; **Suggestions** are aimed for.";
  const body = layers.map((l) => `## ${l.heading}\n\n${demote(l.text)}`).join("\n\n");
  return { line, body };
}
