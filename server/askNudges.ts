// Ask discipline on `ask`: the two habits that make the user type or re-answer
// what they could have seen. Pure, so the rules are tested on their own.

import type { Ask, AskOption } from "./types.ts";

// Words that name how something looks, matched on option labels only: a
// question's text names the topic, not the options. Words with a common
// non-visual sense ("size", "background", "compact", "white") are left out, so
// a pill about file size or a background job is not flagged.
const VISUAL =
  /\b(colou?rs?|borders?|radius|rounded|corners?|spacing|padding|fonts?|typeface|serif|shadows?|tint|hue|opacity|red|orange|yellow|green|olive|teal|blue|navy|purple|violet|pink|gr[ae]y|\d+\s?(px|rem|em|pt))\b|#[0-9a-f]{3,8}\b/i;

const plain = (o: AskOption) => !o.variant && !(o.set && Object.keys(o.set).length);

export const looksVisual = (label: string): boolean => VISUAL.test(label);

// A Look-style ask: one whose options choose between variants.
const bindsVariants = (a: Ask) => a.options.some((o) => o.variant);

const quoted = (opts: AskOption[]) => opts.map((o) => `"${o.label}"`).join(", ");

export function askNudges(added: Ask[], all: Ask[]): string[] {
  const out: string[] = [];
  for (const ask of added) {
    const pills = ask.options.filter(plain);
    if (!pills.length) continue;
    const visual = pills.filter((o) => looksVisual(o.label));
    const look =
      ask.scope === "part" || bindsVariants(ask)
        ? undefined
        : all.find(
            (a) =>
              a.id !== ask.id &&
              a.scope !== "part" &&
              bindsVariants(a) &&
              (a.scope === "mock" || ask.scope === "mock" || a.state === ask.state),
          );
    // Only a pill that names a look or reads visual overlaps the variants; a
    // plain question on another axis ("Drawer or Margin?") stands beside them.
    const names = new Set(
      look?.options.flatMap((o) => [o.label, o.variant ?? ""].map((n) => n.toLowerCase())),
    );
    const reask = look
      ? pills.filter((o) => names.has(o.label.toLowerCase()) || looksVisual(o.label))
      : [];
    if (look && reask.length) {
      out.push(
        `ask "${ask.id}": ${quoted(reask)} may re-ask what "${look.id}" decides. Drop it or use knob sets.`,
      );
    } else if (visual.length) {
      out.push(`ask "${ask.id}": ${quoted(visual)} look visual. Give each a knob set or variant.`);
    }
  }
  return out;
}
