import type { Worker } from "../../../../shared/types";
import { detectIdleBlocker } from "./idleBlockers";
import { classifyParserError } from "./parserErrorRules";
import { resolveWorkingActivity } from "./activity";
import { collectWorkingEvidence, shouldKeepStickyWorking } from "./workingEvidence";
import { statusFreshnessWindowMs } from "./helpers";
import { commandWarmupWindowMs } from "./constants";
import type { StatusReason, WorkerStatusDecision, WorkerStatusSignalContext } from "../types";

function deriveWorkerStatusDecision(context: WorkerStatusSignalContext): WorkerStatusDecision {
  const reasons: StatusReason[] = [];

  const pushReason = (reason: StatusReason): void => {
    reasons.push(reason);
  };

  const transcriptStatus = context.transcriptSnapshot?.status;

  if (transcriptStatus === "attention") {
    pushReason({ code: "transcript-attention", message: "Transcript reports attention." });
    const activityText = context.transcriptSnapshot?.activityText ?? "Waiting for input";
    return finalizeDecision(
      context,
      {
        status: "attention",
        activityText,
        activityTool: context.transcriptSnapshot?.activityTool ?? "terminal",
        activityPath: context.transcriptSnapshot?.activityPath,
        confidence: 0.96,
        reasons,
        parsedStrongSignal: false
      }
    );
  }

  if (context.parsed.activity.needsInput) {
    pushReason({ code: "parser-input-prompt", message: "Terminal output indicates input is required." });
    return finalizeDecision(
      context,
      {
        status: "attention",
        activityText: context.parsed.activity.text ?? "Waiting for input",
        activityTool: context.parsed.activity.tool ?? "terminal",
        activityPath: context.parsed.activity.filePath,
        confidence: 0.9,
        reasons,
        parsedStrongSignal: false
      }
    );
  }

  if (transcriptStatus === "error") {
    pushReason({ code: "transcript-error", message: "Transcript reports error." });
    return finalizeDecision(
      context,
      {
        status: "error",
        activityText: context.transcriptSnapshot?.activityText ?? "Error",
        activityTool: context.transcriptSnapshot?.activityTool ?? "terminal",
        activityPath: context.transcriptSnapshot?.activityPath,
        confidence: 0.92,
        reasons,
        parsedStrongSignal: false
      }
    );
  }

  const parserErrorClassification = classifyParserError(context);
  if (parserErrorClassification === "fatal" && transcriptStatus !== "working") {
    pushReason({
      code: "parser-error-signal",
      message: "Recent fatal error pattern detected in terminal output.",
      detail: `${Math.round(context.outputQuietForMs)}ms since output change`
    });
    return finalizeDecision(
      context,
      {
        status: "error",
        activityText: context.parsed.activity.text ?? "Error",
        activityTool: context.parsed.activity.tool ?? "terminal",
        activityPath: context.parsed.activity.filePath,
        confidence: 0.87,
        reasons,
        parsedStrongSignal: false
      }
    );
  }

  if (parserErrorClassification === "recoverable") {
    pushReason({
      code: "parser-recoverable-error",
      message: "Tool-level error detected but considered recoverable.",
      detail: `${Math.round(context.outputQuietForMs)}ms since output change`
    });
  }

  const evidence = collectWorkingEvidence(context, parserErrorClassification === "recoverable");
  const idleBlocker = detectIdleBlocker(context, evidence);
  if (idleBlocker) {
    pushReason(idleBlocker.reason);
    return finalizeDecision(
      context,
      {
        status: "idle",
        activityText: undefined,
        activityTool: undefined,
        activityPath: undefined,
        confidence: 0.86,
        reasons,
        parsedStrongSignal: evidence.parsedStrongSignal
      }
    );
  }

  if (evidence.strongReasons.length > 0) {
    for (const reason of evidence.strongReasons) {
      pushReason(reason);
    }

    const workingActivity = resolveWorkingActivity(context, evidence);
    return finalizeDecision(
      context,
      {
        status: "working",
        activityText: workingActivity.activityText,
        activityTool: workingActivity.activityTool,
        activityPath: workingActivity.activityPath,
        confidence: 0.88,
        reasons,
        parsedStrongSignal: evidence.parsedStrongSignal
      }
    );
  }

  if (shouldKeepStickyWorking(context, evidence)) {
    pushReason({
      code: "sticky-working-window",
      message: "Keeps working status during a short stabilization window.",
      detail: `${Math.round(context.outputQuietForMs)}ms quiet`
    });

    const workingActivity = resolveWorkingActivity(context, evidence);
    return finalizeDecision(
      context,
      {
        status: "working",
        activityText: workingActivity.activityText,
        activityTool: workingActivity.activityTool,
        activityPath: workingActivity.activityPath,
        confidence: 0.66,
        reasons,
        parsedStrongSignal: evidence.parsedStrongSignal
      }
    );
  }

  if (
    context.worker.status === "working" &&
    evidence.weakReasons.length > 0 &&
    context.outputQuietForMs <= statusFreshnessWindowMs(context)
  ) {
    for (const reason of evidence.weakReasons) {
      pushReason(reason);
    }

    pushReason({
      code: "working-evidence-window",
      message: "Keeps working status while weak evidence remains within freshness window.",
      detail: `${Math.round(context.outputQuietForMs)}ms quiet`
    });

    const workingActivity = resolveWorkingActivity(context, evidence);
    return finalizeDecision(
      context,
      {
        status: "working",
        activityText: workingActivity.activityText,
        activityTool: workingActivity.activityTool,
        activityPath: workingActivity.activityPath,
        confidence: 0.62,
        reasons,
        parsedStrongSignal: evidence.parsedStrongSignal
      }
    );
  }

  if (evidence.weakReasons.length > 0) {
    for (const reason of evidence.weakReasons) {
      pushReason(reason);
    }

    if (context.commandQuietForMs <= commandWarmupWindowMs) {
      const workingActivity = resolveWorkingActivity(context, evidence);
      return finalizeDecision(
        context,
        {
          status: "working",
          activityText: workingActivity.activityText,
          activityTool: workingActivity.activityTool,
          activityPath: workingActivity.activityPath,
          confidence: 0.56,
          reasons,
          parsedStrongSignal: evidence.parsedStrongSignal
        }
      );
    }
  }

  pushReason({ code: "no-active-evidence", message: "No active work evidence remained within freshness windows." });
  return finalizeDecision(
    context,
    {
      status: "idle",
      activityText: undefined,
      activityTool: undefined,
      activityPath: undefined,
      confidence: 0.74,
      reasons,
      parsedStrongSignal: evidence.parsedStrongSignal
    }
  );
}

