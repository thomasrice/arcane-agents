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
  /**
   * Codex-only extension: the parked prompt is specifically an approval /
   * permission / question dialog (routes to attention), as opposed to the
   * ordinary at-rest input prompt (which only classifies the pane as codex and
   * otherwise falls through to idle). Every other adapter leaves it undefined.
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
const agentAdapters: RuntimeAdapter[] = [claudeAdapter, openCodeAdapter, codexAdapter];

/**
 * Resolve the single adapter that governs a worker.
 *
 * Definite classification (runtimeId / wrapped process / foreground command)
 * comes first. When `output` is supplied and nothing definite matched, the pane
 * output is sniffed as a last-resort tiebreak for a worker whose id/command give
 * no runtime but whose pane shows an agent UI (e.g. Claude Code or Codex running
 * as a bare `node` pane with no resolvable runtime process). Capture-time
 * resolution omits `output` (there is nothing captured yet), so it only ever
 * uses the definite classification.
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
    const claudeSignals = claudeAdapter.detect(output);
    const openCodeSignals = openCodeAdapter.detect(output);
    const codexSignals = codexAdapter.detect(output);

    // Documented precedence is claude -> opencode -> codex, so Claude is tried
    // first. But Claude's active detector is bullet-based ("• …") and Codex draws
    // its rows with the same glyph, so Claude's detect() also fires on a Codex
    // pane. Claude therefore only wins the sniff when it is the ONLY runtime that
    // recognises the pane; a runtime-SPECIFIC Codex/OpenCode signal (esc-to-
    // interrupt, the approval dialog, the status footer, the ctrl+t/ctrl+p hints)
    // takes precedence so a Codex/OpenCode pane is never misread as Claude.
    // (Claude's detect() is side-effect free, so calling it here to sniff is safe.)
    if (hasRuntimeSignal(claudeSignals) && !hasRuntimeSignal(openCodeSignals) && !hasRuntimeSignal(codexSignals)) {
      return claudeAdapter;
    }

    if (hasRuntimeSignal(openCodeSignals)) {
      return openCodeAdapter;
    }

    if (hasRuntimeSignal(codexSignals)) {
      return codexAdapter;
    }
  }

  return genericAdapter;
}

function hasRuntimeSignal(signals: RuntimeSignals): boolean {
  return signals.prompt || signals.active;
}

export { claudeAdapter, codexAdapter, genericAdapter, openCodeAdapter };
