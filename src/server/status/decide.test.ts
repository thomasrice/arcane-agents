import { describe, expect, it } from "vitest";
import type { ActivityTool, Worker } from "../../shared/types";
import type { AgentRuntimeProcess } from "./runtimes/runtimeProcess";
import type { ClaudeStatusSnapshot } from "./claudeTranscriptTracker";
import type { WorkerSignals } from "./collectSignals";
import type { ParsedActivity } from "./activityParser";
import type { RuntimeAdapter, RuntimeSignals } from "./runtimes/adapter";
import { claudeAdapter, codexAdapter, genericAdapter, openCodeAdapter } from "./runtimes/adapter";
import { decide, recentNormalizedLines, shouldSuppressShellHistorySignals, statusFreshnessWindowMs } from "./decide";

// Fixed clock. Every quiet-window offset below is expressed relative to it.
const NOW = 1_000_000;

interface Scenario {
  status?: Worker["status"];
  currentCommand?: string;
  output?: string;
  outputQuietForMs?: number;
  commandQuietForMs?: number;
  workerAgeMs?: number;
  runtime?: RuntimeAdapter;
  runtimeSignals?: Partial<RuntimeSignals>;
  transcriptSnapshot?: ClaudeStatusSnapshot;
  activeRuntimeProcess?: AgentRuntimeProcess;
  parsed?: Partial<ParsedActivity>;
  priorActivityText?: string;
  priorActivityTool?: ActivityTool;
  interactiveCommands?: ReadonlySet<string>;
  runtimeFreshnessWindowMs?: number;
}

function createWorker(scenario: Scenario): Worker {
  const workerAgeMs = scenario.workerAgeMs ?? 30_000;
  return {
    id: "worker-1",
    name: "worker-1",
    displayName: "Worker 1",
    projectId: "project-1",
    projectPath: "/tmp/project-1",
    runtimeId: "opencode",
    runtimeLabel: "OpenCode",
    command: ["opencode"],
    status: scenario.status ?? "idle",
    activityText: scenario.priorActivityText,
    activityTool: scenario.priorActivityTool,
    activityPath: undefined,
    avatarType: "ranger",
    movementMode: "hold",
    position: { x: 120, y: 180 },
    tmuxRef: { session: "arcane-agents", window: "worker-1", pane: "%1" },
    createdAt: new Date(NOW - workerAgeMs).toISOString(),
    updatedAt: new Date(NOW - workerAgeMs).toISOString()
  };
}

function createSignals(scenario: Scenario): WorkerSignals {
  const currentCommand = scenario.currentCommand ?? "opencode";
  const outputQuietForMs = scenario.outputQuietForMs ?? 1_000;
  const commandQuietForMs = scenario.commandQuietForMs ?? 5_000;
  return {
    currentCommand,
    commandLower: currentCommand.toLowerCase(),
    output: scenario.output ?? "",
    observation: {
      lastCommand: currentCommand,
      lastCommandChangeAtMs: NOW - commandQuietForMs,
      lastOutputSignature: "sig",
      lastOutputChangeAtMs: NOW - outputQuietForMs
    },
    transcriptSnapshot: scenario.transcriptSnapshot,
    parsed: {
      activity: {
        text: scenario.parsed?.text,
        tool: scenario.parsed?.tool,
        filePath: scenario.parsed?.filePath,
        needsInput: scenario.parsed?.needsInput ?? false,
        hasError: scenario.parsed?.hasError ?? false
      }
    },
    runtime: scenario.runtime ?? genericAdapter,
    runtimeSignals: {
      prompt: scenario.runtimeSignals?.prompt ?? false,
      active: scenario.runtimeSignals?.active ?? false,
      activityText: scenario.runtimeSignals?.activityText,
      activeTask: scenario.runtimeSignals?.activeTask,
      awaitingApproval: scenario.runtimeSignals?.awaitingApproval,
      awaitingInput: scenario.runtimeSignals?.awaitingInput
    },
    promptSignature: undefined,
    activeRuntimeProcess: scenario.activeRuntimeProcess,
    transcriptHealth: scenario.transcriptSnapshot ? "ok" : "absent",
    interactiveCommands: scenario.interactiveCommands ?? new Set<string>(),
    runtimeFreshnessWindowMs: scenario.runtimeFreshnessWindowMs,
    customStatusRule: undefined
  };
}

function run(scenario: Scenario) {
  return decide(createWorker(scenario), createSignals(scenario), NOW);
}

