import type { WorkerStatusSignalContext } from "../types";
import { fatalRuntimeErrorMatchers, recentErrorSignalWindowMs } from "./constants";
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

  return "recoverable";
}

function hasRecentFatalRuntimeError(output: string): boolean {
  return recentNormalizedLines(output, 30).some((line) => fatalRuntimeErrorMatchers.some((matcher) => matcher.test(line)));
}

export { classifyParserError };
