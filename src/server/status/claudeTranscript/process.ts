import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const maxProcessTreeDepth = 4;

export async function findClaudeSessionStartTimeMs(panePid: number): Promise<number | undefined> {
  const claudePid = await findClaudeChildPid(panePid, 0);
  if (!claudePid) {
    return undefined;
  }

  return getProcessStartTimeMs(claudePid);
}

async function findClaudeChildPid(parentPid: number, depth: number): Promise<number | undefined> {
  if (depth >= maxProcessTreeDepth) {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync("pgrep", ["-P", String(parentPid)], {
      maxBuffer: 1024 * 16
    });

    const childPids = stdout
      .trim()
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0);

    for (const childPid of childPids) {
      if (await isClaudeProcess(childPid)) {
        return childPid;
      }

      const nestedClaude = await findClaudeChildPid(childPid, depth + 1);
      if (nestedClaude) {
        return nestedClaude;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function isClaudeProcess(pid: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "comm=", "-p", String(pid)], {
      maxBuffer: 1024 * 4
    });
    return stdout.trim().toLowerCase() === "claude";
  } catch {
    return false;
  }
}

async function getProcessStartTimeMs(pid: number): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "etimes=", "-p", String(pid)], {
      maxBuffer: 1024 * 4
    });
    const elapsedSeconds = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
      return undefined;
    }

    return Date.now() - elapsedSeconds * 1000;
  } catch {
    return undefined;
  }
}
