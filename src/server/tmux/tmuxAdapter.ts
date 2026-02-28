import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TmuxRef } from "../../shared/types";

const execFileAsync = promisify(execFile);

interface SpawnTmuxInput {
  workerId: string;
  windowName: string;
  projectPath: string;
  command: string[];
}

interface PaneState {
  currentCommand: string;
  isDead: boolean;
}

interface WindowSummary {
  name: string;
  id: string;
}

export class TmuxAdapter {
  constructor(private readonly sessionName: string) {}

  async spawnWorker(input: SpawnTmuxInput): Promise<TmuxRef> {
    const target = `${this.sessionName}:${input.windowName}`;
    const commandLine = input.command.map(shellQuote).join(" ");
    const env = `OVERWORLD_WORKER_ID=${input.workerId}`;

    if (await this.hasSession()) {
      await this.runTmux([
        "new-window",
        "-d",
        "-t",
        this.sessionName,
        "-n",
        input.windowName,
        "-c",
        input.projectPath,
        "-e",
        env,
        commandLine
      ]);
    } else {
      await this.runTmux([
        "new-session",
        "-d",
        "-s",
        this.sessionName,
        "-n",
        input.windowName,
        "-c",
        input.projectPath,
        "-e",
        env,
        commandLine
      ]);
    }

    const paneOutput = await this.runTmux(["list-panes", "-t", target, "-F", "#{pane_id}"]);
    const pane = firstLine(paneOutput);
    if (!pane) {
      throw new Error(`Unable to resolve tmux pane for ${target}.`);
    }

    return {
      session: this.sessionName,
      window: input.windowName,
      pane
    };
  }

  async stop(ref: TmuxRef): Promise<void> {
    const target = this.target(ref);
    await this.runTmux(["send-keys", "-t", target, "C-c"]).catch(() => undefined);
    await delay(500);
    await this.runTmux(["kill-window", "-t", target]).catch(() => undefined);
  }

  async listWindows(): Promise<WindowSummary[]> {
    if (!(await this.hasSession())) {
      return [];
    }

    const output = await this.runTmux([
      "list-windows",
      "-t",
      this.sessionName,
      "-F",
      "#{window_name}\t#{window_id}"
    ]);

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, id] = line.split("\t");
        return {
          name,
          id
        };
      });
  }

  async windowExists(ref: TmuxRef): Promise<boolean> {
    try {
      await this.runTmux(["has-session", "-t", this.target(ref)]);
      return true;
    } catch {
      return false;
    }
  }

  async capturePane(ref: TmuxRef, lines = 30): Promise<string> {
    return this.runTmux(["capture-pane", "-t", this.target(ref), "-p", "-S", `-${Math.max(1, lines)}`]);
  }

  async getPaneState(ref: TmuxRef): Promise<PaneState> {
    const output = await this.runTmux([
      "list-panes",
      "-t",
      this.target(ref),
      "-F",
      "#{pane_current_command}\t#{pane_dead}"
    ]);

    const [currentCommand = "", deadFlag = "0"] = firstLine(output).split("\t");
    return {
      currentCommand,
      isDead: deadFlag === "1"
    };
  }

  attachTarget(ref: TmuxRef): string {
    return this.target(ref);
  }

  private async hasSession(): Promise<boolean> {
    try {
      await this.runTmux(["has-session", "-t", this.sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  private target(ref: TmuxRef): string {
    return `${ref.session}:${ref.window}`;
  }

  private async runTmux(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("tmux", args, {
      maxBuffer: 1024 * 1024
    });
    return stdout.trimEnd();
  }
}

function firstLine(input: string): string {
  const [line = ""] = input.split("\n");
  return line;
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
