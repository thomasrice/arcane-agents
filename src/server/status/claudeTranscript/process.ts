import { execFile } from "node:child_process";
import fs from "node:fs/promises";
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

export async function findClaudeSessionId(panePid: number): Promise<string | undefined> {
  const claudePid = await findClaudeChildPid(panePid, 0);
  if (!claudePid) {
    return undefined;
  }

  try {
    const command = (await fs.readFile(`/proc/${claudePid}/cmdline`))
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    return extractSessionId(command);
  } catch {
    return undefined;
  }
}

function extractSessionId(command: string[]): string | undefined {
  for (let index = 0; index < command.length; index += 1) {
    const argument = command[index];
    if (argument === "--resume" || argument === "-r" || argument === "--session-id") {
      return command[index + 1];
    }
    if (argument?.startsWith("--resume=") || argument?.startsWith("--session-id=")) {
      return argument.slice(argument.indexOf("=") + 1) || undefined;
    }
  }
  return undefined;
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
