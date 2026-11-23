// The links a response hands an agent to pass on to the user. A pasted link has no
// history behind it, so `focus=1` asks the viewer for Focus outright (route.ts), and
// `owed=1` sends Focus to the first question still waiting when the link names no
// place: an agent sends a link to say "look at this" or "answer this".

import { openCount, type Design } from "./types.ts";

export interface LinkPlace {
  state: string | null;
  alternative: string;
}

export function designLink(
  base: string,
  design: Pick<Design, "project" | "slug" | "asks">,
  place?: LinkPlace | null,
): string {
  const q = new URLSearchParams({ focus: "1" });
  if (place) {
    if (place.state !== null) q.set("state", place.state);
    q.set("alternative", place.alternative);
  } else if (openCount(design) > 0) q.set("owed", "1");
  return `${base}/project/${encodeURIComponent(design.project)}/${encodeURIComponent(design.slug)}?${q}`;
}
