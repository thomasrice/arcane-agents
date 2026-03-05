import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
  type WheelEvent
} from "react";
import type { Worker, WorkerPosition } from "../../shared/types";
import { useOutpostMap, type LoadedOutpostMap } from "../map/tileMapLoader";
import {
  buildBlockedTileSet,
  clampWorldPosition,
  createCardinalWaypoints,
  findNearestWalkablePosition,
  findNearestWalkableTile,
  findTilePath,
  isTileWalkable,
  isWorldPositionWalkable,
  randomWanderTarget,
  randomRange,
  tilePathToWaypoints,
  worldPositionToTile
} from "../map/pathfinding";
import { findWorkerAtScreenPoint } from "../map/hitTesting";
import { drawScene, type CommandFeedback } from "../map/renderScene";
import { findWorkersInSelectionBox, normalizeSelectionBox, type SelectionBox } from "../map/selection";
import { type SpriteDirection, useCharacterSpriteLibrary } from "../sprites/spriteLoader";
import {
  clamp,
  isInsideViewport,
  screenToWorld,
  worldToScreen,
  type PanDirection,
  type ViewportState
} from "../map/viewportMath";
import {
  deriveActivityOverlayStateByWorker,
  deriveWorkerMotion,
  type ActivityOverlayAnimationState
} from "../map/workerVisualState";
import { useMapKeyboardMotion } from "../map/runtime/useMapKeyboardMotion";
import { isEditableTarget, isElementInTerminalPanel } from "../app/utils";

interface MapCanvasProps {
  workers: Worker[];
  fadingWorkers?: Array<{ worker: Worker; startedAtMs: number }>;
  selectedWorkerId?: string;
  selectedWorkerIds?: string[];
  focusedSelectedWorkerId?: string;
  terminalFocusedSelected?: boolean;
  terminalFocusedWorkerId?: string;
  controlGroups?: Partial<Record<number, string[]>>;
  completionPendingWorkerIds?: string[];
  onSelect: (workerId: string | undefined) => void;
  onSelectionChange?: (workerIds: string[]) => void;
  onActivateWorker?: (workerId: string) => void;
  onMoveOrderIssued?: (workerId: string) => void;
  onPositionCommit: (workerId: string, position: WorkerPosition) => void;
  centerOnWorkerId?: string;
  centerRequestKey?: number;
}

interface HoverInfo {
  worker: Worker;
  screenX: number;
  screenY: number;
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
  mode: "pan" | "click" | "marquee";
  clickedWorkerId?: string;
  toggleSelectionOnRelease?: boolean;
  issueMoveOnClick?: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  deselectOnClick: boolean;
}

const workerRadius = 13;
const spriteBaseSize = 64;
const moveSpeedPerTick = 9;
const movementIntervalMs = 95;
const walkAnimationIntervalMs = 72;
const keyboardPanSpeedPerSecond = 520;
const keyboardMoveUnitsPerSecond = (moveSpeedPerTick * 1000) / movementIntervalMs;
const keyboardMoveCommitIntervalMs = 160;
const pointerPanDragThreshold = 4;
const defaultZoomScale = 1.45;
const maxZoomScale = 2.4;
const recenterVisibilityPaddingPx = 56;
const commandFeedbackDurationMs = 900;
const blockedFeedbackDurationMs = 750;
const workerPersonalSpacePx = 26;

