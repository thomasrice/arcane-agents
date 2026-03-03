import * as pty from "node-pty";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RawData, WebSocket } from "ws";
import { WorkerRepository } from "../persistence/workerRepository";

const execFileAsync = promisify(execFile);

interface TerminalBridgeOptions {
  onSubmittedInput?: (workerId: string) => void;
}

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

interface SessionMouseState {
  activeConnections: number;
  previousValue: "on" | "off";
  overrideApplied: boolean;
}

export class TerminalBridge {
  private readonly sessionMouseStateBySession = new Map<string, SessionMouseState>();

  constructor(
    private readonly workers: WorkerRepository,
    private readonly options: TerminalBridgeOptions = {}
  ) {}

  async connect(workerId: string, socket: WebSocket): Promise<void> {
    const worker = this.workers.getWorker(workerId);
    if (!worker) {
      socket.send(JSON.stringify({ type: "error", message: `Unknown worker '${workerId}'.` }));
      socket.close();
      return;
    }

    const tmuxTarget = `${worker.tmuxRef.session}:${worker.tmuxRef.window}`;
    const sessionName = worker.tmuxRef.session;
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: "xterm-256color"
    };

    await this.acquireSessionMouseOverride(sessionName);

    if (socket.readyState !== socket.OPEN) {
      await this.releaseSessionMouseOverride(sessionName);
      return;
    }

    let terminal: pty.IPty;
    try {
      terminal = pty.spawn("tmux", ["attach-session", "-t", tmuxTarget], {
        name: "xterm-256color",
        cols: 120,
        rows: 36,
        cwd: worker.projectPath,
        env
      });
    } catch (error) {
      await this.releaseSessionMouseOverride(sessionName);
      const message = error instanceof Error ? error.message : "Failed to spawn terminal bridge";
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "error", message }));
      }
      socket.close();
      return;
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;

      terminal.kill();
      void this.releaseSessionMouseOverride(sessionName);
    };

    terminal.onData((chunk) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(chunk);
      }
    });

    terminal.onExit(() => {
      cleanup();
      if (socket.readyState === socket.OPEN) {
        socket.close();
      }
    });

    socket.on("message", (raw) => {
      const incoming = rawDataToString(raw);
      const control = parseResizeMessage(incoming);

      if (control) {
        terminal.resize(Math.max(20, control.cols), Math.max(5, control.rows));
        return;
      }

      if (isLikelySubmittedInput(incoming)) {
        this.options.onSubmittedInput?.(worker.id);
      }

      terminal.write(incoming);
    });

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  private async acquireSessionMouseOverride(sessionName: string): Promise<void> {
    const existing = this.sessionMouseStateBySession.get(sessionName);
    if (existing) {
      existing.activeConnections += 1;
      return;
    }

    const previousValue = await readSessionMouseValue(sessionName);
    const overrideApplied = previousValue === "on" ? await setSessionMouseValue(sessionName, "off") : false;

    this.sessionMouseStateBySession.set(sessionName, {
      activeConnections: 1,
      previousValue,
      overrideApplied
    });
  }

  private async releaseSessionMouseOverride(sessionName: string): Promise<void> {
    const state = this.sessionMouseStateBySession.get(sessionName);
    if (!state) {
      return;
    }

    state.activeConnections -= 1;
    if (state.activeConnections > 0) {
      return;
    }

    this.sessionMouseStateBySession.delete(sessionName);
    if (!state.overrideApplied) {
      return;
    }

    await setSessionMouseValue(sessionName, state.previousValue);
  }
}

function parseResizeMessage(value: string): ResizeMessage | undefined {
  if (!value.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ResizeMessage>;
    if (parsed.type !== "resize") {
      return undefined;
    }

    if (typeof parsed.cols !== "number" || typeof parsed.rows !== "number") {
      return undefined;
    }

    return {
      type: "resize",
      cols: parsed.cols,
      rows: parsed.rows
    };
  } catch {
    return undefined;
  }
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === "string") {
    return raw;
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }

  if (raw instanceof Buffer) {
    return raw.toString("utf8");
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }

  return Buffer.from(raw).toString("utf8");
}

function isLikelySubmittedInput(text: string): boolean {
  return text.includes("\r") || text.includes("\n");
}

async function readSessionMouseValue(sessionName: string): Promise<"on" | "off"> {
  try {
    const { stdout } = await execFileAsync("tmux", ["show-options", "-v", "-t", sessionName, "mouse"], {
      maxBuffer: 1024 * 64
    });
    const normalized = stdout.trim().toLowerCase();
    return normalized === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}

async function setSessionMouseValue(sessionName: string, value: "on" | "off"): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["set-option", "-t", sessionName, "mouse", value], {
      maxBuffer: 1024 * 64
    });
    return true;
  } catch {
    return false;
  }
}
