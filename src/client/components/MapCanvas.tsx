import { useCallback, useEffect, useMemo, useRef } from "react";
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
import {
  keyboardMoveUnitsPerSecond,
  keyboardPanSpeedPerSecond,
  movementIntervalMs,
  spriteBaseSize,
  walkAnimationIntervalMs,
  workerPersonalSpacePx,
  workerRadius
} from "../map/mapRuntimeConstants";

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
  externalMoveOrders?: Array<{ workerId: string; target: WorkerPosition }>;
  externalMoveOrderToken?: number;
  centerOnWorkerIds?: string[];
  centerRequestKey?: number;
}

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
  onSelectionChange,
  onActivateWorker,
  onMoveOrderIssued,
  onPositionCommit,
  externalMoveOrders,
  externalMoveOrderToken,
  centerOnWorkerIds,
  centerRequestKey
}: MapCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerFacingRef = useRef<Record<string, SpriteDirection>>({});
  const selectedWorkerIdsRef = useRef<Set<string>>(new Set());
  const drawStateRef = useRef<MapDrawState | null>(null);
  const lastExternalMoveOrderTokenRef = useRef<number | undefined>(undefined);

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

  const { containerRef, canvasSize, viewport, setConstrainedViewport, zoomViewportAroundPoint, zoomViewportByFactor } =
    useMapCamera({ mapData, workers, centerOnWorkerIds, centerRequestKey, resolveWorkerPosition });

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

  useEffect(() => {
    if (
      externalMoveOrderToken === undefined ||
      externalMoveOrderToken === lastExternalMoveOrderTokenRef.current ||
      !externalMoveOrders ||
      externalMoveOrders.length === 0
    ) {
      return;
    }
    lastExternalMoveOrderTokenRef.current = externalMoveOrderToken;
    const workersById = new Map(workers.map((worker) => [worker.id, worker]));
    for (const order of externalMoveOrders) {
      const worker = workersById.get(order.workerId);
      if (worker) {
        issueManualMoveToWorld(worker, order.target);
      }
    }
  }, [externalMoveOrderToken, externalMoveOrders, workers, issueManualMoveToWorld]);

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
}
