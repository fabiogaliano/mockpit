import { createMemo, Match, Switch } from "solid-js";
import { startBadge } from "./badge.ts";
import { Board } from "./Board.tsx";
import { Jump } from "./Jump.tsx";
import { DesignScreen } from "./DesignScreen.tsx";
import { NotFound } from "./NotFound.tsx";
import { startNotifier } from "./notify.ts";
import { type DesignRoute, rootPath, route } from "./route.ts";
import { CarriedToast } from "./toast.tsx";

export function App() {
  startNotifier();
  startBadge();
  // The Board stays mounted across its pages, selections and projects, so moving between
  // them keeps what is loaded and only swaps what it shows.
  const board = createMemo(() => {
    const r = route();
    return r.screen === "board" ? r : null;
  });
  // A design's URL moves as its state and version do; only another design or flow
  // is another screen, or every tab would reload the design.
  const design = createMemo<DesignRoute | null>(
    () => {
      const r = route();
      return r.screen === "design" ? r : null;
    },
    null,
    { equals: (a, b) => a?.project === b?.project && a?.slug === b?.slug && a?.flow === b?.flow },
  );
  return (
    <>
      <Switch>
        <Match when={design()} keyed>
          {(r) => <DesignScreen project={r.project} slug={r.slug} open={r.open} flow={r.flow} />}
        </Match>
        <Match when={board()}>
          {(r) => (
            <Board
              project={r().project}
              page={r().page}
              unsorted={r().unsorted}
              sel={r().sel}
              sec={r().sec}
              show={r().show}
              for={r().for}
            />
          )}
        </Match>
        <Match when={route().screen === "missing"}>
          <NotFound title="Nothing at this address" href={rootPath()} back="Go to your projects" />
        </Match>
      </Switch>
      <CarriedToast />
      <Jump />
    </>
  );
}
