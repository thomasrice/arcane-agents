import type { SelectionBox } from "../selection";
import { normalizeSelectionBox } from "../selection";

/**
 * Pure-ish pointer interaction logic for the map canvas, lifted out of MapCanvas so
 * the pan / click / marquee / double-click state transitions are testable without a
 * DOM. MapCanvas wires raw DOM pointer events to these methods and performs the
 * resulting side effects (viewport pan, selection change, terminal activation, move
 * orders); hit-testing and marquee resolution are injected so this stays DOM-free.
 */

export interface PointerVector {
  x: number;
  y: number;
}

export interface PointerModifiers {
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
}

type DragMode = "pan" | "click" | "marquee";

interface DragState {
  pointerId: number;
  mode: DragMode;
  clickedWorkerId: string | undefined;
  toggleSelectionOnRelease: boolean;
  issueMoveOnClick: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  deselectOnClick: boolean;
}

export interface PointerDownInput {
  pointerId: number;
  button: number;
  point: PointerVector;
  modifiers: PointerModifiers;
  hitWorkerId: string | undefined;
  hasSelection: boolean;
}

export interface PointerDownResult {
  capture: boolean;
  preventDefault: boolean;
}

export interface PointerMoveInput {
  pointerId: number;
  point: PointerVector;
  /** Lazily resolves the worker under the pointer; only called when no drag is active. */
  resolveHit: () => string | undefined;
}

export type PointerMoveResult =
  | { kind: "hover"; hover: { workerId: string; x: number; y: number } | null }
  | { kind: "dragging" }
  | { kind: "pan"; deltaX: number; deltaY: number }
  | { kind: "marquee"; box: SelectionBox };

export interface PointerUpInput {
  pointerId: number;
  primarySelectedWorkerId: string | undefined;
  selectedWorkerIds: readonly string[];
  /** Resolves the worker ids inside a finished marquee box. */
  resolveMarquee: (box: SelectionBox) => string[];
}

export interface PointerUpResult {
  releaseCapture: boolean;
  clearMarquee: boolean;
  select?: string[];
  activateWorkerId?: string;
  issueMoveAt?: PointerVector;
}

export interface PointerInteractionConfig {
  panDragThreshold: number;
}

const marqueeMinSizePx = 2;

export class PointerInteraction {
  private drag: DragState | null = null;
  private readonly panDragThreshold: number;

  constructor(config: Partial<PointerInteractionConfig> = {}) {
    this.panDragThreshold = config.panDragThreshold ?? 4;
  }

  pointerDown(input: PointerDownInput): PointerDownResult {
    if (input.button === 2) {
      this.drag = {
        pointerId: input.pointerId,
        mode: "pan",
        clickedWorkerId: undefined,
        toggleSelectionOnRelease: false,
        issueMoveOnClick: input.hasSelection,
        startX: input.point.x,
        startY: input.point.y,
        lastX: input.point.x,
        lastY: input.point.y,
        moved: false,
        deselectOnClick: false
      };
      return { capture: true, preventDefault: true };
    }

    if (input.button !== 0) {
      return { capture: false, preventDefault: false };
    }

    this.drag = {
      pointerId: input.pointerId,
      mode: "click",
      clickedWorkerId: input.hitWorkerId,
      toggleSelectionOnRelease:
        input.modifiers.shift && !input.modifiers.ctrl && !input.modifiers.meta && !input.modifiers.alt,
      issueMoveOnClick: false,
      startX: input.point.x,
      startY: input.point.y,
      lastX: input.point.x,
      lastY: input.point.y,
      moved: false,
      deselectOnClick: input.hasSelection
    };
    return { capture: true, preventDefault: false };
  }

