// Finishes the demo shop's product photos so they read as one shoot: each product is
// lifted out of its photo (scripts/product-cutout.swift, macOS Vision), scaled to the
// same visual weight, stood on the same baseline with the same soft contact shadow,
// lightly graded, and saved as transparent WebP, so the shop's tile colour shows
// through. macOS 14+ with ImageMagick and cwebp:
//
//   node scripts/finish-products.mjs <raw dir> [id=file …]
//
// Without pairs, every <id>.jpg in the raw dir is used. Output: scripts/demo-products/.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "demo-products");
const [raw, ...pairs] = process.argv.slice(2);
if (!raw) throw new Error("usage: finish-products <raw dir> [id=file …]");

const jobs = pairs.length
  ? pairs.map((p) => p.split("="))
  : readdirSync(raw)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .map((f) => [basename(f, extname(f)), f]);

const work = mkdtempSync(join(tmpdir(), "mockpit-products-"));
const cutout = join(work, "cutout");
execFileSync("swiftc", ["-O", join(ROOT, "scripts", "product-cutout.swift"), "-o", cutout]);
mkdirSync(OUT, { recursive: true });

// The canvas every product sits on: wide products fill the width, tall ones the height,
// and all of them meet the floor at the same line.
const SIZE = 1000;
const BOX = 760;
const FLOOR = 820;

const magick = (...args) => execFileSync("magick", args.flat(), { stdio: "inherit" });

for (const [id, file] of jobs) {
  const cut = join(work, `${id}-cut.png`);
  execFileSync(cutout, [join(raw, file), cut], { stdio: "inherit" });
  const fit = join(work, `${id}-fit.png`);
  // Grade: a little less saturation and contrast, so photos from different shoots sit
  // together; the alpha edge is feathered by a pixel to lose segmentation fringes.
  magick(cut, "-trim", "+repage", "-resize", `${BOX}x${BOX}`, "-modulate", "100,88", [
    "-channel",
    "A",
    "-blur",
    "0x0.7",
    "-level",
    "8%,100%",
    "+channel",
    fit,
  ]);
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", fit])
    .toString()
    .split(" ")
    .map(Number);
  const x = Math.round((SIZE - w) / 2);
  const y = FLOOR - h;
  // The contact shadow: a flat ellipse under the product's footprint, blurred, darker in
  // the middle, so everything looks lit by the same softbox.
  const sw = Math.round(w * 0.86);
  const shadow = join(work, `${id}-shadow.png`);
  magick("-size", `${SIZE}x${SIZE}`, "xc:none", [
    "-fill",
    "rgba(0,0,0,0.30)",
    "-draw",
    `ellipse ${SIZE / 2},${FLOOR - 4} ${sw / 2},${Math.max(10, Math.round(sw * 0.045))} 0,360`,
    "-blur",
    "0x18",
    shadow,
  ]);
  const png = join(work, `${id}.png`);
  magick(shadow, fit, "-geometry", `+${x}+${y}`, "-composite", "-resize", "720x720", png);
  const webp = join(OUT, `${id}.webp`);
  execFileSync("cwebp", ["-quiet", "-q", "80", "-alpha_q", "90", "-m", "6", png, "-o", webp]);
  console.log(webp);
}
