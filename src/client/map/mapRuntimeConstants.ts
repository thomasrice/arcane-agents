// Shared tuning for the map runtime (movement cadence, camera limits, input, feedback).
// Movement speed and animation cadence are load-bearing: keep px-per-tick and the
// tick/animation intervals unchanged so characters walk and animate at the same rate.

export const workerRadius = 13;
export const spriteBaseSize = 64;
export const moveSpeedPerTick = 9;
export const movementIntervalMs = 95;
export const walkAnimationIntervalMs = 72;
export const keyboardPanSpeedPerSecond = 520;
export const keyboardMoveUnitsPerSecond = (moveSpeedPerTick * 1000) / movementIntervalMs;
export const keyboardMoveCommitIntervalMs = 160;
export const pointerPanDragThreshold = 4;
export const defaultZoomScale = 1.45;
export const maxZoomScale = 4.8;
export const recenterVisibilityPaddingPx = 56;
export const cameraFollowPaddingPx = 96;
export const commandFeedbackDurationMs = 900;
export const blockedFeedbackDurationMs = 750;
export const workerPersonalSpacePx = 26;
export const scatterBaseSpreadPx = 80;
export const scatterPerWorkerSpreadPx = 20;
