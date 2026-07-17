import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Worker, WorkerPosition } from "../../../shared/types";
import type { LoadedOutpostMap } from "../tileMapLoader";
import {
  clamp,
  constrainViewportToContainMap,
  getBoundingCenter,
  isInsideViewport,
  screenToWorld,
  worldToScreen,
  type ViewportState
} from "../viewportMath";
import { defaultZoomScale, maxZoomScale, recenterVisibilityPaddingPx } from "../mapRuntimeConstants";

export interface CanvasSize {
  width: number;
  height: number;
}

interface UseMapCameraInput {
  mapData: LoadedOutpostMap | undefined;
  workers: Worker[];
  centerOnWorkerIds: string[] | undefined;
  centerRequestKey: number | undefined;
  resolveWorkerPosition: (worker: Worker) => WorkerPosition;
}

export interface MapCamera {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  canvasSize: CanvasSize;
  viewport: ViewportState;
  setConstrainedViewport: Dispatch<SetStateAction<ViewportState>>;
  zoomViewportAroundPoint: (point: { x: number; y: number }, zoomDelta: number) => void;
  zoomViewportByFactor: (factor: number) => void;
}

/**
 * Owns the map camera: the container ResizeObserver-driven `canvasSize`, the
 * `viewport` (always clamped to keep the map contained), zooming, and the two
 * auto-centre behaviours (first fit-to-map, and recentring on a selection request).
 */
export function useMapCamera({
  mapData,
  workers,
  centerOnWorkerIds,
  centerRequestKey,
  resolveWorkerPosition
}: UseMapCameraInput): MapCamera {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastCenterRequestRef = useRef<number | undefined>(undefined);

  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 1000, height: 640 });
  const [viewport, setViewport] = useState<ViewportState>({ scale: defaultZoomScale, offsetX: 70, offsetY: 25 });
  const [hasCenteredOnMap, setHasCenteredOnMap] = useState(false);

  const setConstrainedViewport = useCallback<Dispatch<SetStateAction<ViewportState>>>(
    (nextState) => {
      setViewport((current) => {
        const resolved =
          typeof nextState === "function" ? (nextState as (state: ViewportState) => ViewportState)(current) : nextState;
        return constrainViewportToContainMap(resolved, canvasSize, mapData, maxZoomScale);
      });
    },
    [canvasSize, mapData]
  );

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

  const zoomViewportByFactor = useCallback(
    (factor: number) => {
      zoomViewportAroundPoint({ x: canvasSize.width / 2, y: canvasSize.height / 2 }, factor);
    },
    [canvasSize.height, canvasSize.width, zoomViewportAroundPoint]
  );

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
      setCanvasSize({ width: Math.max(300, Math.floor(width)), height: Math.max(220, Math.floor(height)) });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setViewport((current) => constrainViewportToContainMap(current, canvasSize, mapData, maxZoomScale));
  }, [canvasSize, mapData]);

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
    if (!centerOnWorkerIds || centerOnWorkerIds.length === 0 || centerRequestKey === undefined) {
      return;
    }
    if (lastCenterRequestRef.current === centerRequestKey) {
      return;
    }
    const centeredWorkerIdSet = new Set(centerOnWorkerIds);
    const positions = workers
      .filter((worker) => centeredWorkerIdSet.has(worker.id))
      .map((worker) => resolveWorkerPosition(worker));
    const center = getBoundingCenter(positions);
    if (!center) {
      return;
    }
    lastCenterRequestRef.current = centerRequestKey;
    const allWorkersVisible = positions.every((position) =>
      isInsideViewport(worldToScreen(position.x, position.y, viewport), canvasSize.width, canvasSize.height, recenterVisibilityPaddingPx)
    );
    if (allWorkersVisible) {
      return;
    }
    setConstrainedViewport((current) => ({
      ...current,
      offsetX: canvasSize.width / 2 - center.x * current.scale,
      offsetY: canvasSize.height / 2 - center.y * current.scale
    }));
  }, [
    canvasSize.height,
    canvasSize.width,
    centerOnWorkerIds,
    centerRequestKey,
    resolveWorkerPosition,
    setConstrainedViewport,
    viewport,
    workers
  ]);

  return {
    containerRef,
    canvasSize,
    viewport,
    setConstrainedViewport,
    zoomViewportAroundPoint,
    zoomViewportByFactor
  };
}
