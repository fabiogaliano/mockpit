// The system of the project on screen, as frames wear it. Every frame URL carries
// its revision (`y`), so a system change is a new URL: frames reload and a
// version-pinned document stays cacheable for as long as the system doesn't change.
// Two view settings ride along, neither of which settles anything: the palette
// picked in the tool strip (`p`, kept per project) and an older revision looked at
// from the System changed note (`sys`, this tab only).

import { createSignal } from "solid-js";
import { host } from "./host.ts";

const [onScreen, setOnScreen] = createSignal<{ project: string; rev: number } | null>(null);

export const systemRev = (): number | undefined => onScreen()?.rev;
export const systemProject = (): string | undefined => onScreen()?.project;

// A view of the project came in, or the live feed said its system changed.
export function noteSystemRev(project: string, rev: number | undefined): void {
  if (rev === undefined) return;
  const now = onScreen();
  // A view read before a change can land after its event: it never takes `y` back.
  if (now?.project === project && rev <= now.rev) return;
  if (now?.project !== project) {
    setPeek(null);
    setChange(null);
  }
  setOnScreen({ project, rev });
}

// `from` is the revision before the change; 0 when the change made the system, so
// there is nothing before it to see or restore.
export type SystemChange = { project: string; from: number; to: number; summary: string };
const [change, setChange] = createSignal<SystemChange | null>(null);

// The agents' recent changes, so a restore can tell what landed while it was in flight.
let agentChanges: { project: string; rev: number; summary: string }[] = [];
export const agentChangesBetween = (project: string, after: number, before: number): string[] =>
  agentChanges
    .filter((c) => c.project === project && c.rev > after && c.rev < before)
    .map((c) => c.summary);

// The change the System changed note offers to look behind, while it's unanswered.
export const systemChange = (): SystemChange | null => change();
export const dismissSystemChange = (): void => {
  setChange(null);
  setPeek(null);
};

// Only a change to the project on screen moves the frames, and only an agent's earns
// the note: what the user changed themselves they already know.
export function systemChanged(e: {
  project: string;
  rev: number;
  summary: string;
  by: "user" | "agent";
}): void {
  if (e.by === "agent")
    agentChanges = [...agentChanges, { project: e.project, rev: e.rev, summary: e.summary }].slice(
      -20,
    );
  const now = onScreen();
  if (now?.project !== e.project) return;
  if (e.rev > now.rev) setOnScreen({ project: e.project, rev: e.rev });
  const prev = change();
  if (e.by === "user") {
    // Restoring or deciding from here answers the note.
    if (prev) dismissSystemChange();
    return;
  }
  // Revisions are one apart, so the one before is known even when a refetch already
  // moved the frames on. Several changes in a row read as one, from the first.
  setChange({
    project: e.project,
    from: prev ? prev.from : e.rev - 1,
    to: e.rev,
    summary: prev ? `${prev.summary}; ${e.summary}` : e.summary,
  });
}

const PALETTE_KEY = "mockpit:palette:";
const readPick = (project: string): string | null => {
  try {
    return host().window.localStorage.getItem(PALETTE_KEY + project);
  } catch {
    return null;
  }
};
const [pickStamp, setPickStamp] = createSignal(0);

// The palette picked for a project, null for its default.
export function palettePick(project: string | undefined): string | null {
  pickStamp();
  return project ? readPick(project) : null;
}

export function setPalettePick(project: string, id: string | null): void {
  try {
    const ls = host().window.localStorage;
    if (id) ls.setItem(PALETTE_KEY + project, id);
    else ls.removeItem(PALETTE_KEY + project);
  } catch {
    // Private mode: nothing to keep it in.
  }
  setPickStamp((n) => n + 1);
}

// The palettes each project offers to view in, as its latest design view said.
const [offered, setOffered] = createSignal<ReadonlyMap<string, readonly string[]>>(new Map());

export function notePalettes(project: string, ids: readonly string[]): void {
  setOffered((m) => new Map(m).set(project, ids));
  const pick = readPick(project);
  // A pick the system no longer offers is forgotten, so showing the palette again
  // doesn't bring it back unasked.
  if (pick && !ids.includes(pick)) setPalettePick(project, null);
}

// The palette the frames on screen wear, when it isn't the default. Until a design
// view says what's offered, the pick stands.
export const framePalette = (): string | null => {
  const project = systemProject();
  const pick = palettePick(project);
  const ids = project ? offered().get(project) : undefined;
  return pick && (!ids || ids.includes(pick)) ? pick : null;
};

const [peek, setPeekSignal] = createSignal<number | null>(null);
// The older revision frames show instead of the current one ("See before").
export const peekRev = (): number | null => peek();
export const setPeek = (rev: number | null): void => {
  setPeekSignal(rev && rev > 0 ? rev : null);
};

// A poster is a still of the frame as published under the current system with its
// default palette; anything else must be drawn live.
export const framesAsPosted = (): boolean => framePalette() === null && peek() === null;

// A poster, only while frames are drawn as it was taken.
export const posterShown = (id: string | undefined): string | undefined =>
  framesAsPosted() ? id : undefined;
