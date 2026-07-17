import { describe, expect, it } from "vitest";
import type { SelectionBox } from "../selection";
import { PointerInteraction, type PointerModifiers } from "./pointerStateMachine";

const noModifiers: PointerModifiers = { shift: false, ctrl: false, meta: false, alt: false };
const shift: PointerModifiers = { ...noModifiers, shift: true };

function neverHit(): string | undefined {
  return undefined;
}

describe("PointerInteraction click vs drag threshold", () => {
  it("treats a press+release without movement as a click that selects the hit worker", () => {
    const machine = new PointerInteraction({ panDragThreshold: 4 });
    const down = machine.pointerDown({
      pointerId: 1,
      button: 0,
      point: { x: 10, y: 10 },
      modifiers: noModifiers,
      hitWorkerId: "w1",
      hasSelection: false
    });
    expect(down).toEqual({ capture: true, preventDefault: false });

    const up = machine.pointerUp({
      pointerId: 1,
      primarySelectedWorkerId: undefined,
      selectedWorkerIds: [],
      resolveMarquee: () => []
    });
    expect(up.select).toEqual(["w1"]);
    expect(up.activateWorkerId).toBeUndefined();
  });

  it("promotes a left-drag past the threshold into a marquee, not a click", () => {
    const machine = new PointerInteraction({ panDragThreshold: 4 });
    machine.pointerDown({
      pointerId: 1,
      button: 0,
      point: { x: 0, y: 0 },
      modifiers: noModifiers,
      hitWorkerId: "w1",
      hasSelection: false
    });

    // Below threshold: still a click, no marquee.
    expect(machine.pointerMove({ pointerId: 1, point: { x: 2, y: 0 }, resolveHit: neverHit })).toEqual({ kind: "dragging" });

    // Past threshold: becomes a marquee.
    const moved = machine.pointerMove({ pointerId: 1, point: { x: 40, y: 30 }, resolveHit: neverHit });
    expect(moved.kind).toBe("marquee");

    const up = machine.pointerUp({
      pointerId: 1,
      primarySelectedWorkerId: undefined,
      selectedWorkerIds: [],
      resolveMarquee: (box: SelectionBox) => {
        expect(box).toEqual({ x: 0, y: 0, width: 40, height: 30 });
        return ["w1", "w2"];
      }
    });
    expect(up.select).toEqual(["w1", "w2"]);
    expect(up.clearMarquee).toBe(true);
  });
});

describe("PointerInteraction pan vs marquee mode", () => {
  it("pans on a right-drag and issues no selection change", () => {
    const machine = new PointerInteraction();
    const down = machine.pointerDown({
      pointerId: 2,
      button: 2,
      point: { x: 100, y: 100 },
      modifiers: noModifiers,
      hitWorkerId: undefined,
      hasSelection: false
    });
    expect(down).toEqual({ capture: true, preventDefault: true });

    const moved = machine.pointerMove({ pointerId: 2, point: { x: 120, y: 90 }, resolveHit: neverHit });
    expect(moved).toEqual({ kind: "pan", deltaX: 20, deltaY: -10 });

    const up = machine.pointerUp({
      pointerId: 2,
      primarySelectedWorkerId: undefined,
      selectedWorkerIds: [],
      resolveMarquee: () => ["should-not-select"]
    });
    expect(up.select).toBeUndefined();
    expect(up.releaseCapture).toBe(true);
  });

  it("issues a move on a right-click without drag when something is selected", () => {
    const machine = new PointerInteraction();
    machine.pointerDown({
      pointerId: 3,
      button: 2,
      point: { x: 55, y: 66 },
      modifiers: noModifiers,
      hitWorkerId: undefined,
      hasSelection: true
    });
    const up = machine.pointerUp({
      pointerId: 3,
      primarySelectedWorkerId: undefined,
      selectedWorkerIds: ["w1"],
      resolveMarquee: () => []
    });
    expect(up.issueMoveAt).toEqual({ x: 55, y: 66 });
  });
});

describe("PointerInteraction selection semantics", () => {
  it("activates a worker on second click when it is the sole selection", () => {
    const machine = new PointerInteraction();
    machine.pointerDown({
      pointerId: 1,
      button: 0,
      point: { x: 5, y: 5 },
      modifiers: noModifiers,
      hitWorkerId: "w1",
      hasSelection: true
    });
    const up = machine.pointerUp({
      pointerId: 1,
      primarySelectedWorkerId: "w1",
      selectedWorkerIds: ["w1"],
      resolveMarquee: () => []
    });
    expect(up.select).toEqual(["w1"]);
    expect(up.activateWorkerId).toBe("w1");
  });

  it("shift-click toggles a worker in and out of the selection", () => {
    const machine = new PointerInteraction();
    machine.pointerDown({
      pointerId: 1,
      button: 0,
      point: { x: 5, y: 5 },
      modifiers: shift,
      hitWorkerId: "w2",
      hasSelection: true
    });
    const up = machine.pointerUp({
      pointerId: 1,
      primarySelectedWorkerId: undefined,
      selectedWorkerIds: ["w1"],
      resolveMarquee: () => []
    });
    expect(up.select).toEqual(["w1", "w2"]);
  });

  it("deselects when clicking empty space with an existing selection", () => {
    const machine = new PointerInteraction();
    machine.pointerDown({
      pointerId: 1,
      button: 0,
      point: { x: 5, y: 5 },
      modifiers: noModifiers,
      hitWorkerId: undefined,
      hasSelection: true
    });
    const up = machine.pointerUp({
      pointerId: 1,
      primarySelectedWorkerId: undefined,
      selectedWorkerIds: ["w1"],
      resolveMarquee: () => []
    });
    expect(up.select).toEqual([]);
  });

  it("discards a marquee that is too small", () => {
    const machine = new PointerInteraction({ panDragThreshold: 1 });
    machine.pointerDown({
      pointerId: 1,
      button: 0,
      point: { x: 0, y: 0 },
      modifiers: noModifiers,
      hitWorkerId: undefined,
      hasSelection: false
    });
    machine.pointerMove({ pointerId: 1, point: { x: 1, y: 1 }, resolveHit: neverHit });
    const up = machine.pointerUp({
      pointerId: 1,
      primarySelectedWorkerId: undefined,
      selectedWorkerIds: [],
      resolveMarquee: () => ["should-not-select"]
    });
    expect(up.select).toBeUndefined();
    expect(up.clearMarquee).toBe(true);
  });
});

describe("PointerInteraction hover and double-click", () => {
  it("reports hover only when idle and over a worker", () => {
    const machine = new PointerInteraction();
    expect(machine.pointerMove({ pointerId: 9, point: { x: 3, y: 4 }, resolveHit: () => "w7" })).toEqual({
      kind: "hover",
      hover: { workerId: "w7", x: 3, y: 4 }
    });
    expect(machine.pointerMove({ pointerId: 9, point: { x: 3, y: 4 }, resolveHit: neverHit })).toEqual({
      kind: "hover",
      hover: null
    });
  });

  it("activates the worker under a double-click", () => {
    const machine = new PointerInteraction();
    expect(machine.doubleClick("w4")).toEqual({ activateWorkerId: "w4" });
    expect(machine.doubleClick(undefined)).toEqual({});
  });
});
