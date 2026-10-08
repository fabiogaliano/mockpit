// The one place the viewer touches the page's globals, so the rest of the code
// reads the document, URL and history through a seam a test (or a future
// embedder) can replace.

export interface Host {
  location: Location;
  history: History;
  window: Window;
  storage: Storage | null;
}

let rootDoc: Document | null = null;
let current: Host | null = null;

export function root(): Document {
  return (rootDoc ??= document);
}

export function host(): Host {
  if (current) return current;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // Storage can throw in locked-down contexts; theme persistence just degrades.
  }
  current = { location: window.location, history: window.history, window, storage };
  return current;
}

declare global {
  interface Window {
    __MOCKPIT_BASE_PATH__?: string;
    __MOCKPIT_READONLY__?: boolean;
  }
}

export const basePath = (): string => host().window.__MOCKPIT_BASE_PATH__ ?? "";
export const readonly = (): boolean => host().window.__MOCKPIT_READONLY__ === true;
