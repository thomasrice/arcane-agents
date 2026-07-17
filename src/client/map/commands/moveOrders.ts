import type { WorkerPosition } from "../../../shared/types";
import type { LoadedOutpostMap } from "../tileMapLoader";
import type { CommandFeedback } from "../renderScene";
import type { MoveOrderInit } from "../runtime/movementSimulation";
import {
  clampWorldPosition,
  findNearestWalkableTile,
  findTilePath,
  isTileWalkable,
  tilePathToWaypoints,
  worldPositionToTile
} from "../pathfinding";

/**
 * Pure planning for manual ("move here") commands: resolve a walkable path to the
 * target, produce the simulation order plus its on-canvas command feedback, or
 * report the move as blocked. Also lays out multi-worker formations. MapCanvas
 * applies the results (feeding the order to the simulation and the feedback to state).
 */

export interface ManualMoveConfig {
  moveSpeedPerTick: number;
  commandFeedbackDurationMs: number;
  blockedFeedbackDurationMs: number;
}

export interface ManualMoveInput extends ManualMoveConfig {
  workerId: string;
  currentPosition: WorkerPosition;
  targetWorld: WorkerPosition;
  mapData: LoadedOutpostMap;
  blockedTileKeys: Set<string>;
  nowMs: number;
}

export type ManualMoveResult =
  | { kind: "ok"; order: MoveOrderInit; feedback: CommandFeedback }
  | { kind: "blocked"; feedback: CommandFeedback };

export interface FormationConfig {
  tileSize: number;
  spriteBaseSize: number;
  personalSpacePx: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function planManualMove(input: ManualMoveInput): ManualMoveResult {
  const {
    workerId,
    currentPosition,
    targetWorld,
    mapData,
    blockedTileKeys,
    nowMs,
    moveSpeedPerTick,
    commandFeedbackDurationMs,
    blockedFeedbackDurationMs
  } = input;

  const target = clampWorldPosition(targetWorld, mapData);
  const normalizedTarget = { x: round1(target.x), y: round1(target.y) };

  const blocked = (): ManualMoveResult => ({
    kind: "blocked",
    feedback: {
      kind: "blocked",
      workerId,
      startedAtMs: nowMs,
      durationMs: blockedFeedbackDurationMs,
      destination: normalizedTarget
    }
  });

  const startTile = worldPositionToTile(currentPosition, mapData);
  const goalTileCandidate = worldPositionToTile(normalizedTarget, mapData);

  const startTileResolved = isTileWalkable(startTile.x, startTile.y, mapData, blockedTileKeys)
    ? startTile
    : findNearestWalkableTile(startTile, mapData, blockedTileKeys);
  const goalTileResolved = isTileWalkable(goalTileCandidate.x, goalTileCandidate.y, mapData, blockedTileKeys)
    ? goalTileCandidate
    : findNearestWalkableTile(goalTileCandidate, mapData, blockedTileKeys);

  if (!startTileResolved || !goalTileResolved) {
    return blocked();
  }

  const tilePath = findTilePath(startTileResolved, goalTileResolved, mapData, blockedTileKeys);
  if (!tilePath || tilePath.length === 0) {
    return blocked();
  }

  const waypoints = tilePathToWaypoints(tilePath, mapData);
  if (waypoints.length === 0) {
    return blocked();
  }

  const resolvedDestination = waypoints[waypoints.length - 1] ?? normalizedTarget;

  return {
    kind: "ok",
    order: {
      workerId,
      waypoints,
      speedPerTick: moveSpeedPerTick,
      commitOnArrival: true,
      source: "manual"
    },
    feedback: {
      kind: "ok",
      workerId,
      startedAtMs: nowMs,
      durationMs: commandFeedbackDurationMs,
      destination: resolvedDestination,
      path: [currentPosition, ...waypoints]
    }
  };
}

/** Lay out a target position per worker so a group fans out into a centred grid. */
export function formationTargets(count: number, targetWorld: WorkerPosition, config: FormationConfig): WorkerPosition[] {
  if (count <= 1) {
    return [targetWorld];
  }

  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const spacing = Math.max(config.tileSize * 2.2, config.spriteBaseSize + 8, config.personalSpacePx * 2.2);

  const targets: WorkerPosition[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const offsetX = (col - (columns - 1) / 2) * spacing;
    const offsetY = (row - (rows - 1) / 2) * spacing;
    targets.push({ x: targetWorld.x + offsetX, y: targetWorld.y + offsetY });
  }

  return targets;
}
