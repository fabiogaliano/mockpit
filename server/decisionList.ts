// The project's decision list: what the user has settled, as plain lines any
// agent can read first, so a new session stops contradicting it. Nothing here
// summarises and no agent has to keep it: every line is built from what replies
// already left on the design, the answers on its questions and the variants in
// use. Those are the current truth, so a later reply on a question replaces its
// line by construction. Runtime-agnostic (no node imports).

import {
  type Ask,
  type AskAnswer,
  DEFAULT_VARIANT,
  type DecisionSources,
  type DecisionVariant,
  type Design,
  optionState,
} from "./types.ts";
import { standingOf } from "./standings.ts";
import type { System } from "./system.ts";

// The words of a derived line, so the viewer can weigh the answer over the
// question. `text` below is exactly these, joined.
export interface DecisionParts {
  asked: string;
  chose?: string;
  // Answers kept for later: the runners-up.
  kept?: string;
  not?: string;
  words?: string;
}

export interface DecisionLine {
  id: string;
  // The design it came from, by slug and by title.
  design: string;
  title: string;
  // The state it is about, when it is about one.
  state?: string;
  text: string;
  // Absent once the user has reworded the line: then `text` is all there is.
  parts?: DecisionParts;
  edited?: true;
  // The design is archived: its answers stand, but the work there has stopped.
  archived?: true;
  // About the project's system rather than one design (`design` is empty).
  system?: true;
  at?: string;
}

// What the user changed by hand, by line id. `basis` is the answer the change
// was made on, so a new answer outranks an old edit or removal, while rewording
// this file's derivation disturbs neither.
export type DecisionEdits = Record<string, { basis: string; text?: string; removed?: true }>;

export function parseDecisionEdits(raw: string | null): DecisionEdits {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? (value as DecisionEdits) : {};
  } catch {
    return {};
  }
}

// A write-in or note that hands the question back rather than settling it: the
// agent still hears it in the reply, but "I don't get this" is no decision. Only
// plain patterns, so it errs both ways on real replies; the user can remove what
// slips through. "but" or "i think" rescues an unsure opening, since what follows
// is usually the real answer ("idk what it means, but it hurt when I stopped").
const TAKES_A_SIDE = /^((i\s+guess\s+)?(yes|no|yep|nope)\b|(i\s+)?don.?t\s+like\b)/i;
const UNSURE =
  /^(idk\s+(what|if|how|why|i\s+already)\b|i\s+don.?t\s+(get|understand|know)\b|i.?m\s+(a\s+bit\s+|even\s+)?(confused|not\s+(even\s+)?sure)\b|not\s+sure\b|this\s+(one\s+)?is\s+(a\s+bit\s+)?confusing\b|so\s+i\s+don.?t\s+get\b)/i;
const ASKS_BACK = /^(also\s+)?(what|how|why|can|could|is\s+it|do\s+we|does)\b/i;

function handsItBack(words: string): boolean {
  const text = words.trim();
  if (TAKES_A_SIDE.test(text)) return false;
  const sentences = text.match(/[^.!?…]+[.!?…]*/g) ?? [];
  const asking = sentences.filter((s) => s.trim().endsWith("?"));
  if (asking.length > sentences.length / 2) return true;
  if (sentences[0]?.trim().endsWith("?") && ASKS_BACK.test(text)) return true;
  return UNSURE.test(text) && !/\b(but|i\s+think)\b/i.test(text);
}

const answerIds = (answer: AskAnswer | undefined): string[] =>
  answer === undefined ? [] : Array.isArray(answer) ? answer : [answer];

// An older habit of writing the agent's pick into the label; the mark is the
// option's own now, and in a decision it reads as noise.
const cleanLabel = (label: string) => label.replace(/\s*\(recommended\)\s*$/i, "").trim();

// "Yes. Not: No." says nothing the answer doesn't.
const YES_NO = /^(yes|no|maybe|sim|não|nao|keep|drop)\b/i;
const MAX_NOT_CHARS = 90;
const MAX_NOT = 4;

