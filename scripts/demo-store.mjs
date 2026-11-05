// The design the README media records: HALDE, a technical-outdoor label's shop in the
// spirit of ROA and the Yeezy store, as a product grid and a product page, each drawn in
// three grids. The questions set knobs (tile colour, name case, prices). Products are
// real photos cut out onto transparency (scripts/demo-products/, see CREDITS.md there),
// inlined so the render needs nothing from the network.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "demo-products");

const PRODUCTS = [
  { id: "boot", name: "Talus Boot", price: 390, kind: "Footwear" },
  { id: "trail", name: "Scree Runner", price: 240, kind: "Footwear" },
  { id: "shell", name: "Ridge Anorak", price: 520, kind: "Outerwear" },
  { id: "fleece", name: "Col Long Sleeve", price: 120, kind: "Apparel" },
  { id: "pants", name: "Moraine Trouser", price: 280, kind: "Apparel" },
  { id: "bag", name: "Tarn Rolltop 22L", price: 240, kind: "Accessories" },
  { id: "cap", name: "Fell Beanie", price: 65, kind: "Accessories" },
  { id: "mule", name: "Cairn Slide", price: 110, kind: "Footwear" },
].filter((p) => existsSync(join(DIR, `${p.id}.webp`)));

const src = new Map(
  PRODUCTS.map((p) => [
    p.id,
    `data:image/webp;base64,${readFileSync(join(DIR, `${p.id}.webp`)).toString("base64")}`,
  ]),
);

const img = (p) => `<img src="${src.get(p.id)}" alt="${p.name}">`;

const name = (p) =>
  `<span class="nm" data-part="name" data-part-label="Product name" data-part-key="${p.id}">${p.name}</span>`;
const price = (p) =>
  `<span class="pr" data-part="price" data-part-label="Price" data-part-key="${p.id}">€ ${p.price}.00</span>`;

const tile = (p, extra = "") =>
  `<a class="tile ${extra}"><span class="ph">${img(p)}</span><span class="cap">${name(p)}${price(p)}</span></a>`;

