import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../../shared/types";
import { TmuxAdapter } from "./tmuxAdapter";

// Exercises the real tmux shell-out on a throwaway, per-process socket so it can
// never touch a developer's own tmux server. Skipped cleanly where tmux is not
// installed. The value here is catching quoting / protocol regressions that unit
// tests of the argv builders cannot: shellQuote surviving a real double shell,
// window metadata surviving a real round-trip, and live pane parsing.

const execFileAsync = promisify(execFile);

function detectTmux(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const tmuxAvailable = detectTmux();
const socketName = `arcane-adapter-test-${process.pid}`;

const config: ResolvedConfig["backend"]["tmux"] = {
  socketName,
  sessionName: "arcane-adapter-test",
  pollIntervalMs: 2500
};

async function killTestServer(): Promise<void> {
  await execFileAsync("tmux", ["-L", socketName, "kill-server"]).catch(() => undefined);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 4000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor: condition not met before timeout");
}

const tmpDirs: string[] = [];
function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcane-adapter-it-"));
  tmpDirs.push(dir);
  return fs.realpathSync(dir);
}

describe.skipIf(!tmuxAvailable)("TmuxAdapter integration (real tmux socket)", () => {
  const adapter = new TmuxAdapter(config);

  beforeAll(async () => {
    // Clear any stale server left by a previous crashed run on this socket.
    await killTestServer();
  });

  afterAll(async () => {
    await killTestServer();
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it(
    "passes a single-quoted, spaced command through the real shell intact",
    async () => {
      const workDir = makeWorkDir();
      const outFile = path.join(workDir, "quoted-output.txt");
      // Derived independently of any builder output: this is exactly what printf
      // must emit if shellQuote survives the sh -c / bash -c double shell. A
      // broken quote would either fail the command or corrupt the content.
      const expected = "a 'quoted' phrase with spaces";
      const script = `printf '%s' "a 'quoted' phrase with spaces" > "${outFile}"; sleep 5`;

      await adapter.spawnWorker({
        workerId: "quote-test",
        windowName: "quote-test",
        projectPath: workDir,
        command: ["bash", "-c", script],
        projectId: "proj-quote",
        runtimeId: "shell",
        runtimeLabel: "Shell"
      });

      await waitFor(() => fs.existsSync(outFile) && fs.readFileSync(outFile, "utf8").length > 0);
      expect(fs.readFileSync(outFile, "utf8")).toBe(expected);
    },
    8000
  );

  it(
    "round-trips @arcane_agents_* window metadata and reads live pane state",
    async () => {
      const workDir = makeWorkDir();
      const ref = await adapter.spawnWorker({
        workerId: "meta-test",
        windowName: "meta-test",
        projectPath: workDir,
        command: ["sleep", "600"],
        projectId: "proj-meta",
        runtimeId: "codex",
        runtimeLabel: "Codex CLI"
      });

      const managed = await adapter.listManagedWindows();
      const window = managed.find((entry) => entry.workerId === "meta-test");
      expect(window).toMatchObject({
        window: "meta-test",
        workerId: "meta-test",
        projectId: "proj-meta",
        runtimeId: "codex",
        runtimeLabel: "Codex CLI",
        projectPath: workDir
      });

      const state = await adapter.getPaneState(ref);
      expect(state.isDead).toBe(false);
      expect(state.panePid).toBeGreaterThan(0);
      expect(state.currentPath && fs.realpathSync(state.currentPath)).toBe(workDir);
    },
    8000
  );

  it(
    "delivers multiline bracketed-paste input and removes the window on stop",
    async () => {
      const workDir = makeWorkDir();
      const outFile = path.join(workDir, "input.txt");
      const ref = await adapter.spawnWorker({
        workerId: "input-test",
        windowName: "input-test",
        projectPath: workDir,
        command: ["bash", "-c", `cat > "${outFile}"`],
        projectId: "proj-input",
        runtimeId: "shell",
        runtimeLabel: "Shell"
      });

      // Two lines with a submit: sendInput wraps this in bracketed-paste markers
      // and appends Enter. cat copies its stdin to the file, so the delivered
      // lines must both land there.
      await adapter.sendInput(ref, "alpha line\nbeta line", { submit: true });

      await waitFor(() => {
        if (!fs.existsSync(outFile)) {
          return false;
        }
        const body = fs.readFileSync(outFile, "utf8");
        return body.includes("alpha line") && body.includes("beta line");
      });

      const body = fs.readFileSync(outFile, "utf8");
      expect(body).toContain("alpha line");
      expect(body).toContain("beta line");

      await adapter.stop(ref);

      await waitFor(async () => {
        const managed = await adapter.listManagedWindows();
        return managed.every((entry) => entry.workerId !== "input-test");
      });
      const managedAfter = await adapter.listManagedWindows();
      expect(managedAfter.some((entry) => entry.workerId === "input-test")).toBe(false);
    },
    8000
  );
});
