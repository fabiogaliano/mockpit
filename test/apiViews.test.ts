import assert from "node:assert/strict";
import { test } from "node:test";
import {
  postDetailView,
  recentHomeSurfaceView,
  recentSurfacePreviewView,
} from "../server/apiViews.ts";
import type { Post, PostVersion, Surface } from "../server/types.ts";

// The recent feed ships one row per post for every post on the workspace, so an
// agent that pastes a 2 MB file into a surface must not make that feed 2 MB
// larger. These pin the cap — and, just as importantly, that an under-cap
// surface is passed through untouched (same object, no `truncated` flag).

const CAP = 8_000;
const long = "x".repeat(CAP + 10);

const preview = (surface: Surface) => recentSurfacePreviewView(surface, 0) as Record<string, any>;

test("an oversized body of any text-carrying kind is capped and flagged", () => {
  const cases: Array<[Surface, string]> = [
    [{ kind: "html", html: long }, "html"],
    [{ kind: "markdown", markdown: long }, "markdown"],
    [{ kind: "mermaid", mermaid: long }, "mermaid"],
    [{ kind: "code", code: long }, "code"],
    [{ kind: "terminal", text: long }, "text"],
  ];
  for (const [surface, field] of cases) {
    const view = preview(surface);
    assert.equal(view.truncated, true, `${surface.kind} is flagged`);
    assert.equal(view[field].length, CAP);
    assert.equal(view.index, 0);
  }
});

test("a surface under the cap is returned as-is, with no truncated flag", () => {
  for (const surface of [
    { kind: "html", html: "<p>hi</p>" },
    { kind: "markdown", markdown: "# hi" },
    { kind: "mermaid", mermaid: "graph TD;" },
    { kind: "code", code: "const a = 1;" },
    { kind: "terminal", text: "ok" },
    { kind: "diff", patch: "--- a\n+++ b\n" },
    { kind: "image", assetId: "a1", alt: "shot", caption: "fig 1" },
    { kind: "json", data: { ok: true } },
    { kind: "trace", title: "run", steps: [{ label: "step", kind: "tool", detail: "d", ts: "t" }] },
  ] as Surface[]) {
    const view = preview(surface);
    assert.equal(view.truncated, undefined, `${surface.kind} is untouched`);
  }
});

test("a diff caps the patch and every field of every file pair", () => {
  const byPatch = preview({ kind: "diff", patch: long });
  assert.equal(byPatch.truncated, true);
  assert.equal(byPatch.patch.length, CAP);

  const byFile = preview({
    kind: "diff",
    files: [{ filename: "a.ts", before: long, after: "after", language: "ts" }],
  });
  assert.equal(byFile.truncated, true);
  assert.equal(byFile.files[0].before.length, CAP);
  assert.equal(byFile.files[0].after, "after");
  assert.equal(byFile.files[0].language, "ts", "a short language id survives");

  // a hostile filename/language is capped too — they are agent-authored strings
  const hostile = preview({
    kind: "diff",
    files: [{ filename: long, before: "b", after: "a", language: long }],
  });
  assert.equal(hostile.files[0].filename.length, CAP);
  assert.equal(hostile.files[0].language.length, CAP);
});

test("image alt/caption and json data are capped", () => {
  const image = preview({ kind: "image", assetId: "a1", alt: long, caption: "short" });
  assert.equal(image.truncated, true);
  assert.equal(image.alt.length, CAP);
  assert.equal(image.caption, "short");
  assert.equal(
    preview({ kind: "image", assetId: "a1", caption: long }).caption.length,
    CAP,
    "a caption alone also truncates",
  );

  const json = preview({ kind: "json", data: { blob: long } });
  assert.equal(json.truncated, true);
  assert.equal(typeof json.data, "string", "an oversized tree degrades to capped text");
  assert.equal(json.data.length, CAP);
});

test("a trace caps step text and stops at the preview limit", () => {
  const long_step = preview({
    kind: "trace",
    title: long,
    steps: [{ label: long, kind: long, detail: long, ts: long }],
  });
  assert.equal(long_step.truncated, true);
  assert.equal(long_step.title.length, CAP);
  assert.equal(long_step.steps[0].label.length, CAP);
  assert.equal(long_step.steps[0].detail.length, CAP);

  const many = preview({
    kind: "trace",
    steps: Array.from({ length: 40 }, (_, i) => ({ label: `step ${i}` })),
  });
  assert.equal(many.truncated, true);
  assert.equal(many.steps.length, 25, "the rest is fetched from the post detail");
});

test("Home previews keep image and json inline and reduce everything else to a ref", () => {
  const image = recentHomeSurfaceView({ kind: "image", assetId: "a1" }, 0) as Record<string, any>;
  assert.equal(image.assetId, "a1");
  const html = recentHomeSurfaceView({ kind: "html", html: "<p>hi</p>" }, 2) as Record<string, any>;
  assert.deepEqual(html, { id: undefined, kind: "html", index: 2 });
});

// A 20-version post used to ship every surface of every version on the read
// agents make after every compaction; the default is metadata now.
const version = (over: Partial<PostVersion> = {}): PostVersion => ({
  version: 1,
  title: "v1",
  at: "2026-09-15T00:00:00.000Z",
  surfaces: [
    { kind: "html", html: "<p>a</p>" },
    { kind: "json", data: 1 },
  ],
  ...over,
});

const post = (history: PostVersion[]): Post =>
  ({
    id: "p1",
    sessionId: "s1",
    title: "t",
    surfaces: [],
    history,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    version: 2,
  }) as unknown as Post;

test("history metadata names the surfaces without carrying their bodies", () => {
  const [meta] = postDetailView(post([version({ from: 0, prompt: "tighter", author: "user" })]))
    .history as any[];
  assert.deepEqual(meta, {
    version: 1,
    title: "v1",
    at: "2026-09-15T00:00:00.000Z",
    from: 0,
    prompt: "tighter",
    author: "user",
    surfaceCount: 2,
    surfaceKinds: ["html", "json"],
  });

  // absent provenance stays absent, so the shape round-trips byte-identically
  const [bare] = postDetailView(post([version()])).history as any[];
  assert.deepEqual(Object.keys(bare), ["version", "title", "at", "surfaceCount", "surfaceKinds"]);

  const [full] = postDetailView(post([version()]), { history: "full" }).history as any[];
  assert.equal(full.surfaces.length, 2, "history: full restores the legacy bodies");
  assert.equal(full.surfaceCount, undefined);
});
