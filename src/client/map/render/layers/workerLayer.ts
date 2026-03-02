import type { Worker } from "../../../../shared/types";
import type { ActivityOverlayRenderState } from "../../workerVisualState";
import { spriteBoundsAtGround, type SpriteBounds } from "../../hitTesting";

const activityOverlayShimmerBandChars = 3.4;
const summonWorkerDurationMs = 520;

export interface SelectedWorkerOutline {
  workerId: string;
  screenX: number;
  screenY: number;
  radius: number;
  spriteBounds?: SpriteBounds;
}

export interface WorkerNameplate {
  anchorX: number;
  topY: number;
  label: string;
  visible: boolean;
}

export type SelectedOutlineState = "selected" | "terminal-focused" | "group-focused" | "group-focused-terminal";

export function drawSpriteCharacter(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  centerX: number,
  groundY: number,
  scale: number,
  baseSize: number
): SpriteBounds {
  const bounds = spriteBoundsAtGround(centerX, groundY, scale, baseSize);
  context.save();
  context.shadowColor = "rgba(8, 12, 10, 0.5)";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = Math.max(1, Math.round(2 * scale));
  context.shadowBlur = 0;
  context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
  context.restore();
  return bounds;
}

export function drawFallbackWorker(
  context: CanvasRenderingContext2D,
  worker: Worker,
  centerX: number,
  centerY: number,
  radius: number,
  scale: number
): void {
  context.fillStyle = fallbackAvatarColor(worker.avatarType);
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(8, 12, 10, 0.7)";
  context.lineWidth = Math.max(1, 1.5 * scale);
  context.stroke();

  context.fillStyle = "rgba(15, 24, 19, 0.45)";
  context.fillRect(centerX - 4 * scale, centerY - 3 * scale, 8 * scale, 6 * scale);
}

