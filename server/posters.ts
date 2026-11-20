import { resolveKnobs } from "./knobValues.ts";
import type { Mode } from "./themes.ts";
import type { Design, KnobValue, PostHead, SurfaceHead } from "./types.ts";

/** Render inputs that identify one automatic poster for an HTML version. */
export interface PosterJob {
  design: string;
  postId: string;
  version: number;
  session: string;
}

/** Generated posters are valid in the mode, system and knob values they captured. */
export function stalePoster(surface: SurfaceHead, mode?: Mode, system?: number, knobs = "") {
  if (surface.kind !== "html" || surface.posterMode === undefined) return false;
  return (
    (mode !== undefined && surface.posterMode !== mode) ||
    (surface.posterKnobs ?? "") !== knobs ||
    (system !== undefined &&
      (surface.posterSystem === undefined ? system > 1 : surface.posterSystem !== system))
  );
}

/** The saved frame values, serialized in path order for both the renderer and the cache. */
export function posterKnobs(
  design: Pick<Design, "knobs">,
  post: Pick<PostHead, "knobs" | "alternative">,
  settled: Record<string, KnobValue>,
) {
  const knobs = { ...design.knobs, ...post.knobs };
  const values = resolveKnobs({ knobs, asks: [], answers: {}, tuned: {}, settled });
  const paths = Object.keys(knobs)
    .filter((path) => Object.hasOwn(values, path))
    .sort();
  return paths.length ? JSON.stringify(Object.fromEntries(paths.map((p) => [p, values[p]]))) : "";
}
