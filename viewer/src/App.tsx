import { createMemo, Match, Switch } from "solid-js";
import { startBadge } from "./badge.ts";
import { Home } from "./Home.tsx";
import { MockScreen } from "./MockScreen.tsx";
import { startNotifier } from "./notify.ts";
import { type MockRoute, route } from "./route.ts";
import { CarriedToast } from "./toast.tsx";

export function App() {
  startNotifier();
  startBadge();
  // Home stays mounted across its tabs and projects, so a tab switch keeps
  // what is loaded and only swaps what it shows.
  const home = createMemo(() => {
    const r = route();
    return r.screen === "home" ? r : null;
  });
  // A mock's URL moves as its state and version do; only another mock or flow
  // is another screen, or every tab would reload the design.
  const mock = createMemo<MockRoute | null>(
    () => {
      const r = route();
      return r.screen === "mock" ? r : null;
    },
    null,
    { equals: (a, b) => a?.project === b?.project && a?.slug === b?.slug && a?.flow === b?.flow },
  );
  return (
    <>
      <Switch>
        <Match when={mock()} keyed>
          {(r) => <MockScreen project={r.project} slug={r.slug} open={r.open} flow={r.flow} />}
        </Match>
        <Match when={home()}>
          {(r) => <Home project={r().project} view={r().view} area={r().area} />}
        </Match>
      </Switch>
      <CarriedToast />
    </>
  );
}
