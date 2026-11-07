// A design's spec: what it is for, how it works where the picture can't show it, and
// the decisions its replies left. The first two are written (by an agent, corrected by
// the user, a hand edit standing per section); the decisions are derived on every read
// from the decision log, never stored. Runtime-agnostic (no node imports).

import type { DecisionLine } from "./decisionLog.ts";
import {
  type Author,
  type Design,
  type DesignEdit,
  type DesignSpec,
  MAX_SPEC_LINES,
  type SpecLine,
  type SpecSection,
  stripNul,
} from "./types.ts";

const MAX_LINE = 600;
const MAX_PART = 200;

export interface SpecInput {
  purpose?: string;
  behaviour?: SpecLine[];
}

// The two sections as an edit gives them, or why not. "" (or []) clears a section.
// Refused rather than cut: a spec missing its end reads as a complete one.
export function specInput(
  body: { purpose?: unknown; behaviour?: unknown },
  design: Pick<Design, "slug" | "states">,
): SpecInput | { error: string; extra?: Record<string, unknown> } {
  const out: SpecInput = {};
  if (body.purpose !== undefined) {
    if (typeof body.purpose !== "string") {
      return { error: '"purpose" must be plain text: what the design is for; "" clears it' };
    }
    out.purpose = stripNul(body.purpose).trim();
  }
  if (body.behaviour !== undefined) {
    const raw = body.behaviour === "" ? [] : body.behaviour;
    if (!Array.isArray(raw)) {
      return {
        error:
          '"behaviour" must be a list of lines, e.g. [{"text": "Pinch zooms between Now and the whole day", "state": "Now", "part": "river"}]; [] clears it',
      };
    }
    if (raw.length > MAX_SPEC_LINES) {
      return { error: `"behaviour" takes at most ${MAX_SPEC_LINES} lines, got ${raw.length}` };
    }
    const lines: SpecLine[] = [];
    for (const item of raw) {
      const line = typeof item === "string" ? { text: item } : item;
      if (!line || typeof line !== "object" || typeof line.text !== "string") {
        return { error: 'each "behaviour" line is {text, state?, part?}' };
      }
      const text = stripNul(line.text).trim();
      if (!text) continue;
      if (text.length > MAX_LINE) {
        return {
          error: `a "behaviour" line is at most ${MAX_LINE} characters, got ${text.length}`,
        };
      }
      const state = typeof line.state === "string" ? stripNul(line.state).trim() : "";
      if (state && !design.states.includes(state)) {
        return {
          error: `${design.slug} has no state "${state}"`,
          extra: { states: design.states },
        };
      }
      const part = typeof line.part === "string" ? stripNul(line.part).trim() : "";
      if (part.length > MAX_PART) return { error: `a part name is at most ${MAX_PART} characters` };
      lines.push({ text, ...(state ? { state } : {}), ...(part ? { part } : {}) });
    }
    out.behaviour = lines;
  }
  return out;
}

const sameLines = (a: SpecLine[], b: SpecLine[]) => JSON.stringify(a) === JSON.stringify(b);

export const heldOf = (spec: DesignSpec | null, section: SpecSection): boolean =>
  !!spec?.held?.includes(section);

export const specSize = (spec: Pick<DesignSpec, "purpose" | "behaviour">): number =>
  spec.purpose.length + spec.behaviour.reduce((n, l) => n + l.text.length, 0);

// The spec after an edit, and the sections an agent's write could not change because
// the user wrote them by hand. Saved as it was isn't an edit: it mustn't take an
// agent's draft for the user's. The user clearing a section hands it back to agents.
export function applySpec(
  before: DesignSpec | null,
  input: SpecInput,
  by: Author,
  at: string,
): { spec: DesignSpec | null; changed: boolean; kept: SpecSection[] } {
  const kept: SpecSection[] = [];
  let purpose = before?.purpose ?? "";
  let behaviour = before?.behaviour ?? [];
  const held = new Set(before?.held ?? []);
  let changed = false;
  if (input.purpose !== undefined) {
    if (by === "agent" && held.has("purpose")) kept.push("purpose");
    else if (input.purpose !== purpose) {
      purpose = input.purpose;
      changed = true;
      if (by === "user") {
        if (purpose) held.add("purpose");
        else held.delete("purpose");
      }
    }
  }
  if (input.behaviour !== undefined) {
    if (by === "agent" && held.has("behaviour")) kept.push("behaviour");
    else if (!sameLines(input.behaviour, behaviour)) {
      behaviour = input.behaviour;
      changed = true;
      if (by === "user") {
        if (behaviour.length) held.add("behaviour");
        else held.delete("behaviour");
      }
    }
  }
  if (!changed) return { spec: before, changed, kept };
  if (!purpose && !behaviour.length) return { spec: null, changed, kept };
  return {
    spec: { purpose, behaviour, by, at, ...(held.size ? { held: [...held].sort() } : {}) },
    changed,
    kept,
  };
}

