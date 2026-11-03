// The project's shortlists and copies as a design screen needs them: where a
// version was saved, and the last shortlist saved to, which the top bar links.
// That one is this browser's, per project.

import { createMemo, createSignal, onCleanup } from "solid-js";
import { api, subscribe, type LiveCopy, type SaveCandidate, type Shortlist } from "./api.ts";
import { host } from "./host.ts";

type Toast = { text: string; undo?: () => void } | null;
export type Add = { label: string; refs: SaveCandidate[] } & (
  | { to: string; state: string | null }
  | { title: string }
);
export type Drop = {
  id: string;
  state: string | null;
  variant: string;
  ref: SaveCandidate;
  title?: string;
  label: string;
};
type Leave = {
  verb: string;
  stays: number;
  run: () => Promise<(() => void) | undefined>;
};

export function createShortlists(project: string, toast: (t: Toast) => void) {
  const key = `mockpit-shortlist:${project}`;
  const [lists, setLists] = createSignal<Shortlist[]>([]);
  const [copies, setCopies] = createSignal<LiveCopy[]>([]);
  const [currentId, setCurrentId] = createSignal(host().storage?.getItem(key) ?? null);
  const load = () =>
    api.shortlists(project).then(
      (r) => {
        setLists(r.shortlists);
        setCopies(r.copies);
      },
      () => {},
    );
  void load();
  onCleanup(
    subscribe((e) => {
      // Only what can change a list or a copy: agents publish all day in a busy
      // project, and every open design screen hears it.
      if (e.type === "design-created" || e.type === "design-deleted") {
        if (e.project === project) void load();
      } else if (e.type === "design-updated") {
        if (lists().some((l) => l.id === e.id)) void load();
      } else if (
        e.type === "post-created" ||
        e.type === "post-updated" ||
        e.type === "post-deleted"
      ) {
        if (
          lists().some((l) => l.id === e.designId) ||
          copies().some((c) => c.design === e.designId)
        ) {
          void load();
        }
      }
    }, load),
  );
  const current = createMemo(() => lists().find((l) => l.id === currentId()) ?? null);
  const pick = (id: string | null) => {
    setCurrentId(id);
    try {
      if (id) host().storage?.setItem(key, id);
      else host().storage?.removeItem(key);
    } catch {
      // Storage refused: it holds for this visit.
    }
  };
  const copiesOf = (ref: SaveCandidate) =>
    copies().filter(
      (c) =>
        c.copiedFrom.design === ref.design &&
        c.copiedFrom.state === ref.state &&
        c.copiedFrom.variant === ref.variant &&
        c.copiedFrom.version === ref.version,
    );
  const isSaved = (ref: SaveCandidate) => copiesOf(ref).length > 0;

  // The copies first: if one can't be made nothing leaves here, and nothing is
  // half done.
  async function settle(name: string, adds: Add[], drops: Drop[], leave: Leave | null) {
    const undos: (() => Promise<unknown>)[] = [];
    const undoAll = async () => {
      for (const undo of undos.reverse()) await undo();
    };
    try {
      for (const { label: _, refs, ...target } of adds) {
        const { to, saved } = await api.saveCopies({ ...target, candidates: refs });
        if (to.shortlist) pick(to.id);
        for (const copy of saved) {
          if (!copy.already) undos.push(() => api.removeCopy(to.id, copy.state, copy.variant));
        }
      }
      for (const d of drops) {
        await api.removeCopy(d.id, d.state, d.variant);
        undos.push(() =>
          api.saveCopies({
            ...(d.title ? { title: d.title } : { to: d.id, state: d.state }),
            candidates: [d.ref],
          }),
        );
      }
    } catch (e) {
      await undoAll().catch(() => {});
      await load();
      toast({ text: `Couldn't save ${name}. ${e instanceof Error ? e.message : e}` });
      return;
    }
    const undoLeave = leave ? await leave.run() : undefined;
    await load();
    const where = adds.length === 1 ? adds[0].label : `${adds.length} places`;
    const dropped = new Set(drops.map((d) => d.label));
    if (leave && !undoLeave) {
      if (adds.length) toast({ text: `Saved ${name} to ${where}, but it is still here` });
      return;
    }
    const stays = leave?.stays ? `, ${leave.stays} in use stays` : "";
    toast({
      text: adds.length
        ? `${leave ? "Moved" : "Saved"} ${name} to ${where}${stays}`
        : leave
          ? `${leave.verb} ${name}${stays}`
          : `Removed ${name} from ${dropped.size === 1 ? [...dropped][0] : `${dropped.size} places`}`,
      undo: () => {
        toast(null);
        undoLeave?.();
        void undoAll()
          .catch((e) => toast({ text: `Couldn't undo. ${e instanceof Error ? e.message : e}` }))
          .then(load);
      },
    });
  }

  return { lists, current, pick, copiesOf, isSaved, settle, load };
}

export type Shortlists = ReturnType<typeof createShortlists>;
