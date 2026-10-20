import { Match, Switch } from "solid-js";
import { startBadge } from "./badge.ts";
import { Home } from "./Home.tsx";
import { MockScreen } from "./MockScreen.tsx";
import { startNotifier } from "./notify.ts";
import { route } from "./route.ts";

export function App() {
  startNotifier();
  startBadge();
  return (
    <Switch>
      <Match when={route().screen === "mock" && route()} keyed>
        {(r) =>
          r.screen === "mock" && <MockScreen project={r.project} slug={r.slug} open={r.open} />
        }
      </Match>
      <Match when={route().screen === "home" && route()} keyed>
        {(r) => r.screen === "home" && <Home project={r.project} view={r.view} focus={r.focus} />}
      </Match>
    </Switch>
  );
}
