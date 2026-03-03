import type { Worker } from "../../shared/types";
import type { SpriteDirection } from "../sprites/spriteLoader";

export interface WorkerMotion {
  moving: boolean;
  facing: SpriteDirection;
}

export interface ActivityOverlayAnimationState {
  text: string;
  animate: boolean;
  revealedLength: number;
  lastRevealAtMs: number;
  fullyRevealedAtMs: number | undefined;
}

export interface ActivityOverlayRenderState {
  text: string;
  shimmerPhase: number | undefined;
}

const activityOverlayTypingCharIntervalMs = 30;
const activityOverlayTextMaxLength = 64;
const activityOverlayShimmerStartDelayMs = 1500;
const activityOverlayShimmerCycleMs = 1800;

interface ActivityOverlayTarget {
  text: string;
  animate: boolean;
}

export function deriveWorkerMotion(
  workers: Worker[],
  positions: Map<string, { x: number; y: number }>,
  previousPositions: Record<string, { x: number; y: number }>,
  movingUntil: Record<string, number>,
  facingByWorker: Record<string, SpriteDirection>,
  nowMs: number,
  activeWorkerIds?: Set<string>
): Record<string, WorkerMotion> {
  const motion: Record<string, WorkerMotion> = {};
  const activeIds = activeWorkerIds ?? new Set(workers.map((worker) => worker.id));

  for (const workerId of Object.keys(previousPositions)) {
    if (!activeIds.has(workerId)) {
      delete previousPositions[workerId];
      delete movingUntil[workerId];
      delete facingByWorker[workerId];
    }
  }

  for (const worker of workers) {
    const position = positions.get(worker.id) ?? worker.position;
    const previous = previousPositions[worker.id];
    let facing = facingByWorker[worker.id] ?? "south";

    if (previous) {
      const dx = position.x - previous.x;
      const dy = position.y - previous.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.3) {
        movingUntil[worker.id] = nowMs + 450;
        facing = directionFromVector(dx, dy, facing);
      }
    }

    previousPositions[worker.id] = { ...position };
    facingByWorker[worker.id] = facing;
    motion[worker.id] = {
      moving: (movingUntil[worker.id] ?? 0) > nowMs,
      facing
    };
  }

  return motion;
}

export function deriveActivityOverlayStateByWorker(
  workers: Worker[],
  animationStateByWorker: Record<string, ActivityOverlayAnimationState>,
  nowMs: number,
  precomputedActiveIds?: Set<string>
): Record<string, ActivityOverlayRenderState | undefined> {
  const overlayStateByWorker: Record<string, ActivityOverlayRenderState | undefined> = {};
  const activeWorkerIds = precomputedActiveIds ?? new Set(workers.map((worker) => worker.id));

  for (const workerId of Object.keys(animationStateByWorker)) {
    if (!activeWorkerIds.has(workerId)) {
      delete animationStateByWorker[workerId];
    }
  }

  for (const worker of workers) {
    const target = buildActivityOverlayTarget(worker);
    if (!target) {
      delete animationStateByWorker[worker.id];
      continue;
    }

    const existing = animationStateByWorker[worker.id];
    if (!existing || existing.animate !== target.animate || existing.text !== target.text) {
      const keepRevealProgress =
        Boolean(existing) &&
        Boolean(existing?.animate) &&
        Boolean(target.animate) &&
        target.text.startsWith(existing?.text ?? "");
      const revealedLength = keepRevealProgress ? Math.min(existing?.revealedLength ?? 0, target.text.length) : target.animate ? 0 : target.text.length;

      animationStateByWorker[worker.id] = {
        text: target.text,
        animate: target.animate,
        revealedLength,
        lastRevealAtMs: nowMs,
        fullyRevealedAtMs: revealedLength >= target.text.length ? nowMs : undefined
      };
    }

    const state = animationStateByWorker[worker.id];
    if (state.animate && state.revealedLength < state.text.length) {
      const elapsedMs = nowMs - state.lastRevealAtMs;
      if (elapsedMs >= activityOverlayTypingCharIntervalMs) {
        const charsToReveal = Math.floor(elapsedMs / activityOverlayTypingCharIntervalMs);
        state.revealedLength = Math.min(state.text.length, state.revealedLength + charsToReveal);
        state.lastRevealAtMs += charsToReveal * activityOverlayTypingCharIntervalMs;
        if (state.revealedLength >= state.text.length && state.fullyRevealedAtMs === undefined) {
          state.fullyRevealedAtMs = nowMs;
        }
      }
    } else if (!state.animate) {
      state.revealedLength = state.text.length;
      state.lastRevealAtMs = nowMs;
      state.fullyRevealedAtMs = undefined;
    } else if (state.revealedLength >= state.text.length && state.fullyRevealedAtMs === undefined) {
      state.fullyRevealedAtMs = nowMs;
    }

    const visibleText = state.text.slice(0, Math.max(0, state.revealedLength));
    if (!visibleText) {
      overlayStateByWorker[worker.id] = {
        text: "…",
        shimmerPhase: undefined
      };
      continue;
    }

    overlayStateByWorker[worker.id] = {
      text: visibleText,
      shimmerPhase: deriveActivityOverlayShimmerPhase(state, nowMs, visibleText.length)
    };
  }

  return overlayStateByWorker;
}

