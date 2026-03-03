import type { Worker, WorkerPosition } from "../../shared/types";
import type { LoadedOutpostMap } from "./tileMapLoader";
import type { CharacterSpriteSet } from "../sprites/spriteLoader";
import { getSpriteFrame } from "../sprites/spriteLoader";
import { drawSelectionBox, type SelectionBox } from "./selection";
import type { SpriteBounds } from "./hitTesting";
import { clamp, worldToScreen, type ViewportState } from "./viewportMath";
import type { ActivityOverlayRenderState, WorkerMotion } from "./workerVisualState";
import { drawCommandFeedbackLayer } from "./render/layers/commandFeedbackLayer";
import {
  drawActivityOverlayLabel,
  drawCharacterGroundShadow,
  drawControlGroupIndicator,
  drawFallbackWorker,
  drawSelectedWorkerOutline,
  drawSpriteCharacter,
  drawWorkerNameplates,
  getWorkerSummonProgress,
  groupControlKeysByWorker,
  type SelectedOutlineState,
  type SelectedWorkerOutline,
  type WorkerNameplate
} from "./render/layers/workerLayer";
import {
  drawAmbientFlameEffectsLayer,
  drawOutpostOcclusionOverlayLayer,
  drawOutpostPreviewBackgroundLayer
} from "./render/layers/mapLayers";
import { isWorkerBehindAnyOcclusionRect } from "./render/layers/occlusion";

const fadingWorkerDurationMs = 420;
const summonWorkerDurationMs = 520;
const occludedGhostAlpha = 0.44;
const activityOverlayMaxBadgeWidth = 320;

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
  activeWorkerIds?: Set<string>;
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
  spriteBaseSize,
  activeWorkerIds: precomputedActiveIds
}: DrawSceneInput): void {
  context.clearRect(0, 0, width, height);
  const nowMs = Date.now();

  const controlGroupsByWorker = groupControlKeysByWorker(controlGroups);

  if (mapData && mapPreviewImage) {
    drawOutpostPreviewBackgroundLayer(context, viewport, mapData, mapPreviewImage);
  }

  if (commandFeedback) {
    drawCommandFeedbackLayer(context, viewport, commandFeedback, nowMs);
  }

  context.textAlign = "center";
  context.imageSmoothingEnabled = false;
  const activeWorkerIds = precomputedActiveIds ?? new Set(workers.map((worker) => worker.id));
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

    drawOutpostOcclusionOverlayLayer(context, viewport, width, height, mapData, mapPreviewImage);
    drawAmbientFlameEffectsLayer(context, viewport, width, height, mapData, mapPreviewImage, nowMs);

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
      drawAmbientFlameEffectsLayer(context, viewport, width, height, mapData, mapPreviewImage, nowMs);
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
