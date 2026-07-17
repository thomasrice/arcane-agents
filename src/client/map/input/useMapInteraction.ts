import { useCallback, useMemo, useRef, useState, type Dispatch, type MouseEvent, type PointerEvent, type SetStateAction, type WheelEvent } from "react";
import type { Worker, WorkerPosition } from "../../../shared/types";
import type { LoadedOutpostMap } from "../tileMapLoader";
import type { CharacterSpriteSet } from "../../sprites/spriteLoader";
import type { ViewportState } from "../viewportMath";
import { screenToWorld } from "../viewportMath";
import type { SelectionBox } from "../selection";
import { findWorkersInSelectionBox } from "../selection";
import { findWorkerAtScreenPoint } from "../hitTesting";
import type { CommandFeedback } from "../renderScene";
import type { MovementSimulation } from "../runtime/movementSimulation";
import type { MapDrawState } from "../runtime/useMapRuntime";
import { formationTargets, planManualMove } from "../commands/moveOrders";
import { PointerInteraction } from "./pointerStateMachine";
import {
  blockedFeedbackDurationMs,
  commandFeedbackDurationMs,
  keyboardMoveCommitIntervalMs,
  moveSpeedPerTick,
  pointerPanDragThreshold,
  spriteBaseSize,
  workerPersonalSpacePx,
  workerRadius
} from "../mapRuntimeConstants";

interface HoverInfo {
  worker: Worker;
  screenX: number;
  screenY: number;
}

interface UseMapInteractionInput {
  simulation: MovementSimulation;
  workers: Worker[];
  viewport: ViewportState;
  mapData: LoadedOutpostMap | undefined;
  blockedTileKeys: Set<string>;
  spriteLibrary: Partial<Record<string, CharacterSpriteSet>>;
  selectedWorkerId: string | undefined;
  selectedWorkerIdsRef: React.MutableRefObject<Set<string>>;
  drawStateRef: React.MutableRefObject<MapDrawState | null>;
  setConstrainedViewport: Dispatch<SetStateAction<ViewportState>>;
  zoomViewportAroundPoint: (point: { x: number; y: number }, zoomDelta: number) => void;
  onSelectionChange: (workerIds: string[]) => void;
  onActivateWorker?: (workerId: string) => void;
  onMoveOrderIssued?: (workerId: string) => void;
}

export interface MapInteraction {
  hover: HoverInfo | null;
  marqueeSelection: SelectionBox | null;
  commandFeedback: CommandFeedback | null;
  issueManualMoveToWorld: (worker: Worker, targetWorld: WorkerPosition) => boolean;
  nudgeSelectedWorkers: (deltaX: number, deltaY: number) => boolean;
  flushPendingKeyboardMoveCommits: () => void;
  canvasHandlers: {
    onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLCanvasElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLCanvasElement>) => void;
    onPointerLeave: () => void;
    onDoubleClick: (event: MouseEvent<HTMLCanvasElement>) => void;
    onContextMenu: (event: MouseEvent<HTMLCanvasElement>) => void;
    onWheel: (event: WheelEvent<HTMLCanvasElement>) => void;
  };
}

/**
 * All map pointer/command interaction: owns hover, the marquee box, command
 * feedback, and keyboard-move commit batching, and drives the pointer state machine
 * plus manual move-order planning. Selection is fully controlled — every change is
 * reported through `onSelectionChange`; the one allowed selection mirror ref is
 * updated optimistically so in-flight closures see the new selection immediately.
 */
