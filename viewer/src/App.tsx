import { Match, Switch } from "solid-js";
import { Home } from "./Home.tsx";
import { MockScreen } from "./MockScreen.tsx";
import { route } from "./route.ts";

export function App() {
  return (
    <Switch>
      <Match when={route().screen === "mock" && route()} keyed>
        {(r) => r.screen === "mock" && <MockScreen project={r.project} slug={r.slug} />}
      </Match>
      <Match when={route().screen === "home" && route()} keyed>
        {(r) => r.screen === "home" && <Home project={r.project} />}
      </Match>
    </Switch>
  );
}
