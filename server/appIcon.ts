// The installable app: its web app manifest and its icon. Runtime-agnostic (no
// `node:` imports) so the Worker serves the same bytes. The PNG renders of the
// icon are generated from ICON_SVG by scripts/app-icons.ts into appIconPng.ts,
// because iOS takes no SVG for a home-screen icon.

import { DIALKIT, type Mode } from "./themes.ts";

const BG = DIALKIT.dark.bg;
const ACCENT = DIALKIT.dark.info.text;

// Lucide's square-dashed-mouse-pointer (ISC): a mock being pointed at, the same
// mark as the project icon. Full-bleed background and the mark inside the central
// 80% circle, so the same art works as `maskable`.
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="${BG}"/>
<g transform="translate(76 76) scale(15)" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z"/>
<path d="M5 3a2 2 0 0 0-2 2"/>
<path d="M19 3a2 2 0 0 1 2 2"/>
<path d="M5 21a2 2 0 0 1-2-2"/>
<path d="M9 3h1"/>
<path d="M9 21h2"/>
<path d="M14 3h1"/>
<path d="M3 9v1"/>
<path d="M21 9v2"/>
<path d="M3 14v1"/>
</g>
</svg>`;

export const ICON_SIZES = [180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export const themeColor = (mode: Mode): string => DIALKIT[mode].bg;

// Relative URLs resolve against the manifest's own URL, so the app works under
// any base path. `startUrl` carries `?key=` on a tokened workspace: a
// home-screen app may not share Safari's cookie jar, and the key is how the
// viewer gets its cookie back on first launch.
export function webManifest(mode: Mode, startUrl = "./") {
  return {
    name: "mockpit",
    short_name: "mockpit",
    description: "Answer your agent's design questions.",
    id: "./",
    start_url: startUrl,
    scope: "./",
    display: "standalone",
    background_color: themeColor(mode),
    theme_color: themeColor(mode),
    icons: [
      { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      ...ICON_SIZES.filter((s) => s !== 180).map((s) => ({
        src: `icon-${s}.png`,
        sizes: `${s}x${s}`,
        type: "image/png",
        purpose: "any maskable",
      })),
    ],
  };
}