export function useMapInteraction({
  simulation,
  workers,
  viewport,
  mapData,
  blockedTileKeys,
  spriteLibrary,
  selectedWorkerId,
  selectedWorkerIdsRef,
  drawStateRef,
  setConstrainedViewport,
  zoomViewportAroundPoint,
  onSelectionChange,
  onActivateWorker,
  onMoveOrderIssued
}: UseMapInteractionInput): MapInteraction {
  const pointer = useMemo(() => new PointerInteraction({ panDragThreshold: pointerPanDragThreshold }), []);
  const lastKeyboardMoveCommitAtRef = useRef(0);
  const pendingKeyboardMoveCommitIdsRef = useRef<Set<string>>(new Set());

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<SelectionBox | null>(null);
  const [commandFeedback, setCommandFeedback] = useState<CommandFeedback | null>(null);

  const currentPositionLookup = useCallback((): Map<string, WorkerPosition> => {
    const positions = simulation.getPositions();
    return new Map(workers.map((worker) => [worker.id, positions[worker.id] ?? worker.position]));
  }, [simulation, workers]);

  const hitWorkerAt = useCallback(
    (point: { x: number; y: number }): Worker | undefined =>
      findWorkerAtScreenPoint(point.x, point.y, workers, currentPositionLookup(), viewport, spriteLibrary, {
        workerRadius,
        spriteBaseSize
      }),
    [currentPositionLookup, spriteLibrary, viewport, workers]
  );

  const applyWorkerSelection = useCallback(
    (nextIds: string[]) => {
      const deduped = Array.from(new Set(nextIds));
      selectedWorkerIdsRef.current = new Set(deduped);
      onSelectionChange(deduped);
    },
    [onSelectionChange, selectedWorkerIdsRef]
  );

  const issueManualMoveToWorld = useCallback(
    (worker: Worker, targetWorld: WorkerPosition): boolean => {
      if (!mapData) {
        return false;
      }
      const result = planManualMove({
        workerId: worker.id,
        currentPosition: simulation.getPosition(worker.id) ?? worker.position,
        targetWorld,
        mapData,
        blockedTileKeys,
        nowMs: Date.now(),
        moveSpeedPerTick,
        commandFeedbackDurationMs,
        blockedFeedbackDurationMs
      });
      setCommandFeedback(result.feedback);
      if (result.kind === "blocked") {
        return false;
      }
      simulation.issueMoveOrders([result.order]);
      onMoveOrderIssued?.(worker.id);
      return true;
    },
    [blockedTileKeys, mapData, onMoveOrderIssued, simulation]
  );

  const issueManualMoveOrders = useCallback(
    (point: { x: number; y: number }) => {
      const selectedWorkers = workers.filter((worker) => selectedWorkerIdsRef.current.has(worker.id));
      if (selectedWorkers.length === 0) {
        return;
      }
      const targetWorld = screenToWorld(point.x, point.y, viewport);
      const targets = formationTargets(selectedWorkers.length, targetWorld, {
        tileSize: mapData?.tileSize ?? 32,
        spriteBaseSize,
        personalSpacePx: workerPersonalSpacePx
      });
      selectedWorkers.forEach((worker, index) => {
        issueManualMoveToWorld(worker, targets[index] ?? targetWorld);
      });
    },
    [issueManualMoveToWorld, mapData?.tileSize, selectedWorkerIdsRef, viewport, workers]
  );

  const commitWorkerPositions = useCallback(
    (workerIds: Iterable<string>) => {
      const draw = drawStateRef.current;
      if (!draw) {
        return;
      }
      const positions = simulation.getPositions();
      const activeWorkerIds = new Set(draw.workers.map((worker) => worker.id));
      for (const workerId of workerIds) {
        const position = positions[workerId];
        if (!activeWorkerIds.has(workerId) || !position) {
          continue;
        }
        draw.onPositionCommit(workerId, { x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10 });
      }
    },
    [drawStateRef, simulation]
  );

  const flushPendingKeyboardMoveCommits = useCallback(() => {
    if (pendingKeyboardMoveCommitIdsRef.current.size === 0) {
      return;
    }
    const commitIds = Array.from(pendingKeyboardMoveCommitIdsRef.current);
    pendingKeyboardMoveCommitIdsRef.current.clear();
    lastKeyboardMoveCommitAtRef.current = performance.now();
    commitWorkerPositions(commitIds);
  }, [commitWorkerPositions]);

  const nudgeSelectedWorkers = useCallback(
    (deltaX: number, deltaY: number): boolean => {
      const draw = drawStateRef.current;
      if (!draw) {
        return false;
      }
      const now = performance.now();
      const movedWorkerIds = simulation.nudgeWorkers(selectedWorkerIdsRef.current, deltaX, deltaY, {
        workers: draw.workers,
        mapData: draw.mapData,
        nowMs: now
      });
      if (movedWorkerIds.length === 0) {
        return false;
      }
      for (const workerId of movedWorkerIds) {
        pendingKeyboardMoveCommitIdsRef.current.add(workerId);
      }
      if (now - lastKeyboardMoveCommitAtRef.current >= keyboardMoveCommitIntervalMs) {
        const commitIds = Array.from(pendingKeyboardMoveCommitIdsRef.current);
        pendingKeyboardMoveCommitIdsRef.current.clear();
        lastKeyboardMoveCommitAtRef.current = now;
        commitWorkerPositions(commitIds);
      }
      return true;
    },
    [commitWorkerPositions, drawStateRef, selectedWorkerIdsRef, simulation]
  );

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    const point = readPointerOnCanvas(event);
    const result = pointer.pointerDown({
      pointerId: event.pointerId,
      button: event.button,
      point,
      modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey },
      hitWorkerId: event.button === 0 ? hitWorkerAt(point)?.id : undefined,
      hasSelection: selectedWorkerIdsRef.current.size > 0 || Boolean(selectedWorkerId)
    });
    if (result.preventDefault) {
      event.preventDefault();
    }
    if (result.capture) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = readPointerOnCanvas(event);
    const result = pointer.pointerMove({ pointerId: event.pointerId, point, resolveHit: () => hitWorkerAt(point)?.id });
    if (result.kind === "pan") {
      setConstrainedViewport((current) => ({
        ...current,
        offsetX: current.offsetX + result.deltaX,
        offsetY: current.offsetY + result.deltaY
      }));
      setHover(null);
    } else if (result.kind === "marquee") {
      setMarqueeSelection(result.box);
      setHover(null);
    } else if (result.kind === "hover") {
      const worker = result.hover ? workers.find((candidate) => candidate.id === result.hover?.workerId) : undefined;
      setHover(worker ? { worker, screenX: point.x, screenY: point.y } : null);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const result = pointer.pointerUp({
      pointerId: event.pointerId,
      primarySelectedWorkerId: selectedWorkerId,
      selectedWorkerIds: Array.from(selectedWorkerIdsRef.current),
      resolveMarquee: (box) => findWorkersInSelectionBox(box, workers, currentPositionLookup(), viewport, workerRadius)
    });
    if (result.releaseCapture && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (result.clearMarquee) {
      setMarqueeSelection(null);
    }
    if (result.select) {
      applyWorkerSelection(result.select);
    }
    if (result.activateWorkerId) {
      onActivateWorker?.(result.activateWorkerId);
    }
    if (result.issueMoveAt) {
      issueManualMoveOrders(result.issueMoveAt);
    }
  };

  const onPointerCancel = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!pointer.pointerCancel(event.pointerId).cleared) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setMarqueeSelection(null);
  };

  const onPointerLeave = () => {
    if (!pointer.hasActiveDrag()) {
      setHover(null);
    }
  };

  const onDoubleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }
    const { activateWorkerId } = pointer.doubleClick(hitWorkerAt(readPointerOnCanvas(event))?.id);
    if (activateWorkerId) {
      onActivateWorker?.(activateWorkerId);
    }
  };

  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    zoomViewportAroundPoint(readPointerOnCanvas(event), event.deltaY < 0 ? 1.1 : 0.9);
  };

  return {
    hover,
    marqueeSelection,
    commandFeedback,
    issueManualMoveToWorld,
    nudgeSelectedWorkers,
    flushPendingKeyboardMoveCommits,
    canvasHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onDoubleClick,
      onContextMenu: (event) => event.preventDefault(),
      onWheel
    }
  };
}

function readPointerOnCanvas(
  event: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>
): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}
