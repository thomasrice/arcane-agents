import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Worker, WorkerPosition } from "../../../shared/types";
import type { LoadedOutpostMap } from "../tileMapLoader";
import {
  clamp,
  constrainViewportToContainMap,
  getBoundingCenter,
  isInsideViewport,
  panViewportToKeepWorldPointInside,
  screenToWorld,
  worldToScreen,
  type ViewportState
} from "../viewportMath";
import {
  cameraFollowPaddingPx,
  defaultZoomScale,
  maxZoomScale,
  recenterVisibilityPaddingPx
} from "../mapRuntimeConstants";

export interface CanvasSize {
  width: number;
  height: number;
}

interface UseMapCameraInput {
  mapData: LoadedOutpostMap | undefined;
  workers: Worker[];
  resolveWorkerPosition: (worker: Worker) => WorkerPosition;
}

export interface MapCamera {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  canvasSize: CanvasSize;
  viewport: ViewportState;
  setConstrainedViewport: Dispatch<SetStateAction<ViewportState>>;
  zoomViewportAroundPoint: (point: { x: number; y: number }, zoomDelta: number) => void;
  zoomViewportByFactor: (factor: number) => void;
  /** Recentre the viewport on the given workers unless they are already fully visible. */
  centerOnWorkers: (workerIds: string[]) => void;
  /** Pan only enough to keep the moving workers inside the camera's edge margin. */
  keepWorkersInView: (workerIds: ReadonlySet<string>) => void;
}

/**
 * Owns the map camera: the container ResizeObserver-driven `canvasSize`, the
 * `viewport` (always clamped to keep the map contained), zooming, first fit-to-map,
 * and the imperative `centerOnWorkers` recentre (called through the MapCanvas handle
 * — the caller no longer threads a token/request-key prop).
 */
export function useMapCamera({ mapData, workers, resolveWorkerPosition }: UseMapCameraInput): MapCamera {
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const centerOnWorkers = useCallback(
    (workerIds: string[]) => {
      if (workerIds.length === 0) {
        return;
      }
      const centeredWorkerIdSet = new Set(workerIds);
      const positions = workers
        .filter((worker) => centeredWorkerIdSet.has(worker.id))
        .map((worker) => resolveWorkerPosition(worker));
      const center = getBoundingCenter(positions);
      if (!center) {
        return;
      }
      const allWorkersVisible = positions.every((position) =>
        isInsideViewport(
          worldToScreen(position.x, position.y, viewport),
          canvasSize.width,
          canvasSize.height,
          recenterVisibilityPaddingPx
        )
      );
      if (allWorkersVisible) {
        return;
      }
      setConstrainedViewport((current) => ({
        ...current,
        offsetX: canvasSize.width / 2 - center.x * current.scale,
        offsetY: canvasSize.height / 2 - center.y * current.scale
      }));
    },
    [canvasSize.height, canvasSize.width, resolveWorkerPosition, setConstrainedViewport, viewport, workers]
  );

  const keepWorkersInView = useCallback(
    (workerIds: ReadonlySet<string>) => {
      const positions = workers
        .filter((worker) => workerIds.has(worker.id))
        .map((worker) => resolveWorkerPosition(worker));
      const center = getBoundingCenter(positions);
      if (!center) {
        return;
      }
      setConstrainedViewport((current) =>
        panViewportToKeepWorldPointInside(current, center, canvasSize, cameraFollowPaddingPx)
      );
    },
    [canvasSize, resolveWorkerPosition, setConstrainedViewport, workers]
  );

  return {
    containerRef,
    canvasSize,
    viewport,
    setConstrainedViewport,
    zoomViewportAroundPoint,
    zoomViewportByFactor,
    centerOnWorkers,
    keepWorkersInView
  };
}
