import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { Worker, WorkerPosition } from "../../shared/types";
import { useOutpostMap } from "../map/tileMapLoader";
import { useCharacterSpriteLibrary, type SpriteDirection } from "../sprites/spriteLoader";
import { WorkerVisualStateTracker } from "../map/workerVisualState";
import { MovementSimulation } from "../map/runtime/movementSimulation";
import { useMapRuntime, type MapDrawState } from "../map/runtime/useMapRuntime";
import { useMapKeyboardMotion } from "../map/runtime/useMapKeyboardMotion";
import { useMapCamera } from "../map/runtime/useMapCamera";
import { useMapPreviewImage } from "../map/runtime/useMapPreviewImage";
import { useMapInteraction } from "../map/input/useMapInteraction";
import { planScatterTargets } from "../map/commands/moveOrders";
import {
  keyboardMoveUnitsPerSecond,
  keyboardPanSpeedPerSecond,
  movementIntervalMs,
  scatterBaseSpreadPx,
  scatterPerWorkerSpreadPx,
  spriteBaseSize,
  walkAnimationIntervalMs,
  workerPersonalSpacePx,
  workerRadius
} from "../map/mapRuntimeConstants";

export interface MapCanvasHandle {
  /** Recentre the viewport on the given workers (no-op if already fully visible). */
  centerOnWorkers: (workerIds: string[]) => void;
  /** Scatter the given group around its centroid, pathing each to a walkable target. */
  scatterWorkers: (workerIds: string[]) => void;
  /** Move keyboard focus onto the canvas (used when leaving terminal focus). */
  focus: () => void;
}

