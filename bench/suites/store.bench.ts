// Store benchmarks: the read/write paths every request sits on top of, on the
// SQLite store in memory and on disk.
//
// Two methodology notes worth knowing before reading the numbers:
//
//   - Steady state, not first insert. Every backend is benchmarked against a
//     pre-built workspace, so the numbers describe a store people have actually
//     been using, not an empty table.
//   - Writes use a FIXED iteration count, so the accumulated growth is
//     identical on every machine.
//
// The scaling probe at the end measures create cost at three workspace sizes,
// so a write that pays for every existing post shows up as a slope.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqlStore } from "../../server/sqlStore.ts";
import { createSqliteStorage } from "../../server/sqliteStorage.ts";
import type { Store } from "../../server/types.ts";
import {
  createBenchPost,
  buildWorkspace,
  surfaceOfKind,
  TYPICAL,
  type WorkspaceShape,
} from "../fixtures.ts";
import { memory, retainedHeap, type Suite, type SuiteContext, time } from "../harness.ts";

const tmpPath = (name: string) => join(mkdtempSync(join(tmpdir(), "mockpit-bench-")), name);

/** Ops per write benchmark: enough samples for a stable median. */
const WRITE_ITERATIONS = 40;

/**
 * Shape used for the memory comparison. Deliberately smaller than the API
 * suite's HEAVY, to keep the suite's wall time down. Same shape for every
 * backend, so the heap numbers are comparable to each other.
 */
const MEMORY_SHAPE: WorkspaceShape = {
  sessions: 12,
  postsPerSession: 25,
  updatesPerPost: 1,
  commentsPerSession: 15,
  surfacesPerPost: 2,
  size: "small",
};

type BackendId = "sqlite-memory" | "sqlite-file";

interface Backend {
  id: BackendId;
  label: string;
  create: () => Store;
  /** Reopen the same underlying storage — measures cold-load cost. */
  reopen?: (store: Store) => Store;
}

const BACKENDS: Backend[] = [
  {
    id: "sqlite-memory",
    label: "SqlStore(:memory:)",
    create: () => new SqlStore(createSqliteStorage()),
  },
  {
    id: "sqlite-file",
    label: "SqlStore(file)",
    create: () => {
      const path = tmpPath("bench.db");
      const store = new SqlStore(createSqliteStorage(path)) as SqlStore & { __path: string };
      store.__path = path;
      return store;
    },
    reopen: (store) =>
      new SqlStore(createSqliteStorage((store as SqlStore & { __path: string }).__path)),
  },
];

async function benchBackend(ctx: SuiteContext, backend: Backend) {
  const store = backend.create();
  const built = await buildWorkspace(store, TYPICAL);
  const label = backend.label;
  const scale = `${label}, ${built.totalPosts} posts / ${built.totalComments} comments`;

  // --- reads -------------------------------------------------------------
  await ctx.time(`${backend.id}/getPost`, () => store.getPost(built.postIds[0]), { note: scale });

  await ctx.time(
    `${backend.id}/listPosts(session)`,
    () => store.listPosts({ sessionId: built.busiestSessionId }),
    {
      note: `${label}, ${TYPICAL.postsPerSession} posts in session`,
    },
  );

  // The whole-workspace read. Both stores hydrate every post's surfaces AND its
  // history here, so this is the one most likely to dominate a large workspace.
  await ctx.time(`${backend.id}/listPosts(all)`, () => store.listPosts(), { note: scale });

  await ctx.time(`${backend.id}/listMocks`, () => store.listMocks(), { note: scale });

  await ctx.time(
    `${backend.id}/listComments(session)`,
    () => store.listComments({ sessionId: built.busiestSessionId }),
    { note: scale },
  );

  await ctx.time(`${backend.id}/listSessions`, () => store.listSessions(), {
    note: `${label}, ${TYPICAL.sessions} sessions`,
  });

  // isAssetReferenced scans every post's surfaces + history looking for the id.
  // It runs on the asset-serving path, so its cost is proportional to workspace
  // size on every image load — worth watching explicitly.
  await ctx.time(
    `${backend.id}/isAssetReferenced(miss)`,
    () => store.isAssetReferenced("asset-that-does-not-exist"),
    { note: scale },
  );

  // --- writes ------------------------------------------------------------
  const surface = surfaceOfKind("markdown", "small");
  await ctx.time(
    `${backend.id}/createPost`,
    () =>
      createBenchPost(store, {
        sessionId: built.busiestSessionId,
        title: "bench post",
        surfaces: [surface] as never,
      }),
    { note: scale, iterations: WRITE_ITERATIONS },
  );

  const target = built.postIds[Math.floor(built.postIds.length / 2)];
  let rev = 0;
  await ctx.time(
    `${backend.id}/updatePost`,
    () => store.updatePost(target, { title: `rev ${rev++}` }),
    { note: `${label}, history at cap`, iterations: WRITE_ITERATIONS },
  );

  await ctx.time(
    `${backend.id}/createComment`,
    () =>
      store.createComment({
        sessionId: built.busiestSessionId,
        author: "user",
        text: "bench comment",
      }),
    { note: scale, iterations: WRITE_ITERATIONS },
  );

  // --- cold open ---------------------------------------------------------
  // What a server restart pays before serving its first request: SQLite opens a
  // handle and runs its migration probes.
  if (backend.reopen) {
    const reopen = backend.reopen;
    await ctx.time(
      `${backend.id}/cold open + first read`,
      async () => {
        const fresh = reopen(store);
        await fresh.listMocks();
      },
      { note: scale, minSamples: 7, minMs: 300 },
    );
  }
}

