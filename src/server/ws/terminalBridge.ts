import * as pty from "node-pty";
import type { RawData, WebSocket } from "ws";
import { WorkerRepository } from "../persistence/workerRepository";

interface TerminalBridgeOptions {
  onSubmittedInput?: (workerId: string) => void;
  onTerminalOutput?: (workerId: string) => void;
}

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

export class TerminalBridge {
  private readonly lastOutputActivityAtByWorker = new Map<string, number>();

  constructor(
    private readonly workers: WorkerRepository,
    private readonly options: TerminalBridgeOptions = {}
  ) {}

  connect(workerId: string, socket: WebSocket): void {
    const worker = this.workers.getWorker(workerId);
    if (!worker) {
      socket.send(JSON.stringify({ type: "error", message: `Unknown agent '${workerId}'.` }));
      socket.close();
      return;
    }

    const tmuxTarget = `${worker.tmuxRef.session}:${worker.tmuxRef.window}`;
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: "xterm-256color"
    };

    let terminal: pty.IPty | undefined;
    let ready = false;

    socket.on("message", (raw) => {
      const incoming = rawDataToString(raw);
      const control = parseResizeMessage(incoming);

      if (control) {
        const cols = Math.max(20, control.cols);
        const rows = Math.max(5, control.rows);

        if (!terminal) {
          try {
            terminal = pty.spawn("tmux", ["attach-session", "-t", tmuxTarget], {
              name: "xterm-256color",
              cols,
              rows,
              cwd: worker.projectPath,
              env
            });
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            console.error(`[arcane-agents] terminal bridge failed to spawn pty for ${workerId}: ${detail}`);
            socket.close(1011, "Failed to attach terminal");
            return;
          }

          terminal.onData((chunk) => {
            this.handleTerminalOutput(worker.id);
            if (socket.readyState === socket.OPEN) {
              socket.send(chunk);
            }
          });

          terminal.onExit(() => {
            if (socket.readyState === socket.OPEN) {
              socket.close();
            }
          });

          ready = true;
        } else {
          terminal.resize(cols, rows);
        }
        return;
      }

      if (!ready) {
        return;
      }

      if (isLikelySubmittedInput(incoming)) {
        this.options.onSubmittedInput?.(worker.id);
      }

      terminal!.write(incoming);
    });

    const cleanup = () => {
      terminal?.kill();
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  private handleTerminalOutput(workerId: string): void {
    const nowMs = Date.now();
    const lastOutputActivityAtMs = this.lastOutputActivityAtByWorker.get(workerId) ?? 0;
    if (nowMs - lastOutputActivityAtMs < 120) {
      return;
    }

    this.lastOutputActivityAtByWorker.set(workerId, nowMs);
    this.options.onTerminalOutput?.(workerId);
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
