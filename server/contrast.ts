// WCAG 2.2 contrast between two CSS colours, for the system's declared pairs.
// Five notations resolve: hex, rgb(), hsl(), oklch() and oklab(). Anything else
// (a var(), color-mix(), a named colour past the few below) is unresolved, and
// the caller reports the pair as unchecked rather than passing it.
// Runtime-agnostic.

type Rgba = [r: number, g: number, b: number, a: number];

const NAMED: Record<string, Rgba> = {
  white: [1, 1, 1, 1],
  black: [0, 0, 0, 1],
  transparent: [0, 0, 0, 0],
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// A number, a percentage of `full`, or `none` (0).
function channel(raw: string, full: number): number | null {
  const s = raw.trim();
  if (s === "none") return 0;
  const pct = /^(-?\d*\.?\d+)%$/.exec(s);
  if (pct) return (Number(pct[1]) / 100) * full;
  const n = /^(-?\d*\.?\d+(?:e-?\d+)?)$/.exec(s);
  return n ? Number(n[1]) : null;
}

function hue(raw: string): number | null {
  const m = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(raw.trim());
  if (!m) return raw.trim() === "none" ? 0 : null;
  const n = Number(m[1]);
  switch (m[2]) {
    case "turn":
      return n * 360;
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    default:
      return n;
  }
}

// `fn(a b c / d)` or the legacy `fn(a, b, c, d)` into its parts.
function args(body: string): { parts: string[]; alpha: string | null } | null {
  const [main, alpha] = body.includes("/") ? body.split("/") : [body, null];
  const parts = main.includes(",")
    ? main.split(",").map((s) => s.trim())
    : main.trim().split(/\s+/);
  if (parts.length === 4 && alpha === null && main.includes(","))
    return { parts: parts.slice(0, 3), alpha: parts[3] };
  if (parts.length !== 3) return null;
  return { parts, alpha: alpha?.trim() ?? null };
}

const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    clamp01(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp01(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp01(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

export function parseColor(input: string): Rgba | null {
  const v = input.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const fn = /^([a-z]+)\((.*)\)$/.exec(v);
  if (!fn) return null;
  const parsed = args(fn[2]);
  if (!parsed) return null;
  const alpha = parsed.alpha === null ? 1 : channel(parsed.alpha, 1);
  if (alpha === null) return null;
  const [p0, p1, p2] = parsed.parts;
  switch (fn[1]) {
    case "rgb":
    case "rgba": {
      const c = [channel(p0, 255), channel(p1, 255), channel(p2, 255)];
      if (c.some((x) => x === null)) return null;
      return [clamp01(c[0]! / 255), clamp01(c[1]! / 255), clamp01(c[2]! / 255), clamp01(alpha)];
    }
    case "hsl":
    case "hsla": {
      const h = hue(p0);
      const s = channel(p1.endsWith("%") ? p1 : `${p1}%`, 1);
      const l = channel(p2.endsWith("%") ? p2 : `${p2}%`, 1);
      if (h === null || s === null || l === null) return null;
      return [...hslToRgb(((h % 360) + 360) % 360, clamp01(s), clamp01(l)), clamp01(alpha)];
    }
    case "oklab": {
      const L = channel(p0, 1);
      const a = channel(p1, 0.4);
      const b = channel(p2, 0.4);
      if (L === null || a === null || b === null) return null;
      return [...oklabToRgb(L, a, b), clamp01(alpha)];
    }
    case "oklch": {
      const L = channel(p0, 1);
      const C = channel(p1, 0.4);
      const h = hue(p2);
      if (L === null || C === null || h === null) return null;
      const r = (h * Math.PI) / 180;
      return [...oklabToRgb(L, C * Math.cos(r), C * Math.sin(r)), clamp01(alpha)];
    }
    default:
      return null;
  }
}

const luminance = ([r, g, b]: Rgba) => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

// A translucent colour is what it shows over what's under it.
const over = (top: Rgba, under: Rgba): Rgba => [
  top[0] * top[3] + under[0] * (1 - top[3]),
  top[1] * top[3] + under[1] * (1 - top[3]),
  top[2] * top[3] + under[2] * (1 - top[3]),
  1,
];

// The ratio, rounded to two places, or null when either colour doesn't resolve.
// A translucent background sits on white, the frame's canvas.
export function contrastRatio(fg: string, bg: string): number | null {
  const f = parseColor(fg);
  const b0 = parseColor(bg);
  if (!f || !b0) return null;
  const b = b0[3] < 1 ? over(b0, [1, 1, 1, 1]) : b0;
  const top = f[3] < 1 ? over(f, b) : f;
  const l1 = luminance(top);
  const l2 = luminance(b);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return Math.round(ratio * 100) / 100;
}
