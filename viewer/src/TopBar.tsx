import type { JSX } from "solid-js";
import { theme, toggleTheme } from "./theme.ts";

// Shows the theme you'd switch TO: a sun while dark, a moon while light.
function ThemeIcon(props: { theme: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {props.theme === "dark" ? (
        <>
          <path d="M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </>
      ) : (
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
      )}
    </svg>
  );
}

export function TopBar(props: { left: JSX.Element; right?: JSX.Element }) {
  const next = () => (theme() === "dark" ? "Light" : "Dark");
  return (
    <header class="top">
      <div class="crumb">{props.left}</div>
      <div class="right">
        {props.right}
        <button
          type="button"
          class="themebtn"
          title={next()}
          aria-label={`${next()} theme`}
          onClick={toggleTheme}
        >
          <ThemeIcon theme={theme()} />
        </button>
      </div>
    </header>
  );
}
