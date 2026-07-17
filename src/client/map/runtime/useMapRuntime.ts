import { useEffect, type MutableRefObject, type RefObject } from "react";
import type { Worker, WorkerPosition } from "../../../shared/types";
import type { LoadedOutpostMap } from "../tileMapLoader";
import type { CharacterSpriteSet, SpriteDirection } from "../../sprites/spriteLoader";
import type { ViewportState } from "../viewportMath";
import type { SelectionBox } from "../selection";
import { drawScene, type CommandFeedback } from "../renderScene";
import type { MovementSimulation } from "./movementSimulation";
import type { WorkerVisualStateTracker } from "../workerVisualState";

/**
 * The single map render loop. One requestAnimationFrame loop drives the whole map:
 * it steps the movement simulation at its fixed cadence, computes animation frame
 * indices from the clock, updates the visual-state tracker once per frame, and draws
 * the scene — replacing the two interval tick-states, both setIntervals, and the
 * 20-dependency draw effect. Volatile per-frame inputs are read from `drawStateRef`
 * so the loop never restarts as props change; the canvas backing store is reallocated
 * only when its size or the device pixel ratio actually changes.
 */

export interface MapDrawState {
  canvasSize: { width: number; height: number };
  viewport: ViewportState;
  workers: Worker[];
  fadingWorkers?: Array<{ worker: Worker; startedAtMs: number }>;
  mapData: LoadedOutpostMap | undefined;
  spriteLibrary: Partial<Record<string, CharacterSpriteSet>>;
  selectedWorkerId: string | undefined;
  selectedWorkerIds: string[];
  focusedSelectedWorkerId: string | undefined;
  terminalFocusedSelected: boolean | undefined;
  terminalFocusedWorkerId: string | undefined;
  controlGroups?: Partial<Record<number, string[]>>;
  completionPendingWorkerIds?: Set<string>;
  commandFeedback: CommandFeedback | null;
  mapPreviewImage: HTMLImageElement | undefined;
  marqueeSelection: SelectionBox | null;
  onPositionCommit: (workerId: string, position: WorkerPosition) => void;
}

interface UseMapRuntimeInput {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  drawStateRef: MutableRefObject<MapDrawState | null>;
  simulation: MovementSimulation;
  visualStateTracker: WorkerVisualStateTracker;
  facingRef: MutableRefObject<Record<string, SpriteDirection>>;
  selectedWorkerIdsRef: MutableRefObject<Set<string>>;
  stepIntervalMs: number;
  walkAnimationIntervalMs: number;
  workerRadius: number;
  spriteBaseSize: number;
}

const maxCatchUpTicks = 4;
const emptySuppression: ReadonlySet<string> = new Set();

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Only a lone selected worker is suppressed from wander, matching historical behaviour. */
function deriveWanderSuppression(selectedWorkerIds: Set<string>): ReadonlySet<string> {
  return selectedWorkerIds.size === 1 ? selectedWorkerIds : emptySuppression;
}

export function useMapRuntime({
  canvasRef,
  drawStateRef,
  simulation,
  visualStateTracker,
  facingRef,
  selectedWorkerIdsRef,
  stepIntervalMs,
  walkAnimationIntervalMs,
  workerRadius,
  spriteBaseSize
}: UseMapRuntimeInput): void {
  useEffect(() => {
    let rafId = 0;
    let lastSimTickAt = performance.now();

    const stepSimulation = (draw: MapDrawState, now: number): void => {
      const elapsed = now - lastSimTickAt;
      if (elapsed < stepIntervalMs) {
        return;
      }

      const wanderSuppressedWorkerIds = deriveWanderSuppression(selectedWorkerIdsRef.current);
      const fadingWorkerIds =
        draw.fadingWorkers && draw.fadingWorkers.length > 0
          ? new Set(draw.fadingWorkers.map((item) => item.worker.id))
          : undefined;

      const ticks = Math.min(maxCatchUpTicks, Math.floor(elapsed / stepIntervalMs));
      for (let index = 0; index < ticks; index += 1) {
        const { commits } = simulation.tick(now, {
          workers: draw.workers,
          mapData: draw.mapData,
          wanderSuppressedWorkerIds,
          fadingWorkerIds
        });
        for (const commit of commits) {
          draw.onPositionCommit(commit.workerId, { x: round1(commit.position.x), y: round1(commit.position.y) });
        }
      }

      lastSimTickAt += ticks * stepIntervalMs;
      if (now - lastSimTickAt >= stepIntervalMs) {
        lastSimTickAt = now;
      }
    };

    const renderFrame = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, draw: MapDrawState): void => {
      const now = performance.now();

      const devicePixelRatio = window.devicePixelRatio || 1;
      const desiredWidth = Math.floor(draw.canvasSize.width * devicePixelRatio);
      const desiredHeight = Math.floor(draw.canvasSize.height * devicePixelRatio);
      if (canvas.width !== desiredWidth || canvas.height !== desiredHeight) {
        canvas.width = desiredWidth;
        canvas.height = desiredHeight;
        canvas.style.width = `${draw.canvasSize.width}px`;
        canvas.style.height = `${draw.canvasSize.height}px`;
      }
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      stepSimulation(draw, now);

      const positions = simulation.getPositions();
      const activeWorkerIds = new Set(draw.workers.map((worker) => worker.id));
      const workerMotion = visualStateTracker.updateMotion(draw.workers, positions, facingRef.current, now, activeWorkerIds);
      const activityOverlayStateByWorker = visualStateTracker.updateActivityOverlays(draw.workers, Date.now(), activeWorkerIds);

      drawScene({
        context,
        width: draw.canvasSize.width,
        height: draw.canvasSize.height,
        workers: draw.workers,
        fadingWorkers: draw.fadingWorkers,
        displayedPositions: positions,
        workerMotion,
        selectedWorkerId: draw.selectedWorkerId,
        selectedWorkerIds: draw.selectedWorkerIds,
        focusedSelectedWorkerId: draw.focusedSelectedWorkerId,
        terminalFocusedSelected: draw.terminalFocusedSelected,
        terminalFocusedWorkerId: draw.terminalFocusedWorkerId,
        controlGroups: draw.controlGroups,
        completionPendingWorkerIds: draw.completionPendingWorkerIds,
        viewport: draw.viewport,
        mapData: draw.mapData,
        spriteLibrary: draw.spriteLibrary,
        animationTick: Math.floor(now / stepIntervalMs),
        walkAnimationTick: Math.floor(now / walkAnimationIntervalMs),
        commandFeedback: draw.commandFeedback,
        mapPreviewImage: draw.mapPreviewImage,
        activityOverlayStateByWorker,
        marqueeSelection: draw.marqueeSelection,
        workerRadius,
        spriteBaseSize,
        activeWorkerIds
      });
    };

    const frame = (): void => {
      const draw = drawStateRef.current;
      const canvas = canvasRef.current;
      if (draw && canvas) {
        const context = canvas.getContext("2d");
        if (context) {
          renderFrame(canvas, context, draw);
        }
      }
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [
    canvasRef,
    drawStateRef,
    facingRef,
    selectedWorkerIdsRef,
    simulation,
    spriteBaseSize,
    stepIntervalMs,
    visualStateTracker,
    walkAnimationIntervalMs,
    workerRadius
  ]);
}