function finalizeDecision(
  context: WorkerStatusSignalContext,
  partial: {
    status: Worker["status"];
    activityText: Worker["activityText"];
    activityTool: Worker["activityTool"];
    activityPath: Worker["activityPath"];
    confidence: number;
    reasons: StatusReason[];
    parsedStrongSignal: boolean;
  }
): WorkerStatusDecision {
  return {
    status: partial.status,
    activityText: partial.status === "idle" ? undefined : partial.activityText,
    activityTool: partial.status === "idle" ? undefined : partial.activityTool,
    activityPath: partial.status === "idle" ? undefined : partial.activityPath,
    confidence: partial.confidence,
    reasons: partial.reasons.length > 0 ? partial.reasons : [{ code: "no-reason", message: "No explicit reason captured." }],
    facts: {
      command: context.currentCommand,
      commandQuietForMs: context.commandQuietForMs,
      outputQuietForMs: context.outputQuietForMs,
      workerAgeMs: context.workerAgeMs,
      isClaudeSession: context.isClaudeSession,
      isOpenCodeSession: context.isOpenCodeSession,
      hasOpenCodePromptSignal: context.hasOpenCodePromptSignal,
      hasOpenCodeActiveSignal: context.hasOpenCodeActiveSignal,
      hasClaudeProgressSignal: context.hasClaudeProgressSignal,
      hasActiveClaudeTask: Boolean(context.activeClaudeTask),
      hasRuntimeActivityText: Boolean(context.runtimeActivityText),
      hasParsedStrongSignal: partial.parsedStrongSignal,
      hasParsedNeedsInput: context.parsed.activity.needsInput,
      hasParsedError: context.parsed.activity.hasError
    }
  };
}

export { deriveWorkerStatusDecision };
