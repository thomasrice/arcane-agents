import { describe, expect, it } from "vitest";
import { getBoundingCenter } from "./viewportMath";

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
