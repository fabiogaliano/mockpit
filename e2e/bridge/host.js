// Trusted host for the bridge e2e, standing in for the stage the viewer will
// build: one sandboxed /s/:id frame per state under an overlay layer. Runs in the
// trusted origin, so every DOM node is built with createElement/textContent from
// the data the frames report — never innerHTML.
(function () {
  var cfg = window.__bridgeConfig;
  var STATES = cfg.states;
  var FRAME_W = 820,
    FRAME_H = 640,
    STAGE_W = 615;
  var S = STAGE_W / FRAME_W;
  var stage = document.getElementById("stage");
  var layer = document.getElementById("layer");
  var strip = document.getElementById("strip");
  var list = document.getElementById("list");
  var selinfo = document.getElementById("selinfo");
  stage.style.width = STAGE_W + "px";
  stage.style.height = FRAME_H * S + "px";

  var frames = {},
    reports = {},
    active = STATES[0],
    selected = null,
    hot = null,
    version = 1,
    refN = 0;
  // Probe surface for the spec.
  var mp = (window.__mp = {
    log: [],
    reports: reports,
    counts: {},
    hits: [],
    stale: 0,
    v2At: null,
    scale: S,
  });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function load(v) {
    version = v;
    STATES.forEach(function (s) {
      var f = frames[s];
      if (!f) {
        f = frames[s] = el("iframe");
        f.setAttribute("sandbox", "allow-scripts");
        f.width = FRAME_W;
        f.height = FRAME_H;
        f.style.transform = "scale(" + S + ")";
        stage.insertBefore(f, layer);
      }
      delete reports[s];
      f.src = cfg.server + "/s/" + cfg.ids[s] + "?surface=0&ver=" + v + "&mode=light";
    });
    show(active);
  }

  function show(s) {
    active = s;
    STATES.forEach(function (k) {
      frames[k].classList.toggle("on", k === s);
    });
    [].forEach.call(strip.children, function (b) {
      b.classList.toggle("on", b.dataset.state === s);
    });
    hot = null;
    post(s, { type: "clear" });
    draw();
  }

  function post(s, msg) {
    var f = frames[s];
    if (!f || !f.contentWindow) return;
    msg.__mockpit = true;
    f.contentWindow.postMessage(msg, "*");
  }

  function stateOf(source) {
    for (var i = 0; i < STATES.length; i++)
      if (frames[STATES[i]].contentWindow === source) return STATES[i];
    return null;
  }

  window.addEventListener("message", function (e) {
    var s = stateOf(e.source);
    var d = e.data;
    if (!s || !d || d.__mockpit !== true) return;
    if (d.type === "parts" && Array.isArray(d.parts)) {
      // A reloading frame keeps its contentWindow: drop the old document's reports.
      if (d.version !== version) {
        mp.stale++;
        return;
      }
      reports[s] = d;
      mp.counts[s] = (mp.counts[s] || 0) + 1;
      mp.log.push({
        t: performance.now(),
        state: s,
        v: version,
        names: d.parts.map(function (p) {
          return String(p.name);
        }),
        h: d.parts.map(function (p) {
          return Number(p.box.h);
        }),
      });
      if (s === active) draw();
      renderList();
    } else if (d.type === "hit") {
      var name = d.part == null ? null : String(d.part);
      if (d.ref === hoverRef) {
        if (name !== hot) setHot(name);
        return;
      }
      if (!clickRefs[d.ref]) return;
      delete clickRefs[d.ref];
      mp.hits.push({ ref: d.ref, name: name });
      select(name);
    }
  });

  function draw() {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    var r = reports[active];
    if (!r) return;
    var parts = r.parts
      .filter(function (p) {
        return p.visible === true;
      })
      .sort(function (a, b) {
        return a.depth - b.depth || a.order - b.order;
      });
    parts.forEach(function (p) {
      var name = String(p.name);
      var o = el("div", "ov" + (name === hot ? " hot" : "") + (name === selected ? " sel" : ""));
      o.dataset.name = name;
      o.style.left = (Number(p.box.x) - r.scroll.x) * S + "px";
      o.style.top = (Number(p.box.y) - r.scroll.y) * S + "px";
      o.style.width = Number(p.box.w) * S + "px";
      o.style.height = Number(p.box.h) * S + "px";
      o.style.zIndex = String(1 + Number(p.depth));
      o.appendChild(el("span", "lbl", String(p.label) + (p.fixed ? " · fixed" : "")));
      layer.appendChild(o);
    });
  }

  function setHot(name) {
    hot = name;
    [].forEach.call(layer.children, function (o) {
      o.classList.toggle("hot", o.dataset.name === name);
    });
    post(active, name ? { type: "highlight", parts: [name] } : { type: "clear" });
  }

  function select(name) {
    selected = name;
    [].forEach.call(layer.children, function (o) {
      o.classList.toggle("sel", o.dataset.name === name);
    });
    renderList();
    selinfo.textContent = name ? name + " (" + active + ", v" + version + ")" : "none";
  }

  // Hover and click resolve through the frame's own hit-test: overlay z-order
  // can't reproduce the page's stacking (a fixed popover over a nested part).
  var hoverRef = 0,
    clickRefs = {};
  function hitAt(e) {
    var r = reports[active];
    if (!r) return 0;
    var b = stage.getBoundingClientRect();
    var ref = ++refN;
    post(active, {
      type: "hit",
      ref: ref,
      x: (e.clientX - b.left) / S + r.scroll.x,
      y: (e.clientY - b.top) / S + r.scroll.y,
    });
    return ref;
  }
  layer.addEventListener("click", function (e) {
    clickRefs[hitAt(e)] = true;
  });
  layer.addEventListener("mousemove", function (e) {
    hoverRef = hitAt(e);
  });
  layer.addEventListener("mouseleave", function () {
    hoverRef = 0;
    setHot(null);
  });
  // Overlays sit above the frame and would swallow scrolling; forward it.
  layer.addEventListener(
    "wheel",
    function (e) {
      e.preventDefault();
      post(active, { type: "scroll", dx: e.deltaX / S, dy: e.deltaY / S });
    },
    { passive: false },
  );

  function renderList() {
    var order = [],
      seen = {};
    STATES.forEach(function (s) {
      var r = reports[s];
      if (!r) return;
      r.parts.forEach(function (p) {
        var n = String(p.name);
        if (!seen[n]) {
          seen[n] = [];
          order.push(n);
        }
        if (seen[n].indexOf(s) < 0) seen[n].push(s);
      });
    });
    while (list.firstChild) list.removeChild(list.firstChild);
    order.forEach(function (n) {
      var row = el("div", n === selected ? "sel" : "");
      row.dataset.name = n;
      row.appendChild(el("b", "", n));
      row.appendChild(el("span", "st", " · in states: " + seen[n].join(", ")));
      row.addEventListener("click", function () {
        select(n);
      });
      list.appendChild(row);
    });
    mp.union = seen;
  }

  STATES.forEach(function (s) {
    var b = el("button", "", s);
    b.dataset.state = s;
    b.addEventListener("click", function () {
      show(s);
    });
    strip.appendChild(b);
  });
  var v2 = el("button", "", "v2");
  v2.id = "v2";
  v2.addEventListener("click", function () {
    mp.v2At = performance.now();
    load(2);
  });
  strip.appendChild(v2);
  load(1);
})();
