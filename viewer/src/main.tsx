import { render } from "solid-js/web";
import { App } from "./App.tsx";
import { root } from "./host.ts";
import { dropKeyParam } from "./route.ts";
import { syncTheme } from "./theme.ts";
import "./styles.css";

dropKeyParam();
void syncTheme();
render(() => <App />, root().body);
