import type { Worker } from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import type { ParsedActivity } from "./activityParser";
import { parseActivity } from "./activityParser";
import { ClaudeTranscriptTracker } from "./claudeTranscriptTracker";

interface PaneObservation {
  lastCommand: string;
  lastCommandChangeAtMs: number;
  lastOutputSignature: string;
  lastOutputChangeAtMs: number;
}

const shellCommands = new Set(["bash", "zsh", "fish", "sh", "nu", "pwsh"]);
const nonShellIdleAfterMs = 10_000;
const outputHeartbeatWorkingWindowMs = 12_000;
const claudeStickyWorkingWindowMs = 10_000;
const claudeActiveTextHoldWindowMs = 5 * 60_000;
const claudeSpawnIdleGraceMs = 5_000;
const defaultCapturePaneLines = 35;
const claudeCapturePaneLines = 60;
const openCodeCapturePaneLines = 420;
const openCodeThinkingContinuationMaxLines = 3;

export class StatusMonitor {
  private intervalId: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private readonly claudeTranscript = new ClaudeTranscriptTracker();
  private readonly paneObservation = new Map<string, PaneObservation>();

  constructor(
    private readonly workers: WorkerRepository,
    private readonly tmux: TmuxAdapter,
    private readonly pollIntervalMs: number,
    private readonly onWorkerUpdated: (worker: Worker) => void,
    private readonly onWorkerRemoved: (workerId: string) => void
  ) {}

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);

    void this.pollOnce();
  }

  stop(): void {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  async pollOnce(): Promise<void> {
    if (this.pollInFlight) {
      return;
    }

    this.pollInFlight = true;
    try {
      const currentWorkers = this.workers.listWorkers();

      for (const worker of currentWorkers) {
        await this.updateWorkerStatus(worker);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private async updateWorkerStatus(worker: Worker): Promise<void> {
    const live = await this.tmux.windowExists(worker.tmuxRef);
    if (!live) {
      const removed = this.workers.deleteWorker(worker.id);
      if (removed) {
        this.claudeTranscript.forget(worker.id);
        this.paneObservation.delete(worker.id);
        this.onWorkerRemoved(worker.id);
      }
      return;
    }

    let derivedStatus = worker.status;
    let derivedActivityText = worker.activityText;
    let derivedActivityTool = worker.activityTool;
    let derivedActivityPath = worker.activityPath;

    try {
      const paneState = await this.tmux.getPaneState(worker.tmuxRef);
      const currentCommandLower = paneState.currentCommand.toLowerCase();
      const output = await this.tmux.capturePane(worker.tmuxRef, capturePaneLineCount(worker, currentCommandLower));
      if (paneState.isDead) {
        const removed = this.workers.deleteWorker(worker.id);
        if (removed) {
          this.claudeTranscript.forget(worker.id);
          this.paneObservation.delete(worker.id);
          this.onWorkerRemoved(worker.id);
        }
        return;
      } else {
        const parsed = parseActivity(paneState.currentCommand, output);
        const transcriptSnapshot = this.claudeTranscript.poll(worker, paneState.currentCommand, paneState.currentPath);
        const observation = this.observePane(worker.id, paneState.currentCommand, output);
        const activeClaudeTask = extractClaudeActiveTask(output);
        const runtimeActivityText = extractRuntimeActivityText(worker, paneState.currentCommand, output);

        if (transcriptSnapshot) {
          derivedStatus = transcriptSnapshot.status;
          derivedActivityText = transcriptSnapshot.activityText ?? runtimeActivityText ?? parsed.activity.text;
          derivedActivityTool = transcriptSnapshot.activityTool ?? parsed.activity.tool;
          derivedActivityPath = transcriptSnapshot.activityPath ?? parsed.activity.filePath;

          if (
            derivedStatus === "idle" &&
            this.shouldPromoteIdleFromActiveClaudeTask(worker, paneState.currentCommand, observation, activeClaudeTask)
          ) {
            derivedStatus = "working";
            derivedActivityText = activeClaudeTask;
            derivedActivityTool = "terminal";
            derivedActivityPath = undefined;
          }
        } else {
          derivedStatus = this.resolveFallbackStatus(parsed.status, paneState.currentCommand, observation, parsed.activity);
          const hasClaudeProgressSignal = isLikelyClaudeSession(worker, currentCommandLower) && hasClaudeLiveProgressSignal(output);
          if (isLikelyClaudeSession(worker, currentCommandLower) && !activeClaudeTask && !hasClaudeProgressSignal) {
            derivedStatus = parsed.activity.needsInput ? "attention" : "idle";
          }

          if (
            derivedStatus === "idle" &&
            this.shouldPromoteIdleFromActiveClaudeTask(worker, paneState.currentCommand, observation, activeClaudeTask)
          ) {
            derivedStatus = "working";
            derivedActivityText = activeClaudeTask;
            derivedActivityTool = "terminal";
            derivedActivityPath = undefined;
          }

          if (derivedStatus === "idle") {
            derivedActivityText = undefined;
            derivedActivityTool = undefined;
            derivedActivityPath = undefined;
          } else {
            derivedActivityText = runtimeActivityText ?? parsed.activity.text;
            derivedActivityTool = parsed.activity.tool;
            derivedActivityPath = parsed.activity.filePath;
          }
        }

        if (
          derivedStatus === "working" &&
          this.shouldTreatAsSpawnGraceIdle(worker, paneState.currentCommand, parsed.activity, activeClaudeTask)
        ) {
          derivedStatus = "idle";
          derivedActivityText = undefined;
          derivedActivityTool = undefined;
          derivedActivityPath = undefined;
        }

        if (
          (derivedStatus === "working" || derivedStatus === "error") &&
          this.shouldForceIdleOnOpenCodePrompt(worker, paneState.currentCommand, output, parsed.activity)
        ) {
          derivedStatus = "idle";
          derivedActivityText = undefined;
          derivedActivityTool = undefined;
          derivedActivityPath = undefined;
        }

        if (
          derivedStatus === "idle" &&
          this.shouldKeepWorkingFromHeartbeat(
            worker,
            paneState.currentCommand,
            observation,
            parsed.activity,
            activeClaudeTask,
            derivedActivityText,
            output
          )
        ) {
          derivedStatus = "working";
          derivedActivityText = derivedActivityText ?? runtimeActivityText ?? activeClaudeTask ?? parsed.activity.text ?? worker.activityText;
          derivedActivityTool = derivedActivityTool ?? parsed.activity.tool ?? "terminal";
          derivedActivityPath = derivedActivityPath ?? parsed.activity.filePath;
        }

        if (
          derivedStatus === "attention" &&
          this.shouldDowngradeAttentionToWorking(
            worker,
            paneState.currentCommand,
            observation,
            parsed.activity,
            activeClaudeTask,
            derivedActivityText,
            output
          )
        ) {
          derivedStatus = "working";
          derivedActivityText = derivedActivityText ?? runtimeActivityText ?? activeClaudeTask ?? parsed.activity.text ?? worker.activityText;
          derivedActivityTool = derivedActivityTool ?? parsed.activity.tool ?? "terminal";
          derivedActivityPath = derivedActivityPath ?? parsed.activity.filePath;
        }

        if (
          derivedStatus === "working" &&
          this.shouldForceIdleOnStaleClaudeProgress(worker, paneState.currentCommand, observation, derivedActivityText)
        ) {
          derivedStatus = "idle";
          derivedActivityText = undefined;
          derivedActivityTool = undefined;
          derivedActivityPath = undefined;
        }

        if (derivedStatus === "working" && isLikelyOpenCodeSession(worker, currentCommandLower)) {
          derivedActivityText = preferOpenCodeSpecificActivityText(worker.activityText, derivedActivityText);
        }
      }
    } catch {
      derivedStatus = "error";
      derivedActivityText = "Status check failed";
      derivedActivityTool = "unknown";
      derivedActivityPath = undefined;
    }

    if (derivedStatus === "idle") {
      derivedActivityText = undefined;
      derivedActivityTool = undefined;
      derivedActivityPath = undefined;
    }

    if (
      derivedStatus === worker.status &&
      derivedActivityText === worker.activityText &&
      derivedActivityTool === worker.activityTool &&
      derivedActivityPath === worker.activityPath
    ) {
      return;
    }

    if (derivedStatus === "stopped") {
      const removed = this.workers.deleteWorker(worker.id);
      if (removed) {
        this.claudeTranscript.forget(worker.id);
        this.paneObservation.delete(worker.id);
        this.onWorkerRemoved(worker.id);
      }
      return;
    }

    const updated = this.workers.updateStatus(worker.id, {
      status: derivedStatus,
      activityText: derivedActivityText,
      activityTool: derivedActivityTool,
      activityPath: derivedActivityPath
    });
    if (updated) {
      this.onWorkerUpdated(updated);
    }
  }

  private observePane(workerId: string, currentCommand: string, output: string): PaneObservation {
    const now = Date.now();
    const signature = outputSignature(output);
    const existing = this.paneObservation.get(workerId);

    if (!existing) {
      const initial: PaneObservation = {
        lastCommand: currentCommand,
        lastCommandChangeAtMs: now,
        lastOutputSignature: signature,
        lastOutputChangeAtMs: now
      };
      this.paneObservation.set(workerId, initial);
      return initial;
    }

    if (existing.lastCommand !== currentCommand) {
      existing.lastCommand = currentCommand;
      existing.lastCommandChangeAtMs = now;
    }

    if (existing.lastOutputSignature !== signature) {
      existing.lastOutputSignature = signature;
      existing.lastOutputChangeAtMs = now;
    }

    return existing;
  }

  private resolveFallbackStatus(
    parsedStatus: Worker["status"],
    currentCommand: string,
    observation: PaneObservation,
    activity: ParsedActivity
  ): Worker["status"] {
    if (parsedStatus !== "working") {
      return parsedStatus;
    }

    const commandLower = currentCommand.toLowerCase();
    if (shellCommands.has(commandLower)) {
      return "idle";
    }

    const hasStrongActivitySignal =
      Boolean(activity.filePath) ||
      (Boolean(activity.tool) && activity.tool !== "terminal");

    if (!hasStrongActivitySignal && !commandLower.includes("claude")) {
      return "idle";
    }

    const now = Date.now();
    const quietForMs = now - Math.max(observation.lastCommandChangeAtMs, observation.lastOutputChangeAtMs);
    if (quietForMs >= nonShellIdleAfterMs) {
      return "idle";
    }

    return "working";
  }

  private shouldKeepWorkingFromHeartbeat(
    worker: Worker,
    currentCommand: string,
    observation: PaneObservation,
    activity: ParsedActivity,
    activeClaudeTask: string | undefined,
    activityText: string | undefined,
    output: string
  ): boolean {
    const now = Date.now();
    const commandLower = currentCommand.toLowerCase();
    const likelyClaudeSession = isLikelyClaudeSession(worker, commandLower);
    const likelyOpenCodeSession = isLikelyOpenCodeSession(worker, commandLower);
    const outputQuietForMs = now - observation.lastOutputChangeAtMs;
    const hasClaudeProgressSignal = likelyClaudeSession && hasClaudeLiveProgressSignal(output);

    if (likelyOpenCodeSession && hasOpenCodePromptSignal(output) && !hasOpenCodeActiveSignal(output)) {
      return false;
    }

    if (
      likelyClaudeSession &&
      hasActiveWorkActivityText(activityText) &&
      !hasWaitingActivityText(activityText) &&
      (Boolean(activeClaudeTask) || hasClaudeProgressSignal) &&
      outputQuietForMs <= claudeActiveTextHoldWindowMs
    ) {
      return true;
    }

    const heartbeatWindowMs = likelyClaudeSession ? claudeStickyWorkingWindowMs : outputHeartbeatWorkingWindowMs;
    if (outputQuietForMs > heartbeatWindowMs) {
      return false;
    }

    if (likelyClaudeSession) {
      return Boolean(activeClaudeTask || hasClaudeProgressSignal);
    }

    if (!shellCommands.has(commandLower)) {
      return true;
    }

    if (activeClaudeTask) {
      return true;
    }

    if (worker.status === "working") {
      return true;
    }

    return Boolean(activity.filePath || activity.tool || activity.text);
  }

  private shouldTreatAsSpawnGraceIdle(
    worker: Worker,
    currentCommand: string,
    activity: ParsedActivity,
    activeClaudeTask: string | undefined
  ): boolean {
    const createdAtMs = Date.parse(worker.createdAt);
    if (!Number.isFinite(createdAtMs)) {
      return false;
    }

    const ageMs = Date.now() - createdAtMs;
    if (ageMs < 0 || ageMs > claudeSpawnIdleGraceMs) {
      return false;
    }

    if (!isLikelyClaudeSession(worker, currentCommand.toLowerCase())) {
      return false;
    }

    if (activeClaudeTask || activity.needsInput || activity.hasError) {
      return false;
    }

    const hasStrongActivitySignal =
      Boolean(activity.filePath) ||
      (Boolean(activity.tool) && activity.tool !== "terminal");

    return !hasStrongActivitySignal;
  }

  private shouldPromoteIdleFromActiveClaudeTask(
    worker: Worker,
    currentCommand: string,
    observation: PaneObservation,
    activeClaudeTask: string | undefined
  ): boolean {
    if (!activeClaudeTask) {
      return false;
    }

    if (!isLikelyClaudeSession(worker, currentCommand.toLowerCase())) {
      return true;
    }

    const outputQuietForMs = Date.now() - observation.lastOutputChangeAtMs;
    return outputQuietForMs <= claudeStickyWorkingWindowMs;
  }

  private shouldForceIdleOnOpenCodePrompt(
    worker: Worker,
    currentCommand: string,
    output: string,
    activity: ParsedActivity
  ): boolean {
    if (!isLikelyOpenCodeSession(worker, currentCommand.toLowerCase())) {
      return false;
    }

    if (!hasOpenCodePromptSignal(output)) {
      return false;
    }

    if (hasOpenCodeActiveSignal(output)) {
      return false;
    }

    if (activity.needsInput) {
      return false;
    }

    return true;
  }

  private shouldDowngradeAttentionToWorking(
    worker: Worker,
    currentCommand: string,
    observation: PaneObservation,
    activity: ParsedActivity,
    activeClaudeTask: string | undefined,
    activityText: string | undefined,
    output: string
  ): boolean {
    const normalizedActivityText = (activityText ?? "").toLowerCase();
    if (normalizedActivityText.includes("waiting for your answer") || normalizedActivityText.includes("waiting for approval")) {
      return false;
    }

    const likelyClaudeSession = isLikelyClaudeSession(worker, currentCommand.toLowerCase());
    const hasClaudeProgressSignal = likelyClaudeSession && hasClaudeLiveProgressSignal(output);

    if (activity.needsInput && !hasClaudeProgressSignal) {
      return false;
    }

    if (likelyClaudeSession && (Boolean(activeClaudeTask) || hasClaudeProgressSignal)) {
      return true;
    }

    return this.shouldKeepWorkingFromHeartbeat(worker, currentCommand, observation, activity, activeClaudeTask, activityText, output);
  }

  private shouldForceIdleOnStaleClaudeProgress(
    worker: Worker,
    currentCommand: string,
    observation: PaneObservation,
    activityText: string | undefined
  ): boolean {
    if (!isLikelyClaudeSession(worker, currentCommand.toLowerCase())) {
      return false;
    }

    if (!activityText) {
      return false;
    }

    const normalized = activityText.trim();
    if (!normalized) {
      return false;
    }

    const looksLikeTransientProgress = isGenericClaudeProgressLabel(normalized) || /\bfor\s+\d+\s*[ms]\b/i.test(normalized);
    if (!looksLikeTransientProgress) {
      return false;
    }

    const outputQuietForMs = Date.now() - observation.lastOutputChangeAtMs;
    return outputQuietForMs > claudeStickyWorkingWindowMs;
  }
}

function outputSignature(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-40)
    .join("\n");
}

function extractClaudeActiveTask(output: string): string | undefined {
  const linesNewestFirst = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-120)
    .reverse();

  for (const line of linesNewestFirst) {
    const parentheticalMatch = line.match(/^(?:\*|•|·|✶|✻|✢|✽)\s+(.+?)\s+\((?:[^)]*(?:thinking|thought\s+for)[^)]*)\)\s*$/i);
    const plainProgressMatch = line.match(/^(?:\*|•|·|✶|✻|✢|✽)\s+(.+?)\s*$/);
    const task = parentheticalMatch?.[1]?.trim() ?? plainProgressMatch?.[1]?.trim();
    if (task) {
      if (isGenericClaudeProgressLabel(task)) {
        continue;
      }

      return task;
    }
  }

  return undefined;
}