function directionFromVector(dx: number, dy: number, fallback: SpriteDirection): SpriteDirection {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX < 0.001 && absY < 0.001) {
    return fallback;
  }

  if (absX > absY) {
    return dx >= 0 ? "east" : "west";
  }

  return dy >= 0 ? "south" : "north";
}

function getActivityBadge(worker: Worker): string | undefined {
  switch (worker.activityTool) {
    case "read":
      return "READ";
    case "edit":
      return "EDIT";
    case "write":
      return "WRITE";
    case "bash":
      return "RUN";
    case "grep":
      return "SEARCH";
    case "glob":
      return "SCAN";
    case "task":
      return "TASK";
    case "todo":
      return "TODO";
    case "web":
      return "WEB";
    case "terminal":
      return "TTY";
    case "unknown":
      return "...";
    default:
      if (worker.status === "error") {
        return "ERR";
      }
      if (worker.status === "working") {
        return "RUN";
      }
      return undefined;
  }
}

function deriveActivityOverlayShimmerPhase(
  state: ActivityOverlayAnimationState,
  nowMs: number,
  visibleLength: number
): number | undefined {
  if (!state.animate || state.revealedLength < state.text.length || visibleLength < 6) {
    return undefined;
  }

  if (state.fullyRevealedAtMs === undefined) {
    return undefined;
  }

  const shimmerElapsedMs = nowMs - state.fullyRevealedAtMs - activityOverlayShimmerStartDelayMs;
  if (shimmerElapsedMs < 0) {
    return undefined;
  }

  return (shimmerElapsedMs % activityOverlayShimmerCycleMs) / activityOverlayShimmerCycleMs;
}

function buildActivityOverlayTarget(worker: Worker): ActivityOverlayTarget | undefined {
  if (worker.status !== "working" && worker.status !== "attention" && worker.status !== "error") {
    return undefined;
  }

  const activityText = worker.activityText?.replace(/\s+/g, " ").trim();
  if (activityText) {
    const thinkingDetail = extractThinkingOverlayDetail(activityText);
    if (thinkingDetail) {
      return {
        text: truncateOverlayLabel(thinkingDetail, activityOverlayTextMaxLength),
        animate: true
      };
    }

    return {
      text: truncateOverlayLabel(activityText, activityOverlayTextMaxLength),
      animate: false
    };
  }

  const badge = getActivityBadge(worker);
  if (!badge) {
    return undefined;
  }

  return {
    text: badge,
    animate: false
  };
}

function extractThinkingOverlayDetail(activityText: string): string | undefined {
  const match = activityText.match(/\bThinking:\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function truncateOverlayLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return text.slice(0, Math.max(0, maxLength));
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
