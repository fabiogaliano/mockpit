// Ask discipline on `ask`: the habits that make the user type, re-answer what
// they could have seen, or read a sentence where a label would do. Pure, so the rules are tested on their own.

import { openingOf, wordCount } from "./spec.ts";
import type { Ask, AskOption } from "./types.ts";

// Words that name how something looks, matched on option labels only: a
// question's text names the topic, not the options. Words with a common
// non-visual sense ("size", "background", "compact", "white") are left out, so
// a pill about file size or a background job is not flagged.
const VISUAL =
  /\b(colou?rs?|borders?|radius|rounded|corners?|spacing|padding|fonts?|typeface|serif|shadows?|tint|hue|opacity|red|orange|yellow|green|olive|teal|blue|navy|purple|violet|pink|gr[ae]y|\d+\s?(px|rem|em|pt))\b|#[0-9a-f]{3,8}\b/i;

const plain = (o: AskOption) => !o.alternative && !(o.set && Object.keys(o.set).length);

export const looksVisual = (label: string): boolean => VISUAL.test(label);

// A Look-style ask: one whose options choose between alternatives.
const bindsAlternatives = (a: Ask) => a.options.some((o) => o.alternative);

const quoted = (opts: AskOption[]) => opts.map((o) => `"${o.label}"`).join(", ");

const LABEL_WORDS = 6;

// An answer is a pill the user reads at a glance; a sentence there is a question in
// disguise. Nudged, never refused: the first long label, and a count of the rest.
function labelCapNudge(added: Ask[]): string[] {
  const over = added.flatMap((a) =>
    a.options.flatMap((o) => (wordCount(o.label) > LABEL_WORDS ? [{ a, o }] : [])),
  );
  if (!over.length) return [];
  const [{ a, o }] = over;
  return [
    `ask "${a.id}": answer "${openingOf(o.label)}" has ${wordCount(o.label)} words; keep labels to ${LABEL_WORDS}${over.length > 1 ? ` (+${over.length - 1} more over)` : ""}`,
  ];
}

export function askNudges(added: Ask[], all: Ask[]): string[] {
  const out: string[] = labelCapNudge(added);
  for (const ask of added) {
    const pills = ask.options.filter(plain);
    if (!pills.length) continue;
    const visual = pills.filter((o) => looksVisual(o.label));
    const look =
      ask.scope === "part" || bindsAlternatives(ask)
        ? undefined
        : all.find(
            (a) =>
              a.id !== ask.id &&
              a.scope !== "part" &&
              bindsAlternatives(a) &&
              (a.scope === "design" || ask.scope === "design" || a.state === ask.state),
          );
    // Only a pill that names a look or reads visual overlaps the alternatives; a
    // plain question on another axis ("Drawer or Margin?") stands beside them.
    const names = new Set(
      look?.options.flatMap((o) => [o.label, o.alternative ?? ""].map((n) => n.toLowerCase())),
    );
    const reask = look
      ? pills.filter((o) => names.has(o.label.toLowerCase()) || looksVisual(o.label))
      : [];
    if (look && reask.length) {
      out.push(
        `ask "${ask.id}": ${quoted(reask)} may re-ask what "${look.id}" decides. Drop it or use knob sets.`,
      );
    } else if (visual.length) {
      out.push(
        `ask "${ask.id}": ${quoted(visual)} look visual. Give each a knob set or alternative.`,
      );
    }
  }
  return out;
}
