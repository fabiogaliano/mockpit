// A design's sheet stills as Focus needs them (server/stills.ts): the ones made, looked up
// by cell, and the cells in view that have none, asked for together a moment after they
// show. Each still lands as a stills-updated event; until then the cell draws live.

import { createResource, onCleanup } from "solid-js";
import { type StillCell, stillKey } from "../../server/stills.ts";
import { api, assetUrl, subscribe } from "./api.ts";
import { host, readonly } from "./host.ts";

// Cells that come into view together are one request.
const ASK_MS = 150;

export type Stills = ReturnType<typeof createStills>;

export function createStills(designId: () => string | undefined) {
  const [made, { refetch }] = createResource(designId, (id) =>
    api.stills(id).catch((): { stills: Record<string, string>; taking: boolean } => ({
      stills: {},
      taking: false,
    })),
  );
  let timer = 0;
  onCleanup(
    subscribe((e) => {
      if (e.type !== "stills-updated" || e.designId !== designId()) return;
      host().window.clearTimeout(timer);
      timer = host().window.setTimeout(() => void refetch(), ASK_MS);
    }),
  );
  onCleanup(() => host().window.clearTimeout(timer));

  // The still of a cell, as a URL, once one is made.
  const of = (cell: StillCell): string | null => {
    const id = made()?.stills[stillKey(cell)];
    return id ? assetUrl(id) : null;
  };

  let asking = new Map<string, StillCell>();
  let askTimer = 0;
  const asked = new Set<string>();
  const flush = () => {
    const id = designId();
    const cells = [...asking.values()];
    asking = new Map();
    if (!id || !cells.length) return;
    void api
      .takeStills(
        id,
        cells.map(({ system: _s, rewrites: _r, ...c }) => c),
      )
      .catch(() => {});
  };
  // A cell in view with no still: the server is asked once per cell, and only when it
  // can make them.
  const want = (cell: StillCell) => {
    if (readonly() || made.loading || !made()?.taking || of(cell)) return;
    const key = stillKey(cell);
    if (asked.has(key)) return;
    asked.add(key);
    asking.set(key, cell);
    host().window.clearTimeout(askTimer);
    askTimer = host().window.setTimeout(flush, ASK_MS);
  };
  onCleanup(() => host().window.clearTimeout(askTimer));

  return { of, want, loaded: () => !made.loading };
}
