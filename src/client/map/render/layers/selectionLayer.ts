import type { SelectionBox } from "../../selection";

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
