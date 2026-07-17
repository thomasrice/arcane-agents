import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCharacterManifest } from "./characterManifest";

let assetsRoot: string;

beforeEach(() => {
  assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arcane-agents-manifest-"));
});

afterEach(() => {
  fs.rmSync(assetsRoot, { recursive: true, force: true });
});

function writeFrame(relativePath: string): void {
  const absolutePath = path.join(assetsRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, "");
}

describe("readCharacterManifest", () => {
  it("derives rotation directions and per-animation frame counts from disk", () => {
    for (const direction of ["south", "east", "north"]) {
      writeFrame(`hero/rotations/${direction}.png`);
    }
    for (let frame = 0; frame < 8; frame += 1) {
      writeFrame(`hero/animations/walk/south/${frame}.png`);
    }
    for (let frame = 0; frame < 4; frame += 1) {
      writeFrame(`hero/animations/walk/east/${frame}.png`);
    }
    for (let frame = 0; frame < 16; frame += 1) {
      writeFrame(`hero/animations/working/${frame}.png`);
    }

    const manifest = readCharacterManifest("hero", assetsRoot);

    expect(manifest).toEqual({
      rotations: ["south", "east", "north"],
      animations: {
        walk: { south: 8, east: 4 },
        working: 16
      }
    });
  });

  it("stops counting at the first missing frame index (contiguous run from 0)", () => {
    writeFrame("hero/animations/working/0.png");
    writeFrame("hero/animations/working/1.png");
    // Gap at 2.png, so 3.png must not be counted.
    writeFrame("hero/animations/working/3.png");

    const manifest = readCharacterManifest("hero", assetsRoot);

    expect(manifest?.animations.working).toBe(2);
  });

  it("returns null for an unknown character directory", () => {
    expect(readCharacterManifest("missing", assetsRoot)).toBeNull();
  });

  it("rejects path-traversal character names", () => {
    writeFrame("hero/rotations/south.png");

    expect(readCharacterManifest("../hero", assetsRoot)).toBeNull();
    expect(readCharacterManifest("..", assetsRoot)).toBeNull();
    expect(readCharacterManifest("", assetsRoot)).toBeNull();
  });
});
