import type { Worker, WorkerPosition } from "../../shared/types";
import type { LoadedOutpostMap } from "./tileMapLoader";
import type { CharacterSpriteSet } from "../sprites/spriteLoader";
import { getSpriteFrame } from "../sprites/spriteLoader";
import { drawSelectionBox, type SelectionBox } from "./selection";
import { spriteBoundsAtGround, type SpriteBounds } from "./hitTesting";
import { clamp, worldToScreen, type ViewportState } from "./viewportMath";
import type { ActivityOverlayRenderState, WorkerMotion } from "./workerVisualState";

const fadingWorkerDurationMs = 420;
const summonWorkerDurationMs = 520;
const occlusionOverlayAlpha = 0.98;
const occludedGhostAlpha = 0.44;
const activityOverlayMaxBadgeWidth = 320;
const activityOverlayShimmerBandChars = 3.4;
const flameRegionMaskCache = new Map<string, { canvas: HTMLCanvasElement; heatCoverage: number }>();
const flameMaskVersion = "v4";

interface SelectedWorkerOutline {
  workerId: string;
  screenX: number;
  screenY: number;
  radius: number;
  spriteBounds?: SpriteBounds;
}

interface WorkerNameplate {
  anchorX: number;
  topY: number;
  label: string;
  visible: boolean;
}

interface CollisionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CommandFeedback {
  kind: "ok" | "blocked";
  workerId: string;
  startedAtMs: number;
  durationMs: number;
  destination: WorkerPosition;
  path?: WorkerPosition[];
}

export interface DrawSceneInput {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  workers: Worker[];
  fadingWorkers?: Array<{ worker: Worker; startedAtMs: number }>;
  displayedPositions: Record<string, WorkerPosition>;
  workerMotion: Record<string, WorkerMotion>;
  selectedWorkerId: string | undefined;
  selectedWorkerIds: string[];
  focusedSelectedWorkerId: string | undefined;
  terminalFocusedSelected: boolean | undefined;
  terminalFocusedWorkerId: string | undefined;
  controlGroups?: Partial<Record<number, string[]>>;
  viewport: ViewportState;
  mapData: LoadedOutpostMap | undefined;
  spriteLibrary: Partial<Record<string, CharacterSpriteSet>>;
  animationTick: number;
  walkAnimationTick: number;
  commandFeedback: CommandFeedback | null;
  mapPreviewImage: HTMLImageElement | undefined;
  activityOverlayStateByWorker: Record<string, ActivityOverlayRenderState | undefined>;
  marqueeSelection: SelectionBox | null;
  workerRadius: number;
  spriteBaseSize: number;
}

