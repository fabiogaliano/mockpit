import { createMemo, Match, Switch } from "solid-js";
import { startBadge } from "./badge.ts";
import { Home } from "./Home.tsx";
import { MockScreen } from "./MockScreen.tsx";
import { startNotifier } from "./notify.ts";
import { route } from "./route.ts";

export function App() {
  startNotifier();
  startBadge();
  // Home stays mounted across its tabs and projects, so a tab switch keeps
  // what is loaded and only swaps what it shows.
  const home = createMemo(() => {
    const r = route();
    return r.screen === "home" ? r : null;
  });
  return (
    <Switch>
      <Match when={route().screen === "mock" && route()} keyed>
        {(r) =>
          r.screen === "mock" && (
            <MockScreen project={r.project} slug={r.slug} open={r.open} flow={r.flow} />
          )
        }
      </Match>
      <Match when={home()}>
        {(r) => <Home project={r().project} view={r().view} area={r().area} />}
      </Match>
    </Switch>
  );
}
