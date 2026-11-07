// What the README media scripts share: a throwaway server, the HALDE shop published
// through the agent's HTTP tier, and a pointer that moves like a hand.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STORE } from "./demo-store.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEMO = STORE;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const screenPath = `/project/${encodeURIComponent(DEMO.project)}/${DEMO.slug}`;

export async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "mockpit-rec-"));
  const proc = spawn(process.execPath, [join(ROOT, "server", "index.ts")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: "0",
      MOCKPIT_DB: join(dir, "db.sqlite"),
      MOCKPIT_TOKEN: "",
      MOCKPIT_VERSION: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const base = await new Promise((resolve, reject) => {
    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk;
      const m = out.match(/listening on (http:\/\/localhost:\d+)/);
      if (m) resolve(m[1]);
    });
    setTimeout(() => reject(new Error("server did not boot")), 10_000);
  });
  // Node's fetch sends no Origin, so the server treats these calls as the agent.
  const api = async (path, body, method = body === undefined ? "GET" : "POST") => {
    const init = { method };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, init);
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  return { base, api, dir, stop: () => proc.kill() };
}

// One session, one publish per (state, alternative), then the questions: what an agent does.
export async function publishShop(api, asks = DEMO.asks) {
  const session = await api("/api/sessions", {
    agent: DEMO.agent,
    title: DEMO.sessionTitle,
    project: DEMO.project,
  });
  let designId = "";
  for (const state of DEMO.states) {
    for (const alternative of DEMO.alternatives) {
      const out = await api("/api/designs", {
        session: session.id,
        project: DEMO.project,
        design: DEMO.slug,
        title: DEMO.title,
        state: state.label,
        alternative: alternative.name,
        knobs: DEMO.knobs,
        widths: [1200],
        surfaces: [{ kind: "html", html: DEMO.render(state, alternative) }],
      });
      designId = out.design.id;
    }
  }
  await api(`/api/designs/${designId}/asks`, { session: session.id, asks });
  return { designId, session: session.id };
}

export async function setTheme(page, api, base, mode) {
  await api("/api/theme", { mode }, "PUT");
  await page.goto(`${base}${screenPath}`);
  await page.evaluate((t) => localStorage.setItem("mockpit-theme", t), mode);
}

// The recording has no system pointer, and hovers over a picture answer land in its
// iframe, so the page draws one. It moves on the page's own animation frames, so every
// captured frame has it on its path: an eased curve whose time grows with distance, the
// way a hand travels further in a little more time, not proportionally more.
export const POINTER = `(() => {
  const c = document.createElement("div");
  c.id = "rec-cursor";
  c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M4 2.5v20.2l5.3-5 3.6 8.6 3.6-1.5-3.6-8.4h7.4z" fill="#0b0b0c" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span></span>';
  c.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;will-change:transform";
  const svg = () => c.querySelector("svg");
  const ring = () => c.querySelector("span");
  let x = -60, y = -60;
  const put = () => { c.style.transform = "translate(" + x + "px," + y + "px)"; };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  window.__pointer = {
    at(px, py) { x = px; y = py; put(); },
    move(tx, ty, ms) {
      return new Promise((done) => {
        const sx = x, sy = y, dx = tx - sx, dy = ty - sy;
        const len = Math.hypot(dx, dy) || 1;
        const bend = Math.min(48, len * 0.1);
        const cx = sx + dx / 2 + (dy / len) * bend, cy = sy + dy / 2 - (dx / len) * bend;
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms), e = ease(t), u = 1 - e;
          x = u * u * sx + 2 * u * e * cx + e * e * tx;
          y = u * u * sy + 2 * u * e * cy + e * e * ty;
          put();
          if (t < 1) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      });
    },
    press() {
      svg().animate([{ transform: "scale(1)" }, { transform: "scale(.82)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
      ring().animate([{ opacity: 0.55, transform: "translate(-50%,-50%) scale(.3)" }, { opacity: 0, transform: "translate(-50%,-50%) scale(1.6)" }], { duration: 420, easing: "cubic-bezier(.2,.7,.3,1)" });
    },
  };
  const style = () => {
    svg().style.cssText = "position:absolute;left:-4px;top:-2.5px;transform-origin:4px 2.5px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))";
    ring().style.cssText = "position:absolute;left:0;top:0;width:40px;height:40px;border-radius:50%;border:2px solid rgba(255,255,255,.9);opacity:0";
  };
  addEventListener("DOMContentLoaded", () => { style(); document.documentElement.append(c); put(); });
})()`;

// Moves the drawn pointer and the real mouse along the same curve, so hovers fire on the
// way, then rests. Returns the point reached.
export function pointer(page) {
  let at = { x: 720, y: 860 };
  // Fitts: 0.2 s plus 0.13 s per doubling of distance over a 40 px target, 0.35–1 s.
  const travel = (d) =>
    Math.round(Math.min(1000, Math.max(350, 200 + 130 * Math.log2(1 + d / 40))));
  const go = async (x, y) => {
    const d = Math.hypot(x - at.x, y - at.y);
    if (d < 1) return;
    const ms = travel(d);
    const drawn = page.evaluate(([x, y, ms]) => window.__pointer?.move(x, y, ms), [x, y, ms]);
    const steps = Math.max(6, Math.round(ms / 40));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      await page.mouse.move(at.x + (x - at.x) * e, at.y + (y - at.y) * e);
      await sleep(ms / steps);
    }
    await drawn;
    at = { x, y };
  };
  const centre = async (locator, dy = 0) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error(`not on screen: ${locator}`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 + dy, box: b };
  };
  return {
    get at() {
      return at;
    },
    place: async (x, y) => {
      at = { x, y };
      await page.mouse.move(x, y);
      await page.evaluate(([x, y]) => window.__pointer?.at(x, y), [x, y]);
    },
    go,
    hover: async (locator) => {
      const c = await centre(locator);
      await go(c.x, c.y);
      return c.box;
    },
    click: async (locator) => {
      const c = await centre(locator);
      await go(c.x, c.y);
      // A hand settles before it presses.
      await sleep(300);
      await page.evaluate(() => window.__pointer?.press());
      await locator.click();
      return c.box;
    },
  };
}
