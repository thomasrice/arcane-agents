import type { AgentRuntimeId, Worker } from "../../../shared/types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { genericAdapter } from "./generic";
import { ompAdapter } from "./omp";
import { openCodeAdapter } from "./openCode";
import type { KnownAgentRuntime } from "./runtimeProcess";

export type RuntimeAdapterId = "claude" | "codex" | "opencode" | "omp" | "generic";

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
  /** Runtime-native prompt that requires a user response before work can continue. */
  awaitingInput?: boolean;
  /**
   * Codex-only extension: the parked prompt is specifically a native approval /
   * permission dialog (routes to attention), as opposed to the ordinary at-rest
   * input prompt. Every other adapter leaves it undefined.
   */
  awaitingApproval?: boolean;
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
const agentAdapters: RuntimeAdapter[] = [claudeAdapter, openCodeAdapter, codexAdapter, ompAdapter];

/**
 * Resolve the single adapter that governs a worker.
 *
 * Definite classification (runtimeId / wrapped process / foreground command)
 * comes first. When `output` is supplied and nothing definite matched, native
 * pane signals are sniffed next. A configured prompt-signature runtime is only
 * the fallback after native signals, so an active harness cannot be reclassified
 * by persistent custom prompt chrome. Capture-time resolution normally omits
 * both `output` and `configuredRuntime`, so it uses definite classification.
 */
export function resolveRuntimeAdapter(
  worker: Worker,
  commandLower: string,
  wrappedRuntime: KnownAgentRuntime | undefined,
  output?: string,
  configuredRuntime?: AgentRuntimeId
): RuntimeAdapter {
  for (const adapter of agentAdapters) {
    if (adapter.matches(worker, commandLower, wrappedRuntime)) {
      return adapter;
    }
  }

  if (output !== undefined) {
    const claudeSignals = claudeAdapter.detect(output);
    const openCodeSignals = openCodeAdapter.detect(output);
    const codexSignals = codexAdapter.detect(output);
    const ompSignals = ompAdapter.detect(output);

    // Documented precedence is claude -> opencode -> codex, so Claude is tried
    // first. But Claude's active detector is bullet-based ("• …") and Codex draws
    // its rows with the same glyph, so Claude's detect() also fires on a Codex
    // pane. Claude therefore only wins the sniff when it is the ONLY runtime that
    // recognises the pane; a runtime-SPECIFIC Codex/OpenCode/omp signal (esc-to-
    // interrupt, the approval dialog, the status footer, the ctrl+t/ctrl+p hints,
    // omp's Braille spinner + ⟨esc⟩ / footer meter) takes precedence so those
    // panes are never misread as Claude. (Claude's detect() is side-effect free,
    // so calling it here to sniff is safe.)
    if (
      hasRuntimeSignal(claudeSignals) &&
      !hasRuntimeSignal(openCodeSignals) &&
      !hasRuntimeSignal(codexSignals) &&
      !hasRuntimeSignal(ompSignals)
    ) {
      return claudeAdapter;
    }

    if (hasRuntimeSignal(openCodeSignals)) {
      return openCodeAdapter;
    }

    if (hasRuntimeSignal(codexSignals)) {
      return codexAdapter;
    }

    if (hasRuntimeSignal(ompSignals)) {
      return ompAdapter;
    }
  }

  if (configuredRuntime !== undefined) {
    const configuredAdapter = agentAdapters.find((adapter) => adapter.id === configuredRuntime);
    if (configuredAdapter) {
      return configuredAdapter;
    }
  }

  return genericAdapter;
}

function hasRuntimeSignal(signals: RuntimeSignals): boolean {
  return signals.prompt || signals.active;
}

export { claudeAdapter, codexAdapter, genericAdapter, ompAdapter, openCodeAdapter };