export function MapCanvas({
  workers,
  fadingWorkers,
  selectedWorkerId,
  selectedWorkerIds,
  focusedSelectedWorkerId,
  terminalFocusedSelected,
  terminalFocusedWorkerId,
  controlGroups,
  completionPendingWorkerIds,
  onSelect,
  onSelectionChange,
  onActivateWorker,
  onMoveOrderIssued,
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
  const workersRef = useRef<Worker[]>(workers);
  const selectedWorkerIdRef = useRef<string | undefined>(selectedWorkerId);
  const onPositionCommitRef = useRef(onPositionCommit);
  const mapDataRef = useRef<LoadedOutpostMap | undefined>(undefined);
  const panDragRef = useRef<PanDragState | null>(null);
  const pressedPanKeysRef = useRef<Set<PanDirection>>(new Set());
  const panRafRef = useRef<number | null>(null);
  const lastPanFrameRef = useRef<number | null>(null);
  const pressedMoveKeysRef = useRef<Set<PanDirection>>(new Set());
  const moveRafRef = useRef<number | null>(null);
  const lastMoveFrameRef = useRef<number | null>(null);
  const lastKeyboardMoveCommitAtRef = useRef(0);
  const pendingKeyboardMoveCommitIdsRef = useRef<Set<string>>(new Set());
  const activityOverlayAnimationRef = useRef<Record<string, ActivityOverlayAnimationState>>({});
  const multiSelectedWorkerIdsRef = useRef<Set<string>>(new Set(selectedWorkerId ? [selectedWorkerId] : []));

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
  const [mapPreviewLoadError, setMapPreviewLoadError] = useState<string | undefined>(undefined);
  const [marqueeSelection, setMarqueeSelection] = useState<SelectionBox | null>(null);
  const [multiSelectedWorkerIds, setMultiSelectedWorkerIds] = useState<string[]>(selectedWorkerId ? [selectedWorkerId] : []);
  const effectiveSelectedWorkerIds = selectedWorkerIds ?? multiSelectedWorkerIds;

  const { mapData, errorText: mapErrorText } = useOutpostMap();
  const mapRenderError = mapErrorText ?? mapPreviewLoadError;

  const setConstrainedViewport = useCallback(
    (nextState: SetStateAction<ViewportState>) => {
      setViewport((current) => {
        const resolved =
          typeof nextState === "function" ? (nextState as (state: ViewportState) => ViewportState)(current) : nextState;
        return constrainViewportToContainMap(resolved, canvasSize, mapData);
      });
    },
    [canvasSize, mapData]
  );

  useEffect(() => {
    multiSelectedWorkerIdsRef.current = new Set(effectiveSelectedWorkerIds);
  }, [effectiveSelectedWorkerIds]);

  useEffect(() => {
    const activeIds = new Set(workers.map((worker) => worker.id));
    setMultiSelectedWorkerIds((current) => {
      const next = current.filter((workerId) => activeIds.has(workerId));
      if (next.length === current.length) {
        return current;
      }
      multiSelectedWorkerIdsRef.current = new Set(next);
      return next;
    });
  }, [workers]);

  useEffect(() => {
    let cancelled = false;
    setMapPreviewImage(undefined);
    setMapPreviewLoadError(undefined);

    if (!mapData) {
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setMapPreviewImage(image);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setMapPreviewLoadError(`Failed to load map preview image: ${mapData.backgroundImageUrl}`);
      }
    };
    image.src = mapData.backgroundImageUrl;

    return () => {
      cancelled = true;
    };
  }, [mapData]);

  const workerPositionLookup = useMemo(
    () => new Map<string, WorkerPosition>(workers.map((worker) => [worker.id, animatedPositions[worker.id] ?? worker.position])),
    [animatedPositions, workers]
  );

  const spriteTypes = useMemo(() => Array.from(new Set(workers.map((worker) => worker.avatarType))), [workers]);
  const spriteLibrary = useCharacterSpriteLibrary(spriteTypes);
  const blockedTileKeys = useMemo(() => buildBlockedTileSet(mapData), [mapData]);
  const completionPendingWorkerIdSet = useMemo(
    () => (completionPendingWorkerIds?.length ? new Set(completionPendingWorkerIds) : undefined),
    [completionPendingWorkerIds]
  );

  useEffect(() => {
    animatedPositionsRef.current = animatedPositions;
  }, [animatedPositions]);

  useEffect(() => {
    workersRef.current = workers;
  }, [workers]);

  useEffect(() => {
    selectedWorkerIdRef.current = selectedWorkerId;
  }, [selectedWorkerId]);

  useEffect(() => {
    onPositionCommitRef.current = onPositionCommit;
  }, [onPositionCommit]);

  useEffect(() => {
    mapDataRef.current = mapData;
  }, [mapData]);

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
    setViewport((current) => constrainViewportToContainMap(current, canvasSize, mapData));
  }, [canvasSize, mapData]);

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

      const currentWorkers = workersRef.current;
      const currentSelectedWorkerId = selectedWorkerIdRef.current;
      const currentMapData = mapDataRef.current;
      const orders = moveOrdersRef.current;
      const workersById = new Map(currentWorkers.map((worker) => [worker.id, worker]));
      const nextPositions = { ...animatedPositionsRef.current };
      const commitQueue: Array<{ workerId: string; position: WorkerPosition }> = [];
      let changed = false;
      const now = performance.now();
      const tileSize = currentMapData?.tileSize ?? 32;

      if (currentSelectedWorkerId) {
        const selectedOrder = orders[currentSelectedWorkerId];
        if (selectedOrder?.source === "wander") {
          delete orders[currentSelectedWorkerId];
        }
      }

      for (const worker of currentWorkers) {
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

      for (const worker of currentWorkers) {
        if (worker.id === currentSelectedWorkerId) {
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

        const nextTarget = randomWanderTarget(wanderState.anchor, tileSize, currentMapData);
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

          if (!isWorldPositionWalkable(finalPosition, currentMapData)) {
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

        if (!isWorldPositionWalkable(proposedPosition, currentMapData)) {
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

      for (const worker of currentWorkers) {
        if (orders[worker.id]) {
          continue;
        }

        const currentPosition = nextPositions[worker.id] ?? worker.position;
        if (!isWorldPositionWalkable(currentPosition, currentMapData)) {
          const safePosition = findNearestWalkablePosition(currentPosition, currentMapData);
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
        onPositionCommitRef.current(commit.workerId, {
          x: Math.round(commit.position.x * 10) / 10,
          y: Math.round(commit.position.y * 10) / 10
        });
      }
    }, movementIntervalMs);

    return () => {
      clearInterval(animationInterval);
    };
  }, []);

  useEffect(() => {
    if (!mapData || hasCenteredOnMap) {
      return;
    }

    const centerX = (mapData.width * mapData.tileSize) / 2;
    const centerY = (mapData.height * mapData.tileSize) / 2;

    setConstrainedViewport((current) => ({
      ...current,
      offsetX: canvasSize.width / 2 - centerX * current.scale,
      offsetY: canvasSize.height / 2 - centerY * current.scale
    }));
    setHasCenteredOnMap(true);
  }, [canvasSize.height, canvasSize.width, hasCenteredOnMap, mapData, setConstrainedViewport]);

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

    setConstrainedViewport((current) => ({
      ...current,
      offsetX: canvasSize.width / 2 - position.x * current.scale,
      offsetY: canvasSize.height / 2 - position.y * current.scale
    }));
  }, [animatedPositions, canvasSize.height, canvasSize.width, centerOnWorkerId, centerRequestKey, setConstrainedViewport, viewport, workers]);

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

    const activeWorkerIds = new Set(workers.map((worker) => worker.id));
    const workerMotion = deriveWorkerMotion(
      workers,
      workerPositionLookup,
      previousWorkerPositionsRef.current,
      workerMovingUntilRef.current,
      workerFacingRef.current,
      performance.now(),
      activeWorkerIds
    );
    const activityOverlayStateByWorker = deriveActivityOverlayStateByWorker(
      workers,
      activityOverlayAnimationRef.current,
      Date.now(),
      activeWorkerIds
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
      selectedWorkerIds: effectiveSelectedWorkerIds,
      focusedSelectedWorkerId,
      terminalFocusedSelected,
      terminalFocusedWorkerId,
      controlGroups,
      completionPendingWorkerIds: completionPendingWorkerIdSet,
      viewport,
      mapData,
      spriteLibrary,
      animationTick,
      walkAnimationTick,
      commandFeedback,
      mapPreviewImage,
      activityOverlayStateByWorker,
      marqueeSelection,
      workerRadius,
      spriteBaseSize,
      activeWorkerIds
    });
  }, [
    animatedPositions,
    animationTick,
    walkAnimationTick,
    canvasSize,
    controlGroups,
    completionPendingWorkerIdSet,
    fadingWorkers,
    mapData,
    selectedWorkerId,
    effectiveSelectedWorkerIds,
    focusedSelectedWorkerId,
    terminalFocusedSelected,
    terminalFocusedWorkerId,
    spriteLibrary,
    commandFeedback,
    mapPreviewImage,
    marqueeSelection,
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

      onMoveOrderIssued?.(worker.id);

      return true;
    },
    [blockedTileKeys, mapData, onMoveOrderIssued]
  );

  const commitWorkerPositions = useCallback(
    (workerIds: Iterable<string>, positions: Record<string, WorkerPosition>) => {
      const activeWorkerIds = new Set(workersRef.current.map((worker) => worker.id));
      for (const workerId of workerIds) {
        if (!activeWorkerIds.has(workerId)) {
          continue;
        }

        const position = positions[workerId];
        if (!position) {
          continue;
        }

        onPositionCommit(workerId, {
          x: Math.round(position.x * 10) / 10,
          y: Math.round(position.y * 10) / 10
        });
      }
    },
    [onPositionCommit]
  );

  const flushPendingKeyboardMoveCommits = useCallback(() => {
    if (pendingKeyboardMoveCommitIdsRef.current.size === 0) {
      return;
    }

    const commitIds = Array.from(pendingKeyboardMoveCommitIdsRef.current);
    pendingKeyboardMoveCommitIdsRef.current.clear();
    lastKeyboardMoveCommitAtRef.current = performance.now();
    commitWorkerPositions(commitIds, animatedPositionsRef.current);
  }, [commitWorkerPositions]);

  const nudgeSelectedWorkers = useCallback(
    (deltaX: number, deltaY: number): boolean => {
      const selectedIds = Array.from(multiSelectedWorkerIdsRef.current);
      if (selectedIds.length === 0) {
        return false;
      }

      const mapData = mapDataRef.current;
      const workersById = new Map(workersRef.current.map((worker) => [worker.id, worker]));
      const nextPositions = { ...animatedPositionsRef.current };
      const movedWorkerIds: string[] = [];
      let changed = false;
      const now = performance.now();

      for (const workerId of selectedIds) {
        const worker = workersById.get(workerId);
        if (!worker) {
          continue;
        }

        const currentPosition = nextPositions[workerId] ?? worker.position;
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
        nextPositions[workerId] = targetPosition;
        changed = true;

        delete moveOrdersRef.current[workerId];
        const wanderState = wanderStateRef.current[workerId];
        if (wanderState) {
          wanderState.anchor = { ...targetPosition };
          wanderState.nextMoveAfterMs = now + randomRange(900, 1800);
        }
      }

      if (!changed) {
        return false;
      }

      animatedPositionsRef.current = nextPositions;
      setAnimatedPositions(nextPositions);

      for (const workerId of movedWorkerIds) {
        pendingKeyboardMoveCommitIdsRef.current.add(workerId);
      }

      if (now - lastKeyboardMoveCommitAtRef.current >= keyboardMoveCommitIntervalMs) {
        const commitIds = Array.from(pendingKeyboardMoveCommitIdsRef.current);
        pendingKeyboardMoveCommitIdsRef.current.clear();
        lastKeyboardMoveCommitAtRef.current = now;
        commitWorkerPositions(commitIds, nextPositions);
      }

      return true;
    },
    [commitWorkerPositions]
  );

  useMapKeyboardMotion({
    pressedPanKeysRef,
    panRafRef,
    lastPanFrameRef,
    pressedMoveKeysRef,
    moveRafRef,
    lastMoveFrameRef,
    workerFacingRef,
    multiSelectedWorkerIdsRef,
    setViewport: setConstrainedViewport,
    nudgeSelectedWorkers,
    flushPendingKeyboardMoveCommits,
    keyboardPanSpeedPerSecond,
    keyboardMoveUnitsPerSecond
  });

  const issueManualMoveOrder = useCallback(
    (worker: Worker, point: { x: number; y: number }) => {
      const target = screenToWorld(point.x, point.y, viewport);
      issueManualMoveToWorld(worker, target);
    },
    [issueManualMoveToWorld, viewport]
  );

  const applyWorkerSelection = useCallback(
    (nextIds: string[]) => {
      const deduped = Array.from(new Set(nextIds));
      setMultiSelectedWorkerIds(deduped);
      multiSelectedWorkerIdsRef.current = new Set(deduped);
      if (onSelectionChange) {
        onSelectionChange(deduped);
        return;
      }
      onSelect(deduped.length === 1 ? deduped[0] : undefined);
    },
    [onSelect, onSelectionChange]
  );

  const issueManualMoveOrders = useCallback(
    (point: { x: number; y: number }) => {
      const selectedSet = multiSelectedWorkerIdsRef.current;
      const selectedWorkers = workers.filter((worker) => selectedSet.has(worker.id));
      if (selectedWorkers.length > 0) {
        if (selectedWorkers.length === 1) {
          issueManualMoveOrder(selectedWorkers[0], point);
          return;
        }

        const targetWorld = screenToWorld(point.x, point.y, viewport);
        const columns = Math.ceil(Math.sqrt(selectedWorkers.length));
        const tileSize = mapData?.tileSize ?? 32;
        const spacing = Math.max(tileSize * 2.2, spriteBaseSize + 8, workerPersonalSpacePx * 2.2);

        for (let index = 0; index < selectedWorkers.length; index += 1) {
          const worker = selectedWorkers[index];
          const row = Math.floor(index / columns);
          const col = index % columns;
          const offsetX = (col - (columns - 1) / 2) * spacing;
          const offsetY = (row - (Math.ceil(selectedWorkers.length / columns) - 1) / 2) * spacing;
          issueManualMoveToWorld(worker, {
            x: targetWorld.x + offsetX,
            y: targetWorld.y + offsetY
          });
        }
        return;
      }

      if (!selectedWorkerId) {
        return;
      }

      const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId);
      if (!selectedWorker) {
        return;
      }

      issueManualMoveOrder(selectedWorker, point);
    },
    [issueManualMoveOrder, issueManualMoveToWorld, mapData?.tileSize, selectedWorkerId, viewport, workers]
  );

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();

    if (event.button === 2) {
      event.preventDefault();

      const point = readPointerOnCanvas(event);
      panDragRef.current = {
        pointerId: event.pointerId,
        mode: "pan",
        issueMoveOnClick: multiSelectedWorkerIdsRef.current.size > 0 || Boolean(selectedWorkerId),
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
    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport, spriteLibrary, {
      workerRadius,
      spriteBaseSize
    });

    panDragRef.current = {
      pointerId: event.pointerId,
      mode: "click",
      clickedWorkerId: hit?.id,
      toggleSelectionOnRelease: event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      moved: false,
      deselectOnClick: Boolean(selectedWorkerId || multiSelectedWorkerIdsRef.current.size > 0)
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
        if (panDrag.mode === "click") {
          panDrag.mode = "marquee";
          panDrag.clickedWorkerId = undefined;
        }
      }

      if (panDrag.mode === "pan" && panDrag.moved && (deltaX !== 0 || deltaY !== 0)) {
        setConstrainedViewport((current) => ({
          ...current,
          offsetX: current.offsetX + deltaX,
          offsetY: current.offsetY + deltaY
        }));
        setHover(null);
      }

      if (panDrag.mode === "marquee") {
        setMarqueeSelection(normalizeSelectionBox(panDrag.startX, panDrag.startY, point.x, point.y));
        setHover(null);
      }

      panDrag.lastX = point.x;
      panDrag.lastY = point.y;
      return;
    }

    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport, spriteLibrary, {
      workerRadius,
      spriteBaseSize
    });

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

    if (panDrag.mode === "pan" && !panDrag.moved && panDrag.issueMoveOnClick) {
      issueManualMoveOrders({
        x: panDrag.lastX,
        y: panDrag.lastY
      });
      return;
    }

    if (panDrag.mode === "marquee") {
      const rect = normalizeSelectionBox(panDrag.startX, panDrag.startY, panDrag.lastX, panDrag.lastY);
      setMarqueeSelection(null);
      if (rect.width < 2 || rect.height < 2) {
        return;
      }

      const selectedIds = findWorkersInSelectionBox(rect, workers, workerPositionLookup, viewport, workerRadius);
      if (panDrag.toggleSelectionOnRelease) {
        const nextSelectionSet = new Set(multiSelectedWorkerIdsRef.current);
        for (const selectedId of selectedIds) {
          if (nextSelectionSet.has(selectedId)) {
            nextSelectionSet.delete(selectedId);
          } else {
            nextSelectionSet.add(selectedId);
          }
        }

        applyWorkerSelection(Array.from(nextSelectionSet));
        return;
      }

      applyWorkerSelection(selectedIds);
      return;
    }

    if (panDrag.clickedWorkerId) {
      const clickedWorkerId = panDrag.clickedWorkerId;

      if (panDrag.toggleSelectionOnRelease) {
        const nextSelection = multiSelectedWorkerIdsRef.current.has(clickedWorkerId)
          ? Array.from(multiSelectedWorkerIdsRef.current).filter((workerId) => workerId !== clickedWorkerId)
          : [...multiSelectedWorkerIdsRef.current, clickedWorkerId];
        applyWorkerSelection(nextSelection);
        return;
      }

      const isAlreadyPrimary = selectedWorkerId === clickedWorkerId;
      const hasOnlyThisSelection =
        multiSelectedWorkerIdsRef.current.size === 1 && multiSelectedWorkerIdsRef.current.has(clickedWorkerId);
      applyWorkerSelection([clickedWorkerId]);
      if (isAlreadyPrimary && hasOnlyThisSelection) {
        onActivateWorker?.(clickedWorkerId);
      }
      return;
    }

    if (panDrag.deselectOnClick) {
      applyWorkerSelection([]);
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
    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport, spriteLibrary, {
      workerRadius,
      spriteBaseSize
    });
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
    setMarqueeSelection(null);
  };

  const handlePointerLeave = () => {
    if (!panDragRef.current) {
      setHover(null);
    }
  };

  const zoomViewportAroundPoint = useCallback(
    (point: { x: number; y: number }, zoomDelta: number) => {
      setConstrainedViewport((current) => {
        const worldBeforeZoom = screenToWorld(point.x, point.y, current);
        const nextScale = clamp(current.scale * zoomDelta, 0.05, maxZoomScale);
        return {
          scale: nextScale,
          offsetX: point.x - worldBeforeZoom.x * nextScale,
          offsetY: point.y - worldBeforeZoom.y * nextScale
        };
      });
    },
    [setConstrainedViewport]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (isEditableTarget(event.target) || isElementInTerminalPanel(event.target)) {
        return;
      }

      const zoomIn = event.key === "+" || (event.code === "Equal" && event.shiftKey) || event.code === "NumpadAdd";
      const zoomOut = event.key === "-" || (event.code === "Minus" && !event.shiftKey) || event.code === "NumpadSubtract";
      if (!zoomIn && !zoomOut) {
        return;
      }

      event.preventDefault();
      zoomViewportAroundPoint({ x: canvasSize.width / 2, y: canvasSize.height / 2 }, zoomIn ? 1.1 : 0.9);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canvasSize.height, canvasSize.width, zoomViewportAroundPoint]);

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const point = readPointerOnCanvas(event);
    zoomViewportAroundPoint(point, event.deltaY < 0 ? 1.1 : 0.9);
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

      {mapRenderError ? (
        <div className="map-tooltip" style={{ left: 14, top: 14 }}>
          Map assets failed to load: {mapRenderError}
        </div>
      ) : null}
    </div>
  );
}

