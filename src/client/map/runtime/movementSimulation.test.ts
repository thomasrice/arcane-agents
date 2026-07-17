import { describe, expect, it } from "vitest";
import type { Worker, WorkerPosition } from "../../../shared/types";
import type { LoadedOutpostMap } from "../tileMapLoader";
import { isWorldPositionWalkable } from "../pathfinding";
import { MovementSimulation, type MovementTickInputs, type PositionCommit } from "./movementSimulation";

const noSuppression: ReadonlySet<string> = new Set();

function createMap(width = 30, height = 30, collisionTileKeys: string[] = []): LoadedOutpostMap {
  return {
    name: "test-map",
    width,
    height,
    tileSize: 32,
    backgroundImageUrl: "/map.png",
    collisionTileKeys: new Set(collisionTileKeys),
    occlusionRects: [],
    flameClusters: []
  };
}

function makeWorker(id: string, position: WorkerPosition, overrides: Partial<Worker> = {}): Worker {
  return {
    id,
    name: id,
    projectId: "proj",
    projectPath: "/proj",
    runtimeId: "claude",
    runtimeLabel: "Claude",
    command: ["claude"],
    status: "idle",
    avatarType: "knight",
    movementMode: "hold",
    position,
    tmuxRef: { session: "s", window: "w", pane: "p" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function distance(a: WorkerPosition, b: WorkerPosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Deterministic RNG (mulberry32) so wander is reproducible. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("MovementSimulation manual orders", () => {
  it("steps toward a target monotonically and by the ordered speed", () => {
    const sim = new MovementSimulation();
    const map = createMap();
    const worker = makeWorker("a", { x: 100, y: 300 });
    const inputs: MovementTickInputs = { workers: [worker], mapData: map, wanderSuppressedWorkerIds: noSuppression };
    const target = { x: 500, y: 300 };

    sim.issueMoveOrders([
      { workerId: "a", waypoints: [target], speedPerTick: 9, commitOnArrival: true, source: "manual" }
    ]);

    let previousDistance = distance(worker.position, target);
    let previous = { ...worker.position };
    let now = 0;

    for (let step = 0; step < 5; step += 1) {
      now += 95;
      sim.tick(now, inputs);
      const position = sim.getPosition("a");
      expect(position).toBeDefined();
      const current = position as WorkerPosition;
      const currentDistance = distance(current, target);
      // Strictly closer each tick until arrival.
      expect(currentDistance).toBeLessThan(previousDistance);
      // Moved by the ordered speed (motion is purely along x here).
      expect(distance(current, previous)).toBeCloseTo(9, 5);
      previousDistance = currentDistance;
      previous = current;
    }
  });

  it("emits a commit and clears the order on arrival", () => {
    const sim = new MovementSimulation();
    const map = createMap();
    const worker = makeWorker("a", { x: 460, y: 300 });
    const inputs: MovementTickInputs = { workers: [worker], mapData: map, wanderSuppressedWorkerIds: noSuppression };
    const target = { x: 500, y: 300 };

    sim.issueMoveOrders([
      { workerId: "a", waypoints: [target], speedPerTick: 9, commitOnArrival: true, source: "manual" }
    ]);

    const commits: PositionCommit[] = [];
    let now = 0;
    for (let step = 0; step < 12 && commits.length === 0; step += 1) {
      now += 95;
      commits.push(...sim.tick(now, inputs).commits);
    }

    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({ workerId: "a", position: target });
    expect(sim.getPosition("a")).toEqual(target);

    // Order is done: a further tick produces no more movement or commits.
    const after = sim.tick(now + 95, inputs);
    expect(after.commits).toHaveLength(0);
    expect(sim.getPosition("a")).toEqual(target);
  });
});

describe("MovementSimulation walkability", () => {
  it("never steps a worker into a collision tile", () => {
    const map = createMap(20, 20, ["10,3"]);
    const sim = new MovementSimulation();
    // Start at the centre of the walkable tile (9,3); aim straight into collision tile (10,3).
    const worker = makeWorker("a", { x: 9 * 32 + 16, y: 3 * 32 + 16 });
    const inputs: MovementTickInputs = { workers: [worker], mapData: map, wanderSuppressedWorkerIds: noSuppression };
    const target = { x: 10 * 32 + 16, y: 3 * 32 + 16 };

    sim.issueMoveOrders([
      { workerId: "a", waypoints: [target], speedPerTick: 9, commitOnArrival: true, source: "manual" }
    ]);

    let now = 0;
    for (let step = 0; step < 10; step += 1) {
      now += 95;
      sim.tick(now, inputs);
      const position = sim.getPosition("a") ?? worker.position;
      expect(isWorldPositionWalkable(position, map)).toBe(true);
      // Must not enter the blocked column.
      expect(Math.floor(position.x / map.tileSize)).toBeLessThan(10);
    }
  });

  it("rescues a worker stranded on an unwalkable tile and commits the safe spot", () => {
    const map = createMap(20, 20, ["10,3"]);
    const sim = new MovementSimulation();
    const stranded = { x: 10 * 32 + 16, y: 3 * 32 + 16 };
    const worker = makeWorker("a", stranded);
    const inputs: MovementTickInputs = { workers: [worker], mapData: map, wanderSuppressedWorkerIds: noSuppression };

    const { commits } = sim.tick(95, inputs);

    expect(commits).toHaveLength(1);
    expect(commits[0].workerId).toBe("a");
    expect(isWorldPositionWalkable(commits[0].position, map)).toBe(true);
    const rescued = sim.getPosition("a");
    expect(rescued).toBeDefined();
    expect(isWorldPositionWalkable(rescued as WorkerPosition, map)).toBe(true);
  });
});

describe("MovementSimulation crowding", () => {
  it("stops a wandering worker before it violates personal space", () => {
    const personalSpacePx = 26;
    const sim = new MovementSimulation({ personalSpacePx });
    const map = createMap();
    const mover = makeWorker("mover", { x: 100, y: 300 }, { movementMode: "wander" });
    const blocker = makeWorker("blocker", { x: 200, y: 300 }, { movementMode: "wander" });
    const inputs: MovementTickInputs = {
      workers: [mover, blocker],
      mapData: map,
      wanderSuppressedWorkerIds: noSuppression
    };

    // Drive a wander-source order straight at the blocker.
    sim.issueMoveOrders([
      { workerId: "mover", waypoints: [{ x: 200, y: 300 }], speedPerTick: 20, commitOnArrival: false, source: "wander" }
    ]);

    let now = 0;
    for (let step = 0; step < 10; step += 1) {
      now += 95;
      sim.tick(now, inputs);
      const moverPosition = sim.getPosition("mover") ?? mover.position;
      expect(distance(moverPosition, blocker.position)).toBeGreaterThanOrEqual(personalSpacePx);
    }
  });
});

describe("MovementSimulation wander", () => {
  it("does not wander before its rest window elapses, then does", () => {
    // Constant-min RNG: rest = 2000ms, wander target due east of the anchor.
    const sim = new MovementSimulation({ rng: () => 0 });
    const map = createMap();
    const worker = makeWorker("w", { x: 300, y: 300 }, { movementMode: "wander", status: "idle" });
    const inputs: MovementTickInputs = { workers: [worker], mapData: map, wanderSuppressedWorkerIds: noSuppression };

    sim.tick(1000, inputs); // seeds nextMoveAfterMs = 1000 + 2000 = 3000
    expect(sim.getPosition("w")).toBeUndefined();

    sim.tick(2999, inputs);
    expect(sim.getPosition("w")).toBeUndefined();

    sim.tick(3000, inputs);
    expect(sim.getPosition("w")).toBeDefined();
  });

  it("keeps wandering workers on walkable tiles within bounds", () => {
    const map = createMap(24, 24, ["8,8", "9,8", "8,9", "9,9"]);
    const sim = new MovementSimulation({ rng: seededRng(1234) });
    const workers = [
      makeWorker("w1", { x: 300, y: 300 }, { movementMode: "wander" }),
      makeWorker("w2", { x: 360, y: 320 }, { movementMode: "wander" }),
      makeWorker("w3", { x: 420, y: 280 }, { movementMode: "wander" })
    ];
    const inputs: MovementTickInputs = { workers, mapData: map, wanderSuppressedWorkerIds: noSuppression };

    let now = 0;
    for (let step = 0; step < 400; step += 1) {
      now += 95;
      sim.tick(now, inputs);
      const positions = sim.getPositions();
      for (const position of Object.values(positions)) {
        expect(isWorldPositionWalkable(position, map)).toBe(true);
      }
    }
  });

  it("excludes suppressed workers from wander and cancels their active wander order", () => {
    const sim = new MovementSimulation({ rng: () => 0 });
    const map = createMap();
    const worker = makeWorker("w", { x: 300, y: 300 }, { movementMode: "wander", status: "idle" });
    const suppressed: ReadonlySet<string> = new Set(["w"]);
    const suppressedInputs: MovementTickInputs = { workers: [worker], mapData: map, wanderSuppressedWorkerIds: suppressed };
    const freeInputs: MovementTickInputs = { workers: [worker], mapData: map, wanderSuppressedWorkerIds: noSuppression };

    sim.tick(1000, suppressedInputs); // seeds rest window
    sim.tick(3000, suppressedInputs); // rest elapsed, but suppressed => no wander
    sim.tick(5000, suppressedInputs);
    expect(sim.getPosition("w")).toBeUndefined();

    // Let it start wandering while free, then suppress mid-wander.
    sim.tick(6000, freeInputs);
    const wandering = sim.getPosition("w");
    expect(wandering).toBeDefined();

    sim.tick(6095, suppressedInputs);
    const afterSuppress = sim.getPosition("w");
    // The active wander order is cancelled: the worker freezes at its last spot.
    expect(afterSuppress).toEqual(sim.getPosition("w"));
    sim.tick(6190, suppressedInputs);
    expect(sim.getPosition("w")).toEqual(afterSuppress);
  });
});

describe("MovementSimulation lifecycle", () => {
  it("drops orders and positions for workers that disappear", () => {
    const sim = new MovementSimulation();
    const map = createMap();
    const worker = makeWorker("a", { x: 100, y: 300 });

    sim.issueMoveOrders([
      { workerId: "a", waypoints: [{ x: 500, y: 300 }], speedPerTick: 9, commitOnArrival: true, source: "manual" }
    ]);
    sim.tick(95, { workers: [worker], mapData: map, wanderSuppressedWorkerIds: noSuppression });
    expect(sim.getPosition("a")).toBeDefined();

    // Worker gone: its stale order and animated position are garbage-collected.
    const result = sim.tick(190, { workers: [], mapData: map, wanderSuppressedWorkerIds: noSuppression });
    expect(sim.getPosition("a")).toBeUndefined();
    expect(result.commits).toHaveLength(0);
  });

  it("retains fading workers' animated positions for their despawn animation", () => {
    const sim = new MovementSimulation();
    const map = createMap();
    const worker = makeWorker("a", { x: 100, y: 300 });

    sim.issueMoveOrders([
      { workerId: "a", waypoints: [{ x: 500, y: 300 }], speedPerTick: 9, commitOnArrival: true, source: "manual" }
    ]);
    sim.tick(95, { workers: [worker], mapData: map, wanderSuppressedWorkerIds: noSuppression });
    const lastPosition = sim.getPosition("a");
    expect(lastPosition).toBeDefined();

    sim.tick(190, {
      workers: [],
      mapData: map,
      wanderSuppressedWorkerIds: noSuppression,
      fadingWorkerIds: new Set(["a"])
    });
    expect(sim.getPosition("a")).toEqual(lastPosition);
  });
});

describe("MovementSimulation nudge", () => {
  it("shifts selected workers, reports movers, and respects walkability", () => {
    const map = createMap(20, 20, ["10,3"]);
    const sim = new MovementSimulation();
    const free = makeWorker("free", { x: 100, y: 300 });
    const blocked = makeWorker("blocked", { x: 9 * 32 + 30, y: 3 * 32 + 16 }); // one step from collision tile (10,3)

    const moved = sim.nudgeWorkers(["free", "blocked"], 20, 0, {
      workers: [free, blocked],
      mapData: map,
      nowMs: 1000
    });

    expect(moved).toEqual(["free"]);
    expect(sim.getPosition("free")).toEqual({ x: 120, y: 300 });
    expect(sim.getPosition("blocked")).toBeUndefined();
  });
});
