import type { Worker, WorkerPosition } from "../../../shared/types";
import type { LoadedOutpostMap } from "../tileMapLoader";
import {
  clampWorldPosition,
  createCardinalWaypoints,
  findNearestWalkablePosition,
  isWorldPositionWalkable,
  randomRange,
  randomWanderTarget
} from "../pathfinding";

/**
 * The complete character movement/wander simulation for the map, extracted from
 * MapCanvas so it can be exercised without a DOM. It owns move orders, per-worker
 * wander state, and the animated positions; {@link MovementSimulation.tick} advances
 * everything by one step given the current world snapshot and returns the positions
 * to draw plus any positions that should be committed back to the server.
 *
 * Nothing here touches React or the network — callers inject the clock (via `tick`'s
 * `nowMs`) and, optionally, the RNG (for deterministic wander in tests).
 */

export type MoveOrderSource = "manual" | "wander";

export interface MoveOrderInit {
  workerId: string;
  waypoints: WorkerPosition[];
  speedPerTick: number;
  commitOnArrival: boolean;
  source: MoveOrderSource;
}

interface MoveOrder {
  waypoints: WorkerPosition[];
  waypointIndex: number;
  speedPerTick: number;
  commitOnArrival: boolean;
  source: MoveOrderSource;
}

interface WanderState {
  anchor: WorkerPosition;
  nextMoveAfterMs: number;
}

export interface PositionCommit {
  workerId: string;
  position: WorkerPosition;
}

export interface MovementTickInputs {
  workers: Worker[];
  mapData: LoadedOutpostMap | undefined;
  /**
   * Workers that must not initiate wander and whose active wander order is
   * cancelled this tick. MapCanvas passes the single primary selection here, which
   * preserves the historical behaviour of only suppressing wander for a lone
   * selected worker.
   */
  wanderSuppressedWorkerIds: ReadonlySet<string>;
  /** Workers that despawned this frame but are still fading out; their animated positions are retained. */
  fadingWorkerIds?: ReadonlySet<string>;
}

export interface MovementTickResult {
  /** The sim-owned, sparse animated-position map (absent workers draw at their server position). */
  positions: Record<string, WorkerPosition>;
  commits: PositionCommit[];
}

export interface MovementSimulationConfig {
  /** Step cadence in ms; drives wander travel-step counts (walk speed per tick is unchanged). */
  stepIntervalMs: number;
  /** Minimum spacing enforced between wandering workers. */
  personalSpacePx: number;
  /** RNG in [0, 1); injectable so wander is deterministic under test. */
  rng: () => number;
}

const defaultConfig: MovementSimulationConfig = {
  stepIntervalMs: 95,
  personalSpacePx: 26,
  rng: Math.random
};

// Wander tuning — internal to the sim, matching the original MapCanvas closure.
const wanderRestMinMs = 2000;
const wanderRestMaxMs = 5000;
const wanderCrowdedRetryMinMs = 900;
const wanderCrowdedRetryMaxMs = 1800;
const wanderTravelMinMs = 1000;
const wanderTravelMaxMs = 2000;
const wanderMinTravelSteps = 8;
const wanderMinSpeedPerTick = 1.1;
const wanderSkipDistancePx = 6;
const anchorReseedDistancePx = 5;
const positionConvergedEpsilonPx = 0.5;

export class MovementSimulation {
  private readonly config: MovementSimulationConfig;
  private readonly moveOrders: Record<string, MoveOrder> = {};
  private readonly wanderState: Record<string, WanderState> = {};
  private readonly positions: Record<string, WorkerPosition> = {};

