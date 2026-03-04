import fs from "node:fs";
import path from "node:path";
import type { Worker, WorkerPosition } from "../../../shared/types";
import type { OutpostMapSpec } from "./types";

const defaultSpawnSeparationDistancePx = 52;

interface NextSpawnPositionInput {
  activeWorkers: Worker[];
  spec: OutpostMapSpec | undefined;
  spawnSeparationDistancePx?: number;
  anchorPositions?: WorkerPosition[];
}

export function loadOutpostSpawnSpec(cwd = process.cwd()): OutpostMapSpec | undefined {
  const mapPath = path.resolve(cwd, "assets/maps/outpost.json");
  if (!fs.existsSync(mapPath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(mapPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<OutpostMapSpec>;
    if (typeof parsed.tileSize !== "number") {
      return undefined;
    }

    return {
      width: typeof parsed.width === "number" ? parsed.width : undefined,
      height: typeof parsed.height === "number" ? parsed.height : undefined,
      tileSize: parsed.tileSize,
      spawnArea: parsed.spawnArea
    };
  } catch {
    return undefined;
  }
}

export function nextSpawnPosition({ activeWorkers, spec, spawnSeparationDistancePx, anchorPositions }: NextSpawnPositionInput): WorkerPosition {
  const separation = spawnSeparationDistancePx ?? defaultSpawnSeparationDistancePx;

  const anchoredCandidate = nextSpawnPositionNearAnchors(anchorPositions, activeWorkers, spec, separation);
  if (anchoredCandidate) {
    return anchoredCandidate;
  }

  const index = activeWorkers.length;

  if (spec?.spawnArea) {
    const { tileSize, spawnArea } = spec;
    const areaWidth = Math.max(1, spawnArea.x2 - spawnArea.x1 + 1);
    const areaHeight = Math.max(1, spawnArea.y2 - spawnArea.y1 + 1);
    const totalTiles = areaWidth * areaHeight;
    const startTileIndex = index % totalTiles;

    for (let step = 0; step < totalTiles; step += 1) {
      const tileIndex = (startTileIndex + step) % totalTiles;
      const tileOffsetX = tileIndex % areaWidth;
      const tileOffsetY = Math.floor(tileIndex / areaWidth);
      const tileX = spawnArea.x1 + tileOffsetX;
      const tileY = spawnArea.y1 + tileOffsetY;
      const candidate = {
        x: (tileX + 0.5) * tileSize,
        y: (tileY + 0.5) * tileSize
      };

      if (isSpawnPositionFree(candidate, activeWorkers, separation)) {
        return candidate;
      }
    }

    const fallbackOffsetX = startTileIndex % areaWidth;
    const fallbackOffsetY = Math.floor(startTileIndex / areaWidth);
    return {
      x: (spawnArea.x1 + fallbackOffsetX + 0.5) * tileSize,
      y: (spawnArea.y1 + fallbackOffsetY + 0.5) * tileSize
    };
  }

  const ringSize = 6;
  const ring = Math.floor(index / ringSize);
  const angle = (index % ringSize) * ((Math.PI * 2) / ringSize);
  const radius = 110 + ring * 85;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const adjustedRadius = radius + attempt * 36;
    const adjustedAngle = angle + attempt * 0.32;
    const candidate = {
      x: 520 + Math.cos(adjustedAngle) * adjustedRadius,
      y: 310 + Math.sin(adjustedAngle) * adjustedRadius
    };

    if (isSpawnPositionFree(candidate, activeWorkers, separation)) {
      return candidate;
    }
  }

  return {
    x: 520 + Math.cos(angle) * radius,
    y: 310 + Math.sin(angle) * radius
  };
}

function nextSpawnPositionNearAnchors(
  anchorPositions: WorkerPosition[] | undefined,
  activeWorkers: Worker[],
  spec: OutpostMapSpec | undefined,
  separation: number
): WorkerPosition | undefined {
  if (!anchorPositions || anchorPositions.length === 0) {
    return undefined;
  }

  const center = averagePosition(anchorPositions);
  const phaseSeed = activeWorkers.length * 0.37;
  const radialDistances = [
    Math.max(24, separation * 0.8),
    Math.max(36, separation * 1.15),
    Math.max(48, separation * 1.5)
  ];

  const candidates: WorkerPosition[] = [center];
  for (const distance of radialDistances) {
    for (let index = 0; index < 12; index += 1) {
      const angle = phaseSeed + (index / 12) * Math.PI * 2;
      candidates.push({
        x: center.x + Math.cos(angle) * distance,
        y: center.y + Math.sin(angle) * distance
      });
    }
  }

  for (const candidate of candidates) {
    const normalized = clampToMapBounds(candidate, spec);
    if (isSpawnPositionFree(normalized, activeWorkers, separation)) {
      return normalized;
    }
  }

  return clampToMapBounds(center, spec);
}

function averagePosition(positions: WorkerPosition[]): WorkerPosition {
  if (positions.length === 0) {
    return { x: 520, y: 310 };
  }

  let xSum = 0;
  let ySum = 0;
  for (const position of positions) {
    xSum += position.x;
    ySum += position.y;
  }

  return {
    x: xSum / positions.length,
    y: ySum / positions.length
  };
}

function clampToMapBounds(candidate: WorkerPosition, spec: OutpostMapSpec | undefined): WorkerPosition {
  if (!spec || typeof spec.width !== "number" || typeof spec.height !== "number") {
    return candidate;
  }

  const mapWidth = spec.width * spec.tileSize;
  const mapHeight = spec.height * spec.tileSize;
  const margin = Math.max(14, spec.tileSize * 0.45);

  return {
    x: Math.min(Math.max(candidate.x, margin), mapWidth - margin),
    y: Math.min(Math.max(candidate.y, margin), mapHeight - margin)
  };
}

export function isSpawnPositionFree(candidate: WorkerPosition, workers: Worker[], minDistance: number): boolean {
  return workers.every((worker) => {
    return Math.hypot(candidate.x - worker.position.x, candidate.y - worker.position.y) >= minDistance;
  });
}
