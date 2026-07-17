import fs from "node:fs";
import path from "node:path";
import { resolveAppPath } from "../utils/appRoot";

export type SpriteDirection = "south" | "east" | "north" | "west";

/**
 * The frame inventory of a character's sprite assets, derived once from disk so the
 * client can fetch exactly the frames that exist in parallel instead of serially
 * probing `0.png, 1.png, …` until a 404. `walk` carries the per-direction frame
 * count; `working` is a single directionless run; `rotations` lists the still-pose
 * directions that have a PNG.
 */
export interface CharacterSpriteManifest {
  rotations: SpriteDirection[];
  animations: {
    walk: Partial<Record<SpriteDirection, number>>;
    working: number;
  };
}

const spriteDirections: SpriteDirection[] = ["south", "east", "north", "west"];
const manifestCache = new Map<string, CharacterSpriteManifest | null>();

/**
 * Cached per-process manifest lookup for the route handler. Character assets never
 * change while the server runs, so the first read (including a negative result for an
 * unknown character) is memoised for the process lifetime.
 */
export function getCharacterManifest(characterType: string): CharacterSpriteManifest | null {
  const cached = manifestCache.get(characterType);
  if (cached !== undefined) {
    return cached;
  }

  const manifest = readCharacterManifest(characterType);
  manifestCache.set(characterType, manifest);
  return manifest;
}

export function readCharacterManifest(
  characterType: string,
  assetsRoot = resolveAppPath("assets", "characters")
): CharacterSpriteManifest | null {
  const characterDir = resolveCharacterDir(assetsRoot, characterType);
  if (!characterDir) {
    return null;
  }

  try {
    if (!fs.statSync(characterDir).isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }

  const rotations = spriteDirections.filter((direction) =>
    fs.existsSync(path.join(characterDir, "rotations", `${direction}.png`))
  );

  const walk: Partial<Record<SpriteDirection, number>> = {};
  for (const direction of spriteDirections) {
    const frameCount = countContiguousFrames(path.join(characterDir, "animations", "walk", direction));
    if (frameCount > 0) {
      walk[direction] = frameCount;
    }
  }

  const working = countContiguousFrames(path.join(characterDir, "animations", "working"));

  return {
    rotations,
    animations: {
      walk,
      working
    }
  };
}

/**
 * The length of the contiguous `0.png, 1.png, …` run in a directory. This matches the
 * client's historical loop, which stopped at the first missing index, so a numbering
 * gap truncates the animation exactly as before.
 */
function countContiguousFrames(frameDir: string): number {
  let entries: string[];
  try {
    entries = fs.readdirSync(frameDir);
  } catch {
    return 0;
  }

  const present = new Set(entries);
  let frameCount = 0;
  while (present.has(`${frameCount}.png`)) {
    frameCount += 1;
  }

  return frameCount;
}

function resolveCharacterDir(assetsRoot: string, characterType: string): string | null {
  const trimmedType = characterType.trim();
  if (trimmedType.length === 0) {
    return null;
  }

  const absoluteAssetsRoot = path.resolve(assetsRoot);
  const absoluteCharacterDir = path.resolve(absoluteAssetsRoot, trimmedType);
  const expectedPrefix = `${absoluteAssetsRoot}${path.sep}`;

  if (!absoluteCharacterDir.startsWith(expectedPrefix)) {
    return null;
  }

  return absoluteCharacterDir;
}