  pointerMove(input: PointerMoveInput): PointerMoveResult {
    const drag = this.drag;
    if (!drag || drag.pointerId !== input.pointerId) {
      const hit = input.resolveHit();
      return { kind: "hover", hover: hit ? { workerId: hit, x: input.point.x, y: input.point.y } : null };
    }

    const deltaX = input.point.x - drag.lastX;
    const deltaY = input.point.y - drag.lastY;
    const dragDistance = Math.hypot(input.point.x - drag.startX, input.point.y - drag.startY);

    if (!drag.moved && dragDistance >= this.panDragThreshold) {
      drag.moved = true;
      if (drag.mode === "click") {
        drag.mode = "marquee";
        drag.clickedWorkerId = undefined;
      }
    }

    let result: PointerMoveResult = { kind: "dragging" };
    if (drag.mode === "pan" && drag.moved && (deltaX !== 0 || deltaY !== 0)) {
      result = { kind: "pan", deltaX, deltaY };
    } else if (drag.mode === "marquee") {
      result = { kind: "marquee", box: normalizeSelectionBox(drag.startX, drag.startY, input.point.x, input.point.y) };
    }

    drag.lastX = input.point.x;
    drag.lastY = input.point.y;
    return result;
  }

  pointerUp(input: PointerUpInput): PointerUpResult {
    const drag = this.drag;
    if (!drag || drag.pointerId !== input.pointerId) {
      return { releaseCapture: false, clearMarquee: false };
    }
    this.drag = null;

    if (drag.mode === "pan" && drag.moved) {
      return { releaseCapture: true, clearMarquee: false };
    }

    if (drag.mode === "pan" && !drag.moved && drag.issueMoveOnClick) {
      return { releaseCapture: true, clearMarquee: false, issueMoveAt: { x: drag.lastX, y: drag.lastY } };
    }

    if (drag.mode === "marquee") {
      const box = normalizeSelectionBox(drag.startX, drag.startY, drag.lastX, drag.lastY);
      if (box.width < marqueeMinSizePx || box.height < marqueeMinSizePx) {
        return { releaseCapture: true, clearMarquee: true };
      }

      const ids = input.resolveMarquee(box);
      if (drag.toggleSelectionOnRelease) {
        return { releaseCapture: true, clearMarquee: true, select: toggleMany(input.selectedWorkerIds, ids) };
      }
      return { releaseCapture: true, clearMarquee: true, select: ids };
    }

    if (drag.clickedWorkerId) {
      const clickedWorkerId = drag.clickedWorkerId;
      if (drag.toggleSelectionOnRelease) {
        return { releaseCapture: true, clearMarquee: false, select: toggleOne(input.selectedWorkerIds, clickedWorkerId) };
      }

      const isAlreadyPrimary = input.primarySelectedWorkerId === clickedWorkerId;
      const hasOnlyThisSelection = input.selectedWorkerIds.length === 1 && input.selectedWorkerIds[0] === clickedWorkerId;
      return {
        releaseCapture: true,
        clearMarquee: false,
        select: [clickedWorkerId],
        activateWorkerId: isAlreadyPrimary && hasOnlyThisSelection ? clickedWorkerId : undefined
      };
    }

    if (drag.deselectOnClick) {
      return { releaseCapture: true, clearMarquee: false, select: [] };
    }

    return { releaseCapture: true, clearMarquee: false };
  }

  /** Abort any active drag (pointer cancel). Returns whether a drag was cleared. */
  pointerCancel(pointerId: number): { cleared: boolean } {
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointerId) {
      return { cleared: false };
    }
    this.drag = null;
    return { cleared: true };
  }

  doubleClick(hitWorkerId: string | undefined): { activateWorkerId?: string } {
    return hitWorkerId ? { activateWorkerId: hitWorkerId } : {};
  }

  hasActiveDrag(): boolean {
    return this.drag !== null;
  }
}

function toggleOne(current: readonly string[], workerId: string): string[] {
  return current.includes(workerId) ? current.filter((id) => id !== workerId) : [...current, workerId];
}

function toggleMany(current: readonly string[], workerIds: string[]): string[] {
  const next = new Set(current);
  for (const workerId of workerIds) {
    if (next.has(workerId)) {
      next.delete(workerId);
    } else {
      next.add(workerId);
    }
  }
  return Array.from(next);
}
