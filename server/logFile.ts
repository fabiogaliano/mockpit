import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { LogSink } from "./eventLog.ts";

// One file plus one rotated predecessor caps the log at twice this, so leaving
// it on by default costs a bounded slice of disk.
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

// Appends JSONL to `path`, rolling it to `<path>.1` past `maxBytes`. Writes are
// synchronous so lines never interleave and a crash loses nothing already
// answered; the loop's call rate makes that cost negligible.
export function createFileLog(path: string, maxBytes = DEFAULT_MAX_BYTES): LogSink {
  mkdirSync(dirname(path), { recursive: true });
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    // No file yet.
  }
  return (entry) => {
    const line = `${JSON.stringify(entry)}\n`;
    if (size > 0 && size + line.length > maxBytes) {
      renameSync(path, `${path}.1`);
      size = 0;
    }
    appendFileSync(path, line);
    size += Buffer.byteLength(line);
  };
}
