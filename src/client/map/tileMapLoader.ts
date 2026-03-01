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
  backgroundImageUrl?: string;
  collisionTileKeys: Set<string>;
  occlusionRects: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    mode: "soft" | "hard";
  }>;
  ambientFlameRects: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    clusterId: number;
    clusterCenterX: number;
    clusterCenterY: number;
    clusterRadius: number;
    clusterBoundsX: number;
    clusterBoundsY: number;
    clusterBoundsWidth: number;
    clusterBoundsHeight: number;
    isCluster: boolean;
    cellCount: number;
  }>;
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
  animatedObjectDefinitions: Record<
    string,
    {
      width: number;
      height: number;
      frames: HTMLImageElement[];
      frameCount: number;
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

interface LogicGridSpec {
  width: number;
  height: number;
  tileSize: number;
  worldWidth: number;
  worldHeight: number;
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

interface RawMapLogicData {
  version?: number;
  width?: number;
  height?: number;
  tileSize?: number;
  backgroundImage?: string;
  collisionTiles?: unknown;
  occlusionCellSize?: number;
  occlusionCells?: unknown;
  occlusionTiles?: unknown;
  occlusionHardCells?: unknown;
  occlusionHardTiles?: unknown;
  ambientFlameCellSize?: number;
  ambientFlameCells?: unknown;
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
  const rawMapLogic = await fetchJsonOptional<RawMapLogicData>("/api/assets/maps/outpost.logic.json");
  const objectDefinitions = await fetchJson<Record<string, RawObjectDefinition>>("/api/assets/objects/objects.json");

  const loadedObjectDefinitions = await loadObjectDefinitions(objectDefinitions);
  const animatedObjectDefinitions = await loadAnimatedObjectDefinitions(objectDefinitions);
  const tilesetsByTerrain = await loadTilesetsByTerrain(rawMap);
  const logicGridSpec = deriveLogicGridSpec(rawMapLogic, rawMap.width, rawMap.height, rawMap.tileSize);
  const collisionTileKeys = parseLogicTileKeySet(rawMapLogic?.collisionTiles, logicGridSpec, rawMap.width, rawMap.height);
  const occlusionRects = parseLogicOcclusionRects(rawMapLogic, logicGridSpec, rawMap.width, rawMap.height, rawMap.tileSize);
  const ambientFlameRects = parseLogicAmbientFlameRects(rawMapLogic, logicGridSpec, rawMap.width, rawMap.height, rawMap.tileSize);
  const backgroundImageUrl =
    typeof rawMapLogic?.backgroundImage === "string" && rawMapLogic.backgroundImage.trim().length > 0
      ? rawMapLogic.backgroundImage.trim()
      : undefined;

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
    backgroundImageUrl,
    collisionTileKeys,
    occlusionRects,
    ambientFlameRects,
    spawnArea: rawMap.spawnArea,
    objects: rawMap.objects,
    objectDefinitions: loadedObjectDefinitions,
    animatedObjectDefinitions,
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

// Hero animated objects - objects that have looping animations
const ANIMATED_OBJECT_TYPES = ["campfire", "torch"];

async function loadAnimatedObjectDefinitions(
  objectDefinitions: Record<string, RawObjectDefinition>
): Promise<LoadedOutpostMap["animatedObjectDefinitions"]> {
  const animatedDefs: LoadedOutpostMap["animatedObjectDefinitions"] = {};

  for (const objectType of ANIMATED_OBJECT_TYPES) {
    const dimensions = objectDefinitions[objectType];
    if (!dimensions) continue;

    const frameDir = `${objectType}-animated`;
    const frames: HTMLImageElement[] = [];

    // Try to load up to 16 frames
    for (let i = 0; i < 16; i++) {
      const frame = await loadImage(`/api/assets/objects/${frameDir}/${i}.png`);
      if (frame) {
        frames.push(frame);
      } else {
        break;
      }
    }

    if (frames.length > 0) {
      animatedDefs[objectType] = {
        width: dimensions.width,
        height: dimensions.height,
        frames,
        frameCount: frames.length
      };
    }
  }

  return animatedDefs;
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

async function fetchJsonOptional<T>(url: string): Promise<T | undefined> {
  const response = await fetch(url);
  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

function deriveLogicGridSpec(
  rawMapLogic: RawMapLogicData | undefined,
  mapWidth: number,
  mapHeight: number,
  mapTileSize: number
): LogicGridSpec {
  const logicWidth = clampLogicInt(rawMapLogic?.width, 1, 4096, mapWidth);
  const logicHeight = clampLogicInt(rawMapLogic?.height, 1, 4096, mapHeight);
  const logicTileSize = clampLogicInt(rawMapLogic?.tileSize, 1, 512, mapTileSize);

  return {
    width: logicWidth,
    height: logicHeight,
    tileSize: logicTileSize,
    worldWidth: logicWidth * logicTileSize,
    worldHeight: logicHeight * logicTileSize
  };
}

function parseLogicTileKeySet(
  rawTiles: unknown,
  logicGrid: LogicGridSpec,
  mapWidth: number,
  mapHeight: number
): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(rawTiles)) {
    return keys;
  }

  for (const entry of rawTiles) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }

    const tileX = Number(entry[0]);
    const tileY = Number(entry[1]);

    if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) {
      continue;
    }

    if (tileX < 0 || tileY < 0 || tileX >= logicGrid.width || tileY >= logicGrid.height) {
      continue;
    }

    const minMapTileX = clamp(Math.floor((tileX / logicGrid.width) * mapWidth), 0, mapWidth - 1);
    const minMapTileY = clamp(Math.floor((tileY / logicGrid.height) * mapHeight), 0, mapHeight - 1);

    const mappedEndXExclusive = Math.ceil(((tileX + 1) / logicGrid.width) * mapWidth);
    const mappedEndYExclusive = Math.ceil(((tileY + 1) / logicGrid.height) * mapHeight);
    const maxMapTileX = clamp(mappedEndXExclusive - 1, minMapTileX, mapWidth - 1);
    const maxMapTileY = clamp(mappedEndYExclusive - 1, minMapTileY, mapHeight - 1);

    for (let mapTileY = minMapTileY; mapTileY <= maxMapTileY; mapTileY += 1) {
      for (let mapTileX = minMapTileX; mapTileX <= maxMapTileX; mapTileX += 1) {
        keys.add(logicTileKey(mapTileX, mapTileY));
      }
    }
  }

  return keys;
}