function constrainViewportToContainMap(
  viewport: ViewportState,
  canvasSize: { width: number; height: number },
  mapData: LoadedOutpostMap | undefined
): ViewportState {
  if (!mapData) {
    return viewport;
  }

  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  if (worldWidth <= 0 || worldHeight <= 0 || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return viewport;
  }

  const containScale = Math.min(canvasSize.width / worldWidth, canvasSize.height / worldHeight);
  if (!Number.isFinite(containScale) || containScale <= 0) {
    return viewport;
  }

  const minScale = containScale;
  const boundedScale = clamp(viewport.scale, minScale, Math.max(minScale, maxZoomScale));

  const scaledMapWidth = worldWidth * boundedScale;
  const scaledMapHeight = worldHeight * boundedScale;

  const offsetX =
    scaledMapWidth <= canvasSize.width
      ? (canvasSize.width - scaledMapWidth) / 2
      : clamp(viewport.offsetX, canvasSize.width - scaledMapWidth, 0);
  const offsetY =
    scaledMapHeight <= canvasSize.height
      ? (canvasSize.height - scaledMapHeight) / 2
      : clamp(viewport.offsetY, canvasSize.height - scaledMapHeight, 0);

  if (boundedScale === viewport.scale && offsetX === viewport.offsetX && offsetY === viewport.offsetY) {
    return viewport;
  }

  return {
    scale: boundedScale,
    offsetX,
    offsetY
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
