import type { WorkerPosition } from "../../shared/types";
import type { LoadedOutpostMap } from "./tileMapLoader";
import { clamp } from "./viewportMath";

interface TileCoord {
  x: number;
  y: number;
}

export function buildBlockedTileSet(mapData: LoadedOutpostMap | undefined): Set<string> {
  return mapData?.collisionTileKeys ?? new Set<string>();
}

export function clampWorldPosition(position: WorkerPosition, mapData: LoadedOutpostMap | undefined): WorkerPosition {
  if (!mapData) {
    return position;
  }

  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;

  return {
    x: clamp(position.x, 16, worldWidth - 16),
    y: clamp(position.y, 16, worldHeight - 16)
  };
}

export function createCardinalWaypoints(from: WorkerPosition, to: WorkerPosition): WorkerPosition[] {
  const epsilon = 0.01;
  const waypoints: WorkerPosition[] = [];

  const horizontal = {
    x: to.x,
    y: from.y
  };

  if (Math.hypot(horizontal.x - from.x, horizontal.y - from.y) > epsilon) {
    waypoints.push(horizontal);
  }

  const lastWaypoint = waypoints[waypoints.length - 1] ?? from;
  if (Math.hypot(to.x - lastWaypoint.x, to.y - lastWaypoint.y) > epsilon) {
    waypoints.push({
      x: to.x,
      y: to.y
    });
  }

  if (waypoints.length === 0) {
    return [
      {
        x: to.x,
        y: to.y
      }
    ];
  }

  return waypoints;
}

export function randomWanderTarget(
  anchor: WorkerPosition,
  tileSize: number,
  mapData: LoadedOutpostMap | undefined
): WorkerPosition {
  let fallback: WorkerPosition | undefined;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const angle = randomRange(0, Math.PI * 2);
    const radius = tileSize * randomRange(2.5, 4);
    const candidate = clampWorldPosition(
      {
        x: anchor.x + Math.cos(angle) * radius,
        y: anchor.y + Math.sin(angle) * radius
      },
      mapData
    );

    if (isWorldPositionWalkable(candidate, mapData)) {
      return candidate;
    }

    if (!fallback) {
      fallback = candidate;
    }
  }

  if (!fallback) {
    return anchor;
  }

  return findNearestWalkablePosition(fallback, mapData) ?? anchor;
}

export function isWorldPositionWalkable(position: WorkerPosition, mapData: LoadedOutpostMap | undefined): boolean {
  if (!mapData) {
    return true;
  }

  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  if (position.x < 14 || position.y < 14 || position.x > worldWidth - 14 || position.y > worldHeight - 14) {
    return false;
  }

  const tileX = clamp(Math.floor(position.x / mapData.tileSize), 0, mapData.width - 1);
  const tileY = clamp(Math.floor(position.y / mapData.tileSize), 0, mapData.height - 1);
  if (mapData.collisionTileKeys.has(tileCoordKey(tileX, tileY))) {
    return false;
  }

  return true;
}

export function findNearestWalkablePosition(
  target: WorkerPosition,
  mapData: LoadedOutpostMap | undefined
): WorkerPosition | undefined {
  if (!mapData) {
    return target;
  }

  if (isWorldPositionWalkable(target, mapData)) {
    return target;
  }

  const step = Math.max(6, mapData.tileSize * 0.28);
  const maxRadius = mapData.tileSize * 4;

  for (let radius = step; radius <= maxRadius; radius += step) {
    for (let directionIndex = 0; directionIndex < 16; directionIndex += 1) {
      const angle = (Math.PI * 2 * directionIndex) / 16;
      const candidate = clampWorldPosition(
        {
          x: target.x + Math.cos(angle) * radius,
          y: target.y + Math.sin(angle) * radius
        },
        mapData
      );

      if (isWorldPositionWalkable(candidate, mapData)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function worldPositionToTile(position: WorkerPosition, mapData: LoadedOutpostMap): TileCoord {
  return {
    x: clamp(Math.floor(position.x / mapData.tileSize), 0, mapData.width - 1),
    y: clamp(Math.floor(position.y / mapData.tileSize), 0, mapData.height - 1)
  };
}

export function isTileWalkable(tileX: number, tileY: number, mapData: LoadedOutpostMap, blockedTileKeys: Set<string>): boolean {
  if (tileX < 0 || tileY < 0 || tileX >= mapData.width || tileY >= mapData.height) {
    return false;
  }

  return !blockedTileKeys.has(tileCoordKey(tileX, tileY));
}

export function findNearestWalkableTile(
  origin: TileCoord,
  mapData: LoadedOutpostMap,
  blockedTileKeys: Set<string>
): TileCoord | undefined {
  if (isTileWalkable(origin.x, origin.y, mapData, blockedTileKeys)) {
    return origin;
  }

  const maxRadius = Math.max(mapData.width, mapData.height);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) {
          continue;
        }

        const candidateX = origin.x + offsetX;
        const candidateY = origin.y + offsetY;
        if (isTileWalkable(candidateX, candidateY, mapData, blockedTileKeys)) {
          return { x: candidateX, y: candidateY };
        }
      }
    }
  }

  return undefined;
}

