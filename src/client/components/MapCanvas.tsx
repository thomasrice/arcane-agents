import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import type { Worker, WorkerPosition } from "../../shared/types";
import { cornerKey, useOutpostMap, type LoadedOutpostMap } from "../map/tileMapLoader";
import {
  getSpriteFrame,
  type CharacterSpriteSet,
  type SpriteDirection,
  useCharacterSpriteLibrary
} from "../sprites/spriteLoader";

interface MapCanvasProps {
  workers: Worker[];
  fadingWorkers?: Array<{ worker: Worker; startedAtMs: number }>;
  selectedWorkerId?: string;
  terminalFocusedSelected?: boolean;
  controlGroups?: Partial<Record<number, string>>;
  onSelect: (workerId: string | undefined) => void;
  onActivateWorker?: (workerId: string) => void;
  onPositionCommit: (workerId: string, position: WorkerPosition) => void;
  centerOnWorkerId?: string;
  centerRequestKey?: number;
}

interface ViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface HoverInfo {
  worker: Worker;
  screenX: number;
  screenY: number;
}

interface WorkerMotion {
  moving: boolean;
  facing: SpriteDirection;
}

interface ActivityOverlayAnimationState {
  text: string;
  animate: boolean;
  revealedLength: number;
  lastRevealAtMs: number;
  fullyRevealedAtMs: number | undefined;
}

interface ActivityOverlayRenderState {
  text: string;
  shimmerPhase: number | undefined;
}

interface MoveOrder {
  waypoints: WorkerPosition[];
  waypointIndex: number;
  speedPerTick: number;
  commitOnArrival: boolean;
  source: "manual" | "wander";
}

interface WanderState {
  anchor: WorkerPosition;
  nextMoveAfterMs: number;
}

interface PanDragState {
  pointerId: number;
  mode: "pan" | "click";
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  deselectOnClick: boolean;
}

interface SpriteBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectedWorkerOutline {
  screenX: number;
  screenY: number;
  radius: number;
  spriteBounds?: SpriteBounds;
}

interface WorkerNameplate {
  anchorX: number;
  topY: number;
  label: string;
  visible: boolean;
}

interface CollisionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CommandFeedback {
  kind: "ok" | "blocked";
  workerId: string;
  startedAtMs: number;
  durationMs: number;
  destination: WorkerPosition;
  path?: WorkerPosition[];
}

const workerRadius = 13;
const spriteBaseSize = 64;
const spriteAnchorYFactor = 0.84;
const moveSpeedPerTick = 9;
const movementIntervalMs = 95;
const walkAnimationIntervalMs = 72;
const keyboardPanSpeedPerSecond = 520;
const keyboardMoveStepTiles = 0.75;
const pointerPanDragThreshold = 4;
const defaultZoomScale = 1.45;
const recenterVisibilityPaddingPx = 56;
const fadingWorkerDurationMs = 420;
const summonWorkerDurationMs = 520;
const commandFeedbackDurationMs = 900;
const blockedFeedbackDurationMs = 750;
const workerPersonalSpacePx = 26;
const blockedTerrainValues = new Set([3]);
const nonBlockingObjectTypes = new Set(["torch", "signpost", "barrel", "crate", "bush"]);
const fullBodyCollisionObjectTypes = new Set(["oak-tree", "pine-tree", "tent"]);
const defaultMapPreviewImageUrl = "/api/assets/maps/backgrounds/outpost-v1-2x.png";
const occlusionOverlayAlpha = 0.98;
const occludedGhostAlpha = 0.44;
const activityOverlayTypingCharIntervalMs = 30;
const activityOverlayTextMaxLength = 64;
const activityOverlayMaxBadgeWidth = 320;
const activityOverlayShimmerStartDelayMs = 1500;
const activityOverlayShimmerCycleMs = 1800;
const activityOverlayShimmerBandChars = 3.4;
const flameRegionMaskCache = new Map<string, { canvas: HTMLCanvasElement; heatCoverage: number }>();
const flameMaskVersion = "v4";

