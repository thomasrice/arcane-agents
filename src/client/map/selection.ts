import type { Worker, WorkerPosition } from "../../shared/types";
import { worldToScreen, type ViewportState } from "./viewportMath";

export interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizeSelectionBox(startX: number, startY: number, endX: number, endY: number): SelectionBox {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY)
  };
}

export function findWorkersInSelectionBox(
  selectionBox: SelectionBox,
  workers: Worker[],
  workerPositionLookup: Map<string, WorkerPosition>,
  viewport: ViewportState,
  workerRadius: number
): string[] {
  const selected: string[] = [];
  const padding = Math.max(8, workerRadius * viewport.scale * 0.7);
  const left = selectionBox.x;
  const right = selectionBox.x + selectionBox.width;
  const top = selectionBox.y;
  const bottom = selectionBox.y + selectionBox.height;

  for (const worker of workers) {
    const position = workerPositionLookup.get(worker.id) ?? worker.position;
    const screen = worldToScreen(position.x, position.y, viewport);
    if (screen.x >= left - padding && screen.x <= right + padding && screen.y >= top - padding && screen.y <= bottom + padding) {
      selected.push(worker.id);
    }
  }

  return selected;
}

export function drawSelectionBox(context: CanvasRenderingContext2D, selectionBox: SelectionBox): void {
  if (selectionBox.width <= 0 || selectionBox.height <= 0) {
    return;
  }

  context.save();
  context.fillStyle = "rgba(101, 210, 160, 0.16)";
  context.strokeStyle = "rgba(171, 246, 211, 0.82)";
  context.lineWidth = 1.2;
  context.fillRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
  context.strokeRect(selectionBox.x + 0.5, selectionBox.y + 0.5, selectionBox.width - 1, selectionBox.height - 1);
  context.restore();
}
