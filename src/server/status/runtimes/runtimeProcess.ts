import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const maxProcessTreeDepth = 5;

export type KnownAgentRuntime = "claude" | "opencode" | "codex";

export interface AgentRuntimeProcess {
  pid: number;
  runtime: KnownAgentRuntime;
  command: string;
  args: string;
}

export async function findAgentRuntimeProcess(panePid: number): Promise<AgentRuntimeProcess | undefined> {
  return findAgentRuntimeProcessAtDepth(panePid, 0);
}

async function findAgentRuntimeProcessAtDepth(parentPid: number, depth: number): Promise<AgentRuntimeProcess | undefined> {
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
      const details = await describeProcess(childPid);
      if (details) {
        const runtime = classifyAgentRuntime(details.command, details.args);
        if (runtime) {
          return {
            pid: childPid,
            runtime,
            command: details.command,
            args: details.args
          };
        }
      }

      const nestedMatch = await findAgentRuntimeProcessAtDepth(childPid, depth + 1);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function describeProcess(pid: number): Promise<{ command: string; args: string } | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "comm=", "-o", "args=", "-p", String(pid)], {
      maxBuffer: 1024 * 16
    });
    const line = stdout.trim();
    if (!line) {
      return undefined;
    }

    const [command = "", ...argsParts] = line.split(/\s+/);
    return {
      command: command.trim(),
      args: argsParts.join(" ").trim()
    };
  } catch {
    return undefined;
  }
}

function classifyAgentRuntime(command: string, args: string): KnownAgentRuntime | undefined {
  const commandLower = command.trim().toLowerCase();
  const argsLower = args.trim().toLowerCase();
  const commandAndArgs = `${commandLower} ${argsLower}`.trim();

  if (
    commandLower === "claude" ||
    commandAndArgs.includes("/claude") ||
    /\bclaude(?:-code)?\b/.test(commandAndArgs)
  ) {
    return "claude";
  }

  if (commandLower === "opencode" || commandAndArgs.includes("opencode")) {
    return "opencode";
  }

  if (
    commandLower === "codex" ||
    commandAndArgs.includes("@openai/codex") ||
    commandAndArgs.includes("/bin/codex") ||
    /\bcodex\b/.test(commandAndArgs)
  ) {
    return "codex";
  }

  return undefined;
}