function parseLogicOcclusionRects(
  rawMapLogic: RawMapLogicData | undefined,
  logicGrid: LogicGridSpec,
  mapWidth: number,
  mapHeight: number,
  tileSize: number
): LoadedOutpostMap["occlusionRects"] {
  const softRects = parseLogicOcclusionRectsForMode(
    rawMapLogic,
    logicGrid,
    mapWidth,
    mapHeight,
    tileSize,
    rawMapLogic?.occlusionCells,
    rawMapLogic?.occlusionTiles,
    "soft"
  );
  const hardRects = parseLogicOcclusionRectsForMode(
    rawMapLogic,
    logicGrid,
    mapWidth,
    mapHeight,
    tileSize,
    rawMapLogic?.occlusionHardCells,
    rawMapLogic?.occlusionHardTiles,
    "hard"
  );

  return [...softRects, ...hardRects];
}

function parseLogicOcclusionRectsForMode(
  rawMapLogic: RawMapLogicData | undefined,
  logicGrid: LogicGridSpec,
  mapWidth: number,
  mapHeight: number,
  tileSize: number,
  rawOcclusionCellsInput: unknown,
  rawOcclusionTilesInput: unknown,
  mode: "soft" | "hard"
): LoadedOutpostMap["occlusionRects"] {
  const mapWorldWidth = mapWidth * tileSize;
  const mapWorldHeight = mapHeight * tileSize;
  const logicWorldWidth = Math.max(1, logicGrid.worldWidth);
  const logicWorldHeight = Math.max(1, logicGrid.worldHeight);
  const rects: LoadedOutpostMap["occlusionRects"] = [];
  const rectKeys = new Set<string>();

  const mapLogicRectToWorld = (x: number, y: number, width: number, height: number) => {
    const mappedX = (x / logicWorldWidth) * mapWorldWidth;
    const mappedY = (y / logicWorldHeight) * mapWorldHeight;
    const mappedWidth = (width / logicWorldWidth) * mapWorldWidth;
    const mappedHeight = (height / logicWorldHeight) * mapWorldHeight;
    return {
      x: mappedX,
      y: mappedY,
      width: mappedWidth,
      height: mappedHeight
    };
  };

  const pushRect = (x: number, y: number, width: number, height: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }

    if (width <= 0 || height <= 0) {
      return;
    }

    const right = Math.min(mapWorldWidth, x + width);
    const bottom = Math.min(mapWorldHeight, y + height);
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const clampedWidth = right - left;
    const clampedHeight = bottom - top;

    if (clampedWidth <= 0 || clampedHeight <= 0) {
      return;
    }

    const key = `${left},${top},${clampedWidth},${clampedHeight}`;
    if (rectKeys.has(key)) {
      return;
    }

    rectKeys.add(key);
    rects.push({
      x: left,
      y: top,
      width: clampedWidth,
      height: clampedHeight,
      mode
    });
  };

  const rawOcclusionCells = rawOcclusionCellsInput;
  if (Array.isArray(rawOcclusionCells)) {
    const maxCellSize = Math.max(2, logicGrid.tileSize);
    const cellSize = clampLogicInt(rawMapLogic?.occlusionCellSize, 2, maxCellSize, Math.min(8, maxCellSize));

    for (const entry of rawOcclusionCells) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }

      const cellX = Number(entry[0]);
      const cellY = Number(entry[1]);
      if (!Number.isInteger(cellX) || !Number.isInteger(cellY)) {
        continue;
      }

      const mappedRect = mapLogicRectToWorld(cellX * cellSize, cellY * cellSize, cellSize, cellSize);
      pushRect(mappedRect.x, mappedRect.y, mappedRect.width, mappedRect.height);
    }

    if (rects.length > 0) {
      return rects;
    }
  }

  const rawOcclusionTiles = rawOcclusionTilesInput;
  if (Array.isArray(rawOcclusionTiles)) {
    for (const entry of rawOcclusionTiles) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }

      const tileX = Number(entry[0]);
      const tileY = Number(entry[1]);
      if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) {
        continue;
      }

      if (tileX < 0 || tileY < 0 || tileX >= logicGrid.width || tileY >= logicGrid.height) {
        continue;
      }

      const mappedRect = mapLogicRectToWorld(
        tileX * logicGrid.tileSize,
        tileY * logicGrid.tileSize,
        logicGrid.tileSize,
        logicGrid.tileSize
      );
      pushRect(mappedRect.x, mappedRect.y, mappedRect.width, mappedRect.height);
    }
  }

  return rects;
}

