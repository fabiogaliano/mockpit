import { host, root } from "./host.ts";

// Long enough that a pointer crossing a toolbar doesn't flash a name per icon.
const FIRST_DELAY = 60;
// Once one name is up, the user is reading the toolbar: the next shows at once.
const WARM_FOR = 400;
const GAP = 6;
const EDGE = 8;

// A shortcut at the end of a title, "Close (Esc)" or "Search ( / or ⌘K )". Only known keys:
// a title can hold an agent's words, and "Header (v2)" is part of the name.
const KEY = "(?:Esc|Space|Enter|Tab|/|⌘\\S)";
const SHORTCUT = new RegExp(`^(.+?)\\s*\\(\\s*(${KEY}(?:\\s+or\\s+${KEY})*)\\s*\\)$`);

// A frame's title is its accessible name, not something to read on hover.
const OWNER = '[title]:not([title=""]):not(iframe)';

// Every `title` in the viewer shows this tip, so a control only ever declares a title.
export function installTooltips(): void {
  const doc = root();
  const win = host().window;
  let tip: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastShown = 0;
  let watcher: MutationObserver | null = null;
  // What the pointer is on, with its title lifted so the browser's own never shows too.
  let hovered: { el: Element; text: string } | null = null;

  const hide = () => {
    clearTimeout(timer);
    watcher?.disconnect();
    watcher = null;
    if (!tip) return;
    tip.remove();
    tip = null;
    lastShown = Date.now();
  };

  // Text nodes only, since a title can hold an agent's words.
  const fill = (box: HTMLElement, text: string) => {
    const m = SHORTCUT.exec(text);
    if (!m) return void (box.textContent = text);
    const keys = doc.createElement("span");
    keys.className = "tip-keys";
    keys.textContent = m[2]!.split(/\s+or\s+/).join(" ");
    box.replaceChildren(m[1]!, keys);
  };

  const show = (el: Element, text: string) => {
    hide();
    if (!el.isConnected) return;
    const box = doc.createElement("div");
    box.className = "tip";
    box.setAttribute("role", "tooltip");
    // The top layer, so a tip clears a modal dialog and any stacking context.
    box.popover = "manual";
    fill(box, text);
    doc.body.append(box);
    box.showPopover();
    tip = box;
    place(box, el);
    watcher = new MutationObserver(() => {
      if (!el.isConnected) release();
      const next = el.getAttribute("title");
      if (next && hovered?.el === el) {
        hovered.text = next;
        el.removeAttribute("title");
        fill(box, next);
        place(box, el);
      }
    });
    watcher.observe(doc.body, { childList: true, subtree: true });
    watcher.observe(el, { attributes: true, attributeFilter: ["title"] });
  };

  const place = (box: HTMLElement, el: Element) => {
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const above = a.top - GAP - b.height;
    const top = above >= EDGE ? above : a.bottom + GAP;
    const centred = a.left + a.width / 2 - b.width / 2;
    const left = Math.min(Math.max(EDGE, centred), win.innerWidth - b.width - EDGE);
    box.style.top = `${Math.round(top)}px`;
    box.style.left = `${Math.round(left)}px`;
  };

  const schedule = (el: Element, text: string) => {
    clearTimeout(timer);
    const warm = tip !== null || Date.now() - lastShown < WARM_FOR;
    if (warm) show(el, text);
    else timer = setTimeout(() => show(el, text), FIRST_DELAY);
  };

  const release = () => {
    hide();
    if (!hovered) return;
    const { el, text } = hovered;
    hovered = null;
    if (!el.hasAttribute("title")) el.setAttribute("title", text);
  };

  doc.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || e.buttons !== 0) return;
    const el = e.target instanceof Element ? e.target.closest(OWNER) : null;
    if (!el || el === hovered?.el) return;
    release();
    const text = el.getAttribute("title") ?? "";
    hovered = { el, text };
    el.removeAttribute("title");
    schedule(el, text);
  });

  doc.addEventListener("pointerout", (e) => {
    if (!hovered) return;
    const to = e.relatedTarget;
    if (to instanceof Node && hovered.el.contains(to)) return;
    release();
  });

  // The title stays while focused: nothing native competes, and it may be the control's name.
  doc.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!(el instanceof Element) || !el.matches(`${OWNER}:focus-visible`)) return;
    schedule(el, el.getAttribute("title") ?? "");
  });
  doc.addEventListener("focusout", () => {
    if (!hovered) hide();
  });

  // Acting on a control means its name was read; hovered stays so it doesn't come back
  // until the pointer leaves.
  doc.addEventListener("pointerdown", hide, true);
  win.addEventListener("scroll", hide, true);
  win.addEventListener("blur", release);
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}
