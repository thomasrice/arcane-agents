import { describe, expect, it } from "vitest";
import { getBoundingCenter, panViewportToKeepWorldPointInside } from "./viewportMath";

describe("getBoundingCenter", () => {
  it("centres a group between its outermost workers", () => {
    expect(
      getBoundingCenter([
        { x: 10, y: 30 },
        { x: 50, y: 10 },
        { x: 20, y: 70 }
      ])
    ).toEqual({ x: 30, y: 40 });
  });

  it("uses the worker position for a one-worker group", () => {
    expect(getBoundingCenter([{ x: 25, y: 45 }])).toEqual({ x: 25, y: 45 });
  });

  it("returns no centre for an empty selection", () => {
    expect(getBoundingCenter([])).toBeUndefined();
  });
});

describe("panViewportToKeepWorldPointInside", () => {
  const canvasSize = { width: 800, height: 600 };
  const viewport = { scale: 2, offsetX: 100, offsetY: 50 };

  it("leaves the viewport unchanged while the target remains inside the edge margin", () => {
    expect(panViewportToKeepWorldPointInside(viewport, { x: 150, y: 100 }, canvasSize, 96)).toBe(viewport);
  });

  it("pans only far enough to restore the target to the edge margin", () => {
    expect(panViewportToKeepWorldPointInside(viewport, { x: 330, y: 260 }, canvasSize, 96)).toEqual({
      scale: 2,
      offsetX: 44,
      offsetY: -16
    });
  });

  it("follows movement towards the top and left edges", () => {
    expect(panViewportToKeepWorldPointInside(viewport, { x: -20, y: -10 }, canvasSize, 96)).toEqual({
      scale: 2,
      offsetX: 136,
      offsetY: 116
    });
  });
});
