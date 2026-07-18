import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Worker } from "../../shared/types";
import type { ClaudeStatusSnapshot } from "./claudeTranscriptTracker";
import type { PaneObservation } from "./paneObservation";
import type { AgentRuntimeProcess } from "./runtimes/runtimeProcess";
import { evaluateWorkerStatus } from "./decide";

/**
 * End-to-end safety net for the status decision path:
 *
 *   raw pane-capture text + hand-built PaneObservation
 *     -> evaluateWorkerStatus
 *       -> buildWorkerStatusSignalContext (runs per-runtime signal detectors)
 *         -> deriveWorkerStatusDecision
 *     -> { status, reasons }
 *
 * A Phase 2 refactor will collapse these layers into a RuntimeAdapter design
 * (see plan.md, "Phase 2 — Status subsystem rebuild"). These tests pin the
 * CURRENT observable behaviour so that refactor is provably behaviour-preserving
 * except where it deliberately flips a case.
 *
 * The owner's #1 pain point is false "working" and false "idle". Where the code
 * today produces a status we believe is WRONG, the case is asserted as-is and
 * flagged with:
 *
 *   // pins current behaviour — known false-working case, see plan.md
 *
 * so Phase 2 (plan.md line ~109: "demote generic-parser matches to weak evidence
 * for known agent runtimes") can flip it deliberately and update the assertion.
 *
 * Time: evaluateWorkerStatus reads Date.now() internally. We freeze the clock
 * with fake timers and express every observation timestamp as an offset from
 * that fixed "now", so outputQuietForMs / commandQuietForMs / workerAgeMs are
 * deterministic. We assert reason CODES only, never prose.
 */

// Fixed wall clock for every test. Offsets below are relative to this instant.
const FIXED_NOW_MS = Date.UTC(2026, 6, 18, 3, 0, 0);

// These mirror engine/stateMachine/constants.ts. They are load-bearing here only
// as the *boundaries where observable status flips* — that flip is the contract
// under test, not the literal numbers.
const PARSED_STRONG_WINDOW_MS = 8_000; // parsedStrongEvidenceWindowMs
const CLAUDE_FRESH_WINDOW_MS = 10_000; // claudeWorkingFreshWindowMs

type RuntimeKind = "claude" | "codex" | "opencode" | "shell";

const runtimeDefaults: Record<RuntimeKind, { runtimeId: string; runtimeLabel: string; command: string[]; currentCommand: string }> = {
  claude: { runtimeId: "claude", runtimeLabel: "Claude", command: ["claude"], currentCommand: "claude" },
  codex: { runtimeId: "codex", runtimeLabel: "Codex", command: ["codex"], currentCommand: "codex" },
  opencode: { runtimeId: "opencode", runtimeLabel: "OpenCode", command: ["opencode"], currentCommand: "opencode" },
  shell: { runtimeId: "shell", runtimeLabel: "Shell", command: ["bash"], currentCommand: "bash" }
};

interface EvaluateOptions {
  runtime: RuntimeKind;
  output: string;
  /** ms since the pane output last changed (drives outputQuietForMs). */
  outputQuietForMs?: number;
  /** ms since the foreground command last changed (drives commandQuietForMs). */
  commandQuietForMs?: number;
  /** ms since the worker was created (drives spawn-grace windows). */
  workerAgeMs?: number;
  /** Prior status the worker is transitioning from. */
  priorStatus?: Worker["status"];
  /** Overrides the derived foreground command; defaults to the runtime's binary. */
  currentCommand?: string;
  priorActivityText?: string;
  transcriptSnapshot?: ClaudeStatusSnapshot;
  runtimeProcess?: AgentRuntimeProcess;
  interactiveCommands?: ReadonlySet<string>;
  runtimeFreshnessWindowMs?: number;
}

