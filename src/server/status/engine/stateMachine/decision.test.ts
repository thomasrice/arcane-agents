import { describe, expect, it } from "vitest";
import type { Worker } from "../../../../shared/types";
import type { WorkerStatusSignalContext } from "../types";
import { deriveWorkerStatusDecision } from "./decision";

function createWorker(status: Worker["status"] = "idle"): Worker {
  return {
    id: "worker-1",
    name: "worker-1",
    displayName: "Worker 1",
    projectId: "project-1",
    projectPath: "/tmp/project-1",
    runtimeId: "opencode",
    runtimeLabel: "OpenCode",
    command: ["opencode"],
    status,
    activityText: undefined,
    activityTool: undefined,
    activityPath: undefined,
    avatarType: "ranger",
    movementMode: "hold",
    position: { x: 120, y: 180 },
    tmuxRef: { session: "arcane-agents", window: "worker-1", pane: "%1" },
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z"
  };
}

function createContext(overrides: Partial<WorkerStatusSignalContext> = {}): WorkerStatusSignalContext {
  return {
    worker: createWorker(),
    nowMs: 1_000_000,
    currentCommand: "opencode",
    commandLower: "opencode",
    output: "",
    observation: {
      lastCommand: "opencode",
      lastCommandChangeAtMs: 999_000,
      lastOutputSignature: "sig",
      lastOutputChangeAtMs: 999_500
    },
    transcriptSnapshot: undefined,
    parsed: {
      status: "idle",
      activity: {
        text: undefined,
        tool: undefined,
        filePath: undefined,
        needsInput: false,
        hasError: false
      }
    },
    runtimeActivityText: undefined,
    activeClaudeTask: undefined,
    activeRuntimeProcess: undefined,
    hasClaudePromptSignal: false,
    hasClaudeProgressSignal: false,
    hasOpenCodePromptSignal: false,
    hasOpenCodeActiveSignal: false,
    hasCodexPromptSignal: false,
    hasCodexActiveSignal: false,
    isClaudeSession: false,
    isOpenCodeSession: false,
    isCodexSession: false,
    outputQuietForMs: 1_000,
    commandQuietForMs: 5_000,
    workerAgeMs: 30_000,
    interactiveCommands: new Set<string>(),
    ...overrides
  };
}

describe("deriveWorkerStatusDecision", () => {
  it("returns attention when transcript reports attention", () => {
    const decision = deriveWorkerStatusDecision(
      createContext({
        transcriptSnapshot: {
          status: "attention",
          activityText: "Waiting for confirmation",
          activityTool: "terminal"
        }
      })
    );

    expect(decision.status).toBe("attention");
    expect(decision.activityText).toBe("Waiting for confirmation");
    expect(decision.reasons[0]?.code).toBe("transcript-attention");
  });

  it("returns attention when parsed output requires user input", () => {
    const decision = deriveWorkerStatusDecision(
      createContext({
        parsed: {
          status: "attention",
          activity: {
            text: "Allow this action?",
            tool: "terminal",
            filePath: undefined,
            needsInput: true,
            hasError: false
          }
        }
      })
    );

    expect(decision.status).toBe("attention");
    expect(decision.activityText).toBe("Allow this action?");
    expect(decision.reasons[0]?.code).toBe("parser-input-prompt");
  });

  it("returns error for fatal parser signal on non-agent runtime", () => {
    const decision = deriveWorkerStatusDecision(
      createContext({
        currentCommand: "python",
        commandLower: "python",
        output: "Traceback (most recent call last):\nBoom",
        parsed: {
          status: "error",
          activity: {
            text: "Error",
            tool: "terminal",
            filePath: undefined,
            needsInput: false,
            hasError: true
          }
        },
        outputQuietForMs: 400
      })
    );

    expect(decision.status).toBe("error");
    expect(decision.reasons.some((reason) => reason.code === "parser-error-signal")).toBe(true);
  });

  it("returns working when strong transcript evidence is present", () => {
    const decision = deriveWorkerStatusDecision(
      createContext({
        transcriptSnapshot: {
          status: "working",
          activityText: "Reading src/app.ts",
          activityTool: "read",
          activityPath: "src/app.ts"
        },
        outputQuietForMs: 40_000
      })
    );

    expect(decision.status).toBe("working");
    expect(decision.activityText).toBe("Reading src/app.ts");
    expect(decision.reasons.some((reason) => reason.code === "transcript-working")).toBe(true);
  });

  it("returns idle for prompt-dominant OpenCode sessions", () => {
    const decision = deriveWorkerStatusDecision(
      createContext({
        isOpenCodeSession: true,
        hasOpenCodePromptSignal: true,
        hasOpenCodeActiveSignal: false
      })
    );

    expect(decision.status).toBe("idle");
    expect(decision.activityText).toBeUndefined();
    expect(decision.activityTool).toBeUndefined();
    expect(decision.reasons[0]?.code).toBe("opencode-prompt-idle");
  });

  it("returns idle for freshly spawned OpenCode sessions within grace window", () => {
    const decision = deriveWorkerStatusDecision(
      createContext({
        isOpenCodeSession: true,
        currentCommand: "opencode",
        commandLower: "opencode",
        hasOpenCodePromptSignal: false,
        hasOpenCodeActiveSignal: false,
        commandQuietForMs: 500,
        workerAgeMs: 2_000
      })
    );

    expect(decision.status).toBe("idle");
    expect(decision.reasons.some((r) => r.code === "opencode-spawn-grace-idle")).toBe(true);
  });

  it("returns attention for Codex approval prompts", () => {
    const decision = deriveWorkerStatusDecision(
      createContext({
        worker: {
          ...createWorker(),
          runtimeId: "codex",
          runtimeLabel: "Codex",
          command: ["codex"]
        },
        currentCommand: "bash",
        commandLower: "bash",
        runtimeActivityText: "Waiting for approval",
        hasCodexPromptSignal: true,
        hasCodexActiveSignal: false,
        isCodexSession: true
      })
    );

    expect(decision.status).toBe("attention");
    expect(decision.activityText).toBe("Waiting for approval");
    expect(decision.reasons[0]?.code).toBe("codex-approval-prompt");
  });

  it("returns working when a wrapped agent runtime process is active", () => {
    const decision = deriveWorkerStatusDecision(
      createContext({
        currentCommand: "bash",
        commandLower: "bash",
        activeRuntimeProcess: {
          pid: 42,
          runtime: "codex",
          command: "codex",
          args: "codex exec"
        },
        isCodexSession: true,
        outputQuietForMs: 45_000
      })
    );

    expect(decision.status).toBe("working");
    expect(decision.reasons.some((reason) => reason.code === "agent-runtime-child-process")).toBe(true);
  });

  it("returns idle when the Claude prompt is visible under a shell wrapper", () => {
    const decision = deriveWorkerStatusDecision(
      createContext({
        worker: {
          ...createWorker(),
          runtimeId: "claude",
          runtimeLabel: "Claude",
          command: ["claude"]
        },
        currentCommand: "bash",
        commandLower: "bash",
        isClaudeSession: true,
        hasClaudePromptSignal: true,
        activeRuntimeProcess: {
          pid: 42,
          runtime: "claude",
          command: "claude",
          args: "claude"
        },
        outputQuietForMs: 45_000
      })
    );

    expect(decision.status).toBe("idle");
    expect(decision.reasons[0]?.code).toBe("shell-command-idle");
  });
});
