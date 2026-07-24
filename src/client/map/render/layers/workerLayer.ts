import type { Worker, WorkerPosition } from "../../../../shared/types";
import type { ActivityOverlayRenderState, WorkerMotion } from "../../workerVisualState";
import { getSpriteFrame, type CharacterSpriteSet } from "../../../sprites/spriteLoader";
import { clamp, worldToScreen, type ViewportState } from "../../viewportMath";
import { defaultZoomScale } from "../../mapRuntimeConstants";
import { spriteBoundsAtGround, type SpriteBounds } from "../../hitTesting";
import { drawDespawnEffect, drawSummonEffect } from "./effectsLayer";

const activityOverlayShimmerBandChars = 3.4;
const activityOverlayMaxBadgeWidth = 320;
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
  completionKey?: string;
  attentionKey?: string;
  silenced?: boolean;
}

/**
 * Per-frame shared state threaded through `drawWorker`. The z-order orchestrator
 * (renderScene) builds this once, then calls `drawWorker` for each worker in the
 * appropriate pass; `selectedOutlines` and `pendingNameplates` are output collectors
 * drained after all sprites are painted so nameplates and outlines sit on top.
 */
export interface WorkerSceneContext {
  context: CanvasRenderingContext2D;
  viewport: ViewportState;
  displayedPositions: Record<string, WorkerPosition>;
  workerMotion: Record<string, WorkerMotion>;
  spriteLibrary: Partial<Record<string, CharacterSpriteSet>>;
  controlGroupsByWorker: Map<string, string[]>;
  activityOverlayStateByWorker: Record<string, ActivityOverlayRenderState | undefined>;
  completionPendingWorkerIds: Set<string> | undefined;
  selectedWorkerIdSet: Set<string>;
  animationTick: number;
  walkAnimationTick: number;
  workerRadius: number;
  spriteBaseSize: number;
  nowMs: number;
  createdAtMsByWorker: Map<string, number>;
  selectedOutlines: SelectedWorkerOutline[];
  pendingNameplates: WorkerNameplate[];
}

