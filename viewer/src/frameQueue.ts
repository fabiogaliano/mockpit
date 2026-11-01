// How many pictured pages may load at once. Each is a whole sandboxed document
// on an opaque origin, which shares no cache with the others, so a Home that
// starts them all at once spends minutes of bandwidth on what is below the
// fold and starves what the user is looking at.
const MAX_LOADING = 4;
// A page whose CDN hangs must not hold its turn for good.
const TURN_MS = 4000;

let loading = 0;
const waiting: (() => void)[] = [];

const next = () => {
  while (loading < MAX_LOADING && waiting.length) waiting.shift()!();
};

// Runs `start` at this page's turn. The returned function ends the turn, or
// gives up the place in line; calling it again does nothing.
export function takeTurn(start: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: "waiting" | "loading" | "done" = "waiting";
  const run = () => {
    state = "loading";
    loading++;
    timer = setTimeout(end, TURN_MS);
    start();
  };
  const end = () => {
    if (state === "waiting") waiting.splice(waiting.indexOf(run), 1);
    if (state === "loading") {
      clearTimeout(timer);
      loading--;
    }
    state = "done";
    next();
  };
  waiting.push(run);
  next();
  return end;
}
