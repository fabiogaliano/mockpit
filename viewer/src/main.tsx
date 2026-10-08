import { render } from "solid-js/web";
import { App } from "./App.tsx";
import { root } from "./host.ts";
import { syncTheme } from "./theme.ts";
import "./styles.css";

void syncTheme();
render(() => <App />, root().body);
