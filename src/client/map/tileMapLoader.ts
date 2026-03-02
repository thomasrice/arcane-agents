import { useEffect, useState } from "react";

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
  backgroundImageUrl: string;
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
  spawnArea?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
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
  const rawMapLogic = await fetchJson<RawMapLogicData>("/api/assets/maps/outpost.logic.json");
  const logicGridSpec = deriveLogicGridSpec(rawMapLogic, rawMap.width, rawMap.height, rawMap.tileSize);
  const collisionTileKeys = parseLogicTileKeySet(rawMapLogic.collisionTiles, logicGridSpec, rawMap.width, rawMap.height);
  const occlusionRects = parseLogicOcclusionRects(rawMapLogic, logicGridSpec, rawMap.width, rawMap.height, rawMap.tileSize);
  const ambientFlameRects = parseLogicAmbientFlameRects(rawMapLogic, logicGridSpec, rawMap.width, rawMap.height, rawMap.tileSize);
  const backgroundImageUrl =
    typeof rawMapLogic.backgroundImage === "string" && rawMapLogic.backgroundImage.trim().length > 0
      ? rawMapLogic.backgroundImage.trim()
      : undefined;

  if (!backgroundImageUrl) {
    throw new Error("Map logic must define a non-empty backgroundImage.");
  }

  return {
    name: rawMap.name,
    width: rawMap.width,
    height: rawMap.height,
    tileSize: rawMap.tileSize,
    zones: rawMap.zones ?? [],
    backgroundImageUrl,
    collisionTileKeys,
    occlusionRects,
    ambientFlameRects,
    spawnArea: rawMap.spawnArea
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
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
