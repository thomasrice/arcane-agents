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
  completionKey?: string;
}

const completionShimmerBandWidth = 16;

interface CompletionPlaquePalette {
  shimmerCycleMs: number;
  baseTop: string;
  baseHighlight: string;
  baseMid: string;
  baseBottom: string;
  specular: string;
  innerTopShade: string;
  innerBottomShade: string;
  bevelLight: string;
  bevelDark: string;
  shimmerOuter: string;
  shimmerInner: string;
  textShadow: string;
  textFill: string;
}

const completionPlaquePalettes = {
  vivid: {
    shimmerCycleMs: 1850,
    baseTop: "rgba(139, 105, 20, 0.98)",
    baseHighlight: "rgba(245, 212, 66, 0.98)",
    baseMid: "rgba(212, 160, 23, 0.98)",
    baseBottom: "rgba(156, 122, 16, 0.98)",
    specular: "rgba(255, 242, 178, 0.72)",
    innerTopShade: "rgba(122, 91, 17, 0.28)",
    innerBottomShade: "rgba(122, 91, 17, 0.28)",
    bevelLight: "rgba(232, 200, 64, 0.92)",
    bevelDark: "rgba(107, 79, 10, 0.92)",
    shimmerOuter: "rgba(255, 248, 219, 0)",
    shimmerInner: "rgba(255, 249, 232, 0.72)",
    textShadow: "rgba(255, 236, 168, 0.62)",
    textFill: "#1a1000"
  },
  muted: {
    shimmerCycleMs: 2600,
    baseTop: "rgba(111, 84, 22, 0.95)",
    baseHighlight: "rgba(208, 172, 74, 0.93)",
    baseMid: "rgba(171, 130, 42, 0.93)",
    baseBottom: "rgba(124, 94, 27, 0.95)",
    specular: "rgba(245, 227, 173, 0.36)",
    innerTopShade: "rgba(102, 76, 20, 0.2)",
    innerBottomShade: "rgba(84, 61, 16, 0.34)",
    bevelLight: "rgba(216, 184, 93, 0.7)",
    bevelDark: "rgba(94, 68, 16, 0.76)",
    shimmerOuter: "rgba(255, 247, 217, 0)",
    shimmerInner: "rgba(255, 246, 215, 0.34)",
    textShadow: "rgba(230, 208, 145, 0.38)",
    textFill: "#251806"
  }
} satisfies Record<string, CompletionPlaquePalette>;

const completionPlaquePalette = completionPlaquePalettes.muted;

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

export function drawWorkerNameplates(
  context: CanvasRenderingContext2D,
  nameplates: WorkerNameplate[],
  nowMs: number
): void {
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
    const left = nameplate.anchorX - labelWidth / 2;

    if (nameplate.completionKey !== undefined) {
      const seed = hashString(nameplate.completionKey);
      drawCompletionNameplate(context, left, nameplate.topY, labelWidth, labelHeight, nowMs, seed);
      context.fillStyle = completionPlaquePalette.textShadow;
      context.fillText(nameplate.label, nameplate.anchorX, nameplate.topY + 14);
      context.fillStyle = completionPlaquePalette.textFill;
    } else {
      context.fillStyle = "rgba(0, 0, 0, 0.56)";
      context.fillRect(left, nameplate.topY, labelWidth, labelHeight);
      context.fillStyle = "#f8f7e5";
    }

    context.fillText(nameplate.label, nameplate.anchorX, nameplate.topY + 13);
  }

  context.restore();
}

function drawCompletionNameplate(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  nowMs: number,
  seed: number
): void {
  const palette = completionPlaquePalette;
  const x = Math.round(left);
  const y = Math.round(top);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const baseGradient = context.createLinearGradient(0, y, 0, y + h);
  baseGradient.addColorStop(0, palette.baseTop);
  baseGradient.addColorStop(0.26, palette.baseHighlight);
  baseGradient.addColorStop(0.58, palette.baseMid);
  baseGradient.addColorStop(1, palette.baseBottom);
  context.fillStyle = baseGradient;
  context.fillRect(x, y, w, h);

  const specularTop = y + Math.max(2, Math.floor(h * 0.24));
  const specularHeight = Math.max(1, Math.floor(h * 0.16));
  context.fillStyle = palette.specular;
  context.fillRect(x + 2, specularTop, Math.max(0, w - 4), specularHeight);

  context.fillStyle = palette.innerTopShade;
  context.fillRect(x + 1, y + 1, Math.max(0, w - 2), 1);
  context.fillStyle = palette.innerBottomShade;
  context.fillRect(x + 1, y + h - 2, Math.max(0, w - 2), 1);

  context.fillStyle = palette.bevelLight;
  context.fillRect(x, y, w, 1);
  context.fillRect(x, y, 1, h);

  context.fillStyle = palette.bevelDark;
  context.fillRect(x, y + h - 1, w, 1);
  context.fillRect(x + w - 1, y, 1, h);

  const phase = ((nowMs + seed * 37) % palette.shimmerCycleMs) / palette.shimmerCycleMs;
  const shimmerCenter = x - completionShimmerBandWidth + phase * (w + completionShimmerBandWidth * 2);
  const shimmerGradient = context.createLinearGradient(
    shimmerCenter - completionShimmerBandWidth,
    0,
    shimmerCenter + completionShimmerBandWidth,
    0
  );
  shimmerGradient.addColorStop(0, palette.shimmerOuter);
  shimmerGradient.addColorStop(0.45, palette.shimmerInner);
  shimmerGradient.addColorStop(0.55, palette.shimmerInner);
  shimmerGradient.addColorStop(1, palette.shimmerOuter);
  context.fillStyle = shimmerGradient;
  context.fillRect(x, y, w, h);
}

function hashString(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
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

  const hue = hashString(normalized) % 360;
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
