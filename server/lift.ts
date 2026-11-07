// Lifting pieces out of a screen the user marked Ready: what the screen draws itself
// (its parts that are not an instance's place), which of those look like a library
// component drawn inline, and where else each name appears. Identity only, read from
// the markup (parts.ts); never geometry. The agent hears it in the mark's feedback
// batch, lifts the pieces into components, and asks the `lift` question; answering it
// settles the marks. Runtime-agnostic.

import { partsOutsideInstances } from "./parts.ts";
import {
  type AskOption,
  type Design,
  type LibraryCopy,
  type Lift,
  type LiftPart,
  slugify,
  type Surface,
} from "./types.ts";

// The question's id, on the screen: "Still iterating on any of these?".
export const LIFT_ASK = "lift";

// `covered`: the screen's versions its mark covers. `library`: the project's live
// components. `elsewhere`: each other live design's part names, from the versions it
// shows. Null when the screen draws nothing of its own.
export function liftOf(
  covered: { state: string | null; surfaces: Surface[] }[],
  library: Pick<Design, "slug" | "title">[],
  elsewhere: { slug: string; names: Set<string> }[],
): Lift | null {
  const found = new Map<string, { label?: string; states: (string | null)[] }>();
  for (const c of covered) {
    for (const s of c.surfaces) {
      if (s.kind !== "html") continue;
      for (const p of partsOutsideInstances(s.html)) {
        const at = found.get(p.name) ?? { states: [] };
        if (p.label && !at.label) at.label = p.label;
        if (!at.states.includes(c.state)) at.states.push(c.state);
        found.set(p.name, at);
      }
    }
  }
  const parts: LiftPart[] = [];
  const likeLibrary: LibraryCopy[] = [];
  for (const [name, at] of found) {
    const alsoIn = elsewhere.filter((d) => d.names.has(name)).map((d) => d.slug);
    const part: LiftPart = {
      name,
      ...(at.label ? { label: at.label } : {}),
      states: at.states,
      ...(alsoIn.length ? { alsoIn } : {}),
    };
    const key = slugify(name);
    const component = library.find((m) => m.slug === key || slugify(m.title) === key);
    if (component) likeLibrary.push({ ...part, component: component.slug });
    else parts.push(part);
  }
  return parts.length || likeLibrary.length ? { parts, likeLibrary } : null;
}

// The component an answer of the lift question stands for: its id is the component's
// slug, else its label names one by slug or title. An answer that names none (a "No,
// they're done") stands for nothing.
export function liftedComponent(
  option: Pick<AskOption, "id" | "label">,
  components: Pick<Design, "slug" | "title">[],
): string | null {
  const bySlug = (s: string) => components.find((m) => m.slug === s)?.slug;
  return (
    bySlug(option.id) ??
    bySlug(slugify(option.label)) ??
    components.find((m) => slugify(m.title) === slugify(option.label))?.slug ??
    null
  );
}
