// The design the README media records: a shop's product grid and quick view, each in
// three card variants, with knobs the questions set (button style, accent, ratings).
// Products are drawn in SVG so the render needs nothing from the network.

const ART = {
  headphones: `<path d="M52 118v-14a48 48 0 0 1 96 0v14" fill="none" stroke="#1c1917" stroke-width="9" stroke-linecap="round"/>
    <rect x="36" y="104" width="34" height="54" rx="14" fill="#1c1917"/><rect x="130" y="104" width="34" height="54" rx="14" fill="#1c1917"/>
    <rect x="44" y="114" width="14" height="34" rx="7" fill="#57534e"/><rect x="142" y="114" width="14" height="34" rx="7" fill="#57534e"/>`,
  sneaker: `<path d="M28 128c0-14 14-24 34-28l30-20c10-6 20-2 24 8l6 12c18 4 42 10 50 22 5 8 1 18-12 18H40c-7 0-12-4-12-12z" fill="#fafaf9" stroke="#1c1917" stroke-width="3"/>
    <path d="M26 138h146a7 7 0 0 1 0 14H33a7 7 0 0 1-7-7z" fill="#1c1917"/>
    <path d="M96 92l10 14M88 98l10 14M80 104l10 14" stroke="#ea580c" stroke-width="4" stroke-linecap="round"/>
    <path d="M128 108c14 4 28 9 34 16" stroke="#ea580c" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  watch: `<rect x="84" y="26" width="32" height="148" rx="10" fill="#78716c"/>
    <circle cx="100" cy="100" r="40" fill="#1c1917"/><circle cx="100" cy="100" r="32" fill="#f5f5f4"/>
    <rect x="139" y="94" width="8" height="12" rx="2" fill="#1c1917"/>
    <path d="M100 100V78M100 100l14 8" stroke="#1c1917" stroke-width="4" stroke-linecap="round"/>
    <circle cx="100" cy="100" r="3.5" fill="#ea580c"/>`,
  backpack: `<path d="M80 52a20 20 0 0 1 40 0" fill="none" stroke="#365314" stroke-width="7"/>
    <rect x="52" y="50" width="96" height="122" rx="30" fill="#4d7c0f"/>
    <rect x="68" y="108" width="64" height="46" rx="12" fill="#3f6212"/>
    <path d="M74 120h52" stroke="#a3e635" stroke-width="3" stroke-linecap="round"/>
    <path d="M70 70h60" stroke="#365314" stroke-width="4" stroke-linecap="round"/>`,
  mug: `<path d="M136 92h8a20 20 0 0 1 0 40h-8" fill="none" stroke="#0e7490" stroke-width="10"/>
    <rect x="58" y="72" width="82" height="88" rx="12" fill="#0891b2"/>
    <path d="M58 92h82" stroke="#0e7490" stroke-width="5"/>
    <path d="M84 60c-6-8 6-14 0-24M104 60c-6-8 6-14 0-24" stroke="#a8a29e" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  lamp: `<ellipse cx="74" cy="164" rx="34" ry="8" fill="#1c1917"/>
    <path d="M74 160l26-58 34 18" stroke="#44403c" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M118 98l42 24-12 20-42-24z" fill="#eab308"/>
    <circle cx="146" cy="146" r="14" fill="#fde68a" opacity=".8"/>`,
};

const PRODUCTS = [
  {
    id: "headphones",
    name: "Aurora Headphones",
    price: 249,
    rating: 4.8,
    reviews: 312,
    bg: "#e7e5e4",
  },
  { id: "sneaker", name: "Trail Runner", price: 145, rating: 4.6, reviews: 208, bg: "#e2e8f0" },
  { id: "watch", name: "Field Watch", price: 189, rating: 4.9, reviews: 96, bg: "#ede5dc" },
  { id: "backpack", name: "Daypack 22L", price: 98, rating: 4.7, reviews: 154, bg: "#e4ead9" },
  { id: "mug", name: "Studio Mug", price: 28, rating: 4.5, reviews: 87, bg: "#dfeaec" },
  { id: "lamp", name: "Arc Desk Lamp", price: 119, rating: 4.4, reviews: 61, bg: "#f1ead3" },
];

const art = (p, style = "") =>
  `<svg viewBox="0 0 200 200" role="img" aria-label="${p.name}" style="display:block;width:100%;height:100%;${style}">${ART[p.id]}</svg>`;

const stars = (p) =>
  `<span data-part="rating" data-part-label="Rating" data-part-key="${p.id}" class="rating">★ ${p.rating} <i>(${p.reviews})</i></span>`;