function isLikelyClaudeSession(worker: Worker, commandLower: string): boolean {
  if (worker.runtimeId.toLowerCase().includes("claude")) {
    return true;
  }

  const runtimeBinary = worker.command[0]?.toLowerCase() ?? "";
  if (runtimeBinary.includes("claude")) {
    return true;
  }

  return commandLower.includes("claude");
}

function isLikelyOpenCodeSession(worker: Worker, commandLower: string): boolean {
  if (worker.runtimeId.toLowerCase().includes("opencode")) {
    return true;
  }

  const runtimeBinary = worker.command[0]?.toLowerCase() ?? "";
  if (runtimeBinary.includes("opencode")) {
    return true;
  }

  return commandLower.includes("opencode");
}

function hasActiveWorkActivityText(activityText: string | undefined): boolean {
  if (!activityText) {
    return false;
  }

  const normalized = activityText.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^(reading|editing|writing|running:?|searching|searched|subtask:|using|fetching|planning|responding|let me|fixing)/.test(normalized);
}

function hasWaitingActivityText(activityText: string | undefined): boolean {
  if (!activityText) {
    return false;
  }

  const normalized = activityText.trim().toLowerCase();
  return normalized.includes("waiting for your answer") || normalized.includes("waiting for approval");
}

function hasClaudeLiveProgressSignal(output: string): boolean {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-60);

  for (const line of lines) {
    const progressMatch = line.match(/^(?:\*|•|·|✶|✻|✢|✽)\s+(.+?)\s*$/);
    if (!progressMatch?.[1]) {
      continue;
    }

    const progressText = progressMatch[1].trim();
    if (!progressText) {
      continue;
    }

    if (!isGenericClaudeProgressLabel(progressText)) {
      return true;
    }

    if (/\bfor\s+\d+[ms]\b/i.test(progressText) || /\((?:[^)]*(?:thinking|thought\s+for)[^)]*)\)/i.test(line)) {
      return true;
    }
  }

  return false;
}

