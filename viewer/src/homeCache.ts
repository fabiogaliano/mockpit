// Home as this browser last saw it, so a reload paints the project's real covers
// while the fresh read is on its way. Never authoritative: whatever the server
// answers replaces it. It is data, rendered like the answer it stands in for.
// Off for a read-only viewer, who may not be the workspace's owner.

import type { api, DesignList, ProjectSummary } from "./api.ts";
import { host, readonly, renderRev } from "./host.ts";

export type HomeTree = Awaited<ReturnType<typeof api.tree>>;

export interface HomeSnapshot {
  tree: HomeTree;
  list: DesignList;
  decisions: number;
}

const PREFIX = "mockpit:home:";
const PROJECTS_KEY = "mockpit:home-projects";
const ORDER_KEY = "mockpit:home-order";
// localStorage is about five million characters per origin, shared with what must
// not be crowded out (seen marks, Tune presets). These bound this cache to a share.
const MAX_PROJECTS = 3;
const MAX_CHARS = 1_000_000;

// Painting a shape this viewer can't read would break the page. Those shapes are
// the server's views, and the render rev moves whenever the server's code does.
const stamp = () => renderRev() ?? "";

const store = () => (readonly() ? null : host().storage);

function read<T>(key: string): T | null {
  const raw = store()?.getItem(key);
  if (!raw) return null;
  try {
    const held = JSON.parse(raw) as { stamp?: string; data?: T };
    return held.stamp === stamp() ? (held.data ?? null) : null;
  } catch {
    return null;
  }
}

function write(key: string, data: unknown): boolean {
  const s = store();
  if (!s) return false;
  const text = JSON.stringify({ stamp: stamp(), data });
  if (text.length > MAX_CHARS) {
    s.removeItem(key);
    return false;
  }
  try {
    s.setItem(key, text);
    return true;
  } catch {
    // Full or locked storage: the next load just waits for the server.
    return false;
  }
}

function readOrder(): string[] {
  try {
    const v: unknown = JSON.parse(store()?.getItem(ORDER_KEY) ?? "[]");
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

export const readHomeSnapshot = (project: string) => read<HomeSnapshot>(PREFIX + project);
export const readHomeProjects = () => read<ProjectSummary[]>(PROJECTS_KEY);
export const saveHomeProjects = (projects: ProjectSummary[]) => void write(PROJECTS_KEY, projects);

export function saveHomeSnapshot(project: string, snapshot: HomeSnapshot) {
  const s = store();
  if (!s) return;
  // An empty project has nothing to paint, and painting "nothing published" from
  // memory would be a false statement about a project that has since filled.
  if (!snapshot.tree.tree.length) {
    s.removeItem(PREFIX + project);
    return;
  }
  if (!write(PREFIX + project, snapshot)) return;
  const order = [project, ...readOrder().filter((p) => p !== project)];
  for (const old of order.splice(MAX_PROJECTS)) s.removeItem(PREFIX + old);
  try {
    s.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // The order only decides what goes first; it can wait for the next save.
  }
}
