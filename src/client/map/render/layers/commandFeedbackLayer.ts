import type { WorkerPosition } from "../../../../shared/types";
import { clamp, worldToScreen, type ViewportState } from "../../viewportMath";

export interface CommandFeedbackRenderInput {
  kind: "ok" | "blocked";
  workerId: string;
  startedAtMs: number;
  durationMs: number;
  destination: WorkerPosition;
  path?: WorkerPosition[];
}

export function drawCommandFeedbackLayer(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  feedback: CommandFeedbackRenderInput,
  nowMs: number
): void {
  const elapsed = nowMs - feedback.startedAtMs;
  if (elapsed < 0 || elapsed > feedback.durationMs) {
    return;
  }

  const progress = clamp(elapsed / feedback.durationMs, 0, 1);
  const alpha = 1 - progress;

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  if (feedback.kind === "ok" && feedback.path && feedback.path.length >= 2) {
    context.beginPath();
    const start = worldToScreen(feedback.path[0].x, feedback.path[0].y, viewport);
    context.moveTo(start.x, start.y);

    for (let index = 1; index < feedback.path.length; index += 1) {
      const point = worldToScreen(feedback.path[index].x, feedback.path[index].y, viewport);
      context.lineTo(point.x, point.y);
    }

    context.strokeStyle = `rgba(180, 245, 215, ${0.7 * alpha})`;
    context.lineWidth = Math.max(1.5, 2.6 * viewport.scale);
    context.stroke();
  }

  const destination = worldToScreen(feedback.destination.x, feedback.destination.y, viewport);
  const pulse = 0.25 + Math.sin(progress * Math.PI * 4) * 0.1;

  if (feedback.kind === "ok") {
    const outerRadius = (12 + pulse * 18) * viewport.scale;
    const innerRadius = 6 * viewport.scale;

    context.strokeStyle = `rgba(174, 244, 212, ${0.9 * alpha})`;
    context.lineWidth = Math.max(1.2, 2.2 * viewport.scale);
    context.beginPath();
    context.arc(destination.x, destination.y, outerRadius, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = `rgba(201, 255, 226, ${0.55 * alpha})`;
    context.beginPath();
    context.arc(destination.x, destination.y, innerRadius, 0, Math.PI * 2);
    context.fill();
  } else {
    const radius = (12 + progress * 10) * viewport.scale;
    context.strokeStyle = `rgba(255, 126, 126, ${0.95 * alpha})`;
    context.lineWidth = Math.max(1.4, 2.5 * viewport.scale);

    context.beginPath();
    context.moveTo(destination.x - radius * 0.65, destination.y - radius * 0.65);
    context.lineTo(destination.x + radius * 0.65, destination.y + radius * 0.65);
    context.moveTo(destination.x + radius * 0.65, destination.y - radius * 0.65);
    context.lineTo(destination.x - radius * 0.65, destination.y + radius * 0.65);
    context.stroke();

    context.beginPath();
    context.strokeStyle = `rgba(255, 150, 150, ${0.45 * alpha})`;
    context.lineWidth = Math.max(1, 1.6 * viewport.scale);
    context.arc(destination.x, destination.y, radius, 0, Math.PI * 2);
    context.stroke();
  }

  context.restore();
}
