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

/**
 * Classify the pane's OWN process (a single `ps` on `panePid`) as a known agent
 * runtime.
 *
 * The wrapped-shell path ({@link findAgentRuntimeProcess}) descends the CHILDREN
 * of a shell pane. When an agent CLI is launched directly, the pane's foreground
 * command is the interpreter that hosts it (`node`/`bun`/`deno`/`python`…) and
 * the pane pid IS that interpreter — there is no shell to descend from, and the
 * bare command name ("node") hides which agent it is. Reading the interpreter's
 * own argv (e.g. `node …/@openai/codex/bin/codex.js` or `node …/claude`) and
 * classifying it recovers the runtime.
 *
 * Returns undefined for a plain interpreter process (a random node/python
 * script), so only genuine agent runtimes produce an AgentRuntimeProcess.
 */
export async function classifyPaneProcess(panePid: number): Promise<AgentRuntimeProcess | undefined> {
  const details = await describeProcess(panePid);
  if (!details) {
    return undefined;
  }

  const runtime = classifyAgentRuntime(details.command, details.args);
  if (!runtime) {
    return undefined;
  }

  return {
    pid: panePid,
    runtime,
    command: details.command,
    args: details.args
  };
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
