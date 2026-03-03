import type { WorkerStatusSignalContext } from "../types";
import {
  fatalRuntimeErrorMatchers,
  recentErrorSignalWindowMs,
  recoverableToolErrorMatchers,
  stickyWorkingWindowMs
} from "./constants";
import { isAgentRuntime, recentNormalizedLines, shouldSuppressShellHistorySignals } from "./helpers";
import type { ParserErrorClassification } from "./types";

function classifyParserError(context: WorkerStatusSignalContext): ParserErrorClassification {
  if (shouldSuppressShellHistorySignals(context)) {
    return "none";
  }

  const hasRecentParserErrorSignal = context.parsed.activity.hasError && context.outputQuietForMs <= recentErrorSignalWindowMs;
  if (!hasRecentParserErrorSignal) {
    return "none";
  }

  if (!isAgentRuntime(context)) {
    return "fatal";
  }

  if (hasRecentFatalRuntimeError(context.output)) {
    return "fatal";
  }

  if (hasRecoverableAgentToolError(context)) {
    return "recoverable";
  }

  if (context.worker.status === "working" && context.outputQuietForMs <= stickyWorkingWindowMs) {
    return "recoverable";
  }

  return "recoverable";
}

function hasRecentFatalRuntimeError(output: string): boolean {
  return recentNormalizedLines(output, 30).some((line) => fatalRuntimeErrorMatchers.some((matcher) => matcher.test(line)));
}

function hasRecoverableAgentToolError(context: WorkerStatusSignalContext): boolean {
  const recentLines = recentNormalizedLines(context.output, 40);

  if (recentLines.some((line) => recoverableToolErrorMatchers.some((matcher) => matcher.test(line)))) {
    return true;
  }

  const hasLikelyWebToolContext =
    context.parsed.activity.tool === "web" ||
    recentLines.some((line) =>
      /\b(?:webfetch|read-url|curl|wget|http:\/\/|https:\/\/|status code\s*:?\s*\d{3})\b/i.test(line)
    );

  if (hasLikelyWebToolContext && recentLines.some((line) => /^error:\s+/i.test(line))) {
    return true;
  }

  return false;
}

export { classifyParserError };