  constructor(config: Partial<MovementSimulationConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /** Current sparse animated-position map (stable reference; mutated in place each tick). */
  getPositions(): Record<string, WorkerPosition> {
    return this.positions;
  }

  getPosition(workerId: string): WorkerPosition | undefined {
    return this.positions[workerId];
  }

  /** Queue manual/scatter move orders. Existing orders for the same worker are replaced. */
  issueMoveOrders(orders: MoveOrderInit[]): void {
    for (const order of orders) {
      this.moveOrders[order.workerId] = {
        waypoints: order.waypoints,
        waypointIndex: 0,
        speedPerTick: order.speedPerTick,
        commitOnArrival: order.commitOnArrival,
        source: order.source
      };
    }
  }

  /**
   * Directly shift the given workers by a delta (keyboard nudge). Cancels any active
   * order, re-anchors wander, and returns the ids that actually moved so the caller
   * can batch position commits.
   */
  nudgeWorkers(
    workerIds: Iterable<string>,
    deltaX: number,
    deltaY: number,
    inputs: { workers: Worker[]; mapData: LoadedOutpostMap | undefined; nowMs: number }
  ): string[] {
    const { workers, mapData, nowMs } = inputs;
    const workersById = new Map(workers.map((worker) => [worker.id, worker]));
    const movedWorkerIds: string[] = [];

    for (const workerId of workerIds) {
      const worker = workersById.get(workerId);
      if (!worker) {
        continue;
      }

      const currentPosition = this.positions[workerId] ?? worker.position;
      const targetPosition = clampWorldPosition(
        {
          x: currentPosition.x + deltaX,
          y: currentPosition.y + deltaY
        },
        mapData
      );

      if (mapData && !isWorldPositionWalkable(targetPosition, mapData)) {
        continue;
      }

      if (Math.hypot(targetPosition.x - currentPosition.x, targetPosition.y - currentPosition.y) < 0.01) {
        continue;
      }

      movedWorkerIds.push(workerId);
      this.positions[workerId] = targetPosition;

      delete this.moveOrders[workerId];
      const wanderState = this.wanderState[workerId];
      if (wanderState) {
        wanderState.anchor = { ...targetPosition };
        wanderState.nextMoveAfterMs = nowMs + this.randomRange(wanderCrowdedRetryMinMs, wanderCrowdedRetryMaxMs);
      }
    }

    return movedWorkerIds;
  }

  /** Advance the simulation by one step. */
  tick(nowMs: number, inputs: MovementTickInputs): MovementTickResult {
    const { workers, mapData, wanderSuppressedWorkerIds, fadingWorkerIds } = inputs;
    const activeWorkerIds = new Set(workers.map((worker) => worker.id));
    const workersById = new Map(workers.map((worker) => [worker.id, worker]));
    const positions = this.positions;
    const commits: PositionCommit[] = [];
    const tileSize = mapData?.tileSize ?? 32;

    this.reconcileWorkerLifecycle(workers, activeWorkerIds, fadingWorkerIds, nowMs);
    this.cancelSuppressedWander(wanderSuppressedWorkerIds);
    this.cancelWanderForBusyWorkers(workers, nowMs);
    this.planWander(workers, wanderSuppressedWorkerIds, mapData, tileSize, nowMs);
    this.advanceOrders(workersById, positions, mapData, nowMs, commits);
    this.rescueAndSettle(workers, positions, mapData, commits);

    return { positions, commits };
  }

  /** GC stale orders/wander/positions and (re)seed wander anchors from server positions. */
  private reconcileWorkerLifecycle(
    workers: Worker[],
    activeWorkerIds: Set<string>,
    fadingWorkerIds: ReadonlySet<string> | undefined,
    nowMs: number
  ): void {
    for (const workerId of Object.keys(this.moveOrders)) {
      if (!activeWorkerIds.has(workerId)) {
        delete this.moveOrders[workerId];
      }
    }

    for (const workerId of Object.keys(this.wanderState)) {
      if (!activeWorkerIds.has(workerId)) {
        delete this.wanderState[workerId];
      }
    }

    for (const workerId of Object.keys(this.positions)) {
      if (!activeWorkerIds.has(workerId) && !(fadingWorkerIds?.has(workerId) ?? false)) {
        delete this.positions[workerId];
      }
    }

    for (const worker of workers) {
      const existing = this.wanderState[worker.id];
      if (!existing) {
        this.wanderState[worker.id] = {
          anchor: { ...worker.position },
          nextMoveAfterMs: nowMs + this.randomRange(wanderRestMinMs, wanderRestMaxMs)
        };
        continue;
      }

      if (Math.hypot(existing.anchor.x - worker.position.x, existing.anchor.y - worker.position.y) > anchorReseedDistancePx) {
        existing.anchor = { ...worker.position };
      }
    }
  }

  /** Cancel a suppressed (selected) worker's wander order without resetting its rest timer. */
  private cancelSuppressedWander(wanderSuppressedWorkerIds: ReadonlySet<string>): void {
    for (const workerId of wanderSuppressedWorkerIds) {
      if (this.moveOrders[workerId]?.source === "wander") {
        delete this.moveOrders[workerId];
      }
    }
  }

  /** Working or hold-mode workers must not keep a wander order; cancel it and rest. */
  private cancelWanderForBusyWorkers(workers: Worker[], nowMs: number): void {
    for (const worker of workers) {
      if (worker.status !== "working" && worker.movementMode === "wander") {
        continue;
      }

      const activeOrder = this.moveOrders[worker.id];
      if (activeOrder?.source === "wander") {
        delete this.moveOrders[worker.id];
        const wanderState = this.wanderState[worker.id];
        if (wanderState) {
          wanderState.nextMoveAfterMs = nowMs + this.randomRange(wanderRestMinMs, wanderRestMaxMs);
        }
      }
    }
  }

  /** Pick a new wander destination for idle wander-mode workers whose rest has elapsed. */
  private planWander(
    workers: Worker[],
    wanderSuppressedWorkerIds: ReadonlySet<string>,
    mapData: LoadedOutpostMap | undefined,
    tileSize: number,
    nowMs: number
  ): void {
    for (const worker of workers) {
      if (wanderSuppressedWorkerIds.has(worker.id)) {
        continue;
      }
      if (worker.movementMode !== "wander") {
        continue;
      }
      if (worker.status === "working") {
        continue;
      }
      if (this.moveOrders[worker.id]) {
        continue;
      }

      const wanderState = this.wanderState[worker.id];
      if (!wanderState || nowMs < wanderState.nextMoveAfterMs) {
        continue;
      }

      const nextTarget = randomWanderTarget(wanderState.anchor, tileSize, mapData, this.config.rng);
      const currentPosition = this.positions[worker.id] ?? worker.position;
      const distance = Math.hypot(nextTarget.x - currentPosition.x, nextTarget.y - currentPosition.y);
      if (distance < wanderSkipDistancePx) {
        wanderState.nextMoveAfterMs = nowMs + this.randomRange(wanderRestMinMs, wanderRestMaxMs);
        continue;
      }

      const durationMs = this.randomRange(wanderTravelMinMs, wanderTravelMaxMs);
      const steps = Math.max(wanderMinTravelSteps, durationMs / this.config.stepIntervalMs);
      const waypoints = createCardinalWaypoints(currentPosition, nextTarget);

      this.moveOrders[worker.id] = {
        waypoints,
        waypointIndex: 0,
        speedPerTick: Math.max(wanderMinSpeedPerTick, distance / steps),
        commitOnArrival: false,
        source: "wander"
      };
    }
  }

  /** Step every active order toward its current waypoint, enforcing crowding and walkability. */
  private advanceOrders(
    workersById: Map<string, Worker>,
    positions: Record<string, WorkerPosition>,
    mapData: LoadedOutpostMap | undefined,
    nowMs: number,
    commits: PositionCommit[]
  ): void {
    if (Object.keys(this.moveOrders).length === 0) {
      return;
    }

    const isCrowdedByOtherWorker = (workerId: string, position: WorkerPosition): boolean => {
      for (const [otherWorkerId, otherWorker] of workersById.entries()) {
        if (otherWorkerId === workerId) {
          continue;
        }

        const otherPosition = positions[otherWorkerId] ?? otherWorker.position;
        if (Math.hypot(position.x - otherPosition.x, position.y - otherPosition.y) < this.config.personalSpacePx) {
          return true;
        }
      }

      return false;
    };

    const restWander = (workerId: string, minMs: number, maxMs: number): void => {
      const wanderState = this.wanderState[workerId];
      if (wanderState) {
        wanderState.nextMoveAfterMs = nowMs + this.randomRange(minMs, maxMs);
      }
    };

    for (const [workerId, order] of Object.entries(this.moveOrders)) {
      const worker = workersById.get(workerId);
      if (!worker) {
        delete this.moveOrders[workerId];
        if (positions[workerId]) {
          delete positions[workerId];
        }
        continue;
      }

      const currentPosition = positions[workerId] ?? worker.position;
      const targetWaypoint = order.waypoints[order.waypointIndex];
      if (!targetWaypoint) {
        delete this.moveOrders[workerId];
        continue;
      }

      const dx = targetWaypoint.x - currentPosition.x;
      const dy = targetWaypoint.y - currentPosition.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= order.speedPerTick) {
        const finalPosition = { x: targetWaypoint.x, y: targetWaypoint.y };

        if (order.source === "wander" && isCrowdedByOtherWorker(workerId, finalPosition)) {
          delete this.moveOrders[workerId];
          restWander(workerId, wanderCrowdedRetryMinMs, wanderCrowdedRetryMaxMs);
          continue;
        }

        if (!isWorldPositionWalkable(finalPosition, mapData)) {
          delete this.moveOrders[workerId];
          restWander(workerId, wanderRestMinMs, wanderRestMaxMs);
          continue;
        }

        positions[workerId] = finalPosition;

        if (order.waypointIndex < order.waypoints.length - 1) {
          order.waypointIndex += 1;
          continue;
        }

        delete this.moveOrders[workerId];

        if (order.commitOnArrival) {
          commits.push({ workerId, position: finalPosition });
        } else {
          restWander(workerId, wanderRestMinMs, wanderRestMaxMs);
        }

        continue;
      }

      const proposedPosition = {
        x: currentPosition.x + (dx / distance) * order.speedPerTick,
        y: currentPosition.y + (dy / distance) * order.speedPerTick
      };

      if (order.source === "wander" && isCrowdedByOtherWorker(workerId, proposedPosition)) {
        delete this.moveOrders[workerId];
        restWander(workerId, wanderCrowdedRetryMinMs, wanderCrowdedRetryMaxMs);
        continue;
      }

      if (!isWorldPositionWalkable(proposedPosition, mapData)) {
        delete this.moveOrders[workerId];
        restWander(workerId, wanderRestMinMs, wanderRestMaxMs);
        continue;
      }

      positions[workerId] = proposedPosition;
    }
  }

  /** Rescue orderless workers stranded on unwalkable tiles and drop positions that reached the server value. */
  private rescueAndSettle(
    workers: Worker[],
    positions: Record<string, WorkerPosition>,
    mapData: LoadedOutpostMap | undefined,
    commits: PositionCommit[]
  ): void {
    for (const worker of workers) {
      if (this.moveOrders[worker.id]) {
        continue;
      }

      const currentPosition = positions[worker.id] ?? worker.position;
      if (!isWorldPositionWalkable(currentPosition, mapData)) {
        const safePosition = findNearestWalkablePosition(currentPosition, mapData);
        if (safePosition) {
          positions[worker.id] = safePosition;
          commits.push({ workerId: worker.id, position: safePosition });
        }
      }

      const staged = positions[worker.id];
      if (!staged) {
        continue;
      }

      if (Math.hypot(staged.x - worker.position.x, staged.y - worker.position.y) < positionConvergedEpsilonPx) {
        delete positions[worker.id];
      }
    }
  }

  private randomRange(min: number, max: number): number {
    return randomRange(min, max, this.config.rng);
  }
}
