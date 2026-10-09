import { describe, expect, it } from "vitest";
import { filesOf, fitWithin, hasFiles, MAX_BYTES, rejectReason } from "../src/attach.ts";

const transfer = (files: File[], types = ["Files"]) =>
  ({
    types,
    files,
    items: files.map((f) => ({ kind: "file", getAsFile: () => f })),
  }) as unknown as DataTransfer;

describe("attach", () => {
  it("caps the long edge and keeps the aspect", () => {
    expect(fitWithin(4096, 1024)).toEqual({ w: 2048, h: 512 });
    expect(fitWithin(1000, 3000, 1500)).toEqual({ w: 500, h: 1500 });
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
  });

  it("refuses what a model can't read, saying why", () => {
    expect(rejectReason({ name: "a.png", type: "image/png", size: 10 })).toBeNull();
    expect(rejectReason({ name: "a.svg", type: "image/svg+xml", size: 10 })).toMatch(/a\.svg/);
    expect(rejectReason({ name: "a.heic", type: "image/heic", size: 10 })).toMatch(/PNG/);
    expect(rejectReason({ name: "a.gif", type: "image/gif", size: MAX_BYTES + 1 })).toMatch(/MB/);
    expect(rejectReason({ name: "a.jpg", type: "image/jpeg", size: 50 * 1024 * 1024 })).toMatch(
      /too large/,
    );
  });

  it("names pasted screenshots and keeps dropped names", () => {
    const shot = new File(["x"], "image.png", { type: "image/png" });
    const photo = new File(["y"], "photo.jpg", { type: "image/jpeg" });
    expect(filesOf(transfer([shot, shot]), "paste").map((f) => f.name)).toEqual([
      "pasted-1.png",
      "pasted-2.png",
    ]);
    expect(filesOf(transfer([photo]), "drop").map((f) => f.name)).toEqual(["photo.jpg"]);
    expect(filesOf(null, "paste")).toEqual([]);
  });

  it("knows a drag that carries files from one that carries text", () => {
    expect(hasFiles(transfer([]))).toBe(true);
    expect(hasFiles(transfer([], ["text/plain"]))).toBe(false);
    expect(hasFiles(null)).toBe(false);
  });
});
