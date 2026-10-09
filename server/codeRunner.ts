// The Node executor for `run`: one worker_thread per run, QuickJS in wasm
// inside it, host calls relayed to the main thread where the flows live.
// Node-only (worker_threads, fs); server/index.ts wires it in.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ExecRequest, ExecResult, Executor, RunError } from "./run.ts";

// The source tree runs codeWorker.ts directly; the published package runs the
// compiled dist/server/codeWorker.js next to this file.
const HERE = fileURLToPath(import.meta.url);
const WORKER = join(dirname(HERE), HERE.endsWith(".ts") ? "codeWorker.ts" : "codeWorker.js");

// @types/node declares the WebAssembly namespace without its values.
const wasm = (
  globalThis as unknown as { WebAssembly: { compile(bytes: Uint8Array): Promise<object> } }
).WebAssembly;

const COVERAGE = process.env.NODE_V8_COVERAGE;

export interface NodeExecutorOptions {
  // How long past a CPU budget the watchdog lets a builtin run before
  // terminate(); QuickJS's interrupt never fires inside one.
  graceMs?: number;
}

export function createNodeExecutor({ graceMs = 500 }: NodeExecutorOptions = {}): Executor {
  // Compiled once per process and posted to each worker.
  let module: Promise<object> | undefined;
  const load = () =>
    (module ??= readFile(fileURLToPath(import.meta.resolve("quickjs-wasi/quickjs.wasm"))).then(
      (bytes) => wasm.compile(bytes),
    ));

  return {
    async run(req: ExecRequest): Promise<ExecResult> {
      const { limits } = req;
      if (req.signal.aborted) return stopped("aborted", "the caller went away");
      const clock = new Float64Array(new SharedArrayBuffer(16));
      const worker = new Worker(WORKER, {
        workerData: {
          module: await load(),
          code: req.code,
          cpuMs: limits.cpuMs,
          memoryBytes: limits.memoryBytes,
          stackBytes: limits.stackBytes,
          clock: clock.buffer,
        },
        // The guest never sees the environment, but the thread needn't hold
        // secrets either. Coverage is the one variable it needs to report.
        env: COVERAGE ? { NODE_V8_COVERAGE: COVERAGE } : {},
        stdout: true,
        stderr: true,
        // A backstop only: the guest heap is wasm linear memory, not V8 old-gen.
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
      return new Promise<ExecResult>((resolve) => {
        let done = false;
        const finish = (result: ExecResult, kill: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(deadline);
          clearInterval(watchdog);
          req.signal.removeEventListener("abort", onAbort);
          if (kill) void worker.terminate();
          resolve(result);
        };
        const onAbort = () => finish(stopped("aborted", "the caller went away"), true);
        req.signal.addEventListener("abort", onAbort, { once: true });
        const deadline = setTimeout(
          () =>
            finish(
              stopped("timeout", `wall deadline of ${limits.deadlineMs / 1000} s reached`),
              true,
            ),
          limits.deadlineMs,
        );
        // A builtin (sort, repeat, a regex) can run long without reaching the
        // interrupt handler; only terminate() stops it.
        const watchdog = setInterval(
          () => {
            const start = clock[0];
            if (start && clock[1] + (Date.now() - start) > limits.cpuMs + graceMs) {
              finish(stopped("limit", `CPU budget of ${limits.cpuMs} ms exhausted`), true);
            }
          },
          Math.max(20, Math.min(250, graceMs / 2)),
        );
        worker.on("message", (m: any) => {
          if (done) return;
          if (m.t === "print") return req.print(String(m.line));
          if (m.t === "done") return finish(m.outcome as ExecResult, false);
          req.call(m.name, m.args).then(
            (json) => done || worker.postMessage({ id: m.id, ok: true, json }),
            (err: unknown) =>
              done ||
              worker.postMessage({
                id: m.id,
                ok: false,
                message: err instanceof Error ? err.message : String(err),
              }),
          );
        });
        worker.on("error", (err: Error) =>
          finish(stopped("limit", `sandbox stopped: ${err.message}`), true),
        );
        worker.on("exit", () => finish(stopped("limit", "sandbox exited"), false));
      });
    },
  };
}

const stopped = (kind: RunError["kind"], message: string): ExecResult => ({
  ok: false,
  error: { kind, message },
});