// As many of the options left behind as fit, then how many more: enough to stop
// an agent proposing them again, without the line becoming the option list.
function notList(labels: string[]): string | undefined {
  const kept: string[] = [];
  let used = 0;
  for (const label of labels) {
    if (kept.length === MAX_NOT || (kept.length && used + label.length > MAX_NOT_CHARS)) break;
    kept.push(label);
    used += label.length;
  }
  if (!kept.length) return undefined;
  const rest = labels.length - kept.length;
  return rest ? `${listed(kept)} and ${rest} more` : listed(kept);
}

// Labels often hold commas of their own ("Ring, in its own socket").
function listed(labels: string[]): string {
  return labels.join(labels.some((l) => l.includes(",")) ? "; " : ", ");
}

const stop = (text: string) => (/[.!?…:]$/.test(text) ? text : `${text}.`);

function joinParts(p: DecisionParts): string {
  return [
    p.asked,
    p.chose ? stop(p.chose) : "",
    p.kept ? `Kept for later: ${p.kept}.` : "",
    p.not ? `Not: ${p.not}.` : "",
    p.words ? `“${p.words}”` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function askParts(design: Design, ask: Ask): DecisionParts | null {
  const ids = answerIds(ask.answer);
  const chosen = ask.options.filter((o) => ids.includes(o.id)).map((o) => cleanLabel(o.label));
  const said = [ask.other, ask.comment]
    .map((w) => w?.trim() ?? "")
    .filter((w) => w && !handsItBack(w))
    .join(" ");
  const standing = standingOf(design, ask.id);
  const kept = ask.options
    .filter((o) => standing.kept.includes(o.id) && !ids.includes(o.id))
    .map((o) => cleanLabel(o.label));
  // A reason is taste a new session should know before it offers the same again.
  const why = standing.hidden.filter((h) => h.why);
  if (!chosen.length && !said && !why.length) return null;
  const question = ask.text.trim();
  // "Keep this idea?" repeated per state means nothing without the state.
  const state = ask.state && design.states.includes(ask.state) ? ask.state : null;
  const where = state && !question.toLowerCase().includes(state.toLowerCase()) ? `${state}: ` : "";
  const reasoned = why.map((h) => `${cleanLabel(h.label)} (${h.why})`);
  const left = ask.options
    .filter((o) => !ids.includes(o.id) && !standing.kept.includes(o.id))
    .filter((o) => !why.some((h) => h.id === o.id))
    .map((o) => cleanLabel(o.label));
  const not =
    (chosen.length || reasoned.length) &&
    !ask.other &&
    ![...chosen, ...left].some((l) => YES_NO.test(l))
      ? notList([...reasoned, ...(chosen.length ? left : [])])
      : undefined;
  return {
    asked: `${where}${/[?:.]$/.test(question) ? question : `${question}:`}`,
    ...(chosen.length ? { chose: listed(chosen) } : {}),
    ...(kept.length ? { kept: listed(kept) } : {}),
    ...(not ? { not } : {}),
    ...(said ? { words: said } : {}),
  };
}

// The variants a question's answer put in use, by the states it settled.
function pickedVariants(design: Design, ask: Ask): { state: string | null; variant: string }[] {
  if (ask.scope === "part") return [];
  const ids = answerIds(ask.answer);
  return ask.options
    .filter((o) => ids.includes(o.id) && o.variant)
    .flatMap((o) =>
      (o.version !== undefined
        ? [optionState(ask, design)]
        : ask.scope === "state"
          ? [ask.state ?? null]
          : design.states.length
            ? design.states
            : [null]
      ).map((state) => ({ state, variant: o.variant! })),
    );
}

function useParts(v: DecisionVariant, siblings: DecisionVariant[]): DecisionParts {
  const version = v.version > 1 ? `v${v.acceptedVersion ?? v.version}` : "";
  const named = v.variant === DEFAULT_VARIANT ? "" : v.variant;
  const not = notList(siblings.filter((s) => s.status === "archived").map((s) => s.variant));
  return {
    asked: v.state ? `${v.state}, in use:` : "In use:",
    chose: [named, version].filter(Boolean).join(" ") || "this design",
    ...(not ? { not } : {}),
  };
}

const sameQuestion = (ask: Ask) => `${ask.state ?? ""}\n${ask.text.trim().toLowerCase()}`;

// The questions that still stand: an answered one, once per wording (the agent
// may have re-asked it under a new id, and the later answer is the decision),
// whose picked variant, if it picked one, was not replaced since. Ask order is
// the order the agent asked in.
function standingAsks(design: Design, variants: DecisionVariant[]): Ask[] {
  const seen = new Set<string>();
  const out: Ask[] = [];
  for (const ask of [...design.asks].reverse()) {
    if (ask.dismissed) continue;
    const reasons = standingOf(design, ask.id).hidden.some((h) => h.why);
    if (ask.answer === undefined && !ask.other && !ask.comment && !reasons) continue;
    const wording = sameQuestion(ask);
    if (seen.has(wording)) continue;
    seen.add(wording);
    const picks = pickedVariants(design, ask);
    const named = picks.filter((p) =>
      variants.some((v) => v.state === p.state && v.variant === p.variant),
    );
    const replaced =
      named.length > 0 &&
      !named.some((p) =>
        variants.some(
          (v) => v.state === p.state && v.variant === p.variant && v.status === "accepted",
        ),
      );
    if (!replaced) out.unshift(ask);
  }
  return out;
}

// Kept and hidden answers change the line, so they're part of what an edit was made on.
// Absent when there are none, so edits made before standings existed still apply.
function standingBasis(design: Design, ask: Ask): string[] {
  const s = standingOf(design, ask.id);
  if (!s.kept.length && !s.hidden.length) return [];
  return [JSON.stringify([s.kept, s.hidden.map((h) => [h.id, h.why ?? ""])])];
}

// Every line the project's replies add up to, as derived: newest decided design
// first, an archived design after every live one, each design's lines as it asked them
// with what it put in use first.
export function deriveDecisionLines(
  designs: Design[],
  sources: DecisionSources,
  system: System | null = null,
): (DecisionLine & { basis: string })[] {
  const byDesign = new Map<string, DecisionVariant[]>();
  for (const v of sources.variants) {
    const list = byDesign.get(v.designId);
    if (list) list.push(v);
    else byDesign.set(v.designId, [v]);
  }
  const order = [...designs].sort(
    (a, b) =>
      Number(!!a.archivedAt) - Number(!!b.archivedAt) ||
      (sources.decidedAt[b.id] ?? "").localeCompare(sources.decidedAt[a.id] ?? ""),
  );
  const out: (DecisionLine & { basis: string })[] = systemLines(system);
  for (const design of order) {
    const variants = byDesign.get(design.id) ?? [];
    const base = {
      design: design.slug,
      title: design.title,
      ...(design.archivedAt ? { closed: true as const } : {}),
      ...(sources.decidedAt[design.id] ? { at: sources.decidedAt[design.id] } : {}),
    };
    const asks = standingAsks(design, variants);
    const answered = new Set(
      asks.flatMap((a) => pickedVariants(design, a).map((p) => `${p.state}\n${p.variant}`)),
    );
    for (const v of variants) {
      // The question that put it in use already says so, in better words.
      if (v.status !== "accepted" || answered.has(`${v.state}\n${v.variant}`)) continue;
      const parts = useParts(
        v,
        variants.filter((s) => s.state === v.state && s.variant !== v.variant),
      );
      out.push({
        ...base,
        id: `use:${design.id}:${v.state ?? ""}:${v.variant}`,
        ...(v.state ? { state: v.state } : {}),
        text: joinParts(parts),
        parts,
        basis: `${v.variant}@${v.acceptedVersion ?? v.version}`,
      });
    }
    for (const ask of asks) {
      const parts = askParts(design, ask);
      if (!parts) continue;
      out.push({
        ...base,
        id: `ask:${design.id}:${ask.id}`,
        ...(ask.state && design.states.includes(ask.state) ? { state: ask.state } : {}),
        text: joinParts(parts),
        parts,
        basis: JSON.stringify([
          ask.answer ?? null,
          ask.other ?? null,
          ask.comment ?? null,
          ...standingBasis(design, ask),
        ]),
      });
    }
  }
  return out;
}

// The project's own decisions, first: they hold on every design. A palette line
// only once there are palettes to choose between.
function systemLines(system: System | null): (DecisionLine & { basis: string })[] {
  if (!system) return [];
  const base = { design: "", title: "System", system: true as const };
  const out: (DecisionLine & { basis: string })[] = [];
  const palettes = system.color.palettes;
  const def = palettes.find((p) => p.status === "default");
  if (def && palettes.length > 1) {
    const named = (status: string) =>
      palettes.filter((p) => p.status === status).map((p) => p.label || p.id);
    const kept = named("kept");
    const hidden = named("hidden");
    const text = [
      `Palette: ${def.label || def.id} by default.`,
      kept.length ? ` Kept: ${kept.join(", ")}.` : "",
      hidden.length ? ` Not: ${hidden.join(", ")}.` : "",
    ].join("");
    out.push({
      ...base,
      id: "system:palette",
      text,
      basis: JSON.stringify(palettes.map((p) => [p.id, p.status])),
    });
  }
  for (const [path, value] of Object.entries(system.settled)) {
    if (!Object.hasOwn(system.knobs, path)) continue;
    const text = `Project knob ${path}: ${typeof value === "string" ? value : JSON.stringify(value)}.`;
    out.push({ ...base, id: `system:knob:${path}`, text, basis: JSON.stringify(value) });
  }
  return out;
}

// The hand edits laid over the derived lines. An edit made on an older answer
// no longer applies: the user has decided again since.
export function applyDecisionEdits(
  lines: (DecisionLine & { basis: string })[],
  edits: DecisionEdits,
): DecisionLine[] {
  const out: DecisionLine[] = [];
  for (const { basis, ...line } of lines) {
    const edit = edits[line.id];
    if (!edit || edit.basis !== basis) {
      out.push(line);
    } else if (!edit.removed) {
      const { parts: _, ...rest } = line;
      out.push({ ...rest, text: edit.text ?? line.text, edited: true });
    }
  }
  return out;
}

export interface AgentDecisionLine {
  design: string;
  text: string;
  system?: true;
  // Comes from the design this read asked about.
  here?: true;
  edited?: true;
  archived?: true;
}

export interface AgentDecisionList {
  total: number;
  lines: AgentDecisionLine[];
  // Set when lines were cut to stay small, and says how to get them all.
  more?: string;
}

// A read must stay cheap to hold in a prompt, and an agent reads often, so it
// gets the design it asked about and then the newest lines up to a budget, each
// clipped. A long line is a long write-in, and the rest of it is one call away.
const AGENT_LINE_CHARS = 280;
const AGENT_LIST_CHARS = 6000;

export function agentDecisionList(lines: DecisionLine[], here?: string): AgentDecisionList {
  // The project's own come first wherever the read is: they hold on every design.
  const ordered = [
    ...lines.filter((l) => l.system),
    ...lines.filter((l) => !l.system && here && l.design === here),
    ...lines.filter((l) => !l.system && !(here && l.design === here)),
  ];
  const kept: AgentDecisionLine[] = [];
  let used = 0;
  let clipped = false;
  for (const l of ordered) {
    const long = l.text.length > AGENT_LINE_CHARS;
    const text = long ? `${l.text.slice(0, AGENT_LINE_CHARS - 1)}…` : l.text;
    used += text.length + l.design.length;
    if (used > AGENT_LIST_CHARS && kept.length) break;
    clipped ||= long;
    kept.push({
      design: l.design,
      text,
      ...(l.system ? { system: true as const } : {}),
      ...(l.design === here ? { here: true as const } : {}),
      ...(l.edited ? { edited: true as const } : {}),
      ...(l.archived ? { archived: true as const } : {}),
    });
  }
  const left = lines.length - kept.length;
  const cut = [left ? `${left} older lines left out` : "", clipped ? "long lines clipped" : ""]
    .filter(Boolean)
    .join(", ");
  return {
    total: lines.length,
    lines: kept,
    ...(cut ? { more: `${cut}; read with decisions for all of it` } : {}),
  };
}

// The list as an agent asked for it whole: nothing cut, without what only the
// viewer's layout needs.
export function fullAgentDecisionList(lines: DecisionLine[]): AgentDecisionList {
  return {
    total: lines.length,
    lines: lines.map((l) => ({
      design: l.design,
      text: l.text,
      ...(l.system ? { system: true as const } : {}),
      ...(l.edited ? { edited: true as const } : {}),
      ...(l.archived ? { archived: true as const } : {}),
    })),
  };
}
