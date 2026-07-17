import { useEffect, useMemo, useRef, useState } from "react";

export type SpriteDirection = "south" | "east" | "north" | "west";

export interface CharacterSpriteSet {
  rotations: Partial<Record<SpriteDirection, HTMLImageElement>>;
  animations: {
    walk: Partial<Record<SpriteDirection, HTMLImageElement[]>>;
    working: HTMLImageElement[];
  };
  hasSprites: boolean;
}

interface SpriteFrameOptions {
  direction: SpriteDirection;
  state: "idle" | "walking" | "working";
  frameIndex: number;
}

/** Mirror of the server's `CharacterSpriteManifest` (see server/assets/characterManifest.ts). */
interface CharacterSpriteManifest {
  rotations: SpriteDirection[];
  animations: {
    walk: Partial<Record<SpriteDirection, number>>;
    working: number;
  };
}

const directions: SpriteDirection[] = ["south", "east", "north", "west"];
const imageLoadCache = new Map<string, Promise<HTMLImageElement | null>>();
const targetWalkCycleFrames = 8;

export function useCharacterSpriteLibrary(characterTypes: string[]): Partial<Record<string, CharacterSpriteSet>> {
  const normalizedTypes = useMemo(
    () =>
      Array.from(
        new Set(
          characterTypes
            .map((type) => type.trim().toLowerCase())
            .filter((type) => type.length > 0)
        )
      ).sort(),
    [characterTypes]
  );

  const [library, setLibrary] = useState<Partial<Record<string, CharacterSpriteSet>>>({});
  const loadingRef = useRef(new Set<string>());

  useEffect(() => {
    for (const characterType of normalizedTypes) {
      if (library[characterType] || loadingRef.current.has(characterType)) {
        continue;
      }

      loadingRef.current.add(characterType);
      void loadCharacterSpriteSet(characterType)
        .then((spriteSet) => {
          setLibrary((current) => ({
            ...current,
            [characterType]: spriteSet
          }));
        })
        .finally(() => {
          loadingRef.current.delete(characterType);
        });
    }
  }, [library, normalizedTypes]);

  return library;
}

export function getSpriteFrame(spriteSet: CharacterSpriteSet | undefined, options: SpriteFrameOptions): HTMLImageElement | undefined {
  if (!spriteSet || !spriteSet.hasSprites) {
    return undefined;
  }

  if (options.state === "working" && spriteSet.animations.working.length > 0) {
    return spriteSet.animations.working[options.frameIndex % spriteSet.animations.working.length];
  }

  const resolvedDirection = pickDirection(spriteSet, options.direction, options.state === "walking");
  if (options.state === "walking") {
    const walkFrames = spriteSet.animations.walk[resolvedDirection] ?? spriteSet.animations.walk.south;
    if (walkFrames && walkFrames.length > 0) {
      return walkFrames[resolveWalkFrameIndex(options.frameIndex, walkFrames.length)];
    }
  }

  return spriteSet.rotations[resolvedDirection] ?? spriteSet.rotations.south ?? spriteSet.animations.working[0];
}

async function loadCharacterSpriteSet(characterType: string): Promise<CharacterSpriteSet> {
  const baseUrl = `/api/assets/characters/${encodeURIComponent(characterType)}`;
  const manifest = await fetchCharacterManifest(baseUrl);
  if (!manifest) {
    // A missing or failed manifest is treated exactly like absent character assets:
    // an empty sprite set, so the map falls back to the coloured-circle avatar.
    return emptySpriteSet();
  }

  const rotationEntries = await Promise.all(
    manifest.rotations.map(async (direction) => {
      const image = await loadImage(`${baseUrl}/rotations/${direction}.png`);
      return [direction, image] as const;
    })
  );

  const walkEntries = await Promise.all(
    directions.map(async (direction) => {
      const frames = await loadAnimationFrames(`${baseUrl}/animations/walk/${direction}`, manifest.animations.walk[direction] ?? 0);
      return [direction, frames] as const;
    })
  );

  const working = await loadAnimationFrames(`${baseUrl}/animations/working`, manifest.animations.working);

  const rotations = Object.fromEntries(rotationEntries.filter(([, image]) => Boolean(image))) as Partial<
    Record<SpriteDirection, HTMLImageElement>
  >;

  const walk = Object.fromEntries(walkEntries.filter(([, frames]) => frames.length > 0)) as Partial<
    Record<SpriteDirection, HTMLImageElement[]>
  >;

  const hasSprites =
    Object.values(rotations).some((image) => Boolean(image)) ||
    Object.values(walk).some((frames) => Array.isArray(frames) && frames.length > 0) ||
    working.length > 0;

  return {
    rotations,
    animations: {
      walk,
      working
    },
    hasSprites
  };
}

async function fetchCharacterManifest(baseUrl: string): Promise<CharacterSpriteManifest | null> {
  try {
    const response = await fetch(`${baseUrl}/manifest`);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as CharacterSpriteManifest;
  } catch {
    return null;
  }
}

function emptySpriteSet(): CharacterSpriteSet {
  return {
    rotations: {},
    animations: {
      walk: {},
      working: []
    },
    hasSprites: false
  };
}

/**
 * Loads exactly `frameCount` frames (`0.png … frameCount-1.png`) in parallel. Frames
 * are kept as a contiguous prefix so a transient load failure truncates rather than
 * shifting frame indices, matching the previous serial-probe semantics.
 */
async function loadAnimationFrames(baseUrl: string, frameCount: number): Promise<HTMLImageElement[]> {
  if (frameCount <= 0) {
    return [];
  }

  const images = await Promise.all(
    Array.from({ length: frameCount }, (_unused, index) => loadImage(`${baseUrl}/${index}.png`))
  );

  const frames: HTMLImageElement[] = [];
  for (const image of images) {
    if (!image) {
      break;
    }
    frames.push(image);
  }

  return frames;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = imageLoadCache.get(url);
  if (cached) {
    return cached;
  }

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });

  imageLoadCache.set(url, promise);
  return promise;
}

function pickDirection(spriteSet: CharacterSpriteSet, requested: SpriteDirection, moving: boolean): SpriteDirection {
  if (moving) {
    if (spriteSet.animations.walk[requested]?.length) {
      return requested;
    }

    for (const direction of directions) {
      if (spriteSet.animations.walk[direction]?.length) {
        return direction;
      }
    }
  }

  if (spriteSet.rotations[requested]) {
    return requested;
  }

  for (const direction of directions) {
    if (spriteSet.rotations[direction]) {
      return direction;
    }
  }

  return "south";
}

function resolveWalkFrameIndex(frameTick: number, frameCount: number): number {
  if (frameCount <= 1) {
    return 0;
  }

  const cycleFrames = Math.max(targetWalkCycleFrames, frameCount);
  const normalizedTick = ((frameTick % cycleFrames) + cycleFrames) % cycleFrames;
  return Math.min(frameCount - 1, Math.floor((normalizedTick / cycleFrames) * frameCount));
}
