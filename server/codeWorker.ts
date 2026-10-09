// worker_thread entry for one run (Node only). QuickJS runs inside wasm here;
// the guest reaches the host only through two functions the prelude captures,
// and everything crossing them is a string, so no guest getter or proxy ever
// runs host-side. The parent owns the wall deadline and can terminate() this
// thread; the CPU and memory checks below are the soft stops in front of that.
import { parentPort, workerData } from "node:worker_threads";
import { JSException, QuickJS } from "quickjs-wasi";

// @types/node lacks the WebAssembly value types; these are the parts used here.
interface WasmMemory {
  buffer: ArrayBuffer;
}

interface Input {
  module: object;
  code: string;
  cpuMs: number;
  memoryBytes: number;
  stackBytes: number;
  // [burst start (epoch ms, 0 when idle), cpu used (ms)], read by the parent's watchdog.
  clock: SharedArrayBuffer;
}

type Kind = "script" | "timeout" | "limit" | "aborted";
type Outcome =
  | { ok: true; json?: string }
  | { ok: false; error: { kind: Kind; message: string; line?: number; column?: number } };

const input = workerData as Input;
const port = parentPort!;
const clock = new Float64Array(input.clock);

// The call site is captured synchronously: after an await QuickJS keeps no
// caller frames, so a host rejection would otherwise carry no line.
const PRELUDE = `(function (call, out) {
  const fmt = (v) => typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
  const print = (...a) => out(a.map(fmt).join(" "));
  const fn = (name) => (...args) => {
    const site = new Error();
    let json;
    try { json = JSON.stringify(args); } catch (e) { return Promise.reject(e); }
    return call(name, json === undefined ? "[]" : json).then(JSON.parse, (e) => {
      const err = new Error(e.message);
      err.stack = site.stack.split("\\n").slice(1).join("\\n");
      throw err;
    });
  };
  globalThis.mockpit = Object.freeze({
    guide: fn("guide"), list: fn("list"), get: fn("get"), publish: fn("publish"),
    revise: fn("revise"), ask: fn("ask"), wait: fn("wait"), reply: fn("reply"),
    export: fn("export"),
    surfaces: Object.freeze({ add: fn("surfaces.add"), edit: fn("surfaces.edit"),
      remove: fn("surfaces.remove"), reorder: fn("surfaces.reorder") }),
  });
  globalThis.print = print;
  globalThis.console = Object.freeze({ log: print, info: print, warn: print, error: print });
  const fail = (e) => ({ ok: false, name: String(e && e.name), message: String(e && e.message !== undefined ? e.message : e), stack: String(e && e.stack || "") });
  // A value JSON can't encode (a BigInt, a throwing toJSON) fails the script.
  return (f) => f().then((v) => {
    try { return { ok: true, json: v === undefined ? undefined : JSON.stringify(v) }; } catch (e) { return fail(e); }
  }, fail);
})`;

const TS_HINT =
  /^\s*(interface|type\s+\w+\s*=|enum\s)|\b(const|let|var)\s+\w+\s*:\s*\w|\)\s*:\s*(string|number|boolean|void|Promise)\b|\bas\s+(const|string|number|any|unknown)\b/m;

// The wrapper opens on line 1 so stack positions match the script as written;
// only line 1's columns shift by the wrapper's length.
const WRAP = "(async () => {";

function position(stack: string, message: string) {
  const m = /run\.js:(\d+)(?::(\d+))?/.exec(`${stack}\n${message}`);
  if (!m) return {};
  const line = Number(m[1]);
  if (!m[2]) return { line };
  const column = Number(m[2]);
  return { line, column: line === 1 ? Math.max(1, column - WRAP.length) : column };
}

function scriptError(name: string, message: string, stack: string, code: string): Outcome {
  if (/out of memory/i.test(message)) {
    return { ok: false, error: { kind: "limit", message: "memory limit reached" } };
  }
  let text = name && name !== "Error" && name !== "undefined" ? `${name}: ${message}` : message;
  if (name === "SyntaxError" && TS_HINT.test(code)) {
    text += " (this looks like TypeScript; write plain JavaScript)";
  }
  return { ok: false, error: { kind: "script", message: text, ...position(stack, message) } };
}