export function drawScene({
  context,
  width,
  height,
  workers,
  fadingWorkers,
  displayedPositions,
  workerMotion,
  selectedWorkerId,
  selectedWorkerIds,
  focusedSelectedWorkerId,
  terminalFocusedSelected,
  terminalFocusedWorkerId,
  controlGroups,
  viewport,
  mapData,
  spriteLibrary,
  animationTick,
  walkAnimationTick,
  commandFeedback,
  mapPreviewImage,
  activityOverlayStateByWorker,
  marqueeSelection,
  workerRadius,
  spriteBaseSize
}: DrawSceneInput): void {
  context.clearRect(0, 0, width, height);
  const nowMs = Date.now();

  const controlGroupsByWorker = groupControlKeysByWorker(controlGroups);

  if (mapData && mapPreviewImage) {
    drawOutpostPreviewBackground(context, viewport, mapData, mapPreviewImage);
  }

  if (commandFeedback) {
    drawCommandFeedback(context, viewport, commandFeedback, nowMs);
  }

  context.textAlign = "center";
  context.imageSmoothingEnabled = false;
  const activeWorkerIds = new Set(workers.map((worker) => worker.id));
  const selectedWorkerIdSet = new Set(selectedWorkerIds);
  const selectedOutlines: SelectedWorkerOutline[] = [];
  const pendingNameplates: WorkerNameplate[] = [];
  const occludedWorkerIds = new Set<string>();

  if (mapData && mapData.occlusionRects.length > 0) {
    for (const worker of workers) {
      const worldPosition = displayedPositions[worker.id] ?? worker.position;
      if (isWorkerBehindAnyOcclusionRect(worldPosition, mapData)) {
        occludedWorkerIds.add(worker.id);
      }
    }
  }

  const drawWorker = (
    worker: Worker,
    options: {
      queueNameplate?: boolean;
      drawUi?: boolean;
      ghostAlpha?: number;
    } = {}
  ): void => {
    const queueNameplate = options.queueNameplate ?? true;
    const drawUi = options.drawUi ?? true;
    const ghostAlpha = options.ghostAlpha;

    const worldPosition = displayedPositions[worker.id] ?? worker.position;
    const screen = worldToScreen(worldPosition.x, worldPosition.y, viewport);
    const motion = workerMotion[worker.id] ?? { moving: false, facing: "south" as const };
    const displayLabel = worker.displayName ?? worker.name;
    const controlKeys = controlGroupsByWorker.get(worker.id) ?? [];
    const summonProgress = getWorkerSummonProgress(worker.createdAt, nowMs);
    const renderScale = summonProgress === undefined ? viewport.scale : viewport.scale * (0.86 + summonProgress * 0.14);
    const renderAlpha = summonProgress === undefined ? 1 : 0.2 + summonProgress * 0.8;
    const radius = workerRadius * renderScale;

    const spriteSet = spriteLibrary[worker.avatarType];
    const spriteState = motion.moving ? "walking" : worker.status === "working" ? "working" : "idle";
    const spriteFrame = getSpriteFrame(spriteSet, {
      direction: motion.facing,
      state: spriteState,
      frameIndex: spriteState === "walking" ? walkAnimationTick : animationTick
    });

    if (ghostAlpha === undefined) {
      drawCharacterGroundShadow(context, screen.x, screen.y, renderScale);
      if (summonProgress !== undefined) {
        drawSummonEffect(context, screen.x, screen.y, viewport.scale, summonProgress);
      }
    }

    let spriteBounds: SpriteBounds | undefined;
    context.save();
    context.globalAlpha = renderAlpha * (ghostAlpha ?? 1);
    if (spriteFrame) {
      spriteBounds = drawSpriteCharacter(context, spriteFrame, screen.x, screen.y, renderScale, spriteBaseSize);
    } else {
      drawFallbackWorker(context, worker, screen.x, screen.y, radius, renderScale);
    }
    context.restore();

    if (selectedWorkerIdSet.has(worker.id)) {
      selectedOutlines.push({
        workerId: worker.id,
        screenX: screen.x,
        screenY: screen.y,
        radius,
        spriteBounds
      });
    }

    if (!drawUi) {
      return;
    }

    const activityOverlay = activityOverlayStateByWorker[worker.id];
    if (activityOverlay?.text) {
      context.font = "10px 'Trebuchet MS', sans-serif";
      const badgeTextWidth = Math.ceil(context.measureText(activityOverlay.text).width);
      const badgeWidth = Math.max(44, Math.min(activityOverlayMaxBadgeWidth, badgeTextWidth + 16));
      const badgeHeight = 16;
      const badgeY = spriteBounds ? spriteBounds.y - 14 * viewport.scale : screen.y - radius - 22 * viewport.scale;

      context.fillStyle = "rgba(14, 21, 18, 0.85)";
      context.fillRect(screen.x - badgeWidth / 2, badgeY, badgeWidth, badgeHeight);
      context.strokeStyle = "rgba(237, 244, 210, 0.5)";
      context.lineWidth = 1;
      context.strokeRect(screen.x - badgeWidth / 2, badgeY, badgeWidth, badgeHeight);

      drawActivityOverlayLabel(context, activityOverlay, screen.x, badgeY + 11);
    }

    if (worker.status === "attention") {
      const bubbleX = spriteBounds ? spriteBounds.x + spriteBounds.width + 7 * viewport.scale : screen.x + radius + 9 * viewport.scale;
      const bubbleY = spriteBounds ? spriteBounds.y + 10 * viewport.scale : screen.y - radius - 8 * viewport.scale;

      context.fillStyle = "rgba(245, 185, 78, 0.95)";
      context.beginPath();
      context.arc(bubbleX, bubbleY, 8 * viewport.scale, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#35220d";
      context.font = "11px 'Trebuchet MS', sans-serif";
      context.fillText("!", bubbleX, bubbleY + 4 * viewport.scale);
    }

    if (controlKeys.length > 0) {
      const indicatorAnchorX = spriteBounds ? spriteBounds.x + spriteBounds.width / 2 : screen.x;
      let indicatorY = spriteBounds ? spriteBounds.y - 12 * viewport.scale : screen.y - radius - 18 * viewport.scale;
      if (activityOverlay?.text) {
        indicatorY -= 18 * viewport.scale;
      }

      drawControlGroupIndicator(context, indicatorAnchorX, indicatorY, controlKeys, viewport.scale);
    }

    if (queueNameplate) {
      pendingNameplates.push({
        anchorX: spriteBounds ? spriteBounds.x + spriteBounds.width / 2 : screen.x,
        topY: (spriteBounds ? spriteBounds.y + spriteBounds.height : screen.y + radius) + 4 * viewport.scale,
        label: displayLabel,
        visible: !occludedWorkerIds.has(worker.id)
      });
    }
  };

  if (mapData && mapPreviewImage && mapData.occlusionRects.length > 0) {
    for (const worker of workers) {
      if (occludedWorkerIds.has(worker.id)) {
        drawWorker(worker, {
          queueNameplate: false
        });
      }
    }

    drawOutpostOcclusionOverlay(context, viewport, width, height, mapData, mapPreviewImage);
    drawAmbientFlameEffects(context, viewport, width, height, mapData, mapPreviewImage, nowMs);

    for (const worker of workers) {
      if (!occludedWorkerIds.has(worker.id)) {
        drawWorker(worker, {
          queueNameplate: true
        });
      }
    }

    for (const worker of workers) {
      if (!occludedWorkerIds.has(worker.id)) {
        continue;
      }

      drawWorker(worker, {
        queueNameplate: false,
        drawUi: false,
        ghostAlpha: occludedGhostAlpha
      });
    }
  } else {
    if (mapData && mapPreviewImage) {
      drawAmbientFlameEffects(context, viewport, width, height, mapData, mapPreviewImage, nowMs);
    }

    for (const worker of workers) {
      drawWorker(worker, {
        queueNameplate: true
      });
    }
  }

  if (fadingWorkers && fadingWorkers.length > 0) {
    const now = Date.now();
    for (const fading of fadingWorkers) {
      if (activeWorkerIds.has(fading.worker.id)) {
        continue;
      }

      const elapsed = now - fading.startedAtMs;
      const alpha = clamp(1 - elapsed / fadingWorkerDurationMs, 0, 1);
      if (alpha <= 0) {
        continue;
      }
      const fadeProgress = clamp(elapsed / fadingWorkerDurationMs, 0, 1);

      const worldPosition = displayedPositions[fading.worker.id] ?? fading.worker.position;
      const screen = worldToScreen(worldPosition.x, worldPosition.y, viewport);
      const radius = workerRadius * viewport.scale;
      const spriteSet = spriteLibrary[fading.worker.avatarType];
      const spriteFrame = getSpriteFrame(spriteSet, {
        direction: "south",
        state: "idle",
        frameIndex: animationTick
      });

      context.save();
      context.globalAlpha = alpha;
      drawCharacterGroundShadow(context, screen.x, screen.y, viewport.scale);
      drawDespawnEffect(context, screen.x, screen.y, viewport.scale, fadeProgress, alpha);
      if (spriteFrame) {
        drawSpriteCharacter(context, spriteFrame, screen.x, screen.y, viewport.scale, spriteBaseSize);
      } else {
        drawFallbackWorker(context, fading.worker, screen.x, screen.y, radius, viewport.scale);
      }
      context.restore();
    }
  }

  drawWorkerNameplates(context, pendingNameplates);

  const isGroupSelection = selectedWorkerIds.length > 1;
  for (const selectedOutline of selectedOutlines) {
    const isGroupFocused =
      isGroupSelection && Boolean(focusedSelectedWorkerId && selectedOutline.workerId === focusedSelectedWorkerId);
    const isTerminalFocused =
      Boolean(terminalFocusedWorkerId && selectedOutline.workerId === terminalFocusedWorkerId) ||
      Boolean(terminalFocusedSelected && selectedWorkerId === selectedOutline.workerId);
    const outlineState: SelectedOutlineState = isGroupFocused
      ? isTerminalFocused
        ? "group-focused-terminal"
        : "group-focused"
      : isTerminalFocused
      ? "terminal-focused"
      : "selected";

    drawSelectedWorkerOutline(context, selectedOutline, viewport.scale, outlineState);
  }

  if (marqueeSelection) {
    drawSelectionBox(context, marqueeSelection);
  }
}

function drawSpriteCharacter(
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

function drawFallbackWorker(
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

function drawCharacterGroundShadow(context: CanvasRenderingContext2D, centerX: number, groundY: number, scale: number): void {
  context.fillStyle = "rgba(7, 12, 10, 0.28)";
  context.beginPath();
  context.ellipse(centerX, groundY + 2 * scale, 8 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
  context.fill();
}

function drawSelectedWorkerOutline(
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

type SelectedOutlineState = "selected" | "terminal-focused" | "group-focused" | "group-focused-terminal";

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

function drawControlGroupIndicator(
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

function drawWorkerNameplates(context: CanvasRenderingContext2D, nameplates: WorkerNameplate[]): void {
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

function isWorkerBehindAnyOcclusionRect(position: WorkerPosition, mapData: LoadedOutpostMap): boolean {
  const footX = position.x;
  const footY = position.y;
  const horizontalPadding = mapData.tileSize * 0.2;
  const baselineBias = mapData.tileSize * 0.08;
  const workerBounds: CollisionRect = {
    left: footX - mapData.tileSize * 0.48,
    top: footY - mapData.tileSize * 1.46,
    right: footX + mapData.tileSize * 0.48,
    bottom: footY + mapData.tileSize * 0.24
  };

  for (const rect of mapData.occlusionRects) {
    const occlusionRect: CollisionRect = {
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height
    };

    if (rect.mode === "hard") {
      if (intersectsRect(workerBounds, occlusionRect)) {
        return true;
      }
      continue;
    }

    const rectLeft = rect.x - horizontalPadding;
    const rectRight = rect.x + rect.width + horizontalPadding;
    if (footX < rectLeft || footX > rectRight) {
      continue;
    }

    const baselineY = rect.y + rect.height;
    if (footY > baselineY - baselineBias) {
      continue;
    }

    if (!intersectsRect(workerBounds, occlusionRect)) {
      continue;
    }

    return true;
  }

  return false;
}

function groupControlKeysByWorker(controlGroups: Partial<Record<number, string[]>> | undefined): Map<string, string[]> {
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

function drawCommandFeedback(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  feedback: CommandFeedback,
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

function drawSummonEffect(
  context: CanvasRenderingContext2D,
  centerX: number,
  groundY: number,
  scale: number,
  progress: number
): void {
  const alpha = (1 - progress) * 0.85;
  if (alpha <= 0.01) {
    return;
  }

  const ringRadius = (8 + (1 - progress) * 10) * scale;
  const ringY = groundY + 1.5 * scale;

  context.save();
  context.strokeStyle = `rgba(172, 242, 216, ${alpha})`;
  context.lineWidth = Math.max(1.2, 2 * scale);
  context.beginPath();
  context.arc(centerX, ringY, ringRadius, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = `rgba(207, 255, 235, ${alpha * 0.75})`;
  context.lineWidth = Math.max(0.8, 1.2 * scale);
  for (let i = 0; i < 4; i += 1) {
    const angle = progress * Math.PI * 2 + (Math.PI / 2) * i;
    const dx = Math.cos(angle) * ringRadius * 0.65;
    const dy = Math.sin(angle) * ringRadius * 0.35;
    context.beginPath();
    context.arc(centerX + dx, ringY + dy, 2.2 * scale, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function drawDespawnEffect(
  context: CanvasRenderingContext2D,
  centerX: number,
  groundY: number,
  scale: number,
  progress: number,
  alpha: number
): void {
  const ringRadius = (9 + progress * 12) * scale;
  const ringY = groundY + 1.5 * scale;
  const ringAlpha = alpha * 0.55;
  if (ringAlpha <= 0.01) {
    return;
  }

  context.save();
  context.strokeStyle = `rgba(139, 194, 255, ${ringAlpha})`;
  context.lineWidth = Math.max(1, 1.8 * scale);
  context.beginPath();
  context.arc(centerX, ringY, ringRadius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawAmbientFlameEffects(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap,
  backgroundImage: HTMLImageElement,
  nowMs: number
): void {
  if (mapData.ambientFlameRects.length === 0) {
    return;
  }

  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  const sourceScaleX = backgroundImage.naturalWidth / worldWidth;
  const sourceScaleY = backgroundImage.naturalHeight / worldHeight;
  const timeSeconds = nowMs / 1000;

  type FlameCluster = {
    id: number;
    phase: number;
    centerX: number;
    centerY: number;
    radius: number;
    boundsX: number;
    boundsY: number;
    boundsWidth: number;
    boundsHeight: number;
    cells: LoadedOutpostMap["ambientFlameRects"];
  };

  const clusters = new Map<number, FlameCluster>();
  for (const rect of mapData.ambientFlameRects) {
    let cluster = clusters.get(rect.clusterId);
    if (!cluster) {
      cluster = {
        id: rect.clusterId,
        phase: rect.clusterId * 1.37,
        centerX: rect.clusterCenterX,
        centerY: rect.clusterCenterY,
        radius: rect.clusterRadius,
        boundsX: rect.clusterBoundsX,
        boundsY: rect.clusterBoundsY,
        boundsWidth: rect.clusterBoundsWidth,
        boundsHeight: rect.clusterBoundsHeight,
        cells: []
      };
      clusters.set(rect.clusterId, cluster);
    }
    cluster.cells.push(rect);
  }

  for (const cluster of clusters.values()) {
    const phase = cluster.phase;
    const boundsScreen = worldToScreen(cluster.boundsX, cluster.boundsY, viewport);
    const drawWidth = cluster.boundsWidth * viewport.scale;
    const drawHeight = cluster.boundsHeight * viewport.scale;
    const cullPadding = Math.max(6, Math.max(drawWidth, drawHeight) * 0.35);

    if (
      boundsScreen.x + drawWidth < -cullPadding ||
      boundsScreen.y + drawHeight < -cullPadding ||
      boundsScreen.x > width + cullPadding ||
      boundsScreen.y > height + cullPadding
    ) {
      continue;
    }

    const flicker =
      0.26 +
      Math.sin(timeSeconds * 8.1 + phase) * 0.06 +
      Math.sin(timeSeconds * 13.7 + phase * 1.9) * 0.045;
    const lateralDrift = Math.sin(timeSeconds * 4.6 + phase * 1.3) * drawWidth * 0.003;
    const jitterY = Math.cos(timeSeconds * 3.4 + phase * 0.8) * drawHeight * 0.008;
    const widthScale = 0.996 + Math.sin(timeSeconds * 6.7 + phase * 0.9) * 0.015;
    const heightScale = 0.992 + Math.sin(timeSeconds * 5.9 + phase * 1.1) * 0.02;
    const scaledWidth = drawWidth * widthScale;
    const scaledHeight = drawHeight * heightScale;
    const drawX = boundsScreen.x + lateralDrift - (scaledWidth - drawWidth) * 0.5;
    const drawY = boundsScreen.y + jitterY - (scaledHeight - drawHeight);
    const sourceX = cluster.boundsX * sourceScaleX;
    const sourceY = cluster.boundsY * sourceScaleY;
    const sourceWidth = Math.max(1, cluster.boundsWidth * sourceScaleX);
    const sourceHeight = Math.max(1, cluster.boundsHeight * sourceScaleY);
    const flameMask = getOrCreateFlameRegionMask(backgroundImage, sourceX, sourceY, sourceWidth, sourceHeight, cluster.id);
    if (flameMask.heatCoverage <= 0.004) {
      continue;
    }

    context.save();
    context.imageSmoothingEnabled = true;
    context.globalCompositeOperation = "screen";
    context.globalAlpha = clamp(flicker, 0.12, 0.42);
    const feather = Math.max(0.45, viewport.scale * 0.18);
    context.drawImage(flameMask.canvas, drawX, drawY, scaledWidth, scaledHeight);
    context.globalAlpha *= 0.24;
    context.drawImage(flameMask.canvas, drawX - feather, drawY, scaledWidth, scaledHeight);
    context.drawImage(flameMask.canvas, drawX + feather, drawY, scaledWidth, scaledHeight);
    context.drawImage(flameMask.canvas, drawX, drawY - feather, scaledWidth, scaledHeight);
    context.drawImage(flameMask.canvas, drawX, drawY + feather, scaledWidth, scaledHeight);

    context.globalCompositeOperation = "lighter";
    context.globalAlpha = clamp(flicker * 0.2, 0.05, 0.16);
    context.drawImage(flameMask.canvas, drawX, drawY, scaledWidth, scaledHeight);
    context.restore();
  }

  for (const cluster of clusters.values()) {
    const phase = cluster.phase;
    const pulse = 0.88 + Math.sin(timeSeconds * 3.4 + phase * 0.7) * 0.12;
    const clusterScreenX = (cluster.centerX + viewport.offsetX) * viewport.scale;
    const clusterScreenY = (cluster.centerY + viewport.offsetY) * viewport.scale;
    const glowRadius = Math.max(6, cluster.radius * viewport.scale * (0.7 + pulse * 0.25));

    if (
      clusterScreenX < -glowRadius ||
      clusterScreenY < -glowRadius ||
      clusterScreenX > width + glowRadius ||
      clusterScreenY > height + glowRadius
    ) {
      continue;
    }

    context.save();
    context.globalCompositeOperation = "lighter";
    const glow = context.createRadialGradient(clusterScreenX, clusterScreenY, 0, clusterScreenX, clusterScreenY, glowRadius);
    glow.addColorStop(0, "rgba(255, 214, 132, 0.22)");
    glow.addColorStop(0.35, "rgba(255, 168, 80, 0.14)");
    glow.addColorStop(0.7, "rgba(255, 128, 48, 0.06)");
    glow.addColorStop(1, "rgba(255, 98, 28, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(clusterScreenX, clusterScreenY, glowRadius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function getWorkerSummonProgress(createdAtIso: string, nowMs: number): number | undefined {
  const createdMs = Date.parse(createdAtIso);
  if (!Number.isFinite(createdMs)) {
    return undefined;
  }

  const elapsed = nowMs - createdMs;
  if (elapsed < 0 || elapsed > summonWorkerDurationMs) {
    return undefined;
  }

  return clamp(elapsed / summonWorkerDurationMs, 0, 1);
}

function drawOutpostPreviewBackground(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  mapData: LoadedOutpostMap,
  image: HTMLImageElement
): void {
  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  const topLeft = worldToScreen(0, 0, viewport);

  context.save();
  context.imageSmoothingEnabled = true;
  context.drawImage(image, topLeft.x, topLeft.y, worldWidth * viewport.scale, worldHeight * viewport.scale);
  context.restore();
}

function drawOutpostOcclusionOverlay(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap,
  image: HTMLImageElement
): void {
  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  const sourceScaleX = image.naturalWidth / worldWidth;
  const sourceScaleY = image.naturalHeight / worldHeight;

  context.save();
  context.imageSmoothingEnabled = true;

  for (const rect of mapData.occlusionRects) {
    const screen = worldToScreen(rect.x, rect.y, viewport);
    const drawWidth = rect.width * viewport.scale;
    const drawHeight = rect.height * viewport.scale;

    if (screen.x > width || screen.y > height || screen.x + drawWidth < 0 || screen.y + drawHeight < 0) {
      continue;
    }

    context.globalAlpha = occlusionOverlayAlpha;

    context.drawImage(
      image,
      rect.x * sourceScaleX,
      rect.y * sourceScaleY,
      rect.width * sourceScaleX,
      rect.height * sourceScaleY,
      screen.x,
      screen.y,
      drawWidth,
      drawHeight
    );
  }

  context.restore();
}

function intersectsRect(a: CollisionRect, b: CollisionRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function getOrCreateFlameRegionMask(
  backgroundImage: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  clusterId: number
): { canvas: HTMLCanvasElement; heatCoverage: number } {
  const normalizedX = Math.floor(sourceX);
  const normalizedY = Math.floor(sourceY);
  const normalizedWidth = Math.max(1, Math.ceil(sourceWidth));
  const normalizedHeight = Math.max(1, Math.ceil(sourceHeight));
  const cacheKey = [
    flameMaskVersion,
    backgroundImage.currentSrc || backgroundImage.src,
    clusterId,
    normalizedX,
    normalizedY,
    normalizedWidth,
    normalizedHeight
  ].join(":");

  const cached = flameRegionMaskCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = normalizedWidth;
  canvas.height = normalizedHeight;
  const canvasContext = canvas.getContext("2d", { willReadFrequently: true });
  if (!canvasContext) {
    const fallback = { canvas, heatCoverage: 0 };
    flameRegionMaskCache.set(cacheKey, fallback);
    return fallback;
  }

  canvasContext.clearRect(0, 0, normalizedWidth, normalizedHeight);
  canvasContext.drawImage(
    backgroundImage,
    normalizedX,
    normalizedY,
    normalizedWidth,
    normalizedHeight,
    0,
    0,
    normalizedWidth,
    normalizedHeight
  );

  try {
    const sourceImage = canvasContext.getImageData(0, 0, normalizedWidth, normalizedHeight);
    const sourcePixels = sourceImage.data;
    const pixelCount = normalizedWidth * normalizedHeight;
    const heatValues = new Float32Array(pixelCount);

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const pixelOffset = pixelIndex * 4;
      const red = sourcePixels[pixelOffset] / 255;
      const green = sourcePixels[pixelOffset + 1] / 255;
      const blue = sourcePixels[pixelOffset + 2] / 255;
      const alpha = sourcePixels[pixelOffset + 3] / 255;

      const value = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const delta = value - minChannel;
      const saturation = value <= 0 ? 0 : delta / value;
      let hue = 0;
      if (delta > 0.0001) {
        if (value === red) {
          hue = ((green - blue) / delta) % 6;
        } else if (value === green) {
          hue = (blue - red) / delta + 2;
        } else {
          hue = (red - green) / delta + 4;
        }
        hue *= 60;
        if (hue < 0) {
          hue += 360;
        }
      }

      const inFlameHue = hue >= 20 && hue <= 54;
      const warmBalance = red > green * 0.94 && green > blue * 1.16;
      const satGate = saturation > 0.34;
      const brightGate = value > 0.5;
      const potentialCore = hue >= 34 && hue <= 66 && value > 0.8 && saturation > 0.24 && blue < 0.56;

      let heat = 0;
      if ((inFlameHue && warmBalance && satGate && brightGate) || potentialCore) {
        const hueWeight = inFlameHue ? 1 : 0.45;
        const satWeight = clamp((saturation - 0.3) / 0.52, 0, 1);
        const valueWeight = clamp((value - 0.48) / 0.44, 0, 1);
        const orangeBias = clamp((red - blue) / 0.5, 0, 1);
        const yellowBias = clamp((green - blue) / 0.44, 0, 1);
        heat = hueWeight * (satWeight * 0.42 + valueWeight * 0.24 + orangeBias * 0.2 + yellowBias * 0.14);
      }

      if (saturation < 0.24 || value < 0.38) {
        heat *= 0;
      }

      heatValues[pixelIndex] = clamp(heat * alpha, 0, 1);
    }

    let peakHeat = 0;
    for (let index = 0; index < heatValues.length; index += 1) {
      peakHeat = Math.max(peakHeat, heatValues[index]);
    }
    const adaptiveThreshold = clamp(Math.max(0.52, peakHeat * 0.72), 0.52, 0.82);

    const smoothedValues = new Float32Array(pixelCount);
    for (let y = 0; y < normalizedHeight; y += 1) {
      for (let x = 0; x < normalizedWidth; x += 1) {
        const index = y * normalizedWidth + x;
        const north = y > 0 ? heatValues[index - normalizedWidth] : heatValues[index];
        const south = y < normalizedHeight - 1 ? heatValues[index + normalizedWidth] : heatValues[index];
        const west = x > 0 ? heatValues[index - 1] : heatValues[index];
        const east = x < normalizedWidth - 1 ? heatValues[index + 1] : heatValues[index];
        smoothedValues[index] = clamp((heatValues[index] * 6 + north + south + west + east) / 10, 0, 1);
      }
    }

    const seedThreshold = clamp(Math.max(adaptiveThreshold + 0.16, peakHeat * 0.82), 0.62, 0.94);
    const growThreshold = clamp(adaptiveThreshold * 0.9, 0.45, 0.74);
    const connectedMask = new Uint8Array(pixelCount);
    const queue: number[] = [];

    for (let index = 0; index < pixelCount; index += 1) {
      if (smoothedValues[index] >= seedThreshold) {
        connectedMask[index] = 1;
        queue.push(index);
      }
    }

    while (queue.length > 0) {
      const index = queue.pop()!;
      const x = index % normalizedWidth;
      const y = Math.floor(index / normalizedWidth);

      const visit = (nextIndex: number): void => {
        if (connectedMask[nextIndex] === 1) {
          return;
        }
        if (smoothedValues[nextIndex] < growThreshold) {
          return;
        }
        connectedMask[nextIndex] = 1;
        queue.push(nextIndex);
      };

      if (x > 0) visit(index - 1);
      if (x < normalizedWidth - 1) visit(index + 1);
      if (y > 0) visit(index - normalizedWidth);
      if (y < normalizedHeight - 1) visit(index + normalizedWidth);
    }

    const outputImage = canvasContext.createImageData(normalizedWidth, normalizedHeight);
    const outputPixels = outputImage.data;
    let hotPixelCount = 0;

    for (let index = 0; index < pixelCount; index += 1) {
      const connectedHeat = connectedMask[index] === 1 ? smoothedValues[index] : 0;
      const thresholdedHeat =
        connectedHeat > adaptiveThreshold
          ? clamp((connectedHeat - adaptiveThreshold) / (1 - adaptiveThreshold), 0, 1)
          : 0;
      const outputOffset = index * 4;

      outputPixels[outputOffset] = 255;
      outputPixels[outputOffset + 1] = Math.round(168 + thresholdedHeat * 82);
      outputPixels[outputOffset + 2] = Math.round(68 + thresholdedHeat * 60);
      outputPixels[outputOffset + 3] = Math.round(clamp(thresholdedHeat * thresholdedHeat * 255 * 1.45, 0, 255));

      if (thresholdedHeat > 0.08) {
        hotPixelCount += 1;
      }
    }

    canvasContext.clearRect(0, 0, normalizedWidth, normalizedHeight);
    canvasContext.putImageData(outputImage, 0, 0);
    const result = {
      canvas,
      heatCoverage: hotPixelCount / Math.max(1, pixelCount)
    };
    flameRegionMaskCache.set(cacheKey, result);
    return result;
  } catch {
    const fallback = { canvas, heatCoverage: 0 };
    flameRegionMaskCache.set(cacheKey, fallback);
    return fallback;
  }
}
