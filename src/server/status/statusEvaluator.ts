import type { Worker } from "../../shared/types";
import { parseActivity } from "./activityParser";
import type { ClaudeStatusSnapshot } from "./claudeTranscriptTracker";
import type { PaneObservation } from "./paneObservation";
import {
  resolveFallbackStatus,
  shouldDowngradeAttentionToWorking,
  shouldForceIdleOnOpenCodePrompt,
  shouldForceIdleOnStaleClaudeProgress,
  shouldKeepWorkingFromHeartbeat,
  shouldPromoteIdleFromActiveClaudeTask,
  shouldTreatAsSpawnGraceIdle
} from "./statusHeuristics";
import {
  extractClaudeActiveTask,
  extractRuntimeActivityText,
  hasClaudeLiveProgressSignal,
  isLikelyClaudeSession,
  isLikelyOpenCodeSession,
  preferOpenCodeSpecificActivityText
} from "./runtimeSignals";

interface EvaluateWorkerStatusInput {
  worker: Worker;
  currentCommand: string;
  output: string;
  observation: PaneObservation;
  transcriptSnapshot: ClaudeStatusSnapshot | undefined;
}

interface EvaluatedWorkerStatus {
  status: Worker["status"];
  activityText: string | undefined;
  activityTool: Worker["activityTool"];
  activityPath: string | undefined;
}

export function evaluateWorkerStatus({
  worker,
  currentCommand,
  output,
  observation,
  transcriptSnapshot
}: EvaluateWorkerStatusInput): EvaluatedWorkerStatus {
  let derivedStatus = worker.status;
  let derivedActivityText = worker.activityText;
  let derivedActivityTool = worker.activityTool;
  let derivedActivityPath = worker.activityPath;

  const parsed = parseActivity(currentCommand, output);
  const commandLower = currentCommand.toLowerCase();
  const activeClaudeTask = extractClaudeActiveTask(output);
  const runtimeActivityText = extractRuntimeActivityText(worker, currentCommand, output);

  if (transcriptSnapshot) {
    derivedStatus = transcriptSnapshot.status;
    derivedActivityText = transcriptSnapshot.activityText ?? runtimeActivityText ?? parsed.activity.text;
    derivedActivityTool = transcriptSnapshot.activityTool ?? parsed.activity.tool;
    derivedActivityPath = transcriptSnapshot.activityPath ?? parsed.activity.filePath;

    if (derivedStatus === "idle" && shouldPromoteIdleFromActiveClaudeTask(worker, currentCommand, observation, activeClaudeTask)) {
      derivedStatus = "working";
      derivedActivityText = activeClaudeTask;
      derivedActivityTool = "terminal";
      derivedActivityPath = undefined;
    }
  } else {
    derivedStatus = resolveFallbackStatus(parsed.status, currentCommand, observation, parsed.activity);
    const hasClaudeProgressSignal = isLikelyClaudeSession(worker, commandLower) && hasClaudeLiveProgressSignal(output);
    if (isLikelyClaudeSession(worker, commandLower) && !activeClaudeTask && !hasClaudeProgressSignal) {
      derivedStatus = parsed.activity.needsInput ? "attention" : "idle";
    }

    if (derivedStatus === "idle" && shouldPromoteIdleFromActiveClaudeTask(worker, currentCommand, observation, activeClaudeTask)) {
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

  if (derivedStatus === "working" && shouldTreatAsSpawnGraceIdle(worker, currentCommand, parsed.activity, activeClaudeTask)) {
    derivedStatus = "idle";
    derivedActivityText = undefined;
    derivedActivityTool = undefined;
    derivedActivityPath = undefined;
  }

  if ((derivedStatus === "working" || derivedStatus === "error") && shouldForceIdleOnOpenCodePrompt(worker, currentCommand, output, parsed.activity)) {
    derivedStatus = "idle";
    derivedActivityText = undefined;
    derivedActivityTool = undefined;
    derivedActivityPath = undefined;
  }

  if (
    derivedStatus === "idle" &&
    shouldKeepWorkingFromHeartbeat(
      worker,
      currentCommand,
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
    shouldDowngradeAttentionToWorking(
      worker,
      currentCommand,
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

  if (derivedStatus === "working" && shouldForceIdleOnStaleClaudeProgress(worker, currentCommand, observation, derivedActivityText)) {
    derivedStatus = "idle";
    derivedActivityText = undefined;
    derivedActivityTool = undefined;
    derivedActivityPath = undefined;
  }

  if (derivedStatus === "working" && isLikelyOpenCodeSession(worker, commandLower)) {
    derivedActivityText = preferOpenCodeSpecificActivityText(worker.activityText, derivedActivityText);
  }

  if (derivedStatus === "idle") {
    derivedActivityText = undefined;
    derivedActivityTool = undefined;
    derivedActivityPath = undefined;
  }

  return {
    status: derivedStatus,
    activityText: derivedActivityText,
    activityTool: derivedActivityTool,
    activityPath: derivedActivityPath
  };
}
