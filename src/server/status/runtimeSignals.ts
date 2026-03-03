export { capturePaneLineCount, isLikelyClaudeSession, isLikelyOpenCodeSession } from "./runtime/sessionDetection";
export { extractClaudeActiveTask, hasClaudeLiveProgressSignal, isGenericClaudeProgressLabel } from "./runtime/claudeSignals";
export { detectOpenCodeSignals, hasOpenCodePromptSignal, hasOpenCodeActiveSignal, preferOpenCodeSpecificActivityText } from "./runtime/openCodeSignals";
export { hasActiveWorkActivityText, hasWaitingActivityText } from "./runtime/textSignals";
export { extractRuntimeActivityText } from "./runtime/activityTextExtractors";