function isGenericClaudeProgressLabel(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/[.…]+$/, "")
    .toLowerCase();

  return /^(?:whirring|thinking|saut[eé]ed|churned|baked|accomplishing|conversation compacted)\b/.test(normalized);
}

function hasOpenCodePromptSignal(output: string): boolean {
  const lines = output
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0)
    .slice(-24);

  const hasVariantHint = lines.some((line) => line.includes("ctrl+t variants"));
  const hasCommandHint = lines.some((line) => line.includes("ctrl+p commands"));
  return hasVariantHint && hasCommandHint;
}

function hasOpenCodeActiveSignal(output: string): boolean {
  const lines = output
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0)
    .slice(-24);

  return lines.some((line) => line.includes("esc interrupt"));
}

function capturePaneLineCount(worker: Worker, commandLower: string): number {
  if (isLikelyOpenCodeSession(worker, commandLower)) {
    return openCodeCapturePaneLines;
  }

  if (isLikelyClaudeSession(worker, commandLower)) {
    return claudeCapturePaneLines;
  }

  return defaultCapturePaneLines;
}

function extractRuntimeActivityText(worker: Worker, currentCommand: string, output: string): string | undefined {
  const commandLower = currentCommand.toLowerCase();
  if (isLikelyClaudeSession(worker, commandLower)) {
    return extractClaudeRuntimeActivityText(output);
  }

  if (isLikelyOpenCodeSession(worker, commandLower)) {
    return extractOpenCodeRuntimeActivityText(output);
  }

  return undefined;
}

