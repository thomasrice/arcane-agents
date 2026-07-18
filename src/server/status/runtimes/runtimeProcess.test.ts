import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The ps/pgrep lookup is a real OS side effect, so the child_process boundary is
// mocked. `execFile` is consumed via `promisify(execFile)`, which honours the
// promisify.custom hook — we install one that returns `{ stdout }` and records
// the argv it was asked to run.
const { execFileHook } = vi.hoisted(() => ({
  execFileHook: vi.fn<(command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>>()
}));

vi.mock("node:child_process", () => {
  const custom = Symbol.for("nodejs.util.promisify.custom");
  const execFile = vi.fn() as unknown as Record<symbol, unknown>;
  execFile[custom] = (command: string, args: string[]) => execFileHook(command, args);
  return { execFile };
});

import { classifyPaneProcess } from "./runtimeProcess";

function psReturning(commAndArgsLine: string): void {
  execFileHook.mockResolvedValue({ stdout: `${commAndArgsLine}\n`, stderr: "" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyPaneProcess", () => {
  it("classifies an interpreter pane whose own argv is a codex CLI", async () => {
    psReturning("node node /home/thomas/.local/share/npm/lib/node_modules/@openai/codex/bin/codex.js");

    const result = await classifyPaneProcess(4242);

    expect(result).toEqual({
      pid: 4242,
      runtime: "codex",
      command: "node",
      args: "node /home/thomas/.local/share/npm/lib/node_modules/@openai/codex/bin/codex.js"
    });
  });

  it("classifies an interpreter pane whose own argv is the claude CLI", async () => {
    psReturning("node node /home/thomas/.local/share/npm/lib/node_modules/@anthropic-ai/claude-code/cli.js");

    const result = await classifyPaneProcess(4243);

    expect(result?.runtime).toBe("claude");
  });

  it("returns undefined for an interpreter pane running an unrelated node script", async () => {
    psReturning("node node /home/thomas/code/some-project/build.js");

    expect(await classifyPaneProcess(4244)).toBeUndefined();
  });

  it("inspects the pane pid's OWN process — a single ps, never descending into children", async () => {
    psReturning("node node /home/thomas/.local/share/npm/lib/node_modules/@openai/codex/bin/codex.js");

    await classifyPaneProcess(4242);

    // Exactly one boundary call, and it is a `ps` on the given pid (no pgrep of
    // children — that is the separate wrapped-shell path).
    expect(execFileHook).toHaveBeenCalledTimes(1);
    const [command, args] = execFileHook.mock.calls[0] ?? [];
    expect(command).toBe("ps");
    expect(args).toContain("-p");
    expect(args).toContain("4242");
  });

  it("returns undefined when ps produces no output", async () => {
    execFileHook.mockResolvedValue({ stdout: "\n", stderr: "" });

    expect(await classifyPaneProcess(9999)).toBeUndefined();
  });
});
