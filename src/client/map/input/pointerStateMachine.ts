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

type DragMode = "pan" | "click" | "marquee" | "touch";

interface DragState {
  pointerId: number;
  pointerType: string;
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

interface PinchPointer {
  pointerId: number;
  x: number;
  y: number;
}

interface PinchState {
  mode: "pinch";
  pointers: [PinchPointer, PinchPointer];
}

type InteractionState = DragState | PinchState;

export interface PointerDownInput {
  pointerId: number;
  pointerType?: string;
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
  | { kind: "pinch"; midpoint: PointerVector; deltaX: number; deltaY: number; zoomFactor: number }
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
  private interaction: InteractionState | null = null;
  private readonly panDragThreshold: number;

  constructor(config: Partial<PointerInteractionConfig> = {}) {
    this.panDragThreshold = config.panDragThreshold ?? 4;
  }

  pointerDown(input: PointerDownInput): PointerDownResult {
    const pointerType = input.pointerType ?? "mouse";
    const current = this.interaction;
    if (
      pointerType === "touch" &&
      current &&
      current.mode !== "pinch" &&
      current.pointerType === "touch" &&
      current.pointerId !== input.pointerId
    ) {
      this.interaction = {
        mode: "pinch",
        pointers: [
          { pointerId: current.pointerId, x: current.lastX, y: current.lastY },
          { pointerId: input.pointerId, x: input.point.x, y: input.point.y }
        ]
      };
      return { capture: true, preventDefault: true };
    }

    if (pointerType === "touch" && current?.mode === "pinch") {
      return { capture: false, preventDefault: true };
    }

    if (input.button === 2) {
      this.interaction = {
        pointerId: input.pointerId,
        pointerType,
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

    this.interaction = {
      pointerId: input.pointerId,
      pointerType,
      mode: pointerType === "touch" ? "touch" : "click",
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
    return { capture: true, preventDefault: pointerType === "touch" };
  }

  pointerMove(input: PointerMoveInput): PointerMoveResult {
    const current = this.interaction;
    if (current?.mode === "pinch") {
      const movedPointer = current.pointers.find((pointer) => pointer.pointerId === input.pointerId);
      if (!movedPointer) {
        return { kind: "dragging" };
      }

      const previousMidpoint = pinchMidpoint(current.pointers);
      const previousDistance = pinchDistance(current.pointers);
      movedPointer.x = input.point.x;
      movedPointer.y = input.point.y;
      const midpoint = pinchMidpoint(current.pointers);
      const distance = pinchDistance(current.pointers);
      return {
        kind: "pinch",
        midpoint,
        deltaX: midpoint.x - previousMidpoint.x,
        deltaY: midpoint.y - previousMidpoint.y,
        zoomFactor: previousDistance > 0 ? distance / previousDistance : 1
      };
    }

    if (!current || current.pointerId !== input.pointerId) {
      const hit = input.resolveHit();
      return { kind: "hover", hover: hit ? { workerId: hit, x: input.point.x, y: input.point.y } : null };
    }

    const deltaX = input.point.x - current.lastX;
    const deltaY = input.point.y - current.lastY;
    const dragDistance = Math.hypot(input.point.x - current.startX, input.point.y - current.startY);

    if (!current.moved && dragDistance >= this.panDragThreshold) {
      current.moved = true;
      if (current.mode === "click") {
        current.mode = "marquee";
        current.clickedWorkerId = undefined;
      } else if (current.mode === "touch") {
        current.mode = "pan";
        current.clickedWorkerId = undefined;
        current.deselectOnClick = false;
      }
    }

    let result: PointerMoveResult = { kind: "dragging" };
    if (current.mode === "pan" && current.moved && (deltaX !== 0 || deltaY !== 0)) {
      result = { kind: "pan", deltaX, deltaY };
    } else if (current.mode === "marquee") {
      result = {
        kind: "marquee",
        box: normalizeSelectionBox(current.startX, current.startY, input.point.x, input.point.y)
      };
    }

    current.lastX = input.point.x;
    current.lastY = input.point.y;
    return result;
  }

  pointerUp(input: PointerUpInput): PointerUpResult {
    const current = this.interaction;
    if (current?.mode === "pinch") {
      const releasedIndex = current.pointers.findIndex((pointer) => pointer.pointerId === input.pointerId);
      if (releasedIndex < 0) {
        return { releaseCapture: false, clearMarquee: false };
      }

      const remaining = current.pointers[releasedIndex === 0 ? 1 : 0];
      this.interaction = {
        pointerId: remaining.pointerId,
        pointerType: "touch",
        mode: "pan",
        clickedWorkerId: undefined,
        toggleSelectionOnRelease: false,
        issueMoveOnClick: false,
        startX: remaining.x,
        startY: remaining.y,
        lastX: remaining.x,
        lastY: remaining.y,
        moved: true,
        deselectOnClick: false
      };
      return { releaseCapture: true, clearMarquee: false };
    }

    if (!current || current.pointerId !== input.pointerId) {
      return { releaseCapture: false, clearMarquee: false };
    }
    this.interaction = null;

    if (current.mode === "pan" && current.moved) {
      return { releaseCapture: true, clearMarquee: false };
    }

    if (current.mode === "pan" && !current.moved && current.issueMoveOnClick) {
      return { releaseCapture: true, clearMarquee: false, issueMoveAt: { x: current.lastX, y: current.lastY } };
    }

    if (current.mode === "marquee") {
      const box = normalizeSelectionBox(current.startX, current.startY, current.lastX, current.lastY);
      if (box.width < marqueeMinSizePx || box.height < marqueeMinSizePx) {
        return { releaseCapture: true, clearMarquee: true };
      }

      const ids = input.resolveMarquee(box);
      if (current.toggleSelectionOnRelease) {
        return { releaseCapture: true, clearMarquee: true, select: toggleMany(input.selectedWorkerIds, ids) };
      }
      return { releaseCapture: true, clearMarquee: true, select: ids };
    }

    if (current.clickedWorkerId) {
      const clickedWorkerId = current.clickedWorkerId;
      if (current.toggleSelectionOnRelease) {
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

    if (current.deselectOnClick) {
      return { releaseCapture: true, clearMarquee: false, select: [] };
    }

    return { releaseCapture: true, clearMarquee: false };
  }

  /** Abort the matching active pointer. A remaining pinch finger continues as a pan. */
  pointerCancel(pointerId: number): { cleared: boolean } {
    const current = this.interaction;
    if (current?.mode === "pinch") {
      const cancelledIndex = current.pointers.findIndex((pointer) => pointer.pointerId === pointerId);
      if (cancelledIndex < 0) {
        return { cleared: false };
      }
      const remaining = current.pointers[cancelledIndex === 0 ? 1 : 0];
      this.interaction = {
        pointerId: remaining.pointerId,
        pointerType: "touch",
        mode: "pan",
        clickedWorkerId: undefined,
        toggleSelectionOnRelease: false,
        issueMoveOnClick: false,
        startX: remaining.x,
        startY: remaining.y,
        lastX: remaining.x,
        lastY: remaining.y,
        moved: true,
        deselectOnClick: false
      };
      return { cleared: true };
    }

    if (!current || current.pointerId !== pointerId) {
      return { cleared: false };
    }
    this.interaction = null;
    return { cleared: true };
  }

  doubleClick(hitWorkerId: string | undefined): { activateWorkerId?: string } {
    return hitWorkerId ? { activateWorkerId: hitWorkerId } : {};
  }

  hasActiveDrag(): boolean {
    return this.interaction !== null;
  }
}

function pinchMidpoint(pointers: [PinchPointer, PinchPointer]): PointerVector {
  return {
    x: (pointers[0].x + pointers[1].x) / 2,
    y: (pointers[0].y + pointers[1].y) / 2
  };
}

function pinchDistance(pointers: [PinchPointer, PinchPointer]): number {
  return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
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
