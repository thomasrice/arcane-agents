import type { LoadedOutpostMap } from "./tileMapLoader";

export interface ViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export type PanDirection = "up" | "down" | "left" | "right";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function worldToScreen(worldX: number, worldY: number, viewport: ViewportState): { x: number; y: number } {
  return {
    x: worldX * viewport.scale + viewport.offsetX,
    y: worldY * viewport.scale + viewport.offsetY
  };
}

export function getBoundingCenter(points: readonly { x: number; y: number }[]): { x: number; y: number } | undefined {
  const first = points[0];
  if (!first) {
    return undefined;
  }

  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      continue;
    }
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2
  };
}

export function isInsideViewport(
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

export function screenToWorld(screenX: number, screenY: number, viewport: ViewportState): { x: number; y: number } {
  return {
    x: (screenX - viewport.offsetX) / viewport.scale,
    y: (screenY - viewport.offsetY) / viewport.scale
  };
}

export function toPanDirection(key: string): PanDirection | undefined {
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

export function isWasdKey(key: string): boolean {
  if (key.length !== 1) {
    return false;
  }

  const normalized = key.toLowerCase();
  return normalized === "w" || normalized === "a" || normalized === "s" || normalized === "d";
}

export function panViewportToKeepWorldPointInside(
  viewport: ViewportState,
  worldPoint: { x: number; y: number },
  canvasSize: { width: number; height: number },
  padding: number
): ViewportState {
  const screenPoint = worldToScreen(worldPoint.x, worldPoint.y, viewport);
  const horizontalPadding = clamp(padding, 0, canvasSize.width / 2);
  const verticalPadding = clamp(padding, 0, canvasSize.height / 2);
  const offsetX =
    viewport.offsetX +
    (clamp(screenPoint.x, horizontalPadding, canvasSize.width - horizontalPadding) - screenPoint.x);
  const offsetY =
    viewport.offsetY +
    (clamp(screenPoint.y, verticalPadding, canvasSize.height - verticalPadding) - screenPoint.y);

  if (offsetX === viewport.offsetX && offsetY === viewport.offsetY) {
    return viewport;
  }

  return { ...viewport, offsetX, offsetY };
}

/**
 * Clamp a viewport so the map stays contained: scale never drops below a
 * contain-fit, and the offset keeps the map within the canvas (centring it on any
 * axis where the scaled map is smaller than the canvas).
 */
export function constrainViewportToContainMap(
  viewport: ViewportState,
  canvasSize: { width: number; height: number },
  mapData: LoadedOutpostMap | undefined,
  maxZoomScale: number
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