function makeWorker(runtime: RuntimeKind, opts: EvaluateOptions): Worker {
  const defaults = runtimeDefaults[runtime];
  const workerAgeMs = opts.workerAgeMs ?? 3_600_000; // 1h old: past every spawn-grace window by default
  return {
    id: "worker-1",
    name: "worker-1",
    displayName: "Worker 1",
    projectId: "project-1",
    projectPath: "/tmp/project-1",
    runtimeId: defaults.runtimeId,
    runtimeLabel: defaults.runtimeLabel,
    command: defaults.command,
    status: opts.priorStatus ?? "idle",
    activityText: opts.priorActivityText,
    activityTool: undefined,
    activityPath: undefined,
    avatarType: "ranger",
    movementMode: "hold",
    position: { x: 0, y: 0 },
    tmuxRef: { session: "arcane-agents", window: "worker-1", pane: "%1" },
    createdAt: new Date(FIXED_NOW_MS - workerAgeMs).toISOString(),
    updatedAt: new Date(FIXED_NOW_MS - workerAgeMs).toISOString()
  };
}

function makeObservation(command: string, opts: EvaluateOptions): PaneObservation {
  // Default: command settled long ago, output fresh — so a test only opts into
  // whatever quiet window it cares about.
  const outputQuietForMs = opts.outputQuietForMs ?? 1_500;
  const commandQuietForMs = opts.commandQuietForMs ?? 60_000;
  return {
    lastCommand: command,
    lastCommandChangeAtMs: FIXED_NOW_MS - commandQuietForMs,
    lastOutputSignature: "signature",
    lastOutputChangeAtMs: FIXED_NOW_MS - outputQuietForMs
  };
}

function evaluate(opts: EvaluateOptions) {
  const currentCommand = opts.currentCommand ?? runtimeDefaults[opts.runtime].currentCommand;
  const worker = makeWorker(opts.runtime, opts);
  const observation = makeObservation(currentCommand, opts);
  return evaluateWorkerStatus({
    worker,
    currentCommand,
    output: opts.output,
    observation,
    transcriptSnapshot: opts.transcriptSnapshot,
    runtimeProcess: opts.runtimeProcess,
    interactiveCommands: opts.interactiveCommands ?? new Set<string>(),
    runtimeFreshnessWindowMs: opts.runtimeFreshnessWindowMs
  });
}

