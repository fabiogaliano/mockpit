// The project's shortlists as a mock screen needs them: which versions are
// saved where, and the one a bookmark saves to in one click. That one is this
// browser's, per project; with none (or once it is gone) the next save asks.

import { createMemo, createSignal, onCleanup } from "solid-js";
import { api, subscribe, type SaveCandidate, type Shortlist } from "./api.ts";
import { host } from "./host.ts";

type Toast = { text: string; undo?: () => void } | null;
export type Target = { to: string } | { title: string };

export function createShortlists(project: string, toast: (t: Toast) => void) {
  const key = `mockpit-shortlist:${project}`;
  const [lists, setLists] = createSignal<Shortlist[]>([]);
  const [currentId, setCurrentId] = createSignal(host().storage?.getItem(key) ?? null);
  const load = () =>
    api.shortlists(project).then(
      (r) => setLists(r.shortlists),
      () => {},
    );
  void load();
  onCleanup(
    subscribe((e) => {
      // Only what can change a list: agents publish all day in a busy project,
      // and every open mock screen hears it.
      if (e.type === "mock-created" || e.type === "mock-deleted") {
        if (e.project === project) void load();
      } else if (e.type === "mock-updated") {
        if (lists().some((l) => l.id === e.id)) void load();
      } else if (
        e.type === "post-created" ||
        e.type === "post-updated" ||
        e.type === "post-deleted"
      ) {
        if (lists().some((l) => l.id === e.mockId)) void load();
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
  const copyIn = (list: Shortlist, ref: SaveCandidate) =>
    list.candidates.find(
      (c) =>
        c.copiedFrom?.mock === ref.mock &&
        c.copiedFrom.state === ref.state &&
        c.copiedFrom.variant === ref.variant &&
        c.copiedFrom.version === ref.version,
    );
  const has = (list: Shortlist, ref: SaveCandidate) => !!copyIn(list, ref);
  const isSaved = (ref: SaveCandidate) => lists().some((l) => has(l, ref));

  async function remove(list: { id: string; title: string }, variant: string, name: string) {
    try {
      await api.removeFromShortlist(list.id, variant);
      toast({ text: `Removed ${name} from ${list.title}` });
    } catch (e) {
      toast({ text: `Couldn't remove ${name}. ${e instanceof Error ? e.message : e}` });
    }
    await load();
  }

  async function save(ref: SaveCandidate, name: string, target: Target) {
    try {
      const { shortlist, saved } = await api.saveToShortlist({ ...target, candidates: [ref] });
      pick(shortlist.id);
      await load();
      const copy = saved[0];
      toast(
        copy.already
          ? { text: `${name} is already in ${shortlist.title}` }
          : {
              text: `Saved ${name} to ${shortlist.title}`,
              undo: () => {
                toast(null);
                void remove(shortlist, copy.variant, name);
              },
            },
      );
    } catch (e) {
      toast({ text: `Couldn't save ${name}. ${e instanceof Error ? e.message : e}` });
    }
  }

  const unsave = (list: Shortlist, ref: SaveCandidate, name: string) => {
    const copy = copyIn(list, ref);
    return copy ? remove(list, copy.variant, name) : Promise.resolve();
  };

  return { lists, current, pick, has, isSaved, save, unsave, load };
}

export type Shortlists = ReturnType<typeof createShortlists>;
