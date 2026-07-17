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