// Discard QuickJS's own stdout/stderr: the default shim would write to the
// host's process.stdout.
const discardStdio = (memory: WasmMemory) => ({
  fd_write(_fd: number, iovs: number, len: number, nwritten: number) {
    const view = new DataView(memory.buffer);
    let n = 0;
    for (let i = 0; i < len; i++) n += view.getUint32(iovs + i * 8 + 4, true);
    view.setUint32(nwritten, n, true);
    return 0;
  },
});

const pending = new Map<number, { resolve(json: string): void; reject(err: Error): void }>();
let nextId = 1;
let wake = () => {};
port.on("message", (m: { id: number; ok: boolean; json?: string; message?: string }) => {
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.ok) p.resolve(m.json ?? "null");
  else p.reject(new Error(m.message));
  wake();
});

async function main(): Promise<Outcome> {
  let stop: { kind: Kind; message: string } | null = null;
  let memory: WasmMemory | undefined;
  const burst = <T>(fn: () => T): T => {
    clock[0] = Date.now();
    try {
      return fn();
    } finally {
      clock[1] += Date.now() - clock[0];
      clock[0] = 0;
    }
  };
  const vm = await QuickJS.create({
    wasm: input.module as never,
    memoryLimit: input.memoryBytes,
    maxStackSize: input.stackBytes,
    wasi: (m: WasmMemory) => {
      memory = m;
      return discardStdio(m);
    },
    // Called about every 10k bytecode ticks, never inside a long builtin: the
    // parent's watchdog covers that case with terminate().
    interruptHandler: () => {
      if (stop) return true;
      if (clock[0] && clock[1] + (Date.now() - clock[0]) > input.cpuMs) {
        stop = { kind: "limit", message: `CPU budget of ${input.cpuMs} ms exhausted` };
      } else if (memory && memory.buffer.byteLength >= input.memoryBytes) {
        // Linear memory never shrinks, so reaching the cap means the guest hit
        // the limit; stop rather than let a catch-and-retry loop spin in GC.
        stop = { kind: "limit", message: "memory limit reached" };
      }
      return stop !== null;
    },
  });
  try {
    const call = vm.newFunction("__call", (nameH, argsH) => {
      const name = nameH.toString();
      const args = argsH.toString();
      const deferred = vm.newPromise();
      const id = nextId++;
      pending.set(id, {
        resolve: (json) => deferred.resolve(vm.newString(json)),
        reject: (err) => deferred.reject(vm.newError(err.message)),
      });
      port.postMessage({ t: "call", id, name, args });
      return deferred.handle;
    });
    const out = vm.newFunction("__out", (s) => {
      port.postMessage({ t: "print", line: s.toString() });
      return vm.undefined;
    });
    const runner = vm.callFunction(vm.evalCode(PRELUDE, "prelude.js"), vm.undefined, call, out);
    let fnH;
    try {
      fnH = burst(() => vm.evalCode(`${WRAP}${input.code}\n})`, "run.js"));
    } catch (e) {
      if (e instanceof JSException)
        return scriptError(e.name, e.message, e.stack ?? "", input.code);
      throw e;
    }
    const settled = burst(() => vm.callFunction(runner, vm.undefined, fnH));
    for (;;) {
      burst(() => vm.executePendingJobs());
      if (stop) return { ok: false, error: stop };
      if (settled.promiseState !== 0) break;
      if (pending.size === 0) {
        return {
          ok: false,
          error: { kind: "script", message: "the script awaits something that can never settle" },
        };
      }
      await new Promise<void>((resolve) => (wake = resolve));
    }
    // The runner settles every outcome as a value; it never rejects.
    const r = await vm.resolvePromise(settled);
    const result = vm.dump("value" in r ? r.value : r.error) as {
      ok: boolean;
      json?: string;
      name?: string;
      message?: string;
      stack?: string;
    };
    if (result.ok) return { ok: true, json: result.json };
    return scriptError(result.name ?? "", result.message ?? "", result.stack ?? "", input.code);
  } catch (e) {
    if (stop) return { ok: false, error: stop };
    if (e instanceof JSException) return scriptError(e.name, e.message, e.stack ?? "", input.code);
    // A trap (stack overflow on the host side, an import that threw) leaves
    // the VM unusable; it is discarded with this thread.
    return {
      ok: false,
      error: { kind: "limit", message: `sandbox stopped: ${e instanceof Error ? e.message : e}` },
    };
  } finally {
    try {
      vm.dispose();
    } catch {
      // a trapped VM may refuse to dispose; the thread exits anyway
    }
  }
}

port.postMessage({ t: "done", outcome: await main() });
port.close();