interface MapCanvasProps {
  workers: Worker[];
  fadingWorkers?: Array<{ worker: Worker; startedAtMs: number }>;
  selectedWorkerId?: string;
  selectedWorkerIds: string[];
  focusedSelectedWorkerId?: string;
  terminalFocusedSelected?: boolean;
  terminalFocusedWorkerId?: string;
  controlGroups?: Partial<Record<number, string[]>>;
  completionPendingWorkerIds?: string[];
  onSelectionChange: (workerIds: string[]) => void;
  onActivateWorker?: (workerId: string) => void;
  onMoveOrderIssued?: (workerId: string) => void;
  onPositionCommit: (workerId: string, position: WorkerPosition) => void;
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  {
    workers,
    fadingWorkers,
    selectedWorkerId,
    selectedWorkerIds,
    focusedSelectedWorkerId,
    terminalFocusedSelected,
    terminalFocusedWorkerId,
    controlGroups,
    completionPendingWorkerIds,
    onSelectionChange,
    onActivateWorker,
    onMoveOrderIssued,
    onPositionCommit
  }: MapCanvasProps,
  ref
): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerFacingRef = useRef<Record<string, SpriteDirection>>({});
  const selectedWorkerIdsRef = useRef<Set<string>>(new Set());
  const drawStateRef = useRef<MapDrawState | null>(null);

  const simulation = useMemo(
    () => new MovementSimulation({ stepIntervalMs: movementIntervalMs, personalSpacePx: workerPersonalSpacePx }),
    []
  );
  const visualStateTracker = useMemo(() => new WorkerVisualStateTracker(), []);

  const { mapData, errorText: mapErrorText } = useOutpostMap();
  const spriteTypes = useMemo(() => Array.from(new Set(workers.map((worker) => worker.avatarType))), [workers]);
  const spriteLibrary = useCharacterSpriteLibrary(spriteTypes);
  const blockedTileKeys = useMemo(() => mapData?.collisionTileKeys ?? new Set<string>(), [mapData]);
  const completionPendingWorkerIdSet = useMemo(
    () => (completionPendingWorkerIds?.length ? new Set(completionPendingWorkerIds) : undefined),
    [completionPendingWorkerIds]
  );

  const resolveWorkerPosition = useCallback(
    (worker: Worker): WorkerPosition => simulation.getPosition(worker.id) ?? worker.position,
    [simulation]
  );

  const { mapPreviewImage, mapPreviewLoadError } = useMapPreviewImage(mapData);
  const mapRenderError = mapErrorText ?? mapPreviewLoadError;

  const {
    containerRef,
    canvasSize,
    viewport,
    setConstrainedViewport,
    zoomViewportAroundPoint,
    zoomViewportByFactor,
    centerOnWorkers,
    keepWorkersInView
  } = useMapCamera({ mapData, workers, resolveWorkerPosition });

  const {
    hover,
    marqueeSelection,
    commandFeedback,
    issueManualMoveToWorld,
    nudgeSelectedWorkers,
    flushPendingKeyboardMoveCommits,
    canvasHandlers
  } = useMapInteraction({
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
  });

  useEffect(() => {
    selectedWorkerIdsRef.current = new Set(selectedWorkerIds);
  }, [selectedWorkerIds]);

  // Scatter a group around its centroid. Lives in the map layer because it needs live
  // simulated positions and walkability; App only passes the worker ids.
  const scatterWorkers = useCallback(
    (workerIds: string[]) => {
      const idSet = new Set(workerIds);
      const targetWorkers = workers.filter((worker) => idSet.has(worker.id));
      if (targetWorkers.length === 0) {
        return;
      }
      const targets = planScatterTargets(
        targetWorkers.map((worker) => resolveWorkerPosition(worker)),
        { baseSpreadPx: scatterBaseSpreadPx, perWorkerSpreadPx: scatterPerWorkerSpreadPx, rng: Math.random }
      );
      targetWorkers.forEach((worker, index) => {
        const target = targets[index];
        if (target) {
          issueManualMoveToWorld(worker, target);
        }
      });
    },
    [issueManualMoveToWorld, resolveWorkerPosition, workers]
  );

  // The handle object is stable; it dispatches through refs so callers always hit the
  // latest closures without the handle identity churning as props change.
  const centerOnWorkersRef = useRef(centerOnWorkers);
  centerOnWorkersRef.current = centerOnWorkers;
  const scatterWorkersRef = useRef(scatterWorkers);
  scatterWorkersRef.current = scatterWorkers;

  useImperativeHandle(
    ref,
    () => ({
      centerOnWorkers: (workerIds: string[]) => centerOnWorkersRef.current(workerIds),
      scatterWorkers: (workerIds: string[]) => scatterWorkersRef.current(workerIds),
      focus: () => canvasRef.current?.focus()
    }),
    []
  );

  useMapRuntime({
    canvasRef,
    drawStateRef,
    simulation,
    visualStateTracker,
    facingRef: workerFacingRef,
    selectedWorkerIdsRef,
    stepIntervalMs: movementIntervalMs,
    walkAnimationIntervalMs,
    workerRadius,
    spriteBaseSize
  });

  useMapKeyboardMotion({
    workerFacingRef,
    selectedWorkerIdsRef,
    setViewport: setConstrainedViewport,
    zoomViewportByFactor,
    nudgeSelectedWorkers,
    keepWorkersInView,
    flushPendingKeyboardMoveCommits,
    keyboardPanSpeedPerSecond,
    keyboardMoveUnitsPerSecond
  });

  drawStateRef.current = {
    canvasSize,
    viewport,
    workers,
    fadingWorkers,
    mapData,
    spriteLibrary,
    selectedWorkerId,
    selectedWorkerIds,
    focusedSelectedWorkerId,
    terminalFocusedSelected,
    terminalFocusedWorkerId,
    controlGroups,
    completionPendingWorkerIds: completionPendingWorkerIdSet,
    commandFeedback,
    mapPreviewImage,
    marqueeSelection,
    onPositionCommit
  };

  return (
    <div className="map-container" ref={containerRef}>
      <canvas ref={canvasRef} className="map-canvas" tabIndex={0} {...canvasHandlers} />

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
});
