import { useEffect, useMemo, useRef, useState } from "react";

export type SpriteDirection = "south" | "east" | "north" | "west";

export interface CharacterSpriteSet {
  type: string;
  rotations: Partial<Record<SpriteDirection, HTMLImageElement>>;
  animations: {
    walk: Partial<Record<SpriteDirection, HTMLImageElement[]>>;
  };
  hasSprites: boolean;
}

interface SpriteFrameOptions {
  direction: SpriteDirection;
  moving: boolean;
  frameIndex: number;
}

const directions: SpriteDirection[] = ["south", "east", "north", "west"];
const imageLoadCache = new Map<string, Promise<HTMLImageElement | null>>();

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

  const resolvedDirection = pickDirection(spriteSet, options.direction, options.moving);
  if (options.moving) {
    const walkFrames = spriteSet.animations.walk[resolvedDirection] ?? spriteSet.animations.walk.south;
    if (walkFrames && walkFrames.length > 0) {
      return walkFrames[options.frameIndex % walkFrames.length];
    }
  }

  return spriteSet.rotations[resolvedDirection] ?? spriteSet.rotations.south;
}

async function loadCharacterSpriteSet(characterType: string): Promise<CharacterSpriteSet> {
  const baseUrl = `/api/assets/characters/${encodeURIComponent(characterType)}`;

  const rotationEntries = await Promise.all(
    directions.map(async (direction) => {
      const image = await loadImage(`${baseUrl}/rotations/${direction}.png`);
      return [direction, image] as const;
    })
  );

  const walkEntries = await Promise.all(
    directions.map(async (direction) => {
      const frames = await loadAnimationFrames(`${baseUrl}/animations/walk/${direction}`);
      return [direction, frames] as const;
    })
  );

  const rotations = Object.fromEntries(rotationEntries.filter(([, image]) => Boolean(image))) as Partial<
    Record<SpriteDirection, HTMLImageElement>
  >;

  const walk = Object.fromEntries(walkEntries.filter(([, frames]) => frames.length > 0)) as Partial<
    Record<SpriteDirection, HTMLImageElement[]>
  >;

  const hasSprites =
    Object.values(rotations).some((image) => Boolean(image)) ||
    Object.values(walk).some((frames) => Array.isArray(frames) && frames.length > 0);

  return {
    type: characterType,
    rotations,
    animations: {
      walk
    },
    hasSprites
  };
}

async function loadAnimationFrames(baseUrl: string, maxFrames = 48): Promise<HTMLImageElement[]> {
  const frames: HTMLImageElement[] = [];

  for (let index = 0; index < maxFrames; index += 1) {
    const image = await loadImage(`${baseUrl}/${index}.png`);
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
