import { describe, expect, it } from "vitest";
import type { Worker } from "../../../../shared/types";
import type { WorkerStatusSignalContext } from "../types";
import type { WorkingEvidence } from "./types";
import {
  firstDefined,
  hasAnyWorkingEvidence,
  looksLikeActiveRuntimeText,
  pushMaybe,
  recentNormalizedLines,
  shouldSuppressShellHistorySignals,
  statusFreshnessWindowMs
} from "./helpers";

function createWorker(status: Worker["status"] = "idle"): Worker {
  return {
    id: "worker-1",
    name: "worker-1",
    displayName: "Worker 1",
    projectId: "project-1",
    projectPath: "/tmp/project-1",
    runtimeId: "shell",
    runtimeLabel: "Shell",
    command: ["bash"],
    status,
    activityText: undefined,
    activityTool: undefined,
    activityPath: undefined,
    avatarType: "wizard",
    movementMode: "hold",
    position: { x: 100, y: 100 },
    tmuxRef: { session: "arcane-agents", window: "w1", pane: "%1" },
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z"
  };
}

function createContext(overrides: Partial<WorkerStatusSignalContext> = {}): WorkerStatusSignalContext {
  return {
    worker: createWorker(),
    nowMs: 1_000_000,
    currentCommand: "bash",
    commandLower: "bash",
    output: "user@host:~$",
    observation: {
      lastCommand: "bash",
      lastCommandChangeAtMs: 999_500,
      lastOutputSignature: "sig",
      lastOutputChangeAtMs: 999_800
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
    hasClaudeProgressSignal: false,
    hasOpenCodePromptSignal: false,
    hasOpenCodeActiveSignal: false,
    isClaudeSession: false,
    isOpenCodeSession: false,
    outputQuietForMs: 200,
    commandQuietForMs: 300,
    workerAgeMs: 10_000,
    interactiveCommands: new Set<string>(),
    ...overrides
  };
}

describe("state machine helpers", () => {
  it("normalizes and returns the latest non-empty lines", () => {
    expect(recentNormalizedLines("  One\n\n Two  \nTHREE\n", 2)).toEqual(["two", "three"]);
  });

  it("suppresses shell-history signals for non-agent interactive shells", () => {
    const shellContext = createContext({
      commandLower: "bash",
      isClaudeSession: false,
      isOpenCodeSession: false,
      output: "prompt\nuser@host:~/repo$"
    });
    expect(shouldSuppressShellHistorySignals(shellContext)).toBe(true);

    const opencodeContext = createContext({
      commandLower: "bash",
      isOpenCodeSession: true,
      output: "prompt\nuser@host:~/repo$"
    });
    expect(shouldSuppressShellHistorySignals(opencodeContext)).toBe(false);
  });

  it("recognizes active runtime text and ignores waiting text", () => {
    expect(looksLikeActiveRuntimeText("Reading src/index.ts")).toBe(true);
    expect(looksLikeActiveRuntimeText("Waiting for approval")).toBe(false);
  });

  it("returns freshness windows by runtime session", () => {
    expect(statusFreshnessWindowMs(createContext({ isClaudeSession: true }))).toBe(10_000);
    expect(statusFreshnessWindowMs(createContext({ isOpenCodeSession: true }))).toBe(12_000);
    expect(statusFreshnessWindowMs(createContext())).toBe(12_000);
  });

  it("handles helper utility behavior", () => {
    const values: string[] = [];
    pushMaybe(values, "   ");
    pushMaybe(values, "  value  ");
    expect(values).toEqual(["value"]);

    expect(firstDefined(undefined, undefined, "chosen", "fallback")).toBe("chosen");
    expect(firstDefined(undefined, undefined)).toBeUndefined();

    const evidence: WorkingEvidence = {
      strongReasons: [],
      weakReasons: [{ code: "weak", message: "weak signal" }],
      activityTextCandidates: [],
      activityToolCandidates: [],
      activityPathCandidates: [],
      parsedStrongSignal: false
    };
    expect(hasAnyWorkingEvidence(evidence)).toBe(true);
  });
});
