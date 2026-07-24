import { describe, expect, it } from "vitest";
import { getNextSelectedSilencedState } from "./useWorkerActions";

describe("getNextSelectedSilencedState", () => {
  it("silences every selected character when any selection member is audible", () => {
    expect(getNextSelectedSilencedState([{ silenced: false }])).toBe(true);
    expect(getNextSelectedSilencedState([{ silenced: true }, { silenced: false }])).toBe(true);
  });

  it("unsilences the selection when every selected character is silenced", () => {
    expect(getNextSelectedSilencedState([{ silenced: true }, { silenced: true }])).toBe(false);
  });
});
