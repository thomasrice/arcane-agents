import type { Worker } from "../../../shared/types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { genericAdapter } from "./generic";
import { openCodeAdapter } from "./openCode";
import type { KnownAgentRuntime } from "./runtimeProcess";

export type RuntimeAdapterId = "claude" | "codex" | "opencode" | "generic";

/**
 * The per-poll signal set a runtime adapter derives from ONE normalisation pass
 * over the captured pane output. Collapses the old per-runtime
 * {claude,openCode,codex}Signals triples into a single shape.
 *
 * `activeTask` is a Claude-only extension (its transcript-independent bullet
 * task summary); every other adapter leaves it undefined.
 */
export interface RuntimeSignals {
  prompt: boolean;
  active: boolean;
  activityText: string | undefined;
  activeTask: string | undefined;
}

/**
 * One adapter owns everything runtime-specific: how many pane lines to capture,
 * the freshness/spawn-grace windows the decision uses, how the worker is
 * recognised, and how to read prompt/active/activity signals from its output.
 */
export interface RuntimeAdapter {
  id: RuntimeAdapterId;
  displayName: string;
  captureLines: number;
  freshnessWindowMs: number;
  spawnGraceMs: number | undefined;
  matches(worker: Worker, commandLower: string, wrappedRuntime: KnownAgentRuntime | undefined): boolean;
  detect(output: string): RuntimeSignals;
}

// Priority order for a definite match. Mirrors the old decision-time precedence
// (claude -> opencode -> codex) used by the freshness-window and activity-text
// resolution, so a worker that would have matched multiple `isLikely*` predicates
// resolves the same way it did before.
const agentAdapters: RuntimeAdapter[] = [claudeAdapter, openCodeAdapter, codexAdapter];

/**
 * Resolve the single adapter that governs a worker.
 *
 * Definite classification (runtimeId / wrapped process / foreground command)
 * comes first. When `output` is supplied and nothing definite matched, the pane
 * output is sniffed as a last-resort tiebreak — this reproduces the old
 * `isOpenCode`/`isCodex` "|| signals.prompt || signals.active" additions for a
 * worker whose id/command give no runtime but whose pane shows an agent UI.
 * Capture-time resolution omits `output` (there is nothing captured yet), so it
 * only ever uses the definite classification.
 */
export function resolveRuntimeAdapter(
  worker: Worker,
  commandLower: string,
  wrappedRuntime: KnownAgentRuntime | undefined,
  output?: string
): RuntimeAdapter {
  for (const adapter of agentAdapters) {
    if (adapter.matches(worker, commandLower, wrappedRuntime)) {
      return adapter;
    }
  }

  if (output !== undefined) {
    if (hasRuntimeSignal(openCodeAdapter.detect(output))) {
      return openCodeAdapter;
    }

    if (hasRuntimeSignal(codexAdapter.detect(output))) {
      return codexAdapter;
    }
  }

  return genericAdapter;
}

function hasRuntimeSignal(signals: RuntimeSignals): boolean {
  return signals.prompt || signals.active;
}

export { claudeAdapter, codexAdapter, genericAdapter, openCodeAdapter };