describe("decide", () => {
  it("returns attention when transcript reports attention", () => {
    const decision = run({
      transcriptSnapshot: {
        status: "attention",
        activityText: "Waiting for confirmation",
        activityTool: "terminal"
      }
    });

    expect(decision.status).toBe("attention");
    expect(decision.activityText).toBe("Waiting for confirmation");
    expect(decision.reasons[0]?.code).toBe("transcript-attention");
  });

  it("returns attention when parsed output requires user input", () => {
    const decision = run({
      parsed: { text: "Allow this action?", tool: "terminal", needsInput: true }
    });

    expect(decision.status).toBe("attention");
    expect(decision.activityText).toBe("Allow this action?");
    expect(decision.reasons[0]?.code).toBe("parser-input-prompt");
  });

  it("returns error for fatal parser signal on non-agent runtime", () => {
    const decision = run({
      currentCommand: "python",
      output: "Traceback (most recent call last):\nBoom",
      parsed: { text: "Error", tool: "terminal", hasError: true },
      outputQuietForMs: 400
    });

    expect(decision.status).toBe("error");
    expect(decision.reasons.some((reason) => reason.code === "parser-error-signal")).toBe(true);
  });

  it("returns working when strong transcript evidence is present", () => {
    const decision = run({
      transcriptSnapshot: {
        status: "working",
        activityText: "Reading src/app.ts",
        activityTool: "read",
        activityPath: "src/app.ts"
      },
      outputQuietForMs: 40_000
    });

    expect(decision.status).toBe("working");
    expect(decision.activityText).toBe("Reading src/app.ts");
    expect(decision.reasons.some((reason) => reason.code === "transcript-working")).toBe(true);
  });

  it("returns idle for prompt-dominant OpenCode sessions", () => {
    const decision = run({
      runtime: openCodeAdapter,
      runtimeSignals: { prompt: true, active: false }
    });

    expect(decision.status).toBe("idle");
    expect(decision.activityText).toBeUndefined();
    expect(decision.activityTool).toBeUndefined();
    expect(decision.reasons[0]?.code).toBe("opencode-prompt-idle");
  });

  it("returns idle for freshly spawned OpenCode sessions within grace window", () => {
    const decision = run({
      runtime: openCodeAdapter,
      currentCommand: "opencode",
      runtimeSignals: { prompt: false, active: false },
      commandQuietForMs: 500,
      workerAgeMs: 2_000
    });

    expect(decision.status).toBe("idle");
    expect(decision.reasons.some((r) => r.code === "opencode-spawn-grace-idle")).toBe(true);
  });

  it("returns attention for Codex approval prompts", () => {
    const decision = run({
      runtime: codexAdapter,
      currentCommand: "bash",
      // `awaitingApproval` marks the parked codex prompt as a genuine approval
      // (vs the ordinary at-rest input prompt, which only classifies the pane).
      runtimeSignals: { prompt: true, active: false, awaitingApproval: true, activityText: "Waiting for approval" }
    });

    expect(decision.status).toBe("attention");
    expect(decision.activityText).toBe("Waiting for approval");
    expect(decision.reasons[0]?.code).toBe("codex-approval-prompt");
  });

  it("returns working when a wrapped agent runtime process is active", () => {
    const decision = run({
      runtime: codexAdapter,
      currentCommand: "bash",
      activeRuntimeProcess: {
        pid: 42,
        runtime: "codex",
        command: "codex",
        args: "codex exec"
      },
      outputQuietForMs: 45_000
    });

    expect(decision.status).toBe("working");
    expect(decision.reasons.some((reason) => reason.code === "agent-runtime-child-process")).toBe(true);
  });

  it("returns idle when the Claude prompt is visible under a shell wrapper", () => {
    const decision = run({
      runtime: claudeAdapter,
      currentCommand: "bash",
      runtimeSignals: { prompt: true, active: false },
      activeRuntimeProcess: {
        pid: 42,
        runtime: "claude",
        command: "claude",
        args: "claude"
      },
      outputQuietForMs: 45_000
    });

    expect(decision.status).toBe("idle");
    expect(decision.reasons[0]?.code).toBe("shell-command-idle");
  });
});

describe("decide helpers", () => {
  it("normalizes and returns the latest non-empty lines", () => {
    expect(recentNormalizedLines("  One\n\n Two  \nTHREE\n", 2)).toEqual(["two", "three"]);
  });

  it("suppresses shell-history signals for non-agent interactive shells", () => {
    expect(shouldSuppressShellHistorySignals("bash", genericAdapter, new Set<string>())).toBe(true);
    expect(shouldSuppressShellHistorySignals("bash", openCodeAdapter, new Set<string>())).toBe(false);
  });

  it("prefers an explicit runtime freshness override over the adapter default", () => {
    expect(statusFreshnessWindowMs(genericAdapter, 45_000)).toBe(45_000);
    expect(statusFreshnessWindowMs(claudeAdapter, 30_000)).toBe(30_000);
    expect(statusFreshnessWindowMs(claudeAdapter, undefined)).toBe(claudeAdapter.freshnessWindowMs);
  });

});
