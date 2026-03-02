import type { WorkerPosition } from "../../shared/types";

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

export function offsetPositionByDirection(position: WorkerPosition, direction: PanDirection, distance: number): WorkerPosition {
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

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}
