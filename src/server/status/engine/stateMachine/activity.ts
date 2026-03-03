import type { Worker } from "../../../../shared/types";
import type { WorkerStatusDecision, WorkerStatusSignalContext } from "../types";
import { preferOpenCodeSpecificActivityText } from "../../runtimeSignals";
import { firstDefined } from "./helpers";
import type { WorkingEvidence } from "./types";

function resolveWorkingActivity(
  context: WorkerStatusSignalContext,
  evidence: WorkingEvidence
): Pick<WorkerStatusDecision, "activityText" | "activityTool" | "activityPath"> {
  const fallbackText = firstDefined(
    ...evidence.activityTextCandidates,
    context.transcriptSnapshot?.activityText,
    context.runtimeActivityText,
    context.activeClaudeTask,
    context.parsed.activity.text,
    context.worker.activityText
  );

  const activityText = context.isOpenCodeSession
    ? preferOpenCodeSpecificActivityText(context.worker.activityText, fallbackText)
    : fallbackText;

  const activityTool = firstDefined<Worker["activityTool"]>(
    ...evidence.activityToolCandidates,
    context.transcriptSnapshot?.activityTool,
    context.parsed.activity.tool,
    context.worker.activityTool,
    "terminal"
  );

  const activityPath = firstDefined(
    ...evidence.activityPathCandidates,
    context.transcriptSnapshot?.activityPath,
    context.parsed.activity.filePath
  );

  return {
    activityText: activityText ?? "Working",
    activityTool,
    activityPath
  };
}

export { resolveWorkingActivity };
