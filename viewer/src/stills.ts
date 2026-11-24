import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
  legacyStillCompatibility,
  MAX_STILLS_ASKED,
  olderStillCompatibility,
  type StillBox,
  type StillCell,
  stillCompatibility,
  stillKey,
  type StillPending,
  type StillRequestCell,
  type StillsRequest,
} from "../../server/stills.ts";
import { api, assetUrl, subscribe } from "./api.ts";
import { host, readonly } from "./host.ts";

const ASK_MS = 100;
const TIMEOUT_MS = 15_000;

export type Stills = ReturnType<typeof createStills>;

/** Keep the cache and live work for the design currently on screen. */
export function createStills(designId: () => string | undefined) {
  const [capability, setCapability] = createSignal<"loading" | "error" | "capture" | "live">(
    "loading",
  );
  const [legacyPalettes, setLegacyPalettes] = createSignal<Record<number, string | null>>({});
  const [indexError, setIndexError] = createSignal(false);
  const [assets, setAssets] = createStore<Record<string, string | undefined>>({});
  // A still's live canvases; none recorded for one taken before they were.
  const [masks, setMasks] = createStore<Record<string, StillBox[] | undefined>>({});
  const [pending, setPending] = createStore<Record<string, StillPending | undefined>>({});
  const [failures, setFailures] = createStore<Record<string, boolean | undefined>>({});
  const [broken, setBroken] = createStore<Record<string, string | undefined>>({});
  let generation = 0;
  let request = 0;
  let serial = 0;
  let indexRevision = 0;
  let expiryTimer = 0;
  let askTimer = 0;
  let disposed = false;
  const eventStamps = new Map<string, { serial: number; revision: number }>();
  const wanted = new Map<string, StillRequestCell>();
  // What the user is choosing between now: asked for first, and taken first.
  const leading = new Set<string>();
  const requestRevisions = new Map<string, number>();
  const requesting = new Set<string>();
  const window = host().window;

  const reschedule = () => {
    window.clearTimeout(expiryTimer);
    const next = Math.min(...Object.values(pending).map((job) => job?.expires ?? Infinity));
    if (!Number.isFinite(next)) return;
    expiryTimer = window.setTimeout(
      () => {
        batch(() => {
          for (const [key, job] of Object.entries(pending)) {
            if (job && job.expires <= Date.now()) {
              setPending(key, undefined);
              setFailures(key, true);
            }
          }
        });
        reschedule();
      },
      Math.max(0, next - Date.now()),
    );
  };

  const newerEvent = (key: string, since: number, revision: number) => {
    const event = eventStamps.get(key);
    return event && event.serial > since && event.revision > revision;
  };

  async function refresh() {
    const id = designId();
    if (!id) return;
    const before = serial;
    const token = ++request;
    try {
      const index = await api.stills(id, AbortSignal.timeout(TIMEOUT_MS));
      if (disposed || token !== request || id !== designId()) return;
      if (index.revision < indexRevision) {
        eventStamps.clear();
        requestRevisions.clear();
      }
      indexRevision = index.revision;
      const next: Record<string, string | undefined> = { ...index.stills };
      const nextMasks: Record<string, StillBox[] | undefined> = { ...index.masks };
      const work: Record<string, StillPending | undefined> = { ...index.pending };
      for (const key of new Set([...eventStamps.keys(), ...requestRevisions.keys()])) {
        if (
          newerEvent(key, before, index.revision) ||
          (requestRevisions.get(key) ?? 0) > index.revision
        ) {
          next[key] = assets[key];
          nextMasks[key] = masks[key];
          work[key] = pending[key];
        }
      }
      batch(() => {
        for (const [key, job] of Object.entries(pending)) {
          if (job && !work[key] && !next[key]) setFailures(key, true);
        }
        for (const [key, job] of Object.entries(work)) {
          if (job) setFailures(key, undefined);
        }
        for (const [key, asset] of Object.entries(next)) {
          if (asset && broken[key] !== asset) setFailures(key, undefined);
        }
        setLegacyPalettes(index.legacyPalettes);
        setAssets(reconcile(next));
        setMasks(reconcile(nextMasks));
        setPending(reconcile(work));
        setCapability(index.taking ? "capture" : "live");
        setIndexError(false);
      });
      reschedule();
    } catch {
      if (disposed || token !== request || id !== designId()) return;
      if (capability() === "loading") setCapability("error");
      setIndexError(true);
    }
  }

  createEffect(() => {
    const id = designId();
    ++generation;
    ++request;
    wanted.clear();
    requesting.clear();
    eventStamps.clear();
    requestRevisions.clear();
    indexRevision = 0;
    window.clearTimeout(askTimer);
    window.clearTimeout(expiryTimer);
    setLegacyPalettes({});
    setAssets(reconcile({}));
    setMasks(reconcile({}));
    setPending(reconcile({}));
    setFailures(reconcile({}));
    setBroken(reconcile({}));
    setCapability("loading");
    setIndexError(false);
    if (id) void refresh();
  });

  onCleanup(
    subscribe(
      (event) => {
        if (event.type !== "stills-updated" && event.type !== "still-failed") return;
        if (event.designId !== designId()) return;
        const key = event.key;
        if (
          event.revision <=
          Math.max(
            indexRevision,
            requestRevisions.get(key) ?? 0,
            eventStamps.get(key)?.revision ?? 0,
          )
        )
          return;
        eventStamps.set(event.key, { serial: ++serial, revision: event.revision });
        batch(() => {
          if (event.type === "stills-updated") {
            setBroken(event.key, undefined);
            setAssets(event.key, event.asset);
            setMasks(event.key, event.masks);
            setFailures(event.key, undefined);
          } else {
            setFailures(event.key, true);
          }
          setPending(event.key, undefined);
        });
        reschedule();
      },
      () => void refresh(),
    ),
  );

  onCleanup(() => {
    disposed = true;
    window.clearTimeout(expiryTimer);
    window.clearTimeout(askTimer);
  });

  const compatible = createMemo(() => {
    const bySignature = new Map<string, { key: string; asset: string }>();
    for (const [key, asset] of Object.entries(assets).reverse()) {
      if (!asset || broken[key] === asset) continue;
      const signature = olderStillCompatibility(key, legacyPalettes());
      if (signature && !bySignature.has(signature)) bySignature.set(signature, { key, asset });
    }
    return bySignature;
  });
  const picture = (cell: StillCell) => {
    const key = stillKey(cell);
    const asset = assets[key];
    if (asset && broken[key] !== asset) return { key, asset, exact: true };
    const old =
      compatible().get(stillCompatibility(cell)) ??
      compatible().get(legacyStillCompatibility(cell));
    return old ? { ...old, exact: false } : null;
  };

  function receive(key: string, result: StillsRequest | null, before: number) {
    if (newerEvent(key, before, result?.revision ?? -1)) return;
    if (result) requestRevisions.set(key, result.revision);
    else if (pending[key]) return;
    const asset = result?.stills[key];
    const job = result?.pending[key];
    const wasBroken = !!asset && broken[key] === asset;
    if (asset) {
      setAssets(key, asset);
      setMasks(key, result?.masks[key]);
    }
    if (job) {
      setAssets(key, undefined);
      setBroken(key, undefined);
    }
    setPending(key, job);
    setFailures(key, !job && (!asset || wasBroken) ? true : undefined);
  }

  async function flush() {
    const id = designId();
    const owner = generation;
    const lead = [...wanted].filter(([key]) => leading.has(key));
    const cells = (lead.length ? lead : [...wanted]).slice(0, MAX_STILLS_ASKED);
    for (const [key] of cells) {
      wanted.delete(key);
      leading.delete(key);
      requesting.add(key);
    }
    if (!id || !cells.length) return;
    const before = serial;
    let result: StillsRequest | null = null;
    try {
      result = await api.takeStills(
        id,
        cells.map(([, cell]) => cell),
        AbortSignal.timeout(TIMEOUT_MS),
        lead.length > 0,
      );
    } catch {
      // A dropped request leaves its visible cells available for Retry.
    }
    if (disposed || owner !== generation) return;
    for (const [key] of cells) {
      batch(() => receive(key, result, before));
      requesting.delete(key);
    }
    reschedule();
    if (wanted.size) void flush();
  }

  const want = (cell: StillCell, retry = false, lead = false) => {
    if (readonly() || capability() !== "capture") return;
    const key = stillKey(cell);
    if (lead && wanted.has(key)) leading.add(key);
    const waits = pending[key]?.priority;
    if (
      requesting.has(key) ||
      wanted.has(key) ||
      waits === "lead" ||
      (waits === "visible" && !lead)
    )
      return;
    const asset = assets[key];
    if (!retry && (failures[key] || (asset && broken[key] !== asset))) return;
    wanted.set(key, retry && asset ? { ...cell, retryAsset: asset } : cell);
    if (lead) leading.add(key);
    if (retry) void flush();
    else {
      window.clearTimeout(askTimer);
      askTimer = window.setTimeout(() => void flush(), ASK_MS);
    }
  };

  return {
    picture,
    of: (cell: StillCell) => {
      const shot = picture(cell);
      return shot?.exact ? assetUrl(shot.asset) : null;
    },
    want,
    failed: (cell: StillCell) => !!failures[stillKey(cell)],
    // The live canvases of the cell's own still, or undefined while none are recorded.
    masks: (cell: StillCell) => masks[stillKey(cell)],
    pending: (cell: StillCell) => !!pending[stillKey(cell)],
    broken: (key: string, asset: string) => {
      if (assets[key] !== asset) return;
      batch(() => {
        setBroken(key, asset);
        if (key.startsWith("[")) setFailures(key, true);
      });
    },
    capability,
    indexError,
    refresh,
  };
}
