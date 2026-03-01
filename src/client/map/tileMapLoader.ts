import { useEffect, useState } from "react";

export type CornerState = "lower" | "upper";

export interface MapZone {
  id: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LoadedOutpostMap {
  name: string;
  width: number;
  height: number;
  tileSize: number;
  zones: MapZone[];
  terrain: number[][];
  spawnArea?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  objects: Array<{
    type: string;
    x: number;
    y: number;
  }>;
  objectDefinitions: Record<
    string,
    {
      width: number;
      height: number;
      image?: HTMLImageElement;
    }
  >;
  baseGrassTile?: HTMLImageElement;
  tilesetsByTerrain: Record<number, LoadedWangTileset>;
}

export interface LoadedWangTileset {
  name: string;
  tilesByCornerKey: Record<string, HTMLImageElement>;
  fallbackTile?: HTMLImageElement;
}

interface RawMapData {
  name: string;
  width: number;
  height: number;
  tileSize: number;
  zones?: MapZone[];
  terrainTypes: Record<
    string,
    {
      name: string;
      tileset: string | null;
    }
  >;
  terrain: number[][];
  objects: Array<{
    type: string;
    x: number;
    y: number;
  }>;
  spawnArea?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

interface RawTilesetData {
  tiles: Array<{
    id: string;
    name: string;
    corners: {
      NW: CornerState;
      NE: CornerState;
      SW: CornerState;
      SE: CornerState;
    };
  }>;
}

interface RawObjectDefinition {
  width: number;
  height: number;
}

export function useOutpostMap(): {
  mapData?: LoadedOutpostMap;
  errorText?: string;
} {
  const [mapData, setMapData] = useState<LoadedOutpostMap | undefined>(undefined);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    void loadOutpostMap()
      .then((nextMapData) => {
        if (!cancelled) {
          setMapData(nextMapData);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : "Failed to load map assets");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    mapData,
    errorText
  };
}

async function loadOutpostMap(): Promise<LoadedOutpostMap> {
  const rawMap = await fetchJson<RawMapData>("/api/assets/maps/outpost.json");
  const objectDefinitions = await fetchJson<Record<string, RawObjectDefinition>>("/api/assets/objects/objects.json");

  const loadedObjectDefinitions = await loadObjectDefinitions(objectDefinitions);
  const tilesetsByTerrain = await loadTilesetsByTerrain(rawMap);

  const baseGrassTile =
    tilesetsByTerrain[1]?.tilesByCornerKey[cornerKey("lower", "lower", "lower", "lower")] ??
    tilesetsByTerrain[2]?.tilesByCornerKey[cornerKey("lower", "lower", "lower", "lower")] ??
    tilesetsByTerrain[3]?.tilesByCornerKey[cornerKey("lower", "lower", "lower", "lower")];

  return {
    name: rawMap.name,
    width: rawMap.width,
    height: rawMap.height,
    tileSize: rawMap.tileSize,
    zones: rawMap.zones ?? [],
    terrain: rawMap.terrain,
    spawnArea: rawMap.spawnArea,
    objects: rawMap.objects,
    objectDefinitions: loadedObjectDefinitions,
    baseGrassTile,
    tilesetsByTerrain
  };
}

async function loadTilesetsByTerrain(rawMap: RawMapData): Promise<Record<number, LoadedWangTileset>> {
  const terrainEntries = Object.entries(rawMap.terrainTypes)
    .map(([terrainValue, terrainType]) => ({
      terrainValue: Number(terrainValue),
      tilesetName: terrainType.tileset
    }))
    .filter((entry): entry is { terrainValue: number; tilesetName: string } => Boolean(entry.tilesetName));

  const loadedEntries = await Promise.all(
    terrainEntries.map(async ({ terrainValue, tilesetName }) => {
      const tileset = await loadWangTileset(tilesetName);
      return {
        terrainValue,
        tileset
      };
    })
  );

  return Object.fromEntries(loadedEntries.map((entry) => [entry.terrainValue, entry.tileset]));
}

async function loadWangTileset(tilesetName: string): Promise<LoadedWangTileset> {
  const basePath = `/api/assets/tilesets/${encodeURIComponent(tilesetName)}`;
  const tilesetJson = await fetchJson<RawTilesetData>(`${basePath}/tileset.json`);

  const tilesByCornerKey: Record<string, HTMLImageElement> = {};
  let fallbackTile: HTMLImageElement | undefined;

  for (const tile of tilesetJson.tiles) {
    const image = await loadTileImage(basePath, tile.id, tile.name);
    if (!image) {
      continue;
    }

    const key = cornerKey(tile.corners.NW, tile.corners.NE, tile.corners.SW, tile.corners.SE);
    tilesByCornerKey[key] = image;

    if (!fallbackTile) {
      fallbackTile = image;
    }
  }

  return {
    name: tilesetName,
    tilesByCornerKey,
    fallbackTile
  };
}

async function loadObjectDefinitions(
  objectDefinitions: Record<string, RawObjectDefinition>
): Promise<LoadedOutpostMap["objectDefinitions"]> {
  const entries = await Promise.all(
    Object.entries(objectDefinitions).map(async ([objectType, dimensions]) => {
      const image = await loadImage(`/api/assets/objects/${encodeURIComponent(objectType)}.png`);
      return [
        objectType,
        {
          width: dimensions.width,
          height: dimensions.height,
          image: image ?? undefined
        }
      ] as const;
    })
  );

  return Object.fromEntries(entries);
}

async function loadTileImage(basePath: string, tileId: string, tileName: string): Promise<HTMLImageElement | null> {
  const candidates = [
    `${basePath}/${tileName}.png`,
    `${basePath}/${tileId}_${tileName}.png`,
    `${basePath}/wang_${tileId}.png`
  ];

  for (const candidate of candidates) {
    const image = await loadImage(candidate);
    if (image) {
      return image;
    }
  }

  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  const probe = await fetch(url, {
    method: "HEAD"
  }).catch(() => null);

  if (!probe || !probe.ok) {
    return null;
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function cornerKey(nw: CornerState, ne: CornerState, sw: CornerState, se: CornerState): string {
  return `${nw}|${ne}|${sw}|${se}`;
}