export function MapCanvas({
  workers,
  fadingWorkers,
  selectedWorkerId,
  terminalFocusedSelected,
  controlGroups,
  onSelect,
  onActivateWorker,
  onPositionCommit,
  centerOnWorkerId,
  centerRequestKey
}: MapCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastCenterRequestRef = useRef<number | undefined>(undefined);
  const previousWorkerPositionsRef = useRef<Record<string, WorkerPosition>>({});
  const workerMovingUntilRef = useRef<Record<string, number>>({});
  const workerFacingRef = useRef<Record<string, SpriteDirection>>({});
  const moveOrdersRef = useRef<Record<string, MoveOrder>>({});
  const wanderStateRef = useRef<Record<string, WanderState>>({});
  const animatedPositionsRef = useRef<Record<string, WorkerPosition>>({});
  const panDragRef = useRef<PanDragState | null>(null);
  const pressedPanKeysRef = useRef<Set<PanDirection>>(new Set());
  const panRafRef = useRef<number | null>(null);
  const lastPanFrameRef = useRef<number | null>(null);
  const activityOverlayAnimationRef = useRef<Record<string, ActivityOverlayAnimationState>>({});

  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 640 });
  const [viewport, setViewport] = useState<ViewportState>({
    scale: defaultZoomScale,
    offsetX: 70,
    offsetY: 25
  });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [animatedPositions, setAnimatedPositions] = useState<Record<string, WorkerPosition>>({});
  const [animationTick, setAnimationTick] = useState(0);
  const [walkAnimationTick, setWalkAnimationTick] = useState(0);
  const [hasCenteredOnMap, setHasCenteredOnMap] = useState(false);
  const [commandFeedback, setCommandFeedback] = useState<CommandFeedback | null>(null);
  const [mapPreviewImage, setMapPreviewImage] = useState<HTMLImageElement | undefined>(undefined);

  const { mapData, errorText: mapErrorText } = useOutpostMap();
  const mapPreviewImageUrl = mapData?.backgroundImageUrl ?? defaultMapPreviewImageUrl;

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setMapPreviewImage(image);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setMapPreviewImage(undefined);
      }
    };
    image.src = mapPreviewImageUrl;

    return () => {
      cancelled = true;
    };
  }, [mapPreviewImageUrl]);

  const workerPositionLookup = useMemo(
    () => new Map<string, WorkerPosition>(workers.map((worker) => [worker.id, animatedPositions[worker.id] ?? worker.position])),
    [animatedPositions, workers]
  );

  const spriteTypes = useMemo(() => Array.from(new Set(workers.map((worker) => worker.avatarType))), [workers]);
  const spriteLibrary = useCharacterSpriteLibrary(spriteTypes);
  const useLegacyMapBlockers = !mapData?.backgroundImageUrl;
  const mapCollisionRects = useMemo(() => buildObjectCollisionRects(mapData, useLegacyMapBlockers), [mapData, useLegacyMapBlockers]);
  const blockedTileKeys = useMemo(() => buildBlockedTileSet(mapData, mapCollisionRects), [mapCollisionRects, mapData]);

  useEffect(() => {
    animatedPositionsRef.current = animatedPositions;
  }, [animatedPositions]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const { width, height } = entry.contentRect;
      setCanvasSize({
        width: Math.max(300, Math.floor(width)),
        height: Math.max(220, Math.floor(height))
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const activeWorkerIds = new Set(workers.map((worker) => worker.id));
    const fadingWorkerIds = new Set((fadingWorkers ?? []).map((item) => item.worker.id));
    const now = performance.now();

    for (const workerId of Object.keys(moveOrdersRef.current)) {
      if (!activeWorkerIds.has(workerId)) {
        delete moveOrdersRef.current[workerId];
      }
    }

    for (const workerId of Object.keys(wanderStateRef.current)) {
      if (!activeWorkerIds.has(workerId)) {
        delete wanderStateRef.current[workerId];
      }
    }

    for (const worker of workers) {
      const existing = wanderStateRef.current[worker.id];
      if (!existing) {
        wanderStateRef.current[worker.id] = {
          anchor: { ...worker.position },
          nextMoveAfterMs: now + randomRange(2000, 5000)
        };
        continue;
      }

      if (Math.hypot(existing.anchor.x - worker.position.x, existing.anchor.y - worker.position.y) > 5) {
        existing.anchor = { ...worker.position };
      }
    }

    setAnimatedPositions((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const workerId of Object.keys(next)) {
        if (!activeWorkerIds.has(workerId) && !fadingWorkerIds.has(workerId)) {
          delete next[workerId];
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [fadingWorkers, workers]);

  useEffect(() => {
    const walkAnimationInterval = window.setInterval(() => {
      setWalkAnimationTick((current) => (current + 1) % 1000000);
    }, walkAnimationIntervalMs);

    return () => {
      clearInterval(walkAnimationInterval);
    };
  }, []);

  useEffect(() => {
    const animationInterval = window.setInterval(() => {
      setAnimationTick((current) => (current + 1) % 1000000);

      const orders = moveOrdersRef.current;
      const workersById = new Map(workers.map((worker) => [worker.id, worker]));
      const nextPositions = { ...animatedPositionsRef.current };
      const commitQueue: Array<{ workerId: string; position: WorkerPosition }> = [];
      let changed = false;
      const now = performance.now();
      const tileSize = mapData?.tileSize ?? 32;
      const collisionRects = mapCollisionRects;

      if (selectedWorkerId) {
        const selectedOrder = orders[selectedWorkerId];
        if (selectedOrder?.source === "wander") {
          delete orders[selectedWorkerId];
        }
      }

      for (const worker of workers) {
        if (worker.status !== "working" && worker.movementMode === "wander") {
          continue;
        }

        const activeOrder = orders[worker.id];
        if (activeOrder?.source === "wander") {
          delete orders[worker.id];
          const wanderState = wanderStateRef.current[worker.id];
          if (wanderState) {
            wanderState.nextMoveAfterMs = now + randomRange(2000, 5000);
          }
        }
      }

      for (const worker of workers) {
        if (worker.id === selectedWorkerId) {
          continue;
        }

        if (worker.movementMode !== "wander") {
          continue;
        }

        if (worker.status === "working") {
          continue;
        }

        if (orders[worker.id]) {
          continue;
        }

        const wanderState = wanderStateRef.current[worker.id];
        if (!wanderState || now < wanderState.nextMoveAfterMs) {
          continue;
        }

        const nextTarget = randomWanderTarget(wanderState.anchor, tileSize, mapData, collisionRects);
        const currentPosition = nextPositions[worker.id] ?? worker.position;
        const distance = Math.hypot(nextTarget.x - currentPosition.x, nextTarget.y - currentPosition.y);
        if (distance < 6) {
          wanderState.nextMoveAfterMs = now + randomRange(2000, 5000);
          continue;
        }

        const durationMs = randomRange(1000, 2000);
        const steps = Math.max(8, durationMs / movementIntervalMs);
        const waypoints = createCardinalWaypoints(currentPosition, nextTarget);

        orders[worker.id] = {
          waypoints,
          waypointIndex: 0,
          speedPerTick: Math.max(1.1, distance / steps),
          commitOnArrival: false,
          source: "wander"
        };
      }

      if (Object.keys(orders).length > 0) {
        const isCrowdedByOtherWorker = (workerId: string, position: WorkerPosition): boolean => {
          for (const [otherWorkerId, otherWorker] of workersById.entries()) {
            if (otherWorkerId === workerId) {
              continue;
            }

            const otherPosition = nextPositions[otherWorkerId] ?? otherWorker.position;
            if (Math.hypot(position.x - otherPosition.x, position.y - otherPosition.y) < workerPersonalSpacePx) {
              return true;
            }
          }

          return false;
        };

        for (const [workerId, order] of Object.entries(orders)) {
          const worker = workersById.get(workerId);
          if (!worker) {
            delete orders[workerId];
            if (nextPositions[workerId]) {
              delete nextPositions[workerId];
              changed = true;
            }
            continue;
          }

        const currentPosition = nextPositions[workerId] ?? worker.position;
        const targetWaypoint = order.waypoints[order.waypointIndex];
        if (!targetWaypoint) {
          delete orders[workerId];
          continue;
        }

        const dx = targetWaypoint.x - currentPosition.x;
        const dy = targetWaypoint.y - currentPosition.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= order.speedPerTick) {
          const finalPosition = {
            x: targetWaypoint.x,
            y: targetWaypoint.y
          };

          if (order.source === "wander" && isCrowdedByOtherWorker(workerId, finalPosition)) {
            delete orders[workerId];
            const wanderState = wanderStateRef.current[workerId];
            if (wanderState) {
              wanderState.nextMoveAfterMs = now + randomRange(900, 1800);
            }
            continue;
          }

          if (!isWorldPositionWalkable(finalPosition, mapData, collisionRects)) {
            delete orders[workerId];
            const wanderState = wanderStateRef.current[workerId];
            if (wanderState) {
              wanderState.nextMoveAfterMs = now + randomRange(2000, 5000);
            }
            continue;
          }

          nextPositions[workerId] = finalPosition;

          if (order.waypointIndex < order.waypoints.length - 1) {
            order.waypointIndex += 1;
            changed = true;
            continue;
          }

          delete orders[workerId];

          if (order.commitOnArrival) {
            commitQueue.push({
              workerId,
              position: finalPosition
            });
          } else {
            const wanderState = wanderStateRef.current[workerId];
            if (wanderState) {
              wanderState.nextMoveAfterMs = now + randomRange(2000, 5000);
            }
          }

          changed = true;
          continue;
        }

        const proposedPosition = {
          x: currentPosition.x + (dx / distance) * order.speedPerTick,
          y: currentPosition.y + (dy / distance) * order.speedPerTick
        };

        if (order.source === "wander" && isCrowdedByOtherWorker(workerId, proposedPosition)) {
          delete orders[workerId];
          const wanderState = wanderStateRef.current[workerId];
          if (wanderState) {
            wanderState.nextMoveAfterMs = now + randomRange(900, 1800);
          }
          continue;
        }

        if (!isWorldPositionWalkable(proposedPosition, mapData, collisionRects)) {
          delete orders[workerId];
          const wanderState = wanderStateRef.current[workerId];
          if (wanderState) {
            wanderState.nextMoveAfterMs = now + randomRange(2000, 5000);
          }
          continue;
        }

          nextPositions[workerId] = proposedPosition;
          changed = true;
        }
      }

      for (const worker of workers) {
        if (orders[worker.id]) {
          continue;
        }

        const currentPosition = nextPositions[worker.id] ?? worker.position;
        if (!isWorldPositionWalkable(currentPosition, mapData, collisionRects)) {
          const safePosition = findNearestWalkablePosition(currentPosition, mapData, collisionRects);
          if (safePosition) {
            nextPositions[worker.id] = safePosition;
            commitQueue.push({
              workerId: worker.id,
              position: safePosition
            });
            changed = true;
          }
        }

        const staged = nextPositions[worker.id];
        if (!staged) {
          continue;
        }

        if (Math.hypot(staged.x - worker.position.x, staged.y - worker.position.y) < 0.5) {
          delete nextPositions[worker.id];
          changed = true;
        }
      }

      if (changed) {
        animatedPositionsRef.current = nextPositions;
        setAnimatedPositions(nextPositions);
      }

      for (const commit of commitQueue) {
        onPositionCommit(commit.workerId, {
          x: Math.round(commit.position.x * 10) / 10,
          y: Math.round(commit.position.y * 10) / 10
        });
      }
    }, movementIntervalMs);

    return () => {
      clearInterval(animationInterval);
    };
  }, [mapCollisionRects, mapData, onPositionCommit, selectedWorkerId, workers]);

  useEffect(() => {
    if (!mapData || hasCenteredOnMap) {
      return;
    }

    const centerX = (mapData.width * mapData.tileSize) / 2;
    const centerY = (mapData.height * mapData.tileSize) / 2;

    setViewport((current) => ({
      ...current,
      offsetX: canvasSize.width / 2 - centerX * current.scale,
      offsetY: canvasSize.height / 2 - centerY * current.scale
    }));
    setHasCenteredOnMap(true);
  }, [canvasSize.height, canvasSize.width, hasCenteredOnMap, mapData]);

  useEffect(() => {
    if (!centerOnWorkerId || centerRequestKey === undefined) {
      return;
    }

    if (lastCenterRequestRef.current === centerRequestKey) {
      return;
    }

    const worker = workers.find((item) => item.id === centerOnWorkerId);
    if (!worker) {
      return;
    }

    lastCenterRequestRef.current = centerRequestKey;
    const position = animatedPositions[worker.id] ?? worker.position;

    const workerScreenPosition = worldToScreen(position.x, position.y, viewport);
    if (
      isInsideViewport(
        workerScreenPosition,
        canvasSize.width,
        canvasSize.height,
        recenterVisibilityPaddingPx
      )
    ) {
      return;
    }

    setViewport((current) => ({
      ...current,
      offsetX: canvasSize.width / 2 - position.x * current.scale,
      offsetY: canvasSize.height / 2 - position.y * current.scale
    }));
  }, [animatedPositions, canvasSize.height, canvasSize.width, centerOnWorkerId, centerRequestKey, viewport, workers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvasSize.width * devicePixelRatio);
    canvas.height = Math.floor(canvasSize.height * devicePixelRatio);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    const workerMotion = deriveWorkerMotion(
      workers,
      workerPositionLookup,
      previousWorkerPositionsRef.current,
      workerMovingUntilRef.current,
      workerFacingRef.current,
      performance.now()
    );
    const activityOverlayStateByWorker = deriveActivityOverlayStateByWorker(
      workers,
      activityOverlayAnimationRef.current,
      Date.now()
    );

    drawScene({
      context,
      width: canvasSize.width,
      height: canvasSize.height,
      workers,
      fadingWorkers,
      displayedPositions: animatedPositions,
      workerMotion,
      selectedWorkerId,
      terminalFocusedSelected,
      controlGroups,
      viewport,
      mapData,
      spriteLibrary,
      animationTick,
      walkAnimationTick,
      commandFeedback,
      mapPreviewImage,
      activityOverlayStateByWorker
    });
  }, [
    animatedPositions,
    animationTick,
    walkAnimationTick,
    canvasSize,
    controlGroups,
    fadingWorkers,
    mapData,
    selectedWorkerId,
    terminalFocusedSelected,
    spriteLibrary,
    commandFeedback,
    mapPreviewImage,
    viewport,
    workerPositionLookup,
    workers
  ]);

  const issueManualMoveToWorld = useCallback(
    (worker: Worker, targetWorld: WorkerPosition): boolean => {
      if (!mapData) {
        return false;
      }

      const target = clampWorldPosition(targetWorld, mapData);
      const currentPosition = animatedPositionsRef.current[worker.id] ?? worker.position;
      const nowMs = Date.now();
      const normalizedTarget = {
        x: Math.round(target.x * 10) / 10,
        y: Math.round(target.y * 10) / 10
      };

      const startTile = worldPositionToTile(currentPosition, mapData);
      const goalTileCandidate = worldPositionToTile(normalizedTarget, mapData);
      const startTileWalkable = isTileWalkable(startTile.x, startTile.y, mapData, blockedTileKeys);
      const goalTileWalkable = isTileWalkable(goalTileCandidate.x, goalTileCandidate.y, mapData, blockedTileKeys);

      const startTileResolved = startTileWalkable
        ? startTile
        : findNearestWalkableTile(startTile, mapData, blockedTileKeys);

      const goalTileResolved = goalTileWalkable
        ? goalTileCandidate
        : findNearestWalkableTile(goalTileCandidate, mapData, blockedTileKeys);

      if (!startTileResolved || !goalTileResolved) {
        setCommandFeedback({
          kind: "blocked",
          workerId: worker.id,
          startedAtMs: nowMs,
          durationMs: blockedFeedbackDurationMs,
          destination: normalizedTarget
        });
        return false;
      }

      const tilePath = findTilePath(startTileResolved, goalTileResolved, mapData, blockedTileKeys);
      if (!tilePath || tilePath.length === 0) {
        setCommandFeedback({
          kind: "blocked",
          workerId: worker.id,
          startedAtMs: nowMs,
          durationMs: blockedFeedbackDurationMs,
          destination: normalizedTarget
        });
        return false;
      }

      const waypoints = tilePathToWaypoints(tilePath, mapData);

      if (waypoints.length === 0) {
        setCommandFeedback({
          kind: "blocked",
          workerId: worker.id,
          startedAtMs: nowMs,
          durationMs: blockedFeedbackDurationMs,
          destination: normalizedTarget
        });
        return false;
      }

      const resolvedDestination = waypoints[waypoints.length - 1] ?? normalizedTarget;

      moveOrdersRef.current[worker.id] = {
        waypoints,
        waypointIndex: 0,
        speedPerTick: moveSpeedPerTick,
        commitOnArrival: true,
        source: "manual"
      };

      setAnimatedPositions((current) => {
        if (current[worker.id]) {
          return current;
        }

        return {
          ...current,
          [worker.id]: worker.position
        };
      });

      setCommandFeedback({
        kind: "ok",
        workerId: worker.id,
        startedAtMs: nowMs,
        durationMs: commandFeedbackDurationMs,
        destination: resolvedDestination,
        path: [currentPosition, ...waypoints]
      });

      return true;
    },
    [blockedTileKeys, mapData]
  );

  useEffect(() => {
    const stopPanLoop = () => {
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      lastPanFrameRef.current = null;
    };

    const panStep = (timestamp: number) => {
      const pressed = pressedPanKeysRef.current;
      if (pressed.size === 0) {
        stopPanLoop();
        return;
      }

      const lastFrame = lastPanFrameRef.current ?? timestamp;
      const deltaSeconds = Math.min(0.05, (timestamp - lastFrame) / 1000);
      lastPanFrameRef.current = timestamp;

      let xAxis = 0;
      let yAxis = 0;

      if (pressed.has("left")) {
        xAxis += 1;
      }
      if (pressed.has("right")) {
        xAxis -= 1;
      }
      if (pressed.has("up")) {
        yAxis += 1;
      }
      if (pressed.has("down")) {
        yAxis -= 1;
      }

      if (xAxis !== 0 || yAxis !== 0) {
        const vectorLength = Math.hypot(xAxis, yAxis);
        const speed = keyboardPanSpeedPerSecond * deltaSeconds;
        const deltaX = (xAxis / vectorLength) * speed;
        const deltaY = (yAxis / vectorLength) * speed;

        setViewport((current) => ({
          ...current,
          offsetX: current.offsetX + deltaX,
          offsetY: current.offsetY + deltaY
        }));
      }

      panRafRef.current = requestAnimationFrame(panStep);
    };

    const startPanLoop = () => {
      if (panRafRef.current !== null) {
        return;
      }
      lastPanFrameRef.current = null;
      panRafRef.current = requestAnimationFrame(panStep);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const direction = toPanDirection(event.key);
      if (!direction) {
        return;
      }

      const wasdKey = isWasdKey(event.key);

      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && wasdKey) {
        if (terminalFocusedSelected || !selectedWorkerId) {
          return;
        }

        const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId);
        if (!selectedWorker) {
          return;
        }

        event.preventDefault();

        const currentPosition = animatedPositionsRef.current[selectedWorker.id] ?? selectedWorker.position;
        const stepSize = (mapData?.tileSize ?? 32) * keyboardMoveStepTiles;
        const targetPosition = offsetPositionByDirection(currentPosition, direction, stepSize);
        issueManualMoveToWorld(selectedWorker, targetPosition);
        return;
      }

      if (wasdKey && !event.shiftKey) {
        return;
      }

      event.preventDefault();
      pressedPanKeysRef.current.add(direction);
      startPanLoop();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const direction = toPanDirection(event.key);
      if (!direction) {
        return;
      }

      pressedPanKeysRef.current.delete(direction);
      if (pressedPanKeysRef.current.size === 0) {
        stopPanLoop();
      }
    };

    const onBlur = () => {
      pressedPanKeysRef.current.clear();
      stopPanLoop();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      stopPanLoop();
      pressedPanKeysRef.current.clear();
    };
  }, [issueManualMoveToWorld, mapData, selectedWorkerId, terminalFocusedSelected, workers]);

  const issueManualMoveOrder = (worker: Worker, point: { x: number; y: number }) => {
    const target = screenToWorld(point.x, point.y, viewport);
    issueManualMoveToWorld(worker, target);
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();

    if (event.button === 2) {
      event.preventDefault();

      if (selectedWorkerId) {
        const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId);
        if (!selectedWorker) {
          return;
        }

        const point = readPointerOnCanvas(event);
        issueManualMoveOrder(selectedWorker, point);
        return;
      }

      const point = readPointerOnCanvas(event);
      panDragRef.current = {
        pointerId: event.pointerId,
        mode: "pan",
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false,
        deselectOnClick: false
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const point = readPointerOnCanvas(event);
    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport, spriteLibrary);

    if (hit) {
      if (hit.id === selectedWorkerId) {
        onActivateWorker?.(hit.id);
      } else {
        onSelect(hit.id);
      }
      return;
    }

    panDragRef.current = {
      pointerId: event.pointerId,
      mode: "click",
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      moved: false,
      deselectOnClick: Boolean(selectedWorkerId)
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = readPointerOnCanvas(event);

    const panDrag = panDragRef.current;
    if (panDrag && panDrag.pointerId === event.pointerId) {
      const deltaX = point.x - panDrag.lastX;
      const deltaY = point.y - panDrag.lastY;
      const dragDistance = Math.hypot(point.x - panDrag.startX, point.y - panDrag.startY);

      if (!panDrag.moved && dragDistance >= pointerPanDragThreshold) {
        panDrag.moved = true;
      }

      if (panDrag.mode === "pan" && panDrag.moved && (deltaX !== 0 || deltaY !== 0)) {
        setViewport((current) => ({
          ...current,
          offsetX: current.offsetX + deltaX,
          offsetY: current.offsetY + deltaY
        }));
        setHover(null);
      }

      panDrag.lastX = point.x;
      panDrag.lastY = point.y;
      return;
    }

    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport, spriteLibrary);

    if (!hit) {
      setHover(null);
      return;
    }

    setHover({
      worker: hit,
      screenX: point.x,
      screenY: point.y
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const panDrag = panDragRef.current;
    if (!panDrag || panDrag.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panDragRef.current = null;

    if (panDrag.mode === "pan" && panDrag.moved) {
      return;
    }

    if (panDrag.deselectOnClick && selectedWorkerId) {
      onSelect(undefined);
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
  };

  const handleDoubleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }

    const point = readPointerOnCanvas(event);
    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport, spriteLibrary);
    if (!hit) {
      return;
    }

    onActivateWorker?.(hit.id);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLCanvasElement>) => {
    const panDrag = panDragRef.current;
    if (!panDrag || panDrag.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panDragRef.current = null;
  };

  const handlePointerLeave = () => {
    if (!panDragRef.current) {
      setHover(null);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const point = readPointerOnCanvas(event);
    const worldBeforeZoom = screenToWorld(point.x, point.y, viewport);
    const zoomDelta = event.deltaY < 0 ? 1.1 : 0.9;

    setViewport((current) => {
      const nextScale = clamp(current.scale * zoomDelta, 0.55, 2.4);
      return {
        scale: nextScale,
        offsetX: point.x - worldBeforeZoom.x * nextScale,
        offsetY: point.y - worldBeforeZoom.y * nextScale
      };
    });
  };

  return (
    <div className="map-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
      />

      {hover ? (
        <div className="map-tooltip" style={{ left: hover.screenX + 16, top: hover.screenY + 18 }}>
          <div className="map-tooltip-title">{hover.worker.displayName ?? hover.worker.name}</div>
          <div>
            {hover.worker.projectId} · {hover.worker.runtimeId}
          </div>
          <div>Status: {hover.worker.status}</div>
          <div>Mode: {hover.worker.movementMode === "wander" ? "Wander" : "Hold"}</div>
          {hover.worker.activityTool ? <div>Tool: {hover.worker.activityTool}</div> : null}
          {hover.worker.activityPath ? <div>Path: {hover.worker.activityPath}</div> : null}
          {hover.worker.activityText ? <div>{hover.worker.activityText}</div> : null}
        </div>
      ) : null}

      {mapErrorText ? (
        <div className="map-tooltip" style={{ left: 14, top: 14 }}>
          Map assets failed to load: {mapErrorText}
        </div>
      ) : null}
    </div>
  );
}

interface DrawSceneInput {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  workers: Worker[];
  fadingWorkers?: Array<{ worker: Worker; startedAtMs: number }>;
  displayedPositions: Record<string, WorkerPosition>;
  workerMotion: Record<string, WorkerMotion>;
  selectedWorkerId: string | undefined;
  terminalFocusedSelected: boolean | undefined;
  controlGroups?: Partial<Record<number, string>>;
  viewport: ViewportState;
  mapData: LoadedOutpostMap | undefined;
  spriteLibrary: Partial<Record<string, CharacterSpriteSet>>;
  animationTick: number;
  walkAnimationTick: number;
  commandFeedback: CommandFeedback | null;
  mapPreviewImage: HTMLImageElement | undefined;
  activityOverlayStateByWorker: Record<string, ActivityOverlayRenderState | undefined>;
}

function drawScene({
  context,
  width,
  height,
  workers,
  fadingWorkers,
  displayedPositions,
  workerMotion,
  selectedWorkerId,
  terminalFocusedSelected,
  controlGroups,
  viewport,
  mapData,
  spriteLibrary,
  animationTick,
  walkAnimationTick,
  commandFeedback,
  mapPreviewImage,
  activityOverlayStateByWorker
}: DrawSceneInput): void {
  context.clearRect(0, 0, width, height);
  const nowMs = Date.now();

  const controlGroupsByWorker = groupControlKeysByWorker(controlGroups);

  if (mapData) {
    if (mapPreviewImage) {
      drawOutpostPreviewBackground(context, viewport, mapData, mapPreviewImage);
    } else {
      drawOutpostTerrain(context, viewport, width, height, mapData);
      drawOutpostObjects(context, viewport, width, height, mapData, animationTick);
    }
  } else {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#7fc08b");
    gradient.addColorStop(1, "#4d9f60");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  if (commandFeedback) {
    drawCommandFeedback(context, viewport, commandFeedback, nowMs);
  }

  context.textAlign = "center";
  context.imageSmoothingEnabled = false;
  const activeWorkerIds = new Set(workers.map((worker) => worker.id));
  let selectedOutline: SelectedWorkerOutline | undefined;
  const pendingNameplates: WorkerNameplate[] = [];
  const occludedWorkerIds = new Set<string>();

  if (mapData && mapData.occlusionRects.length > 0) {
    for (const worker of workers) {
      const worldPosition = displayedPositions[worker.id] ?? worker.position;
      if (isWorkerBehindAnyOcclusionRect(worldPosition, mapData)) {
        occludedWorkerIds.add(worker.id);
      }
    }
  }

  const drawWorker = (
    worker: Worker,
    options: {
      queueNameplate?: boolean;
      drawUi?: boolean;
      ghostAlpha?: number;
    } = {}
  ): void => {
    const queueNameplate = options.queueNameplate ?? true;
    const drawUi = options.drawUi ?? true;
    const ghostAlpha = options.ghostAlpha;

    const worldPosition = displayedPositions[worker.id] ?? worker.position;
    const screen = worldToScreen(worldPosition.x, worldPosition.y, viewport);
    const motion = workerMotion[worker.id] ?? { moving: false, facing: "south" as const };
    const displayLabel = worker.displayName ?? worker.name;
    const controlKeys = controlGroupsByWorker.get(worker.id) ?? [];
    const summonProgress = getWorkerSummonProgress(worker.createdAt, nowMs);
    const renderScale = summonProgress === undefined ? viewport.scale : viewport.scale * (0.86 + summonProgress * 0.14);
    const renderAlpha = summonProgress === undefined ? 1 : 0.2 + summonProgress * 0.8;
    const radius = workerRadius * renderScale;

    const spriteSet = spriteLibrary[worker.avatarType];
    const spriteState = motion.moving ? "walking" : worker.status === "working" ? "working" : "idle";
    const spriteFrame = getSpriteFrame(spriteSet, {
      direction: motion.facing,
      state: spriteState,
      frameIndex: spriteState === "walking" ? walkAnimationTick : animationTick
    });

    if (ghostAlpha === undefined) {
      drawCharacterGroundShadow(context, screen.x, screen.y, renderScale);
      if (summonProgress !== undefined) {
        drawSummonEffect(context, screen.x, screen.y, viewport.scale, summonProgress);
      }
    }

    let spriteBounds: SpriteBounds | undefined;
    context.save();
    context.globalAlpha = renderAlpha * (ghostAlpha ?? 1);
    if (spriteFrame) {
      spriteBounds = drawSpriteCharacter(context, spriteFrame, screen.x, screen.y, renderScale, spriteBaseSize);
    } else {
      drawFallbackWorker(context, worker, screen.x, screen.y, radius, renderScale);
    }
    context.restore();

    if (worker.id === selectedWorkerId && !selectedOutline) {
      selectedOutline = {
        screenX: screen.x,
        screenY: screen.y,
        radius,
        spriteBounds
      };
    }

    if (!drawUi) {
      return;
    }

    const activityOverlay = activityOverlayStateByWorker[worker.id];
    if (activityOverlay?.text) {
      context.font = "10px 'Trebuchet MS', sans-serif";
      const badgeTextWidth = Math.ceil(context.measureText(activityOverlay.text).width);
      const badgeWidth = Math.max(44, Math.min(activityOverlayMaxBadgeWidth, badgeTextWidth + 16));
      const badgeHeight = 16;
      const badgeY = spriteBounds ? spriteBounds.y - 20 * viewport.scale : screen.y - radius - 28 * viewport.scale;

      context.fillStyle = "rgba(14, 21, 18, 0.85)";
      context.fillRect(screen.x - badgeWidth / 2, badgeY, badgeWidth, badgeHeight);
      context.strokeStyle = "rgba(237, 244, 210, 0.5)";
      context.lineWidth = 1;
      context.strokeRect(screen.x - badgeWidth / 2, badgeY, badgeWidth, badgeHeight);

      drawActivityOverlayLabel(context, activityOverlay, screen.x, badgeY + 11);
    }

    if (worker.status === "attention") {
      const bubbleX = spriteBounds ? spriteBounds.x + spriteBounds.width + 7 * viewport.scale : screen.x + radius + 9 * viewport.scale;
      const bubbleY = spriteBounds ? spriteBounds.y + 10 * viewport.scale : screen.y - radius - 8 * viewport.scale;

      context.fillStyle = "rgba(245, 185, 78, 0.95)";
      context.beginPath();
      context.arc(bubbleX, bubbleY, 8 * viewport.scale, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#35220d";
      context.font = "11px 'Trebuchet MS', sans-serif";
      context.fillText("!", bubbleX, bubbleY + 4 * viewport.scale);
    }

    if (controlKeys.length > 0) {
      const indicatorAnchorX = spriteBounds ? spriteBounds.x + spriteBounds.width / 2 : screen.x;
      let indicatorY = spriteBounds ? spriteBounds.y - 18 * viewport.scale : screen.y - radius - 24 * viewport.scale;
      if (activityOverlay?.text) {
        indicatorY -= 18 * viewport.scale;
      }

      drawControlGroupIndicator(context, indicatorAnchorX, indicatorY, controlKeys, viewport.scale);
    }

    if (queueNameplate) {
      pendingNameplates.push({
        anchorX: spriteBounds ? spriteBounds.x + spriteBounds.width / 2 : screen.x,
        topY: (spriteBounds ? spriteBounds.y + spriteBounds.height : screen.y + radius) + 8 * viewport.scale,
        label: displayLabel,
        visible: !occludedWorkerIds.has(worker.id)
      });
    }
  };

  if (mapData && mapPreviewImage && mapData.occlusionRects.length > 0) {
    for (const worker of workers) {
      if (occludedWorkerIds.has(worker.id)) {
        drawWorker(worker, {
          queueNameplate: false
        });
      }
    }

    drawOutpostOcclusionOverlay(context, viewport, width, height, mapData, mapPreviewImage);
    drawAmbientFlameEffects(context, viewport, width, height, mapData, mapPreviewImage, nowMs);

    for (const worker of workers) {
      if (!occludedWorkerIds.has(worker.id)) {
        drawWorker(worker, {
          queueNameplate: true
        });
      }
    }

    for (const worker of workers) {
      if (!occludedWorkerIds.has(worker.id)) {
        continue;
      }

      drawWorker(worker, {
        queueNameplate: false,
        drawUi: false,
        ghostAlpha: occludedGhostAlpha
      });
    }
  } else {
    if (mapData && mapPreviewImage) {
      drawAmbientFlameEffects(context, viewport, width, height, mapData, mapPreviewImage, nowMs);
    }

    for (const worker of workers) {
      drawWorker(worker, {
        queueNameplate: true
      });
    }
  }

  if (fadingWorkers && fadingWorkers.length > 0) {
    const now = Date.now();
    for (const fading of fadingWorkers) {
      if (activeWorkerIds.has(fading.worker.id)) {
        continue;
      }

      const elapsed = now - fading.startedAtMs;
      const alpha = clamp(1 - elapsed / fadingWorkerDurationMs, 0, 1);
      if (alpha <= 0) {
        continue;
      }
      const fadeProgress = clamp(elapsed / fadingWorkerDurationMs, 0, 1);

      const worldPosition = displayedPositions[fading.worker.id] ?? fading.worker.position;
      const screen = worldToScreen(worldPosition.x, worldPosition.y, viewport);
      const radius = workerRadius * viewport.scale;
      const spriteSet = spriteLibrary[fading.worker.avatarType];
      const spriteFrame = getSpriteFrame(spriteSet, {
        direction: "south",
        state: "idle",
        frameIndex: animationTick
      });

      context.save();
      context.globalAlpha = alpha;
      drawCharacterGroundShadow(context, screen.x, screen.y, viewport.scale);
      drawDespawnEffect(context, screen.x, screen.y, viewport.scale, fadeProgress, alpha);
      if (spriteFrame) {
        drawSpriteCharacter(context, spriteFrame, screen.x, screen.y, viewport.scale, spriteBaseSize);
      } else {
        drawFallbackWorker(context, fading.worker, screen.x, screen.y, radius, viewport.scale);
      }
      context.restore();
    }
  }

  drawWorkerNameplates(context, pendingNameplates);

  if (selectedOutline) {
    drawSelectedWorkerOutline(context, selectedOutline, viewport.scale, Boolean(terminalFocusedSelected));
  }
}

function drawSpriteCharacter(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  centerX: number,
  groundY: number,
  scale: number,
  baseSize: number
): SpriteBounds {
  const bounds = spriteBoundsAtGround(centerX, groundY, scale, baseSize);
  context.save();
  context.shadowColor = "rgba(8, 12, 10, 0.5)";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = Math.max(1, Math.round(2 * scale));
  context.shadowBlur = 0;
  context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
  context.restore();
  return bounds;
}

function drawFallbackWorker(
  context: CanvasRenderingContext2D,
  worker: Worker,
  centerX: number,
  centerY: number,
  radius: number,
  scale: number
): void {
  context.fillStyle = fallbackAvatarColor(worker.avatarType);
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(8, 12, 10, 0.7)";
  context.lineWidth = Math.max(1, 1.5 * scale);
  context.stroke();

  context.fillStyle = "rgba(15, 24, 19, 0.45)";
  context.fillRect(centerX - 4 * scale, centerY - 3 * scale, 8 * scale, 6 * scale);
}

function fallbackAvatarColor(avatarType: string): string {
  const normalized = avatarType.trim().toLowerCase();
  if (!normalized) {
    return "#7a8c9a";
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }

  const hue = hash % 360;
  return `hsl(${hue} 35% 56%)`;
}

function drawCharacterGroundShadow(context: CanvasRenderingContext2D, centerX: number, groundY: number, scale: number): void {
  context.fillStyle = "rgba(7, 12, 10, 0.28)";
  context.beginPath();
  context.ellipse(centerX, groundY + 2 * scale, 8 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
  context.fill();
}

function drawSelectedWorkerOutline(
  context: CanvasRenderingContext2D,
  selectedOutline: SelectedWorkerOutline,
  scale: number,
  terminalFocused: boolean
): void {
  context.save();
  context.strokeStyle = terminalFocused ? "#8ce8ff" : "#f1f2d4";
  context.lineWidth = terminalFocused ? 2.4 : 2;

  if (selectedOutline.spriteBounds) {
    const bounds = selectedOutline.spriteBounds;
    context.strokeRect(
      bounds.x - 2 * scale,
      bounds.y - 2 * scale,
      bounds.width + 4 * scale,
      bounds.height + 4 * scale
    );
  } else {
    context.beginPath();
    context.arc(selectedOutline.screenX, selectedOutline.screenY, selectedOutline.radius + 6 * scale, 0, Math.PI * 2);
    context.stroke();
  }

  context.restore();
}

function drawControlGroupIndicator(
  context: CanvasRenderingContext2D,
  anchorX: number,
  topY: number,
  controlKeys: string[],
  scale: number
): void {
  const badgeSize = Math.max(12, Math.round(14 * scale));
  const gap = Math.max(2, Math.round(3 * scale));
  const totalWidth = controlKeys.length * badgeSize + (controlKeys.length - 1) * gap;
  const startX = Math.round(anchorX - totalWidth / 2);
  const roundedTopY = Math.round(topY);

  context.font = `${Math.max(10, Math.round(10 * scale))}px 'Trebuchet MS', sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  controlKeys.forEach((key, index) => {
    const x = startX + index * (badgeSize + gap);
    context.fillStyle = "rgba(12, 17, 15, 0.88)";
    context.fillRect(x, roundedTopY, badgeSize, badgeSize);
    context.strokeStyle = "rgba(235, 242, 207, 0.72)";
    context.lineWidth = 1;
    context.strokeRect(x, roundedTopY, badgeSize, badgeSize);

    context.fillStyle = "#f2f5dd";
    context.fillText(key, x + badgeSize / 2, roundedTopY + badgeSize / 2 + 0.5);
  });

  context.textBaseline = "alphabetic";
}

function drawActivityOverlayLabel(
  context: CanvasRenderingContext2D,
  overlay: ActivityOverlayRenderState,
  centerX: number,
  baselineY: number
): void {
  context.fillStyle = "#eff3d8";
  context.fillText(overlay.text, centerX, baselineY);

  if (overlay.shimmerPhase === undefined) {
    return;
  }

  const characters = Array.from(overlay.text);
  if (characters.length < 2) {
    return;
  }

  const characterWidths = characters.map((character) => context.measureText(character).width);
  const totalWidth = characterWidths.reduce((sum, width) => sum + width, 0);
  if (totalWidth <= 0) {
    return;
  }

  const shimmerHead = overlay.shimmerPhase * (characters.length + activityOverlayShimmerBandChars * 2) - activityOverlayShimmerBandChars;
  let cursorX = centerX - totalWidth / 2;

  for (let index = 0; index < characters.length; index += 1) {
    const charWidth = characterWidths[index] ?? 0;
    const intensity = Math.max(0, 1 - Math.abs(index - shimmerHead) / activityOverlayShimmerBandChars);
    if (intensity > 0 && charWidth > 0) {
      const alpha = 0.2 + 0.72 * intensity;
      context.fillStyle = `rgba(255, 255, 247, ${alpha.toFixed(3)})`;
      context.fillText(characters[index] ?? "", cursorX + charWidth / 2, baselineY);
    }

    cursorX += charWidth;
  }
}

function drawWorkerNameplates(context: CanvasRenderingContext2D, nameplates: WorkerNameplate[]): void {
  if (!nameplates.length) {
    return;
  }

  context.save();
  context.textAlign = "center";
  context.font = "12px 'Trebuchet MS', sans-serif";

  for (const nameplate of nameplates) {
    if (!nameplate.visible) {
      continue;
    }

    const labelWidth = Math.max(90, context.measureText(nameplate.label).width + 18);
    const labelHeight = 18;

    context.fillStyle = "rgba(0, 0, 0, 0.56)";
    context.fillRect(nameplate.anchorX - labelWidth / 2, nameplate.topY, labelWidth, labelHeight);

    context.fillStyle = "#f8f7e5";
    context.fillText(nameplate.label, nameplate.anchorX, nameplate.topY + 13);
  }

  context.restore();
}

function isWorkerBehindAnyOcclusionRect(position: WorkerPosition, mapData: LoadedOutpostMap): boolean {
  const footX = position.x;
  const footY = position.y;
  const horizontalPadding = mapData.tileSize * 0.2;
  const baselineBias = mapData.tileSize * 0.08;
  const workerBounds: CollisionRect = {
    left: footX - mapData.tileSize * 0.48,
    top: footY - mapData.tileSize * 1.46,
    right: footX + mapData.tileSize * 0.48,
    bottom: footY + mapData.tileSize * 0.24
  };

  for (const rect of mapData.occlusionRects) {
    const occlusionRect: CollisionRect = {
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height
    };

    if (rect.mode === "hard") {
      if (intersectsRect(workerBounds, occlusionRect)) {
        return true;
      }
      continue;
    }

    const rectLeft = rect.x - horizontalPadding;
    const rectRight = rect.x + rect.width + horizontalPadding;
    if (footX < rectLeft || footX > rectRight) {
      continue;
    }

    const baselineY = rect.y + rect.height;
    if (footY > baselineY - baselineBias) {
      continue;
    }

    if (!intersectsRect(workerBounds, occlusionRect)) {
      continue;
    }

    return true;
  }

  return false;
}

function groupControlKeysByWorker(controlGroups: Partial<Record<number, string>> | undefined): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  if (!controlGroups) {
    return grouped;
  }

  for (const [digitText, workerId] of Object.entries(controlGroups)) {
    if (!workerId) {
      continue;
    }

    const digits = grouped.get(workerId) ?? [];
    digits.push(digitText);
    grouped.set(workerId, digits);
  }

  for (const digits of grouped.values()) {
    digits.sort((a, b) => Number(a) - Number(b));
  }

  return grouped;
}

function drawCommandFeedback(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  feedback: CommandFeedback,
  nowMs: number
): void {
  const elapsed = nowMs - feedback.startedAtMs;
  if (elapsed < 0 || elapsed > feedback.durationMs) {
    return;
  }

  const progress = clamp(elapsed / feedback.durationMs, 0, 1);
  const alpha = 1 - progress;

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  if (feedback.kind === "ok" && feedback.path && feedback.path.length >= 2) {
    context.beginPath();
    const start = worldToScreen(feedback.path[0].x, feedback.path[0].y, viewport);
    context.moveTo(start.x, start.y);

    for (let index = 1; index < feedback.path.length; index += 1) {
      const point = worldToScreen(feedback.path[index].x, feedback.path[index].y, viewport);
      context.lineTo(point.x, point.y);
    }

    context.strokeStyle = `rgba(180, 245, 215, ${0.7 * alpha})`;
    context.lineWidth = Math.max(1.5, 2.6 * viewport.scale);
    context.stroke();
  }

  const destination = worldToScreen(feedback.destination.x, feedback.destination.y, viewport);
  const pulse = 0.25 + Math.sin(progress * Math.PI * 4) * 0.1;

  if (feedback.kind === "ok") {
    const outerRadius = (12 + pulse * 18) * viewport.scale;
    const innerRadius = 6 * viewport.scale;

    context.strokeStyle = `rgba(174, 244, 212, ${0.9 * alpha})`;
    context.lineWidth = Math.max(1.2, 2.2 * viewport.scale);
    context.beginPath();
    context.arc(destination.x, destination.y, outerRadius, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = `rgba(201, 255, 226, ${0.55 * alpha})`;
    context.beginPath();
    context.arc(destination.x, destination.y, innerRadius, 0, Math.PI * 2);
    context.fill();
  } else {
    const radius = (12 + progress * 10) * viewport.scale;
    context.strokeStyle = `rgba(255, 126, 126, ${0.95 * alpha})`;
    context.lineWidth = Math.max(1.4, 2.5 * viewport.scale);

    context.beginPath();
    context.moveTo(destination.x - radius * 0.65, destination.y - radius * 0.65);
    context.lineTo(destination.x + radius * 0.65, destination.y + radius * 0.65);
    context.moveTo(destination.x + radius * 0.65, destination.y - radius * 0.65);
    context.lineTo(destination.x - radius * 0.65, destination.y + radius * 0.65);
    context.stroke();

    context.beginPath();
    context.strokeStyle = `rgba(255, 150, 150, ${0.45 * alpha})`;
    context.lineWidth = Math.max(1, 1.6 * viewport.scale);
    context.arc(destination.x, destination.y, radius, 0, Math.PI * 2);
    context.stroke();
  }

  context.restore();
}

function drawSummonEffect(
  context: CanvasRenderingContext2D,
  centerX: number,
  groundY: number,
  scale: number,
  progress: number
): void {
  const alpha = (1 - progress) * 0.85;
  if (alpha <= 0.01) {
    return;
  }

  const ringRadius = (8 + (1 - progress) * 10) * scale;
  const ringY = groundY + 1.5 * scale;

  context.save();
  context.strokeStyle = `rgba(172, 242, 216, ${alpha})`;
  context.lineWidth = Math.max(1.2, 2 * scale);
  context.beginPath();
  context.arc(centerX, ringY, ringRadius, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = `rgba(207, 255, 235, ${alpha * 0.75})`;
  context.lineWidth = Math.max(0.8, 1.2 * scale);
  for (let i = 0; i < 4; i += 1) {
    const angle = progress * Math.PI * 2 + (Math.PI / 2) * i;
    const dx = Math.cos(angle) * ringRadius * 0.65;
    const dy = Math.sin(angle) * ringRadius * 0.35;
    context.beginPath();
    context.arc(centerX + dx, ringY + dy, 2.2 * scale, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function drawDespawnEffect(
  context: CanvasRenderingContext2D,
  centerX: number,
  groundY: number,
  scale: number,
  progress: number,
  alpha: number
): void {
  const ringRadius = (9 + progress * 12) * scale;
  const ringY = groundY + 1.5 * scale;
  const ringAlpha = alpha * 0.55;
  if (ringAlpha <= 0.01) {
    return;
  }

  context.save();
  context.strokeStyle = `rgba(139, 194, 255, ${ringAlpha})`;
  context.lineWidth = Math.max(1, 1.8 * scale);
  context.beginPath();
  context.arc(centerX, ringY, ringRadius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawAmbientFlameEffects(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap,
  backgroundImage: HTMLImageElement,
  nowMs: number
): void {
  if (mapData.ambientFlameRects.length === 0) {
    return;
  }

  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  const sourceScaleX = backgroundImage.naturalWidth / worldWidth;
  const sourceScaleY = backgroundImage.naturalHeight / worldHeight;
  const timeSeconds = nowMs / 1000;

  type FlameCluster = {
    id: number;
    phase: number;
    centerX: number;
    centerY: number;
    radius: number;
    boundsX: number;
    boundsY: number;
    boundsWidth: number;
    boundsHeight: number;
    cells: LoadedOutpostMap["ambientFlameRects"];
  };

  const clusters = new Map<number, FlameCluster>();
  for (const rect of mapData.ambientFlameRects) {
    let cluster = clusters.get(rect.clusterId);
    if (!cluster) {
      cluster = {
        id: rect.clusterId,
        phase: rect.clusterId * 1.37,
        centerX: rect.clusterCenterX,
        centerY: rect.clusterCenterY,
        radius: rect.clusterRadius,
        boundsX: rect.clusterBoundsX,
        boundsY: rect.clusterBoundsY,
        boundsWidth: rect.clusterBoundsWidth,
        boundsHeight: rect.clusterBoundsHeight,
        cells: []
      };
      clusters.set(rect.clusterId, cluster);
    }
    cluster.cells.push(rect);
  }

  // Phase 1: Draw a unified flame texture per cluster, clipped by cluster cells.
  for (const cluster of clusters.values()) {
    const phase = cluster.phase;
    const boundsScreen = worldToScreen(cluster.boundsX, cluster.boundsY, viewport);
    const drawWidth = cluster.boundsWidth * viewport.scale;
    const drawHeight = cluster.boundsHeight * viewport.scale;
    const cullPadding = Math.max(6, Math.max(drawWidth, drawHeight) * 0.35);

    if (
      boundsScreen.x + drawWidth < -cullPadding ||
      boundsScreen.y + drawHeight < -cullPadding ||
      boundsScreen.x > width + cullPadding ||
      boundsScreen.y > height + cullPadding
    ) {
      continue;
    }

    const flicker =
      0.26 +
      Math.sin(timeSeconds * 8.1 + phase) * 0.06 +
      Math.sin(timeSeconds * 13.7 + phase * 1.9) * 0.045;
    const lateralDrift = Math.sin(timeSeconds * 4.6 + phase * 1.3) * drawWidth * 0.003;
    const jitterY = Math.cos(timeSeconds * 3.4 + phase * 0.8) * drawHeight * 0.008;
    const widthScale = 0.996 + Math.sin(timeSeconds * 6.7 + phase * 0.9) * 0.015;
    const heightScale = 0.992 + Math.sin(timeSeconds * 5.9 + phase * 1.1) * 0.02;
    const scaledWidth = drawWidth * widthScale;
    const scaledHeight = drawHeight * heightScale;
    const drawX = boundsScreen.x + lateralDrift - (scaledWidth - drawWidth) * 0.5;
    const drawY = boundsScreen.y + jitterY - (scaledHeight - drawHeight);
    const sourceX = cluster.boundsX * sourceScaleX;
    const sourceY = cluster.boundsY * sourceScaleY;
    const sourceWidth = Math.max(1, cluster.boundsWidth * sourceScaleX);
    const sourceHeight = Math.max(1, cluster.boundsHeight * sourceScaleY);
    const flameMask = getOrCreateFlameRegionMask(backgroundImage, sourceX, sourceY, sourceWidth, sourceHeight, cluster.id);
    if (flameMask.heatCoverage <= 0.004) {
      continue;
    }

    context.save();
    context.imageSmoothingEnabled = true;
    context.globalCompositeOperation = "screen";
    context.globalAlpha = clamp(flicker, 0.12, 0.42);
    const feather = Math.max(0.45, viewport.scale * 0.18);
    context.drawImage(flameMask.canvas, drawX, drawY, scaledWidth, scaledHeight);
    context.globalAlpha *= 0.24;
    context.drawImage(flameMask.canvas, drawX - feather, drawY, scaledWidth, scaledHeight);
    context.drawImage(flameMask.canvas, drawX + feather, drawY, scaledWidth, scaledHeight);
    context.drawImage(flameMask.canvas, drawX, drawY - feather, scaledWidth, scaledHeight);
    context.drawImage(flameMask.canvas, drawX, drawY + feather, scaledWidth, scaledHeight);

    context.globalCompositeOperation = "lighter";
    context.globalAlpha = clamp(flicker * 0.2, 0.05, 0.16);
    context.drawImage(flameMask.canvas, drawX, drawY, scaledWidth, scaledHeight);
    context.restore();
  }

  // Phase 2: Draw unified glows per cluster.
  for (const cluster of clusters.values()) {
    const phase = cluster.phase;
    const pulse = 0.88 + Math.sin(timeSeconds * 3.4 + phase * 0.7) * 0.12;
    const clusterScreenX = (cluster.centerX + viewport.offsetX) * viewport.scale;
    const clusterScreenY = (cluster.centerY + viewport.offsetY) * viewport.scale;
    const glowRadius = Math.max(6, cluster.radius * viewport.scale * (0.7 + pulse * 0.25));

    if (
      clusterScreenX < -glowRadius ||
      clusterScreenY < -glowRadius ||
      clusterScreenX > width + glowRadius ||
      clusterScreenY > height + glowRadius
    ) {
      continue;
    }

    context.save();
    context.globalCompositeOperation = "lighter";
    const glow = context.createRadialGradient(clusterScreenX, clusterScreenY, 0, clusterScreenX, clusterScreenY, glowRadius);
    glow.addColorStop(0, "rgba(255, 214, 132, 0.22)");
    glow.addColorStop(0.35, "rgba(255, 168, 80, 0.14)");
    glow.addColorStop(0.7, "rgba(255, 128, 48, 0.06)");
    glow.addColorStop(1, "rgba(255, 98, 28, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(clusterScreenX, clusterScreenY, glowRadius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function getWorkerSummonProgress(createdAtIso: string, nowMs: number): number | undefined {
  const createdMs = Date.parse(createdAtIso);
  if (!Number.isFinite(createdMs)) {
    return undefined;
  }

  const elapsed = nowMs - createdMs;
  if (elapsed < 0 || elapsed > summonWorkerDurationMs) {
    return undefined;
  }

  return clamp(elapsed / summonWorkerDurationMs, 0, 1);
}

function drawOutpostTerrain(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap
): void {
  const tileSize = mapData.tileSize;
  const worldMinX = (-viewport.offsetX / viewport.scale) - tileSize;
  const worldMinY = (-viewport.offsetY / viewport.scale) - tileSize;
  const worldMaxX = ((width - viewport.offsetX) / viewport.scale) + tileSize;
  const worldMaxY = ((height - viewport.offsetY) / viewport.scale) + tileSize;

  const minTileX = clamp(Math.floor(worldMinX / tileSize), 0, mapData.width - 1);
  const minTileY = clamp(Math.floor(worldMinY / tileSize), 0, mapData.height - 1);
  const maxTileX = clamp(Math.ceil(worldMaxX / tileSize), 0, mapData.width - 1);
  const maxTileY = clamp(Math.ceil(worldMaxY / tileSize), 0, mapData.height - 1);

  const baseTile = mapData.baseGrassTile;
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const screen = worldToScreen(tileX * tileSize, tileY * tileSize, viewport);
      const drawSize = tileSize * viewport.scale;

      if (baseTile) {
        context.drawImage(baseTile, screen.x, screen.y, drawSize, drawSize);
      } else {
        context.fillStyle = "#6eb574";
        context.fillRect(screen.x, screen.y, drawSize, drawSize);
      }

      const terrainValue = mapData.terrain[tileY]?.[tileX] ?? 0;
      if (terrainValue <= 0) {
        continue;
      }

      const tileset = mapData.tilesetsByTerrain[terrainValue];
      if (!tileset) {
        continue;
      }

      const minCornerMatches = tileset.name.includes("water") ? 1 : 2;

      const key = cornerKey(
        cornerStateAtVertex(mapData, terrainValue, tileX, tileY, minCornerMatches),
        cornerStateAtVertex(mapData, terrainValue, tileX + 1, tileY, minCornerMatches),
        cornerStateAtVertex(mapData, terrainValue, tileX, tileY + 1, minCornerMatches),
        cornerStateAtVertex(mapData, terrainValue, tileX + 1, tileY + 1, minCornerMatches)
      );

      const overlayTile = tileset.tilesByCornerKey[key] ?? tileset.fallbackTile;
      if (overlayTile) {
        context.drawImage(overlayTile, screen.x, screen.y, drawSize, drawSize);
      }
    }
  }
}

function drawOutpostPreviewBackground(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  mapData: LoadedOutpostMap,
  image: HTMLImageElement
): void {
  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  const topLeft = worldToScreen(0, 0, viewport);

  context.save();
  context.imageSmoothingEnabled = true;
  context.drawImage(image, topLeft.x, topLeft.y, worldWidth * viewport.scale, worldHeight * viewport.scale);
  context.restore();
}

function drawOutpostOcclusionOverlay(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap,
  image: HTMLImageElement
): void {
  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  const sourceScaleX = image.naturalWidth / worldWidth;
  const sourceScaleY = image.naturalHeight / worldHeight;

  context.save();
  context.imageSmoothingEnabled = true;

  for (const rect of mapData.occlusionRects) {
    const screen = worldToScreen(rect.x, rect.y, viewport);
    const drawWidth = rect.width * viewport.scale;
    const drawHeight = rect.height * viewport.scale;

    if (screen.x > width || screen.y > height || screen.x + drawWidth < 0 || screen.y + drawHeight < 0) {
      continue;
    }

    context.globalAlpha = occlusionOverlayAlpha;

    context.drawImage(
      image,
      rect.x * sourceScaleX,
      rect.y * sourceScaleY,
      rect.width * sourceScaleX,
      rect.height * sourceScaleY,
      screen.x,
      screen.y,
      drawWidth,
      drawHeight
    );
  }

  context.restore();
}

function drawOutpostObjects(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap,
  animationTick: number
): void {
  const drawObjects = [...mapData.objects].sort((a, b) => a.y - b.y || a.x - b.x);
  const worldMinX = (-viewport.offsetX / viewport.scale) - 128;
  const worldMinY = (-viewport.offsetY / viewport.scale) - 128;
  const worldMaxX = ((width - viewport.offsetX) / viewport.scale) + 128;
  const worldMaxY = ((height - viewport.offsetY) / viewport.scale) + 128;

  for (const placedObject of drawObjects) {
    // Check for animated version first
    const animatedDef = mapData.animatedObjectDefinitions[placedObject.type];
    const staticDef = mapData.objectDefinitions[placedObject.type];
    
    const definition = staticDef;
    if (!definition) {
      continue;
    }

    const worldX = placedObject.x * mapData.tileSize + mapData.tileSize / 2 - definition.width / 2;
    const worldY = (placedObject.y + 1) * mapData.tileSize - definition.height;

    if (
      worldX > worldMaxX ||
      worldY > worldMaxY ||
      worldX + definition.width < worldMinX ||
      worldY + definition.height < worldMinY
    ) {
      continue;
    }

    const screen = worldToScreen(worldX, worldY, viewport);
    const drawWidth = definition.width * viewport.scale;
    const drawHeight = definition.height * viewport.scale;

    // Use animated frame if available
    if (animatedDef && animatedDef.frames.length > 0) {
      const frameIndex = animationTick % animatedDef.frames.length;
      const frame = animatedDef.frames[frameIndex];
      if (frame) {
        context.drawImage(frame, screen.x, screen.y, drawWidth, drawHeight);
        continue;
      }
    }

    // Fall back to static image
    if (definition.image) {
      context.drawImage(definition.image, screen.x, screen.y, drawWidth, drawHeight);
      continue;
    }

    context.fillStyle = "rgba(32, 45, 35, 0.65)";
    context.fillRect(screen.x, screen.y, drawWidth, drawHeight);
  }
}

function drawOutpostZoneLabels(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap
): void {
  if (!mapData.zones.length) {
    return;
  }

  context.save();
  context.textAlign = "center";
  context.font = "11px 'Trebuchet MS', sans-serif";

  for (const zone of mapData.zones) {
    const centerTileX = (zone.x1 + zone.x2 + 1) / 2;
    const centerTileY = (zone.y1 + zone.y2 + 1) / 2;
    const worldX = centerTileX * mapData.tileSize;
    const worldY = (centerTileY - 0.45) * mapData.tileSize;

    const screen = worldToScreen(worldX, worldY, viewport);
    if (screen.x < -120 || screen.x > width + 120 || screen.y < -30 || screen.y > height + 30) {
      continue;
    }

    const label = zone.label.toUpperCase();
    const textWidth = context.measureText(label).width;
    const badgeWidth = Math.max(70, textWidth + 14);
    const badgeHeight = 16;

    context.fillStyle = "rgba(8, 14, 12, 0.42)";
    context.fillRect(screen.x - badgeWidth / 2, screen.y - badgeHeight / 2, badgeWidth, badgeHeight);
    context.strokeStyle = "rgba(227, 235, 205, 0.38)";
    context.lineWidth = 1;
    context.strokeRect(screen.x - badgeWidth / 2, screen.y - badgeHeight / 2, badgeWidth, badgeHeight);

    context.fillStyle = "rgba(238, 245, 220, 0.8)";
    context.fillText(label, screen.x, screen.y + 4);
  }

  context.restore();
}

function cornerStateAtVertex(
  mapData: LoadedOutpostMap,
  terrainValue: number,
  vertexTileX: number,
  vertexTileY: number,
  minimumMatches: number
): "lower" | "upper" {
  let matchCount = 0;

  if (terrainAt(mapData, vertexTileX - 1, vertexTileY - 1) === terrainValue) {
    matchCount += 1;
  }
  if (terrainAt(mapData, vertexTileX, vertexTileY - 1) === terrainValue) {
    matchCount += 1;
  }
  if (terrainAt(mapData, vertexTileX - 1, vertexTileY) === terrainValue) {
    matchCount += 1;
  }
  if (terrainAt(mapData, vertexTileX, vertexTileY) === terrainValue) {
    matchCount += 1;
  }

  return matchCount >= minimumMatches ? "upper" : "lower";
}

function terrainAt(mapData: LoadedOutpostMap, tileX: number, tileY: number): number {
  if (tileX < 0 || tileY < 0 || tileX >= mapData.width || tileY >= mapData.height) {
    return 0;
  }

  return mapData.terrain[tileY]?.[tileX] ?? 0;
}

function clampWorldPosition(position: WorkerPosition, mapData: LoadedOutpostMap | undefined): WorkerPosition {
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

function createCardinalWaypoints(from: WorkerPosition, to: WorkerPosition): WorkerPosition[] {
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

function randomWanderTarget(
  anchor: WorkerPosition,
  tileSize: number,
  mapData: LoadedOutpostMap | undefined,
  collisionRects: CollisionRect[]
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

    if (isWorldPositionWalkable(candidate, mapData, collisionRects)) {
      return candidate;
    }

    if (!fallback) {
      fallback = candidate;
    }
  }

  if (!fallback) {
    return anchor;
  }

  return findNearestWalkablePosition(fallback, mapData, collisionRects) ?? anchor;
}

function buildObjectCollisionRects(mapData: LoadedOutpostMap | undefined, includeLegacyObjectBlockers: boolean): CollisionRect[] {
  if (!mapData || !includeLegacyObjectBlockers) {
    return [];
  }

  const collisionRects: CollisionRect[] = [];
  for (const placedObject of mapData.objects) {
    if (nonBlockingObjectTypes.has(placedObject.type)) {
      continue;
    }

    const definition = mapData.objectDefinitions[placedObject.type];
    if (!definition) {
      continue;
    }

    const worldX = placedObject.x * mapData.tileSize + mapData.tileSize / 2 - definition.width / 2;
    const worldY = (placedObject.y + 1) * mapData.tileSize - definition.height;
    let left: number;
    let top: number;
    let right: number;
    let bottom: number;

    if (fullBodyCollisionObjectTypes.has(placedObject.type)) {
      const insetX = Math.max(2, Math.min(8, definition.width * 0.06));
      const insetY = Math.max(2, Math.min(10, definition.height * 0.06));
      left = worldX + insetX;
      top = worldY + insetY;
      right = worldX + definition.width - insetX;
      bottom = worldY + definition.height - insetY;
    } else {
      const footprintWidth = clamp(definition.width * 0.62, mapData.tileSize * 0.42, mapData.tileSize * 1.12);
      const footprintHeight = clamp(definition.height * 0.34, mapData.tileSize * 0.28, mapData.tileSize * 0.88);
      left = worldX + (definition.width - footprintWidth) / 2;
      top = worldY + definition.height - footprintHeight;
      right = left + footprintWidth;
      bottom = top + footprintHeight;
    }

    collisionRects.push({
      left,
      top,
      right,
      bottom
    });
  }

  return collisionRects;
}

function isWorldPositionWalkable(
  position: WorkerPosition,
  mapData: LoadedOutpostMap | undefined,
  collisionRects: CollisionRect[]
): boolean {
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

  const terrainValue = mapData.terrain[tileY]?.[tileX] ?? 0;
  if (blockedTerrainValues.has(terrainValue) && !mapData.backgroundImageUrl) {
    return false;
  }

  const workerFootprint: CollisionRect = {
    left: position.x - 10,
    top: position.y - 9,
    right: position.x + 10,
    bottom: position.y + 7
  };

  for (const rect of collisionRects) {
    if (intersectsRect(workerFootprint, rect)) {
      return false;
    }
  }

  return true;
}

function findNearestWalkablePosition(
  target: WorkerPosition,
  mapData: LoadedOutpostMap | undefined,
  collisionRects: CollisionRect[]
): WorkerPosition | undefined {
  if (!mapData) {
    return target;
  }

  if (isWorldPositionWalkable(target, mapData, collisionRects)) {
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

      if (isWorldPositionWalkable(candidate, mapData, collisionRects)) {
        return candidate;
      }
    }
  }

  return undefined;
}

interface TileCoord {
  x: number;
  y: number;
}

function buildBlockedTileSet(mapData: LoadedOutpostMap | undefined, collisionRects: CollisionRect[]): Set<string> {
  if (!mapData) {
    return new Set<string>();
  }

  const blocked = new Set<string>(mapData.collisionTileKeys);
  const tileSize = mapData.tileSize;

  for (const rect of collisionRects) {
    const minTileX = clamp(Math.floor(rect.left / tileSize), 0, mapData.width - 1);
    const maxTileX = clamp(Math.floor((rect.right - 0.01) / tileSize), 0, mapData.width - 1);
    const minTileY = clamp(Math.floor(rect.top / tileSize), 0, mapData.height - 1);
    const maxTileY = clamp(Math.floor((rect.bottom - 0.01) / tileSize), 0, mapData.height - 1);

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        blocked.add(tileCoordKey(tileX, tileY));
      }
    }
  }

  return blocked;
}

function worldPositionToTile(position: WorkerPosition, mapData: LoadedOutpostMap): TileCoord {
  return {
    x: clamp(Math.floor(position.x / mapData.tileSize), 0, mapData.width - 1),
    y: clamp(Math.floor(position.y / mapData.tileSize), 0, mapData.height - 1)
  };
}

function tileToWorldCenter(tile: TileCoord, mapData: LoadedOutpostMap): WorkerPosition {
  return {
    x: tile.x * mapData.tileSize + mapData.tileSize / 2,
    y: tile.y * mapData.tileSize + mapData.tileSize / 2
  };
}

function isTileWalkable(tileX: number, tileY: number, mapData: LoadedOutpostMap, blockedTileKeys: Set<string>): boolean {
  if (tileX < 0 || tileY < 0 || tileX >= mapData.width || tileY >= mapData.height) {
    return false;
  }

  const terrainValue = mapData.terrain[tileY]?.[tileX] ?? 0;
  if (blockedTerrainValues.has(terrainValue) && !mapData.backgroundImageUrl) {
    return false;
  }

  return !blockedTileKeys.has(tileCoordKey(tileX, tileY));
}

function findNearestWalkableTile(
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

function findTilePath(
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

function tilePathToWaypoints(tilePath: TileCoord[], mapData: LoadedOutpostMap): WorkerPosition[] {
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

function intersectsRect(a: CollisionRect, b: CollisionRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function worldToScreen(worldX: number, worldY: number, viewport: ViewportState): { x: number; y: number } {
  return {
    x: worldX * viewport.scale + viewport.offsetX,
    y: worldY * viewport.scale + viewport.offsetY
  };
}

function isInsideViewport(
  screenPoint: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  padding: number
): boolean {
  return (
    screenPoint.x >= padding &&
    screenPoint.x <= viewportWidth - padding &&
    screenPoint.y >= padding &&
    screenPoint.y <= viewportHeight - padding
  );
}

function screenToWorld(screenX: number, screenY: number, viewport: ViewportState): { x: number; y: number } {
  return {
    x: (screenX - viewport.offsetX) / viewport.scale,
    y: (screenY - viewport.offsetY) / viewport.scale
  };
}

function findWorkerAtScreenPoint(
  screenX: number,
  screenY: number,
  workers: Worker[],
  positions: Map<string, WorkerPosition>,
  viewport: ViewportState,
  spriteLibrary: Partial<Record<string, CharacterSpriteSet>>
): Worker | undefined {
  for (let index = workers.length - 1; index >= 0; index -= 1) {
    const worker = workers[index];
    const position = positions.get(worker.id) ?? worker.position;
    const screenPosition = worldToScreen(position.x, position.y, viewport);
    const spriteSet = spriteLibrary[worker.avatarType];

    if (spriteSet?.hasSprites) {
      const bounds = spriteBoundsAtGround(screenPosition.x, screenPosition.y, viewport.scale, spriteBaseSize);
      const padding = 5 * viewport.scale;
      if (
        screenX >= bounds.x - padding &&
        screenX <= bounds.x + bounds.width + padding &&
        screenY >= bounds.y - padding &&
        screenY <= bounds.y + bounds.height + padding
      ) {
        return worker;
      }
      continue;
    }

    const fallbackRadius = (workerRadius + 8) * viewport.scale;
    if (Math.hypot(screenPosition.x - screenX, screenPosition.y - screenY) <= fallbackRadius) {
      return worker;
    }
  }

  return undefined;
}

function deriveWorkerMotion(
  workers: Worker[],
  positions: Map<string, WorkerPosition>,
  previousPositions: Record<string, WorkerPosition>,
  movingUntil: Record<string, number>,
  facingByWorker: Record<string, SpriteDirection>,
  nowMs: number
): Record<string, WorkerMotion> {
  const motion: Record<string, WorkerMotion> = {};
  const activeIds = new Set(workers.map((worker) => worker.id));

  for (const workerId of Object.keys(previousPositions)) {
    if (!activeIds.has(workerId)) {
      delete previousPositions[workerId];
      delete movingUntil[workerId];
      delete facingByWorker[workerId];
    }
  }

  for (const worker of workers) {
    const position = positions.get(worker.id) ?? worker.position;
    const previous = previousPositions[worker.id];
    let facing = facingByWorker[worker.id] ?? "south";

    if (previous) {
      const dx = position.x - previous.x;
      const dy = position.y - previous.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.3) {
        movingUntil[worker.id] = nowMs + 450;
        facing = directionFromVector(dx, dy, facing);
      }
    }

    previousPositions[worker.id] = { ...position };
    facingByWorker[worker.id] = facing;
    motion[worker.id] = {
      moving: (movingUntil[worker.id] ?? 0) > nowMs,
      facing
    };
  }

  return motion;
}

function directionFromVector(dx: number, dy: number, fallback: SpriteDirection): SpriteDirection {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX < 0.001 && absY < 0.001) {
    return fallback;
  }

  if (absX > absY) {
    return dx >= 0 ? "east" : "west";
  }

  return dy >= 0 ? "south" : "north";
}

function getActivityBadge(worker: Worker): string | undefined {
  switch (worker.activityTool) {
    case "read":
      return "READ";
    case "edit":
      return "EDIT";
    case "write":
      return "WRITE";
    case "bash":
      return "RUN";
    case "grep":
      return "SEARCH";
    case "glob":
      return "SCAN";
    case "task":
      return "TASK";
    case "todo":
      return "TODO";
    case "web":
      return "WEB";
    case "terminal":
      return "TTY";
    case "unknown":
      return "...";
    default:
      if (worker.status === "error") {
        return "ERR";
      }
      if (worker.status === "working") {
        return "RUN";
      }
      return undefined;
  }
}

interface ActivityOverlayTarget {
  text: string;
  animate: boolean;
}

function deriveActivityOverlayStateByWorker(
  workers: Worker[],
  animationStateByWorker: Record<string, ActivityOverlayAnimationState>,
  nowMs: number
): Record<string, ActivityOverlayRenderState | undefined> {
  const overlayStateByWorker: Record<string, ActivityOverlayRenderState | undefined> = {};
  const activeWorkerIds = new Set(workers.map((worker) => worker.id));

  for (const workerId of Object.keys(animationStateByWorker)) {
    if (!activeWorkerIds.has(workerId)) {
      delete animationStateByWorker[workerId];
    }
  }

  for (const worker of workers) {
    const target = buildActivityOverlayTarget(worker);
    if (!target) {
      delete animationStateByWorker[worker.id];
      continue;
    }

    const existing = animationStateByWorker[worker.id];
    if (!existing || existing.animate !== target.animate || existing.text !== target.text) {
      const keepRevealProgress =
        Boolean(existing) &&
        Boolean(existing?.animate) &&
        Boolean(target.animate) &&
        target.text.startsWith(existing?.text ?? "");
      const revealedLength = keepRevealProgress ? Math.min(existing?.revealedLength ?? 0, target.text.length) : target.animate ? 0 : target.text.length;

      animationStateByWorker[worker.id] = {
        text: target.text,
        animate: target.animate,
        revealedLength,
        lastRevealAtMs: nowMs,
        fullyRevealedAtMs: revealedLength >= target.text.length ? nowMs : undefined
      };
    }

    const state = animationStateByWorker[worker.id];
    if (state.animate && state.revealedLength < state.text.length) {
      const elapsedMs = nowMs - state.lastRevealAtMs;
      if (elapsedMs >= activityOverlayTypingCharIntervalMs) {
        const charsToReveal = Math.floor(elapsedMs / activityOverlayTypingCharIntervalMs);
        state.revealedLength = Math.min(state.text.length, state.revealedLength + charsToReveal);
        state.lastRevealAtMs += charsToReveal * activityOverlayTypingCharIntervalMs;
        if (state.revealedLength >= state.text.length && state.fullyRevealedAtMs === undefined) {
          state.fullyRevealedAtMs = nowMs;
        }
      }
    } else if (!state.animate) {
      state.revealedLength = state.text.length;
      state.lastRevealAtMs = nowMs;
      state.fullyRevealedAtMs = undefined;
    } else if (state.revealedLength >= state.text.length && state.fullyRevealedAtMs === undefined) {
      state.fullyRevealedAtMs = nowMs;
    }

    const visibleText = state.text.slice(0, Math.max(0, state.revealedLength));
    if (!visibleText) {
      overlayStateByWorker[worker.id] = {
        text: "…",
        shimmerPhase: undefined
      };
      continue;
    }

    overlayStateByWorker[worker.id] = {
      text: visibleText,
      shimmerPhase: deriveActivityOverlayShimmerPhase(state, nowMs, visibleText.length)
    };
  }

  return overlayStateByWorker;
}

function deriveActivityOverlayShimmerPhase(
  state: ActivityOverlayAnimationState,
  nowMs: number,
  visibleLength: number
): number | undefined {
  if (!state.animate || state.revealedLength < state.text.length || visibleLength < 6) {
    return undefined;
  }

  if (state.fullyRevealedAtMs === undefined) {
    return undefined;
  }

  const shimmerElapsedMs = nowMs - state.fullyRevealedAtMs - activityOverlayShimmerStartDelayMs;
  if (shimmerElapsedMs < 0) {
    return undefined;
  }

  return (shimmerElapsedMs % activityOverlayShimmerCycleMs) / activityOverlayShimmerCycleMs;
}

function buildActivityOverlayTarget(worker: Worker): ActivityOverlayTarget | undefined {
  if (worker.status !== "working" && worker.status !== "attention" && worker.status !== "error") {
    return undefined;
  }

  const activityText = worker.activityText?.replace(/\s+/g, " ").trim();
  if (activityText) {
    const thinkingDetail = extractThinkingOverlayDetail(activityText);
    if (thinkingDetail) {
      return {
        text: truncateOverlayLabel(thinkingDetail, activityOverlayTextMaxLength),
        animate: true
      };
    }

    return {
      text: truncateOverlayLabel(activityText, activityOverlayTextMaxLength),
      animate: false
    };
  }

  const badge = getActivityBadge(worker);
  if (!badge) {
    return undefined;
  }

  return {
    text: badge,
    animate: false
  };
}

function extractThinkingOverlayDetail(activityText: string): string | undefined {
  const match = activityText.match(/\bThinking:\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function truncateOverlayLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return text.slice(0, Math.max(0, maxLength));
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function spriteBoundsAtGround(centerX: number, groundY: number, scale: number, baseSize: number): SpriteBounds {
  const drawSize = baseSize * scale;
  return {
    x: centerX - drawSize / 2,
    y: groundY - drawSize * spriteAnchorYFactor,
    width: drawSize,
    height: drawSize
  };
}

function readPointerOnCanvas(event: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>): {
  x: number;
  y: number;
} {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top
  };
}

function getOrCreateFlameRegionMask(
  backgroundImage: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  clusterId: number
): { canvas: HTMLCanvasElement; heatCoverage: number } {
  const normalizedX = Math.floor(sourceX);
  const normalizedY = Math.floor(sourceY);
  const normalizedWidth = Math.max(1, Math.ceil(sourceWidth));
  const normalizedHeight = Math.max(1, Math.ceil(sourceHeight));
  const cacheKey = [
    flameMaskVersion,
    backgroundImage.currentSrc || backgroundImage.src,
    clusterId,
    normalizedX,
    normalizedY,
    normalizedWidth,
    normalizedHeight
  ].join(":");

  const cached = flameRegionMaskCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = normalizedWidth;
  canvas.height = normalizedHeight;
  const canvasContext = canvas.getContext("2d", { willReadFrequently: true });
  if (!canvasContext) {
    const fallback = { canvas, heatCoverage: 0 };
    flameRegionMaskCache.set(cacheKey, fallback);
    return fallback;
  }

  canvasContext.clearRect(0, 0, normalizedWidth, normalizedHeight);
  canvasContext.drawImage(
    backgroundImage,
    normalizedX,
    normalizedY,
    normalizedWidth,
    normalizedHeight,
    0,
    0,
    normalizedWidth,
    normalizedHeight
  );

  try {
    const sourceImage = canvasContext.getImageData(0, 0, normalizedWidth, normalizedHeight);
    const sourcePixels = sourceImage.data;
    const pixelCount = normalizedWidth * normalizedHeight;
    const heatValues = new Float32Array(pixelCount);

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const pixelOffset = pixelIndex * 4;
      const red = sourcePixels[pixelOffset] / 255;
      const green = sourcePixels[pixelOffset + 1] / 255;
      const blue = sourcePixels[pixelOffset + 2] / 255;
      const alpha = sourcePixels[pixelOffset + 3] / 255;

      const value = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const delta = value - minChannel;
      const saturation = value <= 0 ? 0 : delta / value;
      let hue = 0;
      if (delta > 0.0001) {
        if (value === red) {
          hue = ((green - blue) / delta) % 6;
        } else if (value === green) {
          hue = (blue - red) / delta + 2;
        } else {
          hue = (red - green) / delta + 4;
        }
        hue *= 60;
        if (hue < 0) {
          hue += 360;
        }
      }

      const inFlameHue = hue >= 20 && hue <= 54;
      const warmBalance = red > green * 0.94 && green > blue * 1.16;
      const satGate = saturation > 0.34;
      const brightGate = value > 0.5;
      const potentialCore = hue >= 34 && hue <= 66 && value > 0.8 && saturation > 0.24 && blue < 0.56;

      let heat = 0;
      if ((inFlameHue && warmBalance && satGate && brightGate) || potentialCore) {
        const hueWeight = inFlameHue ? 1 : 0.45;
        const satWeight = clamp((saturation - 0.3) / 0.52, 0, 1);
        const valueWeight = clamp((value - 0.48) / 0.44, 0, 1);
        const orangeBias = clamp((red - blue) / 0.5, 0, 1);
        const yellowBias = clamp((green - blue) / 0.44, 0, 1);
        heat = hueWeight * (satWeight * 0.42 + valueWeight * 0.24 + orangeBias * 0.2 + yellowBias * 0.14);
      }

      if (saturation < 0.24 || value < 0.38) {
        heat *= 0;
      }

      heatValues[pixelIndex] = clamp(heat * alpha, 0, 1);
    }

    let peakHeat = 0;
    for (let index = 0; index < heatValues.length; index += 1) {
      peakHeat = Math.max(peakHeat, heatValues[index]);
    }
    const adaptiveThreshold = clamp(Math.max(0.52, peakHeat * 0.72), 0.52, 0.82);

    const smoothedValues = new Float32Array(pixelCount);
    for (let y = 0; y < normalizedHeight; y += 1) {
      for (let x = 0; x < normalizedWidth; x += 1) {
        const index = y * normalizedWidth + x;
        const north = y > 0 ? heatValues[index - normalizedWidth] : heatValues[index];
        const south = y < normalizedHeight - 1 ? heatValues[index + normalizedWidth] : heatValues[index];
        const west = x > 0 ? heatValues[index - 1] : heatValues[index];
        const east = x < normalizedWidth - 1 ? heatValues[index + 1] : heatValues[index];
        smoothedValues[index] = clamp((heatValues[index] * 6 + north + south + west + east) / 10, 0, 1);
      }
    }

    const seedThreshold = clamp(Math.max(adaptiveThreshold + 0.16, peakHeat * 0.82), 0.62, 0.94);
    const growThreshold = clamp(adaptiveThreshold * 0.9, 0.45, 0.74);
    const connectedMask = new Uint8Array(pixelCount);
    const queue: number[] = [];

    for (let index = 0; index < pixelCount; index += 1) {
      if (smoothedValues[index] >= seedThreshold) {
        connectedMask[index] = 1;
        queue.push(index);
      }
    }

    while (queue.length > 0) {
      const index = queue.pop()!;
      const x = index % normalizedWidth;
      const y = Math.floor(index / normalizedWidth);

      const visit = (nextIndex: number): void => {
        if (connectedMask[nextIndex] === 1) {
          return;
        }
        if (smoothedValues[nextIndex] < growThreshold) {
          return;
        }
        connectedMask[nextIndex] = 1;
        queue.push(nextIndex);
      };

      if (x > 0) visit(index - 1);
      if (x < normalizedWidth - 1) visit(index + 1);
      if (y > 0) visit(index - normalizedWidth);
      if (y < normalizedHeight - 1) visit(index + normalizedWidth);
    }

    const outputImage = canvasContext.createImageData(normalizedWidth, normalizedHeight);
    const outputPixels = outputImage.data;
    let hotPixelCount = 0;

    for (let index = 0; index < pixelCount; index += 1) {
      const connectedHeat = connectedMask[index] === 1 ? smoothedValues[index] : 0;
      const thresholdedHeat =
        connectedHeat > adaptiveThreshold
          ? clamp((connectedHeat - adaptiveThreshold) / (1 - adaptiveThreshold), 0, 1)
          : 0;
      const outputOffset = index * 4;

      outputPixels[outputOffset] = 255;
      outputPixels[outputOffset + 1] = Math.round(168 + thresholdedHeat * 82);
      outputPixels[outputOffset + 2] = Math.round(68 + thresholdedHeat * 60);
      outputPixels[outputOffset + 3] = Math.round(clamp(thresholdedHeat * thresholdedHeat * 255 * 1.45, 0, 255));

      if (thresholdedHeat > 0.08) {
        hotPixelCount += 1;
      }
    }

    canvasContext.clearRect(0, 0, normalizedWidth, normalizedHeight);
    canvasContext.putImageData(outputImage, 0, 0);
    const result = {
      canvas,
      heatCoverage: hotPixelCount / Math.max(1, pixelCount)
    };
    flameRegionMaskCache.set(cacheKey, result);
    return result;
  } catch {
    const fallback = { canvas, heatCoverage: 0 };
    flameRegionMaskCache.set(cacheKey, fallback);
    return fallback;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type PanDirection = "up" | "down" | "left" | "right";

function offsetPositionByDirection(position: WorkerPosition, direction: PanDirection, distance: number): WorkerPosition {
  switch (direction) {
    case "up":
      return { x: position.x, y: position.y - distance };
    case "down":
      return { x: position.x, y: position.y + distance };
    case "left":
      return { x: position.x - distance, y: position.y };
    case "right":
      return { x: position.x + distance, y: position.y };
    default:
      return position;
  }
}

function toPanDirection(key: string): PanDirection | undefined {
  const normalized = key.length === 1 ? key.toLowerCase() : key;
  switch (normalized) {
    case "ArrowUp":
    case "w":
      return "up";
    case "ArrowDown":
    case "s":
      return "down";
    case "ArrowLeft":
    case "a":
      return "left";
    case "ArrowRight":
    case "d":
      return "right";
    default:
      return undefined;
  }
}

function isWasdKey(key: string): boolean {
  if (key.length !== 1) {
    return false;
  }

  const normalized = key.toLowerCase();
  return normalized === "w" || normalized === "a" || normalized === "s" || normalized === "d";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}