// What a hand edit of the spec changed, as the agent hears it in `edited.spec`.
export function specEdit(
  before: DesignSpec | null,
  after: DesignSpec | null,
): DesignEdit["spec"] | undefined {
  const out: NonNullable<DesignEdit["spec"]> = {};
  const p0 = before?.purpose ?? "";
  const p1 = after?.purpose ?? "";
  if (p0 !== p1) out.purpose = p1 || null;
  const b0 = before?.behaviour ?? [];
  const b1 = after?.behaviour ?? [];
  if (!sameLines(b0, b1)) out.behaviour = b1.length ? b1 : null;
  return Object.keys(out).length ? out : undefined;
}

// The first line of what it is for: what a list of designs prints beside its name.
export const purposeLine = (spec: DesignSpec | null): string =>
  (spec?.purpose ?? "").split("\n")[0].trim();

// The spec as a read returns it: the written sections and this design's decisions.
export function specView(spec: DesignSpec | null, decisions: string[] | undefined) {
  if (!spec && !decisions?.length) return {};
  return {
    spec: {
      purpose: spec?.purpose ?? "",
      behaviour: spec?.behaviour ?? [],
      ...(spec ? { by: spec.by, at: spec.at } : {}),
      ...(spec?.held?.length ? { held: spec.held } : {}),
      ...(decisions ? { decisions } : {}),
    },
  };
}

// A screen or a component is part of the product, and a build agent reads its spec.
export const isProduct = (design: Pick<Design, "kind">) => design.kind !== "idea";

// When each of a design's decision lines was made: a question's line by the last reply
// that answered it, anything else by the design's last decision (the line's own `at`).
export function lineTimes(
  design: Pick<Design, "id">,
  replies: { createdAt: string; answers: string[] }[],
): (line: DecisionLine) => string | undefined {
  const answered = new Map<string, string>();
  for (const r of replies) for (const ask of r.answers) answered.set(ask, r.createdAt);
  const prefix = `ask:${design.id}:`;
  return (line) =>
    (line.id.startsWith(prefix) ? answered.get(line.id.slice(prefix.length)) : undefined) ??
    line.at;
}

// The decision lines a product design's spec holds: its own, then those of the ideas that
// are for it, since that is where most of what it shows was chosen.
export function specLines(
  design: Pick<Design, "slug">,
  lines: DecisionLine[],
  ideas: Pick<Design, "slug">[],
): DecisionLine[] {
  const from = new Set(ideas.map((i) => i.slug));
  return [
    ...lines.filter((l) => !l.system && l.design === design.slug),
    ...lines.filter((l) => !l.system && l.design !== design.slug && from.has(l.design)),
  ];
}

// A line decided on an idea says which, so the spec's reader can tell it from the
// design's own.
export const specLineText = (
  design: Pick<Design, "slug">,
  line: Pick<DecisionLine, "design" | "title" | "text">,
) => (line.design === design.slug ? line.text : `From ${line.title}: ${line.text}`);

// How far a product design's spec is behind what was decided on it: the decisions newer
// than it (all of them when there is none). `lines` are its spec's (specLines). Null for
// an idea, where exploring happens.
export function specBehind(
  design: Pick<Design, "slug" | "kind" | "spec">,
  lines: DecisionLine[],
  at: (line: DecisionLine) => string | undefined,
): { decisions: number; noSpec: boolean } | null {
  if (!isProduct(design)) return null;
  const spec = design.spec;
  const own = lines.filter((l) => !l.system);
  if (!spec) return { decisions: own.length, noSpec: true };
  const decisions = own.filter((l) => {
    const t = at(l);
    return !!t && t > spec.at;
  }).length;
  return { decisions, noSpec: false };
}

// A product design's spec should hold what was decided on it. Told on a publish and in
// a feedback batch; never blocks.
export function specNudge(
  design: Pick<Design, "slug" | "kind" | "spec">,
  lines: DecisionLine[],
  at: (line: DecisionLine) => string | undefined,
): string | null {
  const behind = specBehind(design, lines, at);
  if (!behind) return null;
  if (behind.noSpec) {
    return `${design.slug} has no spec: say what it is for (\`edit --purpose\`) and how it works where the picture can't show it (\`edit --behaviour\`)`;
  }
  const newer = behind.decisions;
  if (!newer) return null;
  return `${design.slug} has ${newer} decision${newer === 1 ? "" : "s"} newer than its spec; update it (\`edit --purpose\`, \`edit --behaviour\`)`;
}