export function drawCharacterGroundShadow(
  context: CanvasRenderingContext2D,
  centerX: number,
  groundY: number,
  scale: number
): void {
  context.fillStyle = "rgba(7, 12, 10, 0.28)";
  context.beginPath();
  context.ellipse(centerX, groundY + 2 * scale, 8 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
  context.fill();
}

export function drawSelectedWorkerOutline(
  context: CanvasRenderingContext2D,
  selectedOutline: SelectedWorkerOutline,
  scale: number,
  state: SelectedOutlineState
): void {
  const style = selectedOutlineStyle(state);
  context.save();
  context.strokeStyle = style.stroke;
  context.lineWidth = style.lineWidth;

  if (selectedOutline.spriteBounds) {
    const bounds = selectedOutline.spriteBounds;
    context.strokeRect(bounds.x - 2 * scale, bounds.y - 2 * scale, bounds.width + 4 * scale, bounds.height + 4 * scale);
  } else {
    context.beginPath();
    context.arc(selectedOutline.screenX, selectedOutline.screenY, selectedOutline.radius + 6 * scale, 0, Math.PI * 2);
    context.stroke();
  }

  context.restore();
}

export function drawControlGroupIndicator(
  context: CanvasRenderingContext2D,
  anchorX: number,
  topY: number,
  controlKeys: string[],
  scale: number
): void {
  const badgeSize = Math.max(12, Math.round(14 * scale));
  const gap = Math.max(2, Math.round(3 * scale));
  const totalWidth = controlKeys.length * badgeSize + (controlKeys.length - 1) * gap;
  const startX = Math.round(anchorX - totalWidth / 2);
  const roundedTopY = Math.round(topY);

  context.font = `${Math.max(10, Math.round(10 * scale))}px 'Trebuchet MS', sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  controlKeys.forEach((key, index) => {
    const x = startX + index * (badgeSize + gap);
    context.fillStyle = "rgba(12, 17, 15, 0.88)";
    context.fillRect(x, roundedTopY, badgeSize, badgeSize);
    context.strokeStyle = "rgba(235, 242, 207, 0.72)";
    context.lineWidth = 1;
    context.strokeRect(x, roundedTopY, badgeSize, badgeSize);

    context.fillStyle = "#f2f5dd";
    context.fillText(key, x + badgeSize / 2, roundedTopY + badgeSize / 2 + 0.5);
  });

  context.textBaseline = "alphabetic";
}

export function drawActivityOverlayLabel(
  context: CanvasRenderingContext2D,
  overlay: ActivityOverlayRenderState,
  centerX: number,
  baselineY: number
): void {
  context.fillStyle = "#eff3d8";
  context.fillText(overlay.text, centerX, baselineY);

  if (overlay.shimmerPhase === undefined) {
    return;
  }

  const characters = Array.from(overlay.text);
  if (characters.length < 2) {
    return;
  }

  const characterWidths = characters.map((character) => context.measureText(character).width);
  const totalWidth = characterWidths.reduce((sum, width) => sum + width, 0);
  if (totalWidth <= 0) {
    return;
  }

  const shimmerHead = overlay.shimmerPhase * (characters.length + activityOverlayShimmerBandChars * 2) - activityOverlayShimmerBandChars;
  let cursorX = centerX - totalWidth / 2;

  for (let index = 0; index < characters.length; index += 1) {
    const charWidth = characterWidths[index] ?? 0;
    const intensity = Math.max(0, 1 - Math.abs(index - shimmerHead) / activityOverlayShimmerBandChars);
    if (intensity > 0 && charWidth > 0) {
      const alpha = 0.2 + 0.72 * intensity;
      context.fillStyle = `rgba(255, 255, 247, ${alpha.toFixed(3)})`;
      context.fillText(characters[index] ?? "", cursorX + charWidth / 2, baselineY);
    }

    cursorX += charWidth;
  }
}

export function drawWorkerNameplates(context: CanvasRenderingContext2D, nameplates: WorkerNameplate[]): void {
  if (!nameplates.length) {
    return;
  }

  context.save();
  context.textAlign = "center";
  context.font = "12px 'Trebuchet MS', sans-serif";

  for (const nameplate of nameplates) {
    if (!nameplate.visible) {
      continue;
    }

    const labelWidth = Math.max(90, context.measureText(nameplate.label).width + 18);
    const labelHeight = 18;

    context.fillStyle = "rgba(0, 0, 0, 0.56)";
    context.fillRect(nameplate.anchorX - labelWidth / 2, nameplate.topY, labelWidth, labelHeight);

    context.fillStyle = "#f8f7e5";
    context.fillText(nameplate.label, nameplate.anchorX, nameplate.topY + 13);
  }

  context.restore();
}

export function groupControlKeysByWorker(controlGroups: Partial<Record<number, string[]>> | undefined): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  if (!controlGroups) {
    return grouped;
  }

  for (const [digitText, workerIds] of Object.entries(controlGroups)) {
    if (!Array.isArray(workerIds) || workerIds.length === 0) {
      continue;
    }

    for (const workerId of workerIds) {
      if (!workerId) {
        continue;
      }

      const digits = grouped.get(workerId) ?? [];
      digits.push(digitText);
      grouped.set(workerId, digits);
    }
  }

  for (const digits of grouped.values()) {
    digits.sort((a, b) => Number(a) - Number(b));
  }

  return grouped;
}

export function getWorkerSummonProgress(createdAtIso: string, nowMs: number): number | undefined {
  const createdMs = Date.parse(createdAtIso);
  if (!Number.isFinite(createdMs)) {
    return undefined;
  }

  const elapsed = nowMs - createdMs;
  if (elapsed < 0 || elapsed > summonWorkerDurationMs) {
    return undefined;
  }

  return Math.max(0, Math.min(1, elapsed / summonWorkerDurationMs));
}

function fallbackAvatarColor(avatarType: string): string {
  const normalized = avatarType.trim().toLowerCase();
  if (!normalized) {
    return "#7a8c9a";
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }

  const hue = hash % 360;
  return `hsl(${hue} 35% 56%)`;
}

function selectedOutlineStyle(state: SelectedOutlineState): { stroke: string; lineWidth: number } {
  switch (state) {
    case "terminal-focused":
      return {
        stroke: "#8ce8ff",
        lineWidth: 2.4
      };
    case "group-focused":
      return {
        stroke: "#ffd27a",
        lineWidth: 2.2
      };
    case "group-focused-terminal":
      return {
        stroke: "#8ce8ff",
        lineWidth: 2.4
      };
    case "selected":
    default:
      return {
        stroke: "#f1f2d4",
        lineWidth: 2
      };
  }
}