export function findTilePath(
  start: TileCoord,
  goal: TileCoord,
  mapData: LoadedOutpostMap,
  blockedTileKeys: Set<string>
): TileCoord[] | undefined {
  const startKey = tileCoordKey(start.x, start.y);
  const goalKey = tileCoordKey(goal.x, goal.y);

  if (startKey === goalKey) {
    return [start];
  }

  const openSet = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, manhattanDistance(start, goal)]]);

  while (openSet.size > 0) {
    let currentKey: string | undefined;
    let currentScore = Number.POSITIVE_INFINITY;

    for (const candidate of openSet) {
      const score = fScore.get(candidate) ?? Number.POSITIVE_INFINITY;
      if (score < currentScore) {
        currentScore = score;
        currentKey = candidate;
      }
    }

    if (!currentKey) {
      break;
    }

    if (currentKey === goalKey) {
      return reconstructTilePath(cameFrom, currentKey);
    }

    openSet.delete(currentKey);
    const currentTile = parseTileCoordKey(currentKey);
    if (!currentTile) {
      continue;
    }

    for (const [stepX, stepY] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const neighborX = currentTile.x + stepX;
      const neighborY = currentTile.y + stepY;

      if (!isTileWalkable(neighborX, neighborY, mapData, blockedTileKeys)) {
        continue;
      }

      const neighborKey = tileCoordKey(neighborX, neighborY);
      const tentativeGScore = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentativeGScore >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, currentKey);
      gScore.set(neighborKey, tentativeGScore);
      fScore.set(neighborKey, tentativeGScore + manhattanDistance({ x: neighborX, y: neighborY }, goal));
      openSet.add(neighborKey);
    }
  }

  return undefined;
}

export function tilePathToWaypoints(tilePath: TileCoord[], mapData: LoadedOutpostMap): WorkerPosition[] {
  if (tilePath.length <= 1) {
    return [];
  }

  const waypoints: WorkerPosition[] = [];
  let previousDirection = {
    x: tilePath[1].x - tilePath[0].x,
    y: tilePath[1].y - tilePath[0].y
  };

  for (let index = 2; index < tilePath.length; index += 1) {
    const direction = {
      x: tilePath[index].x - tilePath[index - 1].x,
      y: tilePath[index].y - tilePath[index - 1].y
    };

    if (direction.x !== previousDirection.x || direction.y !== previousDirection.y) {
      waypoints.push(tileToWorldCenter(tilePath[index - 1], mapData));
      previousDirection = direction;
    }
  }

  waypoints.push(tileToWorldCenter(tilePath[tilePath.length - 1], mapData));
  return waypoints;
}

function tileToWorldCenter(tile: TileCoord, mapData: LoadedOutpostMap): WorkerPosition {
  return {
    x: tile.x * mapData.tileSize + mapData.tileSize / 2,
    y: tile.y * mapData.tileSize + mapData.tileSize / 2
  };
}

function reconstructTilePath(cameFrom: Map<string, string>, currentKey: string): TileCoord[] {
  const path: TileCoord[] = [];
  let key: string | undefined = currentKey;

  while (key) {
    const tile = parseTileCoordKey(key);
    if (!tile) {
      break;
    }
    path.push(tile);
    key = cameFrom.get(key);
  }

  path.reverse();
  return path;
}

function tileCoordKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

function parseTileCoordKey(key: string): TileCoord | undefined {
  const [xText, yText] = key.split(",");
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return undefined;
  }
  return { x, y };
}

function manhattanDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
