import fs from "node:fs";
import path from "node:path";
import type { Worker, WorkerPosition } from "../../../shared/types";
import type { OutpostMapSpec } from "./types";

const defaultSpawnSeparationDistancePx = 52;

interface NextSpawnPositionInput {
  activeWorkers: Worker[];
  spec: OutpostMapSpec | undefined;
  spawnSeparationDistancePx?: number;
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
      tileSize: parsed.tileSize,
      spawnArea: parsed.spawnArea
    };
  } catch {
    return undefined;
  }
}

export function nextSpawnPosition({ activeWorkers, spec, spawnSeparationDistancePx }: NextSpawnPositionInput): WorkerPosition {
  const separation = spawnSeparationDistancePx ?? defaultSpawnSeparationDistancePx;
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

export function isSpawnPositionFree(candidate: WorkerPosition, workers: Worker[], minDistance: number): boolean {
  return workers.every((worker) => {
    return Math.hypot(candidate.x - worker.position.x, candidate.y - worker.position.y) >= minDistance;
  });
}