/**
 * How create cost grows with workspace size. Reported per backend at three
 * sizes: a flat line means the write cost is independent of what's already
 * stored, a rising one means every existing post is being paid for again.
 */
async function benchWriteScaling(ctx: SuiteContext, backend: Backend) {
  for (const existing of [50, 200, 500]) {
    const name = `${backend.id}/createPost @ ${existing} posts`;
    if (!ctx.matches(name)) continue;
    const store = backend.create();
    const session = await store.createSession({ agent: "bench", title: "scaling" });
    const surface = surfaceOfKind("markdown", "small");
    for (let i = 0; i < existing; i++) {
      await createBenchPost(store, {
        sessionId: session.id,
        title: `seed ${i}`,
        surfaces: [surface] as never,
      });
    }
    ctx.add(
      await time(
        "store",
        name,
        () =>
          createBenchPost(store, {
            sessionId: session.id,
            title: "probe",
            surfaces: [surface] as never,
          }),
        { note: `${backend.label}, workspace already holds ${existing} posts`, iterations: 20 },
      ),
    );
  }
}

export const storeSuite: Suite = {
  name: "store",
  description: "Store read/write paths per backend, plus how write cost scales with workspace size",
  async run(ctx) {
    for (const backend of BACKENDS) await benchBackend(ctx, backend);
    for (const backend of BACKENDS) await benchWriteScaling(ctx, backend);

    // --- memory ------------------------------------------------------------
    // How much heap a loaded workspace costs. This is the direct answer to "why
    // does the mockpit server hold so much memory?" — SQLite should not keep the
    // workspace resident.
    for (const backend of BACKENDS) {
      const loadedName = `${backend.id}/heap for loaded workspace`;
      const listName = `${backend.id}/heap for listPosts(all) result`;
      if (!ctx.matches(loadedName) && !ctx.matches(listName)) continue;

      const shapeNote = `${backend.label}, ${MEMORY_SHAPE.sessions}×${MEMORY_SHAPE.postsPerSession} posts`;
      const { retained, value: store } = await retainedHeap(async () => {
        const fresh = backend.create();
        await buildWorkspace(fresh, MEMORY_SHAPE);
        return fresh;
      });
      ctx.add(memory("store", loadedName, retained, shapeNote));

      // A whole-workspace read materializes every post as JS objects. This is the
      // transient cost of any route that fans out over the workspace.
      const listed = await retainedHeap(() => store.listPosts());
      ctx.add(
        memory(
          "store",
          listName,
          listed.retained,
          `${shapeNote}, ${listed.value.length} materialized`,
        ),
      );
    }
  },
};