function parseLogicAmbientFlameRects(
  rawMapLogic: RawMapLogicData | undefined,
  logicGrid: LogicGridSpec,
  mapWidth: number,
  mapHeight: number,
  tileSize: number
): LoadedOutpostMap["ambientFlameRects"] {
  const mapWorldWidth = mapWidth * tileSize;
  const mapWorldHeight = mapHeight * tileSize;
  const logicWorldWidth = Math.max(1, logicGrid.worldWidth);
  const logicWorldHeight = Math.max(1, logicGrid.worldHeight);

  const rawFlameCells = rawMapLogic?.ambientFlameCells;
  if (!Array.isArray(rawFlameCells)) {
    return [];
  }

  const maxCellSize = Math.max(2, logicGrid.tileSize);
  const cellSize = clampLogicInt(rawMapLogic?.ambientFlameCellSize, 2, maxCellSize, Math.min(16, maxCellSize));

  // Parse all cells into world coordinates
  type FlameCell = { x: number; y: number; width: number; height: number; key: string };
  const cells: FlameCell[] = [];
  const cellKeys = new Set<string>();

  for (const entry of rawFlameCells) {
    if (!Array.isArray(entry) || entry.length < 2) continue;

    const cellX = Number(entry[0]);
    const cellY = Number(entry[1]);
    if (!Number.isInteger(cellX) || !Number.isInteger(cellY)) continue;

    const logicX = cellX * cellSize;
    const logicY = cellY * cellSize;
    const mappedX = (logicX / logicWorldWidth) * mapWorldWidth;
    const mappedY = (logicY / logicWorldHeight) * mapWorldHeight;
    const mappedSize = (cellSize / logicWorldWidth) * mapWorldWidth;

    const left = Math.max(0, mappedX);
    const top = Math.max(0, mappedY);
    const clampedSize = Math.min(mappedSize, mapWorldWidth - left, mapWorldHeight - top);

    if (clampedSize <= 0) continue;

    const key = `${left},${top}`;
    if (cellKeys.has(key)) continue;

    cellKeys.add(key);
    cells.push({ x: left, y: top, width: clampedSize, height: clampedSize, key });
  }

  if (cells.length === 0) return [];

  // Cluster adjacent cells using flood-fill
  const visited = new Set<string>();
  const clusters: FlameCell[][] = [];

  const getNeighbors = (cell: FlameCell): FlameCell[] => {
    const neighbors: FlameCell[] = [];
    for (const other of cells) {
      if (other.key === cell.key) continue;
      const dx = Math.abs(other.x - cell.x);
      const dy = Math.abs(other.y - cell.y);
      // Adjacent if within 1.5 cell sizes (diagonal included)
      const threshold = cellSize * 1.5;
      if (dx <= threshold && dy <= threshold) {
        neighbors.push(other);
      }
    }
    return neighbors;
  };

  for (const cell of cells) {
    if (visited.has(cell.key)) continue;

    const cluster: FlameCell[] = [];
    const queue: FlameCell[] = [cell];
    visited.add(cell.key);

    while (queue.length > 0) {
      const current = queue.pop()!;
      cluster.push(current);

      for (const neighbor of getNeighbors(current)) {
        if (!visited.has(neighbor.key)) {
          visited.add(neighbor.key);
          queue.push(neighbor);
        }
      }
    }

    clusters.push(cluster);
  }

  // Convert clusters to flame cells, each carrying shared cluster metadata.
  // Keeping per-cell rects preserves fine-grained flicker at all zoom levels.
  const rects: LoadedOutpostMap["ambientFlameRects"] = [];

  for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
    const cluster = clusters[clusterIndex];
    // Compute center of mass
    let centerX = 0, centerY = 0, totalArea = 0;
    for (const cell of cluster) {
      const area = cell.width * cell.height;
      centerX += (cell.x + cell.width * 0.5) * area;
      centerY += (cell.y + cell.height * 0.5) * area;
      totalArea += area;
    }
    centerX /= totalArea;
    centerY /= totalArea;

    // Find max distance from center to determine cluster radius
    let maxDist = 0;
    for (const cell of cluster) {
      const cellCenterX = cell.x + cell.width * 0.5;
      const cellCenterY = cell.y + cell.height * 0.5;
      const dx = cellCenterX - centerX;
      const dy = cellCenterY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy) + Math.max(cell.width, cell.height) * 0.5;
      maxDist = Math.max(maxDist, dist);
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const clusterCell of cluster) {
      minX = Math.min(minX, clusterCell.x);
      minY = Math.min(minY, clusterCell.y);
      maxX = Math.max(maxX, clusterCell.x + clusterCell.width);
      maxY = Math.max(maxY, clusterCell.y + clusterCell.height);
    }

    for (const cell of cluster) {

      rects.push({
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
        clusterId: clusterIndex,
        clusterCenterX: centerX,
        clusterCenterY: centerY,
        clusterRadius: maxDist,
        clusterBoundsX: minX,
        clusterBoundsY: minY,
        clusterBoundsWidth: maxX - minX,
        clusterBoundsHeight: maxY - minY,
        isCluster: cluster.length > 1,
        cellCount: cluster.length
      });
    }
  }

  return rects;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampLogicInt(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  const rounded = Math.round(numberValue);
  return Math.max(min, Math.min(max, rounded));
}

function logicTileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
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