const GRIDS = {
  index: () => `<div class="grid index">${PRODUCTS.map((p) => tile(p)).join("")}</div>`,
  gallery: () => `<div class="grid gallery">${PRODUCTS.map((p) => tile(p)).join("")}</div>`,
  editorial: () =>
    `<div class="grid editorial">${PRODUCTS.map((p, i) => tile(p, i === 0 ? "lead" : "")).join("")}</div>`,
};

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{background:#fff}
.shop{--tile:var(--k-tile,#efefef);background:#fff;color:#111;font:12px/1.35 "Helvetica Neue",Helvetica,Arial,sans-serif;min-height:760px;position:relative;padding-bottom:40px}
.top{display:grid;grid-template-columns:120px 1fr auto;align-items:start;padding:18px 20px 0}
.logo{width:64px;height:64px;display:block}
.nav,.util{display:flex;gap:20px;text-transform:uppercase;letter-spacing:.01em;font-size:12px;padding-top:4px}
.util{gap:18px}
.title{font:400 52px/1 "Times New Roman",Times,serif;letter-spacing:-.02em;margin:-26px 0 0 120px}
.crumb{margin:10px 0 0 120px;font-size:11px;color:#666}
.bar{display:flex;justify-content:space-between;padding:22px 20px 14px;font-size:11px;text-transform:uppercase;color:#777}
.bar b{color:#111;font-weight:400;text-transform:none;margin-right:12px}
.grid{display:grid;gap:10px;padding:0 10px}
.tile{display:flex;flex-direction:column;color:inherit;text-decoration:none}
.ph{display:block;aspect-ratio:4/5;background:var(--tile);overflow:hidden;position:relative}
.ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:12%}
.cap{display:flex;flex-direction:column;gap:2px;padding:12px 14px 22px}
.nm{text-transform:uppercase;font-size:12px;letter-spacing:.01em}
html[data-k-name-case="sentence"] .nm{text-transform:none}
.pr{font-size:11px}
html[data-k-price-show="false"] .pr{display:none}
.index{grid-template-columns:repeat(4,1fr)}
.shop:has(.gallery),.shop:has(.gallery-pdp){background:var(--tile)}
.gallery{grid-template-columns:repeat(4,1fr);gap:28px 18px;padding:12px 60px}
.gallery .ph{background:transparent;aspect-ratio:1}
.gallery .ph img{padding:6%}
.gallery .cap{align-items:center;text-align:center;padding:4px 0 14px}
.gallery .nm{font-size:10px;letter-spacing:.08em}
.gallery .pr{font-size:10px;color:#777}
.editorial{grid-template-columns:repeat(4,1fr)}
.editorial .lead{grid-column:span 2;grid-row:span 2}
.editorial .lead .ph{aspect-ratio:auto;flex:1}
.editorial .lead .nm{font:400 30px/1 "Times New Roman",Times,serif;text-transform:none;letter-spacing:-.01em}
.pdp{display:grid;grid-template-columns:1.35fr 1fr;gap:10px;padding:18px 10px 0}
.pdp .pics{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pdp .pics .ph:first-child{grid-column:span 2;aspect-ratio:5/4}
.pdp .pics .ph{aspect-ratio:1}
.pdp .info{position:sticky;top:0;padding:10px 30px 0 30px;display:flex;flex-direction:column;gap:14px}
.pdp h2{font:400 34px/1.05 "Times New Roman",Times,serif;letter-spacing:-.01em}
.pdp .info .pr{font-size:13px}
.sizes{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.sizes span{border:1px solid #ddd;padding:10px 0;text-align:center;font-size:11px}
.sizes span.on{border-color:#111}
.sizes span.out{color:#bbb;text-decoration:line-through}
.bag{background:#111;color:#fff;text-transform:uppercase;font-size:12px;letter-spacing:.04em;padding:16px;text-align:center}
.det{font-size:11.5px;color:#444;line-height:1.55;border-top:1px solid #e6e6e6;padding-top:12px}
.det b{display:block;color:#111;font-weight:400;text-transform:uppercase;margin-bottom:4px;font-size:11px}
.gallery-pdp .pics .ph,.gallery-pdp .pics .ph:first-child{background:transparent}
.editorial-pdp h2{font-size:44px}
`;

const LOGO = `<svg class="logo" viewBox="0 0 64 64" fill="none" stroke="#111" stroke-width="1.2"><path d="M32 4 L60 58 H4 Z"/><path d="M16 58 L30 34 L38 46 L44 38 L54 58"/></svg>`;

function header(title, crumb) {
  return `<header class="top" data-part="header" data-part-label="Header">
    ${LOGO}
    <nav class="nav"><span>Fall Winter 26</span><span>Shop all</span><span>Apparel</span><span>Footwear</span><span>Accessories</span><span>Lookbook</span></nav>
    <span class="util"><span>Search</span><span>Login</span><span>Bag(0)</span></span>
  </header>
  <h1 class="title">${title}</h1>
  <p class="crumb">${crumb}</p>`;
}

function render(state, variant) {
  if (state.label === "Product") {
    const p = PRODUCTS[0];
    const alt = PRODUCTS.find((x) => x.kind === p.kind && x.id !== p.id) ?? PRODUCTS[1];
    return `<style>${CSS}</style>
<div class="shop">
  ${header(" ", "Home › Footwear › " + p.name)}
  <section class="pdp ${variant.name}-pdp" data-part="product" data-part-label="Product">
    <div class="pics"><span class="ph">${img(p)}</span><span class="ph">${img(p)}</span><span class="ph">${img(alt)}</span></div>
    <div class="info">
      <h2 data-part="name" data-part-label="Product name" data-part-key="pdp" class="nm">${p.name}</h2>
      ${price(p)}
      <div class="sizes" data-part="sizes" data-part-label="Sizes"><span>EU 40</span><span>EU 41</span><span class="on">EU 42</span><span>EU 43</span><span class="out">EU 44</span><span>EU 45</span><span>EU 46</span><span class="out">EU 47</span></div>
      <div class="bag" data-part="cta" data-part-label="Add to bag">Add to bag</div>
      <div class="det"><b>Details</b>Waxed suede upper on a Vibram Megagrip sole. Gusseted tongue, speed hooks, a heel pull. Made in Italy.</div>
      <div class="det"><b>Shipping &amp; returns</b>Free over € 250. Returns within 30 days.</div>
    </div>
  </section>
</div>`;
  }
  return `<style>${CSS}</style>
<div class="shop">
  ${header("Products", "Home › Products")}
  <div class="bar" data-part="filters" data-part-label="Filters"><span><b>Filters</b> Size &nbsp; Colour</span><span><b>Available products</b> In stock &nbsp; Out of stock</span></div>
  <div data-part="grid" data-part-label="Product grid">${GRIDS[variant.name]()}</div>
</div>`;
}

export const STORE = {
  project: "demo/halde",
  agent: "designer",
  sessionTitle: "HALDE shop",
  slug: "shop",
  title: "Shop",
  states: [{ label: "Grid" }, { label: "Product" }],
  variants: [{ name: "index" }, { name: "gallery" }, { name: "editorial" }],
  knobs: {
    tile: "#efefef",
    "name.case": { type: "select", options: ["upper", "sentence"], value: "upper" },
    "price.show": true,
  },
  asks: [
    {
      id: "grid",
      text: "Which grid?",
      scope: "design",
      options: [
        { label: "Index", variant: "index" },
        { label: "Gallery", variant: "gallery" },
        { label: "Editorial", variant: "editorial" },
      ],
    },
    {
      id: "tile",
      text: "What colour behind the products?",
      scope: "design",
      options: [
        { label: "Grey", set: { tile: "#efefef" } },
        { label: "Bone", set: { tile: "#e8e3d9" } },
        { label: "White", set: { tile: "#ffffff" } },
      ],
    },
    {
      id: "case",
      text: "How should names read?",
      scope: "part",
      part: "name",
      options: [
        { label: "UPPERCASE", set: { "name.case": "upper" } },
        { label: "Sentence case", set: { "name.case": "sentence" } },
      ],
    },
    {
      id: "prices",
      text: "Prices on the grid?",
      scope: "part",
      part: "price",
      options: [
        { label: "Show", set: { "price.show": true } },
        { label: "Hide", set: { "price.show": false } },
      ],
    },
  ],
  render,
};

// Already on the project's Home when the film starts, so the shop lands beside something.
export const LOOKBOOK = {
  slug: "lookbook",
  title: "Lookbook",
  html: () => `<style>${CSS}
.lb{display:grid;grid-template-columns:1.2fr 1fr;gap:10px;padding:10px}
.lb .ph{aspect-ratio:3/4}
.lb h2{font:400 64px/1 "Times New Roman",Times,serif;letter-spacing:-.02em;padding:40px 10px 0}
.lb p{padding:14px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#666}</style>
<div class="shop"><h2>Fall Winter 26</h2><p>Lookbook · 8 looks</p>
<div class="lb"><span class="ph">${img(PRODUCTS[2] ?? PRODUCTS[0])}</span><span class="ph">${img(PRODUCTS[0])}</span></div></div>`,
};
