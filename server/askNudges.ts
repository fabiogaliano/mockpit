// Ask discipline on `ask`: the two habits that make the user type or re-answer
// what they could have seen. Pure, so the rules are tested on their own.

import type { Ask, AskOption } from "./types.ts";

// Words that name how something looks. A plain pill labelled with one makes the
// user imagine the change instead of seeing it on the stage.
const VISUAL =
  /\b(colou?rs?|borders?|outlines?|radius|rounded|corners?|spacing|padding|gaps?|sizes?|fonts?|typeface|serif|sans|weights?|shadows?|accents?|background|tint|hue|opacity|contrast|dense|density|compact|roomy|thick|thin|red|orange|yellow|green|olive|teal|blue|navy|purple|violet|pink|gr[ae]y|black|white|\d+\s?(px|rem|em|pt))\b|#[0-9a-f]{3,8}\b/i;

const plain = (o: AskOption) => !o.variant && !(o.set && Object.keys(o.set).length);

export const looksVisual = (text: string): boolean => VISUAL.test(text);

// A Look-style ask: one whose options choose between variants.
const bindsVariants = (a: Ask) => a.options.some((o) => o.variant);

export function askNudges(added: Ask[], all: Ask[]): string[] {
  const out: string[] = [];
  for (const ask of added) {
    const pills = ask.options.filter(plain);
    if (!pills.length) continue;
    const visual = pills.filter((o) => looksVisual(o.label));
    if (visual.length || looksVisual(ask.text)) {
      const named = (visual.length ? visual : pills).map((o) => `"${o.label}"`).join(", ");
      out.push(
        `ask "${ask.id}": ${named} look visual. Give each a knob set or variant so the user sees it.`,
      );
    }
    if (ask.scope === "part" || bindsVariants(ask)) continue;
    const look = all.find(
      (a) =>
        a.id !== ask.id &&
        a.scope !== "part" &&
        bindsVariants(a) &&
        (a.scope === "mock" || ask.scope === "mock" || a.state === ask.state),
    );
    if (look) {
      out.push(
        `ask "${ask.id}" may re-ask what the variants in "${look.id}" decide. Drop it or use knob sets.`,
      );
    }
  }
  return out;
}