function reasonCodes(result: ReturnType<typeof evaluate>): string[] {
  return result.reasons.map((reason) => reason.code);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

describe("status decision — Claude runtime", () => {
  it("reads an active progress spinner as working", () => {
    // Live Claude turn: a tool bullet plus a fresh progress line, no prompt.
    const output = [
      "● Update(src/server/status/engine/decision.ts)",
      "  ⎿ Updated 3 lines",
      "",
      "✶ Wiring up the new decision path"
    ].join("\n");

    const result = evaluate({ runtime: "claude", output, outputQuietForMs: 1_500 });

    expect(result.status).toBe("working");
    // Either the live progress signal or the extracted active task counts as strong.
    expect(reasonCodes(result).some((code) => code === "claude-progress-signal" || code === "claude-active-task")).toBe(true);
  });

  it("reads a finished prompt with stale output as idle even though scrollback mentions Read/git", () => {
    // Claude has returned to its prompt; output has been quiet past the freshness
    // window. Scrollback still shows tool words, which must NOT keep it working.
    const output = [
      "● Read src/app.ts",
      "  ⎿ Read 40 lines",
      "● Bash(git status)",
      "  ⎿ On branch main",
      "",
      "Done — the changes are committed.",
      "",
      "❯"
    ].join("\n");

    const result = evaluate({ runtime: "claude", output, outputQuietForMs: 15_000 });

    expect(result.status).toBe("idle");
    expect(result.activityText).toBeUndefined();
    expect(reasonCodes(result)).toContain("output-stale-idle");
  });

  it("reads a finished Claude as idle even while scrollback tool words are still fresh", () => {
    // Fixed (plan A6 / Phase 2b): the generic parser no longer promotes scrollback
    // tool/path words to working evidence for an agent runtime. Same finished pane
    // as above, but output changed <8s ago (a fresh repaint). With no native active
    // signal (no transcript, no ✻ progress spinner, no active task), a *finished*
    // Claude now correctly reads idle instead of false-working on the "Read
    // src/app.ts" scrollback.
    const output = [
      "● Read src/app.ts",
      "  ⎿ Read 40 lines",
      "● Bash(git status)",
      "  ⎿ On branch main",
      "",
      "Done — the changes are committed.",
      "",
      "❯"
    ].join("\n");

    const result = evaluate({ runtime: "claude", output, outputQuietForMs: 3_000, priorStatus: "idle" });

    expect(result.status).toBe("idle");
    expect(result.activityText).toBeUndefined();
    expect(reasonCodes(result)).toContain("no-active-evidence");
  });

  it("reads a permission-required approval dialog as attention", () => {
    const output = [
      "● Edit(src/app.ts)",
      "",
      " Permission required",
      "",
      " Claude needs your permission to edit src/app.ts",
      "",
      " ❯ 1. Allow once",
      "   2. Allow always",
      "   3. Reject"
    ].join("\n");

    const result = evaluate({ runtime: "claude", output, outputQuietForMs: 2_000 });

    expect(result.status).toBe("attention");
    expect(reasonCodes(result)).toContain("parser-input-prompt");
  });

  it("reads the bypass-permissions footer at a quiet prompt as idle, not attention", () => {
    // pins current behaviour — the bypass-permissions mode footer is a *prompt*
    // signal, not an approval request. It never routes to attention on its own;
    // with quiet output it settles to idle.
    const output = [
      "I've finished reviewing the file. Everything looks good.",
      "",
      "❯",
      "  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)"
    ].join("\n");

    const result = evaluate({ runtime: "claude", output, outputQuietForMs: 15_000 });

    expect(result.status).toBe("idle");
    expect(result.status).not.toBe("attention");
    expect(reasonCodes(result)).toContain("output-stale-idle");
  });

  it("holds a just-spawned Claude with no output at idle during the spawn grace window", () => {
    const result = evaluate({
      runtime: "claude",
      output: "",
      outputQuietForMs: 30_000,
      commandQuietForMs: 30_000,
      workerAgeMs: 2_000
    });

    expect(result.status).toBe("idle");
    expect(reasonCodes(result)).toContain("claude-spawn-grace-idle");
  });

  it("reads a fatal traceback in the pane as error", () => {
    const output = [
      "● Bash(python script.py)",
      "",
      "Traceback (most recent call last):",
      '  File "script.py", line 3, in <module>',
      "    x = 1 / 0",
      "ZeroDivisionError: division by zero"
    ].join("\n");

    const result = evaluate({ runtime: "claude", output, outputQuietForMs: 1_500 });

    expect(result.status).toBe("error");
    expect(reasonCodes(result)).toContain("parser-error-signal");
  });

  it("lets a busy transcript snapshot override an idle-looking pane (guards against false idle)", () => {
    // Pane shows a bare prompt and stale output, but the transcript tracker knows
    // Claude is mid-edit. Transcript-working wins.
    const output = ["Waiting…", "", "❯"].join("\n");

    const result = evaluate({
      runtime: "claude",
      output,
      outputQuietForMs: 30_000,
      transcriptSnapshot: {
        status: "working",
        activityText: "Editing src/app.ts",
        activityTool: "edit",
        activityPath: "src/app.ts"
      }
    });

    expect(result.status).toBe("working");
    expect(reasonCodes(result)).toContain("transcript-working");
  });

  it("lets an idle transcript snapshot suppress fresh scrollback tool words (prevents false working)", () => {
    // Identical pane to the fresh false-working case, but the transcript says idle.
    // The transcript guard zeroes the scrollback tool/path signal, so it reads idle.
    const output = [
      "● Read src/app.ts",
      "  ⎿ Read 40 lines",
      "● Bash(git status)",
      "  ⎿ On branch main",
      "",
      "Done — the changes are committed.",
      "",
      "❯"
    ].join("\n");

    const result = evaluate({
      runtime: "claude",
      output,
      outputQuietForMs: 3_000,
      transcriptSnapshot: { status: "idle" }
    });

    expect(result.status).toBe("idle");
    expect(result.activityText).toBeUndefined();
    expect(reasonCodes(result)).toContain("no-active-evidence");
  });
});

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

describe("status decision — Codex runtime", () => {
  it("reads an active turn (esc to interrupt) as working", () => {
    const output = ["• Reading src/server/status/decision.ts", "  └ 302 lines", "", "esc to interrupt"].join("\n");

    const result = evaluate({ runtime: "codex", output, outputQuietForMs: 1_500 });

    expect(result.status).toBe("working");
    expect(reasonCodes(result)).toContain("codex-active-signal");
  });

  it("reads an approval prompt as attention", () => {
    const output = [
      "Would you like to run the following command?",
      "",
      "  rm -rf build/",
      "",
      "Yes, and don't ask again for this command in this session",
      "No, continue without running it"
    ].join("\n");

    const result = evaluate({ runtime: "codex", output, outputQuietForMs: 2_000 });

    expect(result.status).toBe("attention");
    expect(reasonCodes(result)).toContain("codex-approval-prompt");
  });

  it("reads a finished Codex at a quiet prompt as idle despite a git word in scrollback", () => {
    const output = [
      "• Ran git status",
      "  └ nothing to commit",
      "",
      "Codex finished the task.",
      "",
      "▌ Send a message"
    ].join("\n");

    const result = evaluate({ runtime: "codex", output, outputQuietForMs: 15_000 });

    expect(result.status).toBe("idle");
    expect(result.activityText).toBeUndefined();
    expect(reasonCodes(result)).toContain("output-stale-idle");
  });

  it("reads a finished Codex as idle even while a scrollback git word is still fresh", () => {
    // Fixed (plan A6 / Phase 2b): scrollback tool/path words no longer count as
    // working evidence for an agent runtime. Codex has finished (no "esc to
    // interrupt" active signal, no child process), so the fresh scrollback "git"
    // no longer reads as working — it correctly settles to idle.
    const output = [
      "• Ran git status",
      "  └ nothing to commit",
      "",
      "Codex finished the task.",
      "",
      "▌ Send a message"
    ].join("\n");

    const result = evaluate({ runtime: "codex", output, outputQuietForMs: 3_000, priorStatus: "idle" });

    expect(result.status).toBe("idle");
    expect(result.activityText).toBeUndefined();
    expect(reasonCodes(result)).toContain("no-active-evidence");
  });

  it("holds a just-spawned Codex with no output at idle during the spawn grace window", () => {
    const result = evaluate({
      runtime: "codex",
      output: "",
      outputQuietForMs: 30_000,
      commandQuietForMs: 30_000,
      workerAgeMs: 2_000
    });

    expect(result.status).toBe("idle");
    expect(reasonCodes(result)).toContain("codex-spawn-grace-idle");
  });

  it("suppresses the Codex approval attention when the command is marked interactive", () => {
    // pins current behaviour — a command listed in status.interactiveCommands
    // short-circuits the approval->attention route, so the same prompt reads idle.
    const output = [
      "Would you like to run the following command?",
      "",
      "  rm -rf build/",
      "",
      "Yes, and don't ask again for this command in this session",
      "No, continue without running it"
    ].join("\n");

    const result = evaluate({
      runtime: "codex",
      output,
      outputQuietForMs: 3_000,
      interactiveCommands: new Set<string>(["codex"])
    });

    expect(result.status).not.toBe("attention");
    expect(result.status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// OpenCode
// ---------------------------------------------------------------------------

describe("status decision — OpenCode runtime", () => {
  it("reads an active turn (esc interrupt) as working", () => {
    const output = ["Thinking: tracing the failing assertion", "", "esc interrupt"].join("\n");

    const result = evaluate({ runtime: "opencode", output, outputQuietForMs: 1_500 });

    expect(result.status).toBe("working");
    expect(reasonCodes(result)).toContain("opencode-active-signal");
  });

  it("reads a prompt-dominant footer as idle even with Read/git in scrollback", () => {
    // The ctrl+t / ctrl+p footer with no active-interrupt signal short-circuits to
    // idle before any scrollback heuristic runs — the robust, correct path.
    const output = [
      "> I read src/app.ts, patched the bug, and ran git status.",
      "",
      "ctrl+t variants",
      "ctrl+p commands",
      "tab agents"
    ].join("\n");

    const result = evaluate({ runtime: "opencode", output, outputQuietForMs: 3_000 });

    expect(result.status).toBe("idle");
    expect(result.activityText).toBeUndefined();
    expect(reasonCodes(result)).toContain("opencode-prompt-idle");
  });

  it("reads OpenCode as idle from fresh scrollback when there is no active-interrupt signal", () => {
    // Fixed (plan A6 / Phase 2b): with no footer hints and no "esc interrupt"
    // active signal, neither the generic parser's scrollback tool/path words nor
    // the adapter's lingering "Thinking:" activity label count as working evidence
    // for an agent runtime. A finished OpenCode turn now reads idle instead of
    // false-working off stale scrollback.
    const output = ["Thinking: reviewing the patch", "Read src/app.ts", "$ git status"].join("\n");

    const result = evaluate({ runtime: "opencode", output, outputQuietForMs: 3_000, priorStatus: "idle" });

    expect(result.status).toBe("idle");
    expect(result.activityText).toBeUndefined();
    expect(reasonCodes(result)).toContain("no-active-evidence");
  });

  it("holds a just-spawned OpenCode with no output at idle during the spawn grace window", () => {
    const result = evaluate({
      runtime: "opencode",
      output: "",
      outputQuietForMs: 30_000,
      commandQuietForMs: 30_000,
      workerAgeMs: 2_000
    });

    expect(result.status).toBe("idle");
    expect(reasonCodes(result)).toContain("opencode-spawn-grace-idle");
  });

  it("treats a recoverable tool error as non-error (does not escalate to error status)", () => {
    // pins current behaviour — a transient/recoverable tool error on an agent
    // runtime is classified recoverable, never error. (plan.md A4 notes the
    // recoverable sub-paths all collapse to one outcome; this asserts that outcome.)
    const output = ["Thinking: retrying the request", "", "Error: connection refused"].join("\n");

    const result = evaluate({ runtime: "opencode", output, outputQuietForMs: 2_000, priorStatus: "idle" });

    expect(result.status).not.toBe("error");
    expect(reasonCodes(result)).toContain("parser-recoverable-error");
  });
});

// ---------------------------------------------------------------------------
// Generic shell worker
// ---------------------------------------------------------------------------

describe("status decision — generic shell worker", () => {
  it("reads a running build (non-shell foreground command) as working", () => {
    const output = ["$ npm run build", "vite v6.0.0 building for production...", "transforming src/components/Map.tsx"].join(
      "\n"
    );

    const result = evaluate({ runtime: "shell", output, currentCommand: "npm", outputQuietForMs: 1_500 });

    expect(result.status).toBe("working");
    expect(reasonCodes(result)).toContain("parsed-activity-signal");
  });

  it("reads a shell prompt as idle and ignores git/Read words in scrollback", () => {
    // Foreground command is a shell, so scrollback history signals are suppressed:
    // "git status" in the buffer must not read as working.
    const output = [
      "thomas@asterion ~/code $ git status",
      "On branch main",
      "nothing to commit, working tree clean",
      "thomas@asterion ~/code $"
    ].join("\n");

    const result = evaluate({ runtime: "shell", output, currentCommand: "bash", outputQuietForMs: 3_000 });

    expect(result.status).toBe("idle");
    expect(result.activityText).toBeUndefined();
    expect(reasonCodes(result)).toContain("shell-command-idle");
  });

  it("reads a fatal traceback on a non-agent foreground command as error", () => {
    const output = [
      "$ python app.py",
      "Traceback (most recent call last):",
      '  File "app.py", line 5, in <module>',
      "ValueError: bad input"
    ].join("\n");

    const result = evaluate({ runtime: "shell", output, currentCommand: "python", outputQuietForMs: 1_500 });

    expect(result.status).toBe("error");
    expect(reasonCodes(result)).toContain("parser-error-signal");
  });
});

// ---------------------------------------------------------------------------
// Wrapped agent runtime under a shell (runtimeProcess seam)
// ---------------------------------------------------------------------------

describe("status decision — agent runtime wrapped under a shell", () => {
  it("keeps a bash-wrapped Codex process working even when the pane output is stale", () => {
    // The foreground command is a shell, but pgrep found a live codex child. That
    // child-process evidence short-circuits shell-command-idle and beats staleness.
    const runtimeProcess: AgentRuntimeProcess = { pid: 4242, runtime: "codex", command: "codex", args: "codex exec" };
    const output = ["[codex] session active"].join("\n");

    const result = evaluate({
      runtime: "shell",
      output,
      currentCommand: "bash",
      outputQuietForMs: 45_000,
      runtimeProcess
    });

    expect(result.status).toBe("working");
    expect(reasonCodes(result)).toContain("agent-runtime-child-process");
  });

  it("reads a bash-wrapped Claude sitting at its prompt as idle (child-process evidence suppressed)", () => {
    // When Claude shows its prompt, the wrapped-process signal is intentionally
    // withheld, so the shell falls through to idle rather than false-working.
    const runtimeProcess: AgentRuntimeProcess = { pid: 4243, runtime: "claude", command: "claude", args: "claude" };
    const output = ["I've finished the task.", "", "❯"].join("\n");

    const result = evaluate({
      runtime: "shell",
      output,
      currentCommand: "bash",
      outputQuietForMs: 45_000,
      runtimeProcess
    });

    expect(result.status).toBe("idle");
    expect(reasonCodes(result)).toContain("shell-command-idle");
  });
});

// ---------------------------------------------------------------------------
// Interpreter-hosted Codex (pane command reports "node")
// ---------------------------------------------------------------------------

describe("status decision — Codex hosted as a bare `node` pane", () => {
  // Live pane text from the false-working bug: a Codex CLI whose tmux pane
  // command reports `node` (Codex launched directly, so the interpreter is the
  // pane's own process). Before the fix this fell through to the generic adapter
  // and flapped on scrollback tool words.
  const activeCodexNodePane = [
    "• Working (4m 10s • esc to interrupt)",
    "",
    "",
    "› Run /review on my current changes",
    "",
    "  gpt-5.6-terra medium fast · ~/code/personal-assistant · weekly 93% left · Main [default]"
  ].join("\n");

  const finishedCodexNodePane = [
    "• Ran agent-browser --session s1 snapshot",
    "  └ ok",
    "• Ran git status",
    "  └ nothing to commit",
    "",
    "› Run /review on my current changes",
    "",
    "  gpt-5.6-terra medium fast · ~/code/personal-assistant · weekly 93% left · Main [default]"
  ].join("\n");

  const codexRuntimeProcess: AgentRuntimeProcess = {
    pid: 5150,
    runtime: "codex",
    command: "node",
    args: "node /home/thomas/.local/share/npm/lib/node_modules/@openai/codex/bin/codex.js"
  };

  it("classifies the node pane as codex and reads an active turn as working (not parsed scrollback)", () => {
    // classifyPaneProcess resolved the node pane to codex, so the pane is a codex
    // agent runtime: the native active signal drives working, and scrollback
    // tool/path words are demoted (no parsed-activity-signal).
    const result = evaluate({
      runtime: "shell",
      output: activeCodexNodePane,
      currentCommand: "node",
      outputQuietForMs: 1_500,
      runtimeProcess: codexRuntimeProcess
    });

    expect(result.status).toBe("working");
    expect(reasonCodes(result)).toContain("codex-active-signal");
    expect(reasonCodes(result)).not.toContain("parsed-activity-signal");
  });

  it("reads a finished node-hosted codex at its prompt as idle despite fresh scrollback tool words", () => {
    // The flap-killer. The codex process is still alive (interpreter pane), but it
    // is parked at its input prompt: the child-process signal is suppressed and
    // the fresh "git"/"agent" scrollback words are demoted for the codex agent
    // runtime, so a finished turn settles to idle instead of false-working.
    const result = evaluate({
      runtime: "shell",
      output: finishedCodexNodePane,
      currentCommand: "node",
      outputQuietForMs: 3_000,
      priorStatus: "idle",
      runtimeProcess: codexRuntimeProcess
    });

    expect(result.status).toBe("idle");
    expect(result.activityText).toBeUndefined();
    expect(reasonCodes(result)).toContain("no-active-evidence");
  });

  it("sniffs the codex UI as codex when no runtime process is resolvable and reads active as working", () => {
    // classification unavailable (ps missed the process): the output-sniff must
    // still recognise the codex UI and route the active turn through the native
    // codex signal rather than the generic parser.
    const result = evaluate({
      runtime: "shell",
      output: activeCodexNodePane,
      currentCommand: "node",
      outputQuietForMs: 1_500
    });

    expect(result.status).toBe("working");
    expect(reasonCodes(result)).toContain("codex-active-signal");
  });
});

// ---------------------------------------------------------------------------
// Freshness-window boundaries (deterministic via frozen clock)
// ---------------------------------------------------------------------------

describe("status decision — freshness boundaries", () => {
  // A finished Claude whose scrollback carries a tool/path word. The parsed strong
  // signal is only honoured while output changed within PARSED_STRONG_WINDOW_MS.
  const finishedClaudeWithScrollbackTool = [
    "● Read src/app.ts",
    "  ⎿ Read 40 lines",
    "",
    "Done.",
    "",
    "❯"
  ].join("\n");

  it("reads a finished Claude as idle on both sides of the old parsed-strong window", () => {
    const justInside = evaluate({
      runtime: "claude",
      output: finishedClaudeWithScrollbackTool,
      outputQuietForMs: PARSED_STRONG_WINDOW_MS - 1,
      priorStatus: "idle"
    });
    const justOutside = evaluate({
      runtime: "claude",
      output: finishedClaudeWithScrollbackTool,
      outputQuietForMs: PARSED_STRONG_WINDOW_MS + 1,
      priorStatus: "idle"
    });

    // Fixed (plan A6 / Phase 2b): the parsed-strong evidence window no longer
    // produces a flip for an agent runtime. Scrollback tool/path words never count
    // as working evidence for Claude, so a *finished* Claude reads idle whether the
    // repaint was fresh (inside the old window) or stale (outside it) — both halves
    // are now idle, and the 8s window is no longer an observable boundary here.
    expect(justInside.status).toBe("idle");
    expect(reasonCodes(justInside)).toContain("no-active-evidence");
    expect(justOutside.status).toBe("idle");
    expect(reasonCodes(justOutside)).toContain("no-active-evidence");
  });

  it("keeps a working worker sticky just inside the freshness window, then goes idle just outside", () => {
    // Plain settled output (no tool words, no active UI). A worker already marked
    // working is held briefly by the freshness window, then released to idle.
    const output = "Refactoring the status decision engine.";

    const justInside = evaluate({
      runtime: "claude",
      output,
      outputQuietForMs: CLAUDE_FRESH_WINDOW_MS - 1,
      priorStatus: "working"
    });
    const justOutside = evaluate({
      runtime: "claude",
      output,
      outputQuietForMs: CLAUDE_FRESH_WINDOW_MS + 1,
      priorStatus: "working"
    });

    expect(justInside.status).toBe("working");
    expect(reasonCodes(justInside)).toContain("working-evidence-window");
    expect(justOutside.status).toBe("idle");
    expect(reasonCodes(justOutside)).toContain("output-stale-idle");
  });
});