function extractClaudeRuntimeActivityText(output: string): string | undefined {
  const linesNewestFirst = recentLinesNewestFirst(output, 100);

  for (const line of linesNewestFirst) {
    const normalized = line.trim();
    const bulletActivity = extractClaudeBulletActivityText(normalized);
    if (bulletActivity) {
      return truncateActivityText(bulletActivity, 72);
    }
  }

  for (const line of linesNewestFirst) {
    const normalized = line.trim();
    if (/^✻\s+.+\bfor\s+\d+s\s*$/i.test(normalized)) {
      return "Thinking";
    }
  }

  return undefined;
}

function extractClaudeBulletActivityText(line: string): string | undefined {
  const bulletMatch = line.match(/^●\s+(.+)$/);
  if (!bulletMatch?.[1]) {
    return undefined;
  }

  let activityText = bulletMatch[1].replace(/\s+/g, " ").trim();
  if (!activityText) {
    return undefined;
  }

  if (/^Bash\(/i.test(activityText)) {
    return undefined;
  }

  activityText = activityText.replace(/\s*\(ctrl\+o to expand\)\s*$/i, "").trim();
  if (!activityText) {
    return undefined;
  }

  const updateMatch = activityText.match(/^Update\((.+)\)$/i);
  if (updateMatch?.[1]) {
    return `Editing ${updateMatch[1].trim()}`;
  }

  return activityText;
}

function extractOpenCodeRuntimeActivityText(output: string): string | undefined {
  const latestThinkingText = extractLatestOpenCodeThinkingActivity(output);
  if (latestThinkingText) {
    return latestThinkingText;
  }

  const linesNewestFirst = recentLinesNewestFirst(output, openCodeCapturePaneLines);
  let hasActiveSignal = false;

  for (const line of linesNewestFirst) {
    const normalized = normalizeOpenCodeRuntimeLine(line);
    if (!normalized) {
      continue;
    }

    const thinkingMatch = normalized.match(/\bThinking:\s+(.+)$/i);
    if (thinkingMatch?.[1]) {
      return `Thinking: ${truncateActivityText(thinkingMatch[1].trim(), 72)}`;
    }

    const patchedMatch = normalized.match(/^←\s+Patched\s+(.+)$/i);
    if (patchedMatch?.[1]) {
      return `Editing ${patchedMatch[1].trim()}`;
    }

    const commandMatch = normalized.match(/^\$\s+(.+)$/);
    if (commandMatch?.[1]) {
      return `Running ${summarizeCommand(commandMatch[1])}`;
    }

    const headerMatch = normalized.match(/^#\s+(.+)$/);
    if (headerMatch?.[1]) {
      return truncateActivityText(headerMatch[1], 52);
    }

    if (normalized.toLowerCase().includes("esc interrupt")) {
      hasActiveSignal = true;
    }
  }

  if (hasActiveSignal) {
    return "Responding";
  }

  return undefined;
}

function extractLatestOpenCodeThinkingActivity(output: string): string | undefined {
  const normalizedLines = output
    .split("\n")
    .slice(-openCodeCapturePaneLines)
    .map((line) => normalizeOpenCodeRuntimeLine(line));

  for (let index = normalizedLines.length - 1; index >= 0; index -= 1) {
    const line = normalizedLines[index];
    if (!line) {
      continue;
    }

    const thinkingMatch = line.match(/\bThinking:\s+(.+)$/i);
    if (!thinkingMatch?.[1]) {
      continue;
    }

    const fragments: string[] = [thinkingMatch[1].trim()];

    for (
      let continuationIndex = index + 1, continuationCount = 0;
      continuationIndex < normalizedLines.length && continuationCount < openCodeThinkingContinuationMaxLines;
      continuationIndex += 1
    ) {
      const continuation = normalizedLines[continuationIndex];
      if (!continuation || isOpenCodeRuntimeBoundaryLine(continuation)) {
        break;
      }

      fragments.push(continuation);
      continuationCount += 1;
    }

    const combined = fragments.join(" ").replace(/\s+/g, " ").trim();
    if (!combined) {
      return undefined;
    }

    return `Thinking: ${truncateActivityText(combined, 72)}`;
  }

  return undefined;
}

function isOpenCodeRuntimeBoundaryLine(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized.includes("ctrl+t variants") || normalized.includes("ctrl+p commands") || normalized.includes("tab agents")) {
    return true;
  }

  if (normalized.includes("esc interrupt")) {
    return true;
  }

  if (/^thinking:\s+/i.test(line)) {
    return true;
  }

  if (/^#\s+/.test(line)) {
    return true;
  }

  if (/^\$\s+/.test(line)) {
    return true;
  }

  if (/^←\s+patched\s+/i.test(line)) {
    return true;
  }

  if (/^▣\s+/.test(line) || /^build\s+gpt/i.test(line)) {
    return true;
  }

  return false;
}

function preferOpenCodeSpecificActivityText(previousActivityText: string | undefined, nextActivityText: string | undefined): string | undefined {
  if (!nextActivityText || nextActivityText.trim().toLowerCase() !== "responding") {
    return nextActivityText;
  }

  if (!previousActivityText) {
    return nextActivityText;
  }

  const previousThinkingMatch = previousActivityText.trim().match(/^Thinking:\s+(.+)$/i);
  if (previousThinkingMatch?.[1]) {
    return previousActivityText;
  }

  return nextActivityText;
}

function normalizeOpenCodeRuntimeLine(line: string): string {
  const normalized = line
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const withoutFrame = normalized.replace(/^[│┃]\s*/, "").trim();
  if (/^╹?▀+$/.test(withoutFrame)) {
    return "";
  }

  return withoutFrame;
}

function recentLinesNewestFirst(output: string, limit: number): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-limit)
    .reverse();
}

function summarizeCommand(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "command";
  }

  return truncateActivityText(compact, 46);
}

function truncateActivityText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return text.slice(0, Math.max(0, maxLength));
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
