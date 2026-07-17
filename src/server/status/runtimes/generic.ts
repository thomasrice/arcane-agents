import type { RuntimeAdapter, RuntimeSignals } from "./adapter";

const captureLines = 35;
const freshnessWindowMs = 20_000;

const noSignals: RuntimeSignals = {
  prompt: false,
  active: false,
  activityText: undefined,
  activeTask: undefined
};

/**
 * Fallback adapter for plain shells and any foreground command that is not a
 * known agent runtime. It carries no runtime-specific detectors, so its signals
 * are always empty and the decision falls through to the generic heuristics
 * (parsed activity, freshness windows).
 */
export const genericAdapter: RuntimeAdapter = {
  id: "generic",
  displayName: "Shell",
  captureLines,
  freshnessWindowMs,
  spawnGraceMs: undefined,
  matches() {
    return false;
  },
  detect(): RuntimeSignals {
    return noSignals;
  }
};