export interface DrawWorkerOptions {
  /** Queue this worker's nameplate for the post-pass. Independent of `drawUi`. */
  queueNameplate?: boolean;
  /** Draw the activity badge and control-group indicator. */
  drawUi?: boolean;
  /** Multiplies sprite alpha for occluded ghosts; when set, the ground shadow and summon/despawn effects are skipped. */
  ghostAlpha?: number;
  /** 0→1 despawn progress. Present → fading mode: idle pose, despawn ring, alpha ramp, no summon. */
  fadeProgress?: number;
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

interface AttentionPlaquePalette {
  pulseCycleMs: number;
  baseTop: string;
  baseMid: string;
  baseBottom: string;
  borderLight: string;
  borderDark: string;
  pulseGlowRgb: string;
  textShadow: string;
  textFill: string;
}

const completionPlaquePalette: CompletionPlaquePalette = {
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
};

const attentionPlaquePalette: AttentionPlaquePalette = {
  pulseCycleMs: 1700,
  baseTop: "rgba(168, 92, 27, 0.96)",
  baseMid: "rgba(207, 122, 44, 0.95)",
  baseBottom: "rgba(139, 77, 21, 0.97)",
  borderLight: "rgba(241, 177, 98, 0.88)",
  borderDark: "rgba(97, 49, 11, 0.92)",
  pulseGlowRgb: "255, 212, 138",
  textShadow: "rgba(255, 228, 178, 0.54)",
  textFill: "#251003"
};

export type SelectedOutlineState = "selected" | "terminal-focused" | "group-focused" | "group-focused-terminal";

/**
 * The canonical worker painter. One function draws every worker in every pass —
 * normal, occluded ghost (`ghostAlpha`), and despawning (`fadeProgress`) — so there
 * is a single source of truth for sprite selection, summon/despawn effects, the
 * activity badge, control-group indicator, selection outline, and nameplate.
 */
export function drawWorker(scene: WorkerSceneContext, worker: Worker, options: DrawWorkerOptions = {}): void {
  const { context, viewport } = scene;
  const queueNameplate = options.queueNameplate ?? true;
  const drawUi = options.drawUi ?? true;
  const ghostAlpha = options.ghostAlpha;
  const isFading = options.fadeProgress !== undefined;
  const fadeAlpha = isFading ? clamp(1 - (options.fadeProgress ?? 0), 0, 1) : 1;
  const uiScale = Math.max(1, viewport.scale / defaultZoomScale);

  const worldPosition = scene.displayedPositions[worker.id] ?? worker.position;
  const screen = worldToScreen(worldPosition.x, worldPosition.y, viewport);
  const motion = scene.workerMotion[worker.id] ?? { moving: false, facing: "south" as const };
  const displayLabel = worker.displayName ?? worker.name;
  const controlKeys = scene.controlGroupsByWorker.get(worker.id) ?? [];
  // A despawning worker has left the active set, so it freezes to an idle pose and
  // never re-triggers its summon animation while it fades out.
  const summonProgress = isFading ? undefined : getWorkerSummonProgress(resolveCreatedAtMs(scene, worker), scene.nowMs);
  const renderScale = summonProgress === undefined ? viewport.scale : viewport.scale * (0.86 + summonProgress * 0.14);
  const renderAlpha = summonProgress === undefined ? 1 : 0.2 + summonProgress * 0.8;
  const radius = scene.workerRadius * renderScale;

  const spriteSet = scene.spriteLibrary[worker.avatarType];
  const spriteState = isFading ? "idle" : motion.moving ? "walking" : worker.status === "working" ? "working" : "idle";
  const spriteFrame = getSpriteFrame(spriteSet, {
    direction: motion.facing,
    state: spriteState,
    frameIndex: spriteState === "walking" ? scene.walkAnimationTick : scene.animationTick
  });

  if (ghostAlpha === undefined) {
    drawCharacterGroundShadow(context, screen.x, screen.y, renderScale);
    if (isFading) {
      drawDespawnEffect(context, screen.x, screen.y, viewport.scale, options.fadeProgress ?? 0, fadeAlpha);
    } else if (summonProgress !== undefined) {
      drawSummonEffect(context, screen.x, screen.y, viewport.scale, summonProgress);
    }
  }

  let spriteBounds: SpriteBounds | undefined;
  context.save();
  context.globalAlpha = renderAlpha * (ghostAlpha ?? 1) * fadeAlpha;
  if (spriteFrame) {
    spriteBounds = drawSpriteCharacter(context, spriteFrame, screen.x, screen.y, renderScale, scene.spriteBaseSize);
  } else {
    drawFallbackWorker(context, worker, screen.x, screen.y, radius, renderScale);
  }
  context.restore();

  if (scene.selectedWorkerIdSet.has(worker.id)) {
    scene.selectedOutlines.push({
      workerId: worker.id,
      screenX: screen.x,
      screenY: screen.y,
      radius,
      spriteBounds
    });
  }

  if (drawUi) {
    const activityOverlay = scene.activityOverlayStateByWorker[worker.id];
    if (activityOverlay?.text) {
      const badgeY = spriteBounds ? spriteBounds.y - 14 * viewport.scale : screen.y - radius - 22 * viewport.scale;
      drawActivityBadge(context, activityOverlay, screen.x, badgeY, uiScale);
    }

    if (controlKeys.length > 0) {
      const indicatorAnchorX = spriteBounds ? spriteBounds.x + spriteBounds.width / 2 : screen.x;
      let indicatorY = spriteBounds ? spriteBounds.y - 12 * viewport.scale : screen.y - radius - 18 * viewport.scale;
      if (activityOverlay?.text) {
        indicatorY -= 18 * viewport.scale;
      }

      drawControlGroupIndicator(context, indicatorAnchorX, indicatorY, controlKeys, viewport.scale);
    }
  }

  if (queueNameplate) {
    const completionPending = !worker.silenced && scene.completionPendingWorkerIds?.has(worker.id) && worker.status === "idle";
    const attentionPending = !worker.silenced && worker.status === "attention";
    scene.pendingNameplates.push({
      anchorX: spriteBounds ? spriteBounds.x + spriteBounds.width / 2 : screen.x,
      topY: (spriteBounds ? spriteBounds.y + spriteBounds.height : screen.y + radius) + 4 * viewport.scale,
      label: displayLabel,
      completionKey: completionPending ? worker.id : undefined,
      attentionKey: attentionPending ? worker.id : undefined,
      silenced: worker.silenced
    });
  }
}

function resolveCreatedAtMs(scene: WorkerSceneContext, worker: Worker): number {
  const cached = scene.createdAtMsByWorker.get(worker.id);
  if (cached !== undefined) {
    return cached;
  }

  const parsed = Date.parse(worker.createdAt);
  scene.createdAtMsByWorker.set(worker.id, parsed);
  return parsed;
}

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

/**
 * Draws the whole activity badge — box, label, and shimmer — as one unit. The font is
 * chosen once here and used for both the box-width measurement and the label render,
 * so there is no implicit shared-font contract with the caller.
 */
function drawActivityBadge(
  context: CanvasRenderingContext2D,
  overlay: ActivityOverlayRenderState,
  centerX: number,
  badgeTopY: number,
  scale: number
): void {
  context.font = `${Math.round(10 * scale)}px 'Trebuchet MS', sans-serif`;
  const badgeTextWidth = Math.ceil(context.measureText(overlay.text).width);
  const badgeWidth = Math.max(44 * scale, Math.min(activityOverlayMaxBadgeWidth * scale, badgeTextWidth + 16 * scale));
  const badgeHeight = 16 * scale;

  context.fillStyle = "rgba(14, 21, 18, 0.85)";
  context.fillRect(centerX - badgeWidth / 2, badgeTopY, badgeWidth, badgeHeight);
  context.strokeStyle = "rgba(237, 244, 210, 0.5)";
  context.lineWidth = scale;
  context.strokeRect(centerX - badgeWidth / 2, badgeTopY, badgeWidth, badgeHeight);

  drawActivityOverlayLabel(context, overlay, centerX, badgeTopY + 11 * scale);
}

function drawActivityOverlayLabel(
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
  nowMs: number,
  viewportScale: number
): void {
  if (!nameplates.length) {
    return;
  }

  const scale = Math.max(1, viewportScale / defaultZoomScale);
  context.save();
  context.textAlign = "center";
  context.font = `${Math.round(12 * scale)}px 'Trebuchet MS', sans-serif`;

  for (const nameplate of nameplates) {
    const labelWidth = Math.max(90 * scale, context.measureText(nameplate.label).width + 18 * scale);
    const labelHeight = 18 * scale;
    const left = nameplate.anchorX - labelWidth / 2;

    if (nameplate.silenced) {
      context.fillStyle = "rgba(19, 29, 30, 0.76)";
      context.fillRect(left, nameplate.topY, labelWidth, labelHeight);
      context.fillStyle = "rgba(129, 162, 157, 0.82)";
      context.fillRect(left, nameplate.topY, 3 * scale, labelHeight);
      context.fillRect(left + labelWidth - 3 * scale, nameplate.topY, 3 * scale, labelHeight);
      context.fillStyle = "#d4dfdc";
    } else if (nameplate.completionKey !== undefined) {
      const seed = hashString(nameplate.completionKey);
      drawCompletionNameplate(context, left, nameplate.topY, labelWidth, labelHeight, nowMs, seed);
      context.fillStyle = completionPlaquePalette.textShadow;
      context.fillText(nameplate.label, nameplate.anchorX, nameplate.topY + 14 * scale);
      context.fillStyle = completionPlaquePalette.textFill;
    } else if (nameplate.attentionKey !== undefined) {
      const seed = hashString(nameplate.attentionKey);
      drawAttentionNameplate(context, left, nameplate.topY, labelWidth, labelHeight, nowMs, seed);
      context.fillStyle = attentionPlaquePalette.textShadow;
      context.fillText(nameplate.label, nameplate.anchorX, nameplate.topY + 14 * scale);
      context.fillStyle = attentionPlaquePalette.textFill;
    } else {
      context.fillStyle = "rgba(0, 0, 0, 0.56)";
      context.fillRect(left, nameplate.topY, labelWidth, labelHeight);
      context.fillStyle = "#f8f7e5";
    }

    context.fillText(nameplate.label, nameplate.anchorX, nameplate.topY + 13 * scale);
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

function drawAttentionNameplate(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  nowMs: number,
  seed: number
): void {
  const palette = attentionPlaquePalette;
  const x = Math.round(left);
  const y = Math.round(top);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const baseGradient = context.createLinearGradient(0, y, 0, y + h);
  baseGradient.addColorStop(0, palette.baseTop);
  baseGradient.addColorStop(0.54, palette.baseMid);
  baseGradient.addColorStop(1, palette.baseBottom);
  context.fillStyle = baseGradient;
  context.fillRect(x, y, w, h);

  const pulsePhase = ((nowMs + seed * 41) % palette.pulseCycleMs) / palette.pulseCycleMs;
  const pulseAlpha = 0.16 + 0.22 * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI * 2));
  context.fillStyle = `rgba(${palette.pulseGlowRgb}, ${pulseAlpha.toFixed(3)})`;
  context.fillRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));

  context.fillStyle = palette.borderLight;
  context.fillRect(x, y, w, 1);
  context.fillRect(x, y, 1, h);

  context.fillStyle = palette.borderDark;
  context.fillRect(x, y + h - 1, w, 1);
  context.fillRect(x + w - 1, y, 1, h);
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

function getWorkerSummonProgress(createdAtMs: number, nowMs: number): number | undefined {
  if (!Number.isFinite(createdAtMs)) {
    return undefined;
  }

  const elapsed = nowMs - createdAtMs;
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