const cta = (p, label = "Add to cart") =>
  `<button data-part="cta" data-part-label="Add to cart" data-part-key="${p.id}" class="cta"><span class="cta-icon">+</span><span class="cta-text">${label}</span></button>`;

// Each variant is a card: where the words sit around the picture and the button.
const CARDS = {
  classic: (p) => `<article class="card classic">
      <div class="pic" style="background:${p.bg}">${art(p, "padding:10%")}</div>
      <div class="info"><b>${p.name}</b>${stars(p)}<span class="price">$${p.price}</span></div>
      ${cta(p)}
    </article>`,
  overlay: (p) => `<article class="card overlay" style="background:${p.bg}">
      ${art(p, "padding:6% 14% 30%")}
      <div class="info"><b>${p.name}</b><span class="row">${stars(p)}<span class="price">$${p.price}</span></span></div>
      ${cta(p, "Add")}
    </article>`,
  minimal: (p) => `<article class="card minimal">
      <div class="pic" style="background:${p.bg}">${art(p, "padding:12%")}</div>
      <div class="row"><b>${p.name}</b><span class="price">$${p.price}</span></div>
      <div class="row">${stars(p)}${cta(p, "Add")}</div>
    </article>`,
};

const CSS = `
*{box-sizing:border-box;margin:0}
.shop{--accent:var(--k-accent,#f97316);background:#0c0c0e;color:#f4f4f5;font:14px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:22px 26px 28px;min-height:640px;position:relative}
.top{display:flex;align-items:center;gap:22px;padding-bottom:18px;border-bottom:1px solid #1f1f23}
.logo{font-weight:700;letter-spacing:-.01em;font-size:16px}
.logo i{color:var(--accent);font-style:normal}
.nav{display:flex;gap:18px;color:#a1a1aa;font-size:13px}
.nav b{color:#f4f4f5;font-weight:500}
.bag{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;color:#d4d4d8}
.bag em{font-style:normal;background:var(--accent);color:#0c0c0e;border-radius:999px;padding:1px 7px;font-weight:600;font-size:12px}
.filters{display:flex;gap:8px;margin:18px 0}
.chip{border:1px solid #27272a;border-radius:999px;padding:5px 12px;font-size:12px;color:#a1a1aa}
.chip.on{background:#f4f4f5;color:#0c0c0e;border-color:#f4f4f5}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.card b{font-weight:600;font-size:14px}
.price{font-weight:600;font-variant-numeric:tabular-nums}
.rating{color:#a1a1aa;font-size:12px}
.rating i{font-style:normal;color:#71717a}
.cta{font:600 13px/1 inherit;font-family:inherit;border:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--accent);color:#0c0c0e;border-radius:8px;padding:10px 14px}
.cta-icon{font-size:16px;line-height:0}
html[data-k-cta-style="outline"] .cta{background:transparent;color:var(--accent);box-shadow:inset 0 0 0 1.5px var(--accent)}
html[data-k-cta-style="pill"] .cta{border-radius:999px}
html[data-k-rating-show="false"] .rating{display:none}
.classic{background:#141417;border:1px solid #1f1f23;border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:10px}
.classic .pic{border-radius:9px;aspect-ratio:4/3;overflow:hidden}
.classic .info{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:0 4px}
.classic .price{grid-row:1/3;grid-column:2;align-self:center;font-size:15px}
.classic .cta{width:100%}
.classic .cta-icon{display:none}
.overlay{position:relative;border-radius:16px;overflow:hidden;aspect-ratio:4/4.3}
.overlay .info{position:absolute;inset:auto 0 0 0;padding:44px 14px 14px;background:linear-gradient(transparent,rgba(12,12,14,.92) 55%);display:flex;flex-direction:column;gap:3px}
.overlay .row{display:flex;justify-content:space-between;align-items:center}
.overlay .cta{position:absolute;top:10px;right:10px;padding:8px 11px}
.overlay .rating,.overlay .rating i{color:#d4d4d8}
.minimal{display:flex;flex-direction:column;gap:6px}
.minimal .pic{border-radius:4px;aspect-ratio:4/3.4;overflow:hidden;margin-bottom:4px}
.minimal .row{display:flex;justify-content:space-between;align-items:center}
.minimal b{font-weight:500}
.minimal .cta{padding:6px 10px;font-size:12px}
.minimal .cta-icon{display:none}
.dim{position:absolute;inset:0;background:rgba(5,5,7,.72)}
.qv{position:absolute;left:50%;top:84px;transform:translateX(-50%);width:640px;max-width:calc(100% - 40px);background:#141417;border:1px solid #27272a;border-radius:18px;display:grid;grid-template-columns:1fr 1fr;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.qv .art{aspect-ratio:1}
.qv .side{padding:26px 24px;display:flex;flex-direction:column;gap:12px}
.qv h2{font-size:21px;letter-spacing:-.01em}
.qv .price{font-size:20px}
.qv p{color:#a1a1aa;font-size:13px;line-height:1.55}
.swatches{display:flex;gap:8px}
.swatches span{width:22px;height:22px;border-radius:50%;box-shadow:0 0 0 2px #141417,0 0 0 3px transparent}
.swatches span.on{box-shadow:0 0 0 2px #141417,0 0 0 3.5px var(--accent)}
.qv .cta{width:100%;padding:13px;font-size:14px;margin-top:auto}
.qv .x{position:absolute;top:12px;right:14px;color:#71717a;font-size:18px}
.qv.minimal-qv{border-radius:6px}
.qv.overlay-qv .art{border-radius:0}
`;

