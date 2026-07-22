import type { AgentRuntimeId, PromptSignature } from "../../shared/types";
import { promptPatternSafetyError } from "../promptPatternSafety";
import { stripTerminalControlSequences } from "./runtimes/terminalText";

const maxPromptSignatureLineLength = 1_024;

interface CompiledPromptSignature {
  id: string;
  runtime: AgentRuntimeId;
  patterns: RegExp[];
}

export interface PromptSignatureMatch {
  id: string;
  runtime: AgentRuntimeId;
}

export type CompiledPromptSignatures = readonly CompiledPromptSignature[];

/** Compile configured regexes once at monitor startup, never inside a status poll. */
export function compilePromptSignatures(signatures: readonly PromptSignature[]): CompiledPromptSignatures {
  return signatures.map((signature) => ({
    id: signature.id,
    runtime: signature.runtime,
    patterns: signature.all.map((pattern) => {
      const safetyError = promptPatternSafetyError(pattern);
      if (safetyError) {
        throw new Error(`Prompt signature '${signature.id}' is unsafe: ${safetyError}.`);
      }
      return new RegExp(pattern);
    })
  }));
}

/**
 * Match the first configured signature whose every pattern appears in at least
 * one current-screen line. Line normalization removes terminal controls and
 * layout-only whitespace while retaining line boundaries for anchored regexes.
 */
export function matchPromptSignature(
  signatures: CompiledPromptSignatures,
  visiblePane: string
): PromptSignatureMatch | undefined {
  if (signatures.length === 0) {
    return undefined;
  }

  const lines = normalizePromptSignatureLines(visiblePane);
  for (const signature of signatures) {
    if (signature.patterns.every((pattern) => lines.some((line) => pattern.test(line)))) {
      return { id: signature.id, runtime: signature.runtime };
    }
  }

  return undefined;
}

export function normalizePromptSignatureLines(visiblePane: string): string[] {
  return visiblePane
    .split("\n")
    .map((line) =>
      stripTerminalControlSequences(line).replace(/\s+/g, " ").trim().slice(0, maxPromptSignatureLineLength)
    )
    .filter((line) => line.length > 0);
}
