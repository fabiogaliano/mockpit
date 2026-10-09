import assert from "node:assert/strict";
import { test } from "node:test";
import {
  historyMetaView,
  hydratedSurfaceView,
  mockDetailView,
  mockSummaryView,
  partsByState,
  variantView,
} from "../server/apiViews.ts";
import { builtinAskCount, type Mock, type Post } from "../server/types.ts";

const mock = (over: Partial<Mock> = {}): Mock => ({
  id: "m1",
  project: "demo",
  slug: "writer",
  title: "Writer",
  kind: "component",
  states: ["Writing", "Lab open"],
  asks: [
    { id: "a", text: "?", scope: "mock", options: [{ id: "x", label: "X" }], at: "t" },
    { id: "b", text: "?", scope: "mock", options: [{ id: "y", label: "Y" }], answer: "y", at: "t" },
  ],
  knobs: {},
  draft: {
    version: 1,
    answers: {},
    mix: {},
    tuned: { secret: 1 },
    comments: [],
    updatedAt: "t",
  },
  sessionId: "s1",
  createdAt: "t",
  updatedAt: "t",
  ...over,
});

const post = (over: Partial<Post> = {}): Post => ({
  id: "p1",
  sessionId: "s1",
  mock: "m1",
  state: "Writing",
  variant: "quiet",
  status: "open",
  title: "Writer",
  surfaces: [{ kind: "html", html: '<h1 data-part="title">T</h1>', id: "h" }],
  createdAt: "t",
  updatedAt: "t2",
  version: 2,
  history: [
    { version: 1, title: "Writer", surfaces: [{ kind: "markdown", markdown: "old" }], at: "t" },
  ],
  slots: [],
  ...over,
});

test("sandboxed surfaces drop their body from list views; native kinds keep their data", () => {
  assert.deepEqual(hydratedSurfaceView({ kind: "html", html: "<p>big</p>", id: "h" }, 0), {
    kind: "html",
    id: "h",
    index: 0,
  });
  assert.deepEqual(hydratedSurfaceView({ kind: "json", data: { a: 1 } }, 1), {
    kind: "json",
    data: { a: 1 },
    index: 1,
  });
});

test("history metadata names the surfaces without carrying their bodies", () => {
  const meta = historyMetaView(post().history[0]);
  assert.deepEqual(meta, { version: 1, title: "Writer", at: "t", surfaceKinds: ["markdown"] });
});

test("a variant's bodies and history rows are opt-in", () => {
  const bare = variantView(post());
  assert.equal("history" in bare, false);
  assert.equal("html" in bare.surfaces[0], false);
  const full = variantView(post(), { body: true, history: true });
  assert.equal((full.surfaces[0] as { html?: string }).html, '<h1 data-part="title">T</h1>');
  assert.deepEqual(
    full.history?.map((h) => h.version),
    [2, 1],
    "newest first, current version included",
  );
});

test("parts are listed once per state, from every variant that is not archived", () => {
  const parts = partsByState(mock(), [
    post({ id: "p1", variant: "quiet" }),
    post({
      id: "p2",
      variant: "dark",
      surfaces: [{ kind: "html", html: '<p data-part="body">b</p>' }],
    }),
    post({
      id: "p3",
      variant: "gone",
      status: "archived",
      surfaces: [{ kind: "html", html: '<p data-part="stale">s</p>' }],
    }),
    post({
      id: "p4",
      state: "Lab open",
      surfaces: [{ kind: "html", html: '<aside data-part="lab">l</aside>' }],
    }),
  ]);
  assert.deepEqual(
    parts.map((s) => [s.state, s.parts.map((p) => p.name)]),
    [
      ["Writing", ["title", "body"]],
      ["Lab open", ["lab"]],
    ],
  );
});

test("a mock summary counts open asks and thumbnails the accepted variant of the first state", () => {
  const summary = mockSummaryView(mock(), [
    post({ id: "p1", variant: "quiet" }),
    post({ id: "p2", variant: "dark", status: "accepted" }),
  ]);
  // One unanswered agent ask, plus the built-in "Which one?" for Writing's two
  // unbound variants.
  assert.equal(summary.open, 2);
  assert.equal(summary.variants, 2);
  assert.equal(summary.stateCount, 2);
  assert.deepEqual(summary.thumbnail, { postId: "p2", surface: 0, version: 2 });
});

test("open counts the built-in Which one? the viewer shows, mock-wide or per state", () => {
  const noAsks = mock({ asks: [] });
  const both = (state: string, variant: string, status: Post["status"] = "open") =>
    post({ id: `${state}-${variant}`, state, variant, status });
  const lined = [
    both("Writing", "quiet"),
    both("Writing", "dark"),
    both("Lab open", "quiet"),
    both("Lab open", "dark"),
  ];
  assert.equal(builtinAskCount(noAsks, lined, "m1"), 1, "same names everywhere: one ask");
  assert.equal(
    builtinAskCount(noAsks, [...lined, both("Lab open", "bold")], "m1"),
    2,
    "names differ: one per state",
  );
  assert.equal(
    builtinAskCount(noAsks, [both("Writing", "quiet"), both("Writing", "dark")], "m1"),
    1,
    "only one state needs it",
  );
  assert.equal(
    builtinAskCount(noAsks, [both("Writing", "quiet"), both("Writing", "dark", "archived")], "m1"),
    0,
    "answered: the loser is archived",
  );
  const bound = mock({
    asks: [
      {
        id: "look",
        text: "?",
        scope: "mock",
        options: [
          { id: "q", label: "Q", variant: "quiet" },
          { id: "d", label: "D", variant: "dark" },
        ],
        at: "t",
      },
    ],
  });
  assert.equal(builtinAskCount(bound, lined, "m1"), 0, "an agent ask binds them");
  assert.equal(builtinAskCount(noAsks, lined, "other"), 0, "other mocks' posts never count");
});

test("a single-state mock counts as one state", () => {
  assert.equal(mockSummaryView(mock({ states: [] }), []).stateCount, 1);
  assert.equal(mockSummaryView(mock({ states: [] }), []).thumbnail, null);
});

test("the agent's mock detail never carries the user's unsent draft", () => {
  const detail = mockDetailView(mock(), [post()], { tuned: { size: 3 } });
  assert.equal("draft" in detail, false);
  assert.deepEqual(detail.tuned, { size: 3 });
  assert.equal(detail.variants.length, 1);
});
