import type { Worker, WorkerPosition } from "../../shared/types";
import type { LoadedOutpostMap } from "./tileMapLoader";
import type { CharacterSpriteSet } from "../sprites/spriteLoader";
import type { SelectionBox } from "./selection";
import { clamp, type ViewportState } from "./viewportMath";
import type { ActivityOverlayRenderState, WorkerMotion } from "./workerVisualState";
import { drawCommandFeedbackLayer, type CommandFeedback } from "./render/layers/commandFeedbackLayer";
import {
  drawSelectedWorkerOutline,
  drawWorker,
  drawWorkerNameplates,
  groupControlKeysByWorker,
  type SelectedOutlineState,
  type WorkerSceneContext
} from "./render/layers/workerLayer";
import {
  drawAmbientFlameEffectsLayer,
  drawOutpostOcclusionOverlayLayer,
  drawOutpostPreviewBackgroundLayer
} from "./render/layers/mapLayers";
import { drawSelectionBox } from "./render/layers/selectionLayer";
import { isWorkerBehindAnyOcclusionRect } from "./render/layers/occlusion";

const fadingWorkerDurationMs = 420;
const occludedGhostAlpha = 0.44;

export type { CommandFeedback };

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
  completionPendingWorkerIds?: Set<string>;
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

/**
 * Pure z-order orchestration. Every worker is painted by the canonical `drawWorker`
 * (workerLayer); this file only orders the layers and worker passes.
 */
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
  completionPendingWorkerIds,
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

  if (mapData && mapPreviewImage) {
    drawOutpostPreviewBackgroundLayer(context, viewport, mapData, mapPreviewImage);
  }

  if (commandFeedback) {
    drawCommandFeedbackLayer(context, viewport, commandFeedback, nowMs);
  }

  context.textAlign = "center";
  context.imageSmoothingEnabled = false;

  const activeWorkerIds = precomputedActiveIds ?? new Set(workers.map((worker) => worker.id));

  const scene: WorkerSceneContext = {
    context,
    viewport,
    displayedPositions,
    workerMotion,
    spriteLibrary,
    controlGroupsByWorker: groupControlKeysByWorker(controlGroups),
    activityOverlayStateByWorker,
    completionPendingWorkerIds,
    selectedWorkerIdSet: new Set(selectedWorkerIds),
    animationTick,
    walkAnimationTick,
    workerRadius,
    spriteBaseSize,
    nowMs,
    createdAtMsByWorker: new Map<string, number>(),
    selectedOutlines: [],
    pendingNameplates: []
  };

  if (mapData && mapPreviewImage && mapData.occlusionRects.length > 0) {
    const occludedWorkerIds = new Set<string>();
    for (const worker of workers) {
      const worldPosition = displayedPositions[worker.id] ?? worker.position;
      if (isWorkerBehindAnyOcclusionRect(worldPosition, mapData)) {
        occludedWorkerIds.add(worker.id);
      }
    }

    // Overlay and flames go down first; non-occluded workers paint on top of them.
    drawOutpostOcclusionOverlayLayer(context, viewport, width, height, mapData, mapPreviewImage);
    drawAmbientFlameEffectsLayer(context, viewport, width, height, mapData, mapPreviewImage, nowMs);

    for (const worker of workers) {
      if (!occludedWorkerIds.has(worker.id)) {
        drawWorker(scene, worker);
      }
    }

    // Occluded workers are painted exactly once, after the overlay, as ghosts; their
    // badge, control-group indicator, and nameplate all come from this single pass.
    for (const worker of workers) {
      if (occludedWorkerIds.has(worker.id)) {
        drawWorker(scene, worker, { ghostAlpha: occludedGhostAlpha });
      }
    }
  } else {
    if (mapData && mapPreviewImage) {
      drawAmbientFlameEffectsLayer(context, viewport, width, height, mapData, mapPreviewImage, nowMs);
    }

    for (const worker of workers) {
      drawWorker(scene, worker);
    }
  }

  if (fadingWorkers && fadingWorkers.length > 0) {
    for (const fading of fadingWorkers) {
      if (activeWorkerIds.has(fading.worker.id)) {
        continue;
      }

      const fadeProgress = clamp((nowMs - fading.startedAtMs) / fadingWorkerDurationMs, 0, 1);
      if (fadeProgress >= 1) {
        continue;
      }

      drawWorker(scene, fading.worker, { fadeProgress, drawUi: false, queueNameplate: false });
    }
  }

  drawWorkerNameplates(context, scene.pendingNameplates, nowMs);

  const isGroupSelection = selectedWorkerIds.length > 1;
  for (const selectedOutline of scene.selectedOutlines) {
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