function render(state, variant) {
  const card = CARDS[variant.name];
  const grid = `<div class="grid" data-part="grid" data-part-label="Product grid">${PRODUCTS.map(card).join("")}</div>`;
  const quick =
    state.label === "Quick view"
      ? `<div class="dim"></div>
  <section class="qv ${variant.name}-qv" data-part="quickview" data-part-label="Quick view">
    <div class="art" style="background:${PRODUCTS[0].bg}">${art(PRODUCTS[0], "padding:12%")}</div>
    <div class="side">
      <span class="x">×</span>
      <h2>${PRODUCTS[0].name}</h2>
      ${stars(PRODUCTS[0])}
      <span class="price">$${PRODUCTS[0].price}</span>
      <p>Closed-back, 40-hour battery, folds flat into its case. Noise cancelling you can turn down to hear the room.</p>
      <div class="swatches"><span class="on" style="background:#1c1917"></span><span style="background:#d6d3d1"></span><span style="background:#4d7c0f"></span></div>
      ${cta(PRODUCTS[0])}
    </div>
  </section>`
      : "";
  return `<style>${CSS}</style>
<div class="shop">
  <header class="top" data-part="header" data-part-label="Header">
    <span class="logo">field<i>&amp;</i>form</span>
    <nav class="nav"><b>Shop</b><span>New</span><span>Journal</span><span>About</span></nav>
    <span class="bag">Bag <em>2</em></span>
  </header>
  <div class="filters" data-part="filters" data-part-label="Filters"><span class="chip on">All</span><span class="chip">Audio</span><span class="chip">Outdoor</span><span class="chip">Home</span><span class="chip">Under $100</span></div>
  ${grid}
  ${quick}
</div>`;
}

export const STORE = {
  project: "demo/shop",
  agent: "designer",
  sessionTitle: "Shop redesign",
  slug: "shop",
  title: "Shop",
  states: [{ label: "Grid" }, { label: "Quick view" }],
  variants: [{ name: "classic" }, { name: "overlay" }, { name: "minimal" }],
  knobs: {
    accent: "#f97316",
    "cta.style": { type: "select", options: ["solid", "outline", "pill"], value: "solid" },
    "rating.show": true,
  },
  asks: [
    {
      id: "card",
      text: "Which product card?",
      scope: "design",
      options: [
        { label: "Classic", variant: "classic" },
        { label: "Overlay", variant: "overlay" },
        { label: "Minimal", variant: "minimal" },
      ],
    },
    {
      id: "cta",
      text: "How should Add to cart look?",
      scope: "part",
      part: "cta",
      options: [
        { label: "Solid", set: { "cta.style": "solid" } },
        { label: "Outline", set: { "cta.style": "outline" } },
        { label: "Pill", set: { "cta.style": "pill" } },
      ],
    },
    {
      id: "accent",
      text: "Which accent?",
      scope: "design",
      options: [
        { label: "Orange", set: { accent: "#f97316" } },
        { label: "Lime", set: { accent: "#a3e635" } },
        { label: "Violet", set: { accent: "#a78bfa" } },
      ],
    },
    {
      id: "ratings",
      text: "Show ratings on the cards?",
      scope: "part",
      part: "rating",
      options: [
        { label: "Show", set: { "rating.show": true } },
        { label: "Hide", set: { "rating.show": false } },
      ],
    },
  ],
  render,
};
