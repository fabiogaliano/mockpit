// The installable app: its web app manifest and its icon. Runtime-agnostic (no
// `node:` imports) so the Worker serves the same bytes. The PNG renders of the
// icon are generated from ICON_SVG by scripts/app-icons.ts into appIconPng.ts,
// because iOS takes no SVG for a home-screen icon.

import { DIALKIT, type Mode } from "./themes.ts";

const BG = DIALKIT.dark.bg;
const ACCENT = DIALKIT.dark.info.text;

// A stage frame with a comment pin on its corner. Full-bleed background and the
// mark inside the central 80% circle, so the same art works as `maskable`.
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="${BG}"/>
<rect x="126" y="142" width="260" height="196" rx="34" fill="none" stroke="${ACCENT}" stroke-width="28"/>
<path d="M170 206h120M170 262h76" stroke="${ACCENT}" stroke-width="24" stroke-linecap="round" opacity="0.55"/>
<circle cx="366" cy="338" r="58" fill="${ACCENT}" stroke="${BG}" stroke-width="22"/>
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
