import { describe, expect, it } from "vitest";
import type { LoadedOutpostMap } from "./tileMapLoader";
import {
  buildBlockedTileSet,
  clampWorldPosition,
  createCardinalWaypoints,
  findNearestWalkablePosition,
  findNearestWalkableTile,
  findTilePath,
  isWorldPositionWalkable,
  tilePathToWaypoints
} from "./pathfinding";

function createMap(width = 5, height = 5, collisionTileKeys: string[] = []): LoadedOutpostMap {
  return {
    name: "test-map",
    width,
    height,
    tileSize: 10,
    backgroundImageUrl: "/map.png",
    collisionTileKeys: new Set(collisionTileKeys),
    occlusionRects: [],
    ambientFlameRects: []
  };
}

describe("pathfinding utilities", () => {
  it("builds blocked sets and clamps world positions", () => {
    const map = createMap(5, 5, ["2,2"]);
    expect(buildBlockedTileSet(map)).toBe(map.collisionTileKeys);
    expect(buildBlockedTileSet(undefined).size).toBe(0);

    expect(clampWorldPosition({ x: -5, y: 999 }, map)).toEqual({ x: 16, y: 34 });
    expect(clampWorldPosition({ x: 22, y: 23 }, undefined)).toEqual({ x: 22, y: 23 });
  });

  it("creates cardinal waypoints and evaluates world walkability", () => {
    const map = createMap(5, 5, ["2,2"]);

    expect(createCardinalWaypoints({ x: 10, y: 10 }, { x: 20, y: 30 })).toEqual([
      { x: 20, y: 10 },
      { x: 20, y: 30 }
    ]);
    expect(createCardinalWaypoints({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual([{ x: 10, y: 10 }]);

    expect(isWorldPositionWalkable({ x: 20, y: 20 }, map)).toBe(false);
    expect(isWorldPositionWalkable({ x: 30, y: 30 }, map)).toBe(true);
    expect(isWorldPositionWalkable({ x: 8, y: 20 }, map)).toBe(false);
  });

  it("finds nearest walkable positions/tiles when blocked", () => {
    const map = createMap(5, 5, ["2,2"]);

    const nearestPosition = findNearestWalkablePosition({ x: 20, y: 20 }, map);
    expect(nearestPosition).toBeDefined();
    expect(isWorldPositionWalkable(nearestPosition!, map)).toBe(true);

    const nearestTile = findNearestWalkableTile({ x: 2, y: 2 }, map, map.collisionTileKeys);
    expect(nearestTile).toEqual({ x: 1, y: 1 });
  });

  it("finds tile paths and converts turn points to waypoints", () => {
    const clearMap = createMap();
    const path = findTilePath({ x: 0, y: 0 }, { x: 2, y: 0 }, clearMap, clearMap.collisionTileKeys);

    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ]);

    expect(tilePathToWaypoints(path ?? [], clearMap)).toEqual([{ x: 25, y: 5 }]);

    const blockedMap = createMap(3, 3, ["1,0", "1,1", "1,2"]);
    expect(findTilePath({ x: 0, y: 1 }, { x: 2, y: 1 }, blockedMap, blockedMap.collisionTileKeys)).toBeUndefined();
  });
});
