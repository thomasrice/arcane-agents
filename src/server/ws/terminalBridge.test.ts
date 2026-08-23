import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig, Worker } from "../../shared/types";
import { WorkerRepository } from "../persistence/workerRepository";
import { buildTmuxAttachArgs } from "../tmux/tmuxAdapter";
import { TerminalBridge } from "./terminalBridge";

// The only external boundary this bridge touches is node-pty (which spawns the
// real `tmux attach` process). We mock that. Everything else is driven real:
// a real WorkerRepository backed by a throwaway SQLite file, the real
// buildTmuxAttachArgs arg builder, and a real EventEmitter-backed fake socket
// mirroring the ws/xterm protocol. buildTmuxAttachArgs is a pure helper, so we
// leave it real and assert the spawn args against it rather than stubbing it.
import * as pty from "node-pty";

vi.mock("node-pty", () => ({
  spawn: vi.fn()
}));

const spawnMock = vi.mocked(pty.spawn);

/**
 * Fake node-pty handle. onData/onExit register listeners (node-pty style,
 * returning a disposable) so the test can push output / signal exit. write,
 * resize and kill are spies.
 */
class FakePty {
  readonly write = vi.fn<(data: string) => void>();
  readonly resize = vi.fn<(cols: number, rows: number) => void>();
  readonly kill = vi.fn<() => void>();
  private readonly dataListeners: Array<(chunk: string) => void> = [];
  private readonly exitListeners: Array<() => void> = [];

  onData(listener: (chunk: string) => void): { dispose: () => void } {
    this.dataListeners.push(listener);
    return { dispose: () => undefined };
  }

  onExit(listener: () => void): { dispose: () => void } {
    this.exitListeners.push(listener);
    return { dispose: () => undefined };
  }

  emitData(chunk: string): void {
    for (const listener of [...this.dataListeners]) {
      listener(chunk);
    }
  }

  emitExit(): void {
    for (const listener of [...this.exitListeners]) {
      listener();
    }
  }
}

/**
 * EventEmitter-backed fake WebSocket, in the style of realtimeHub.test.ts.
 * close() flips readyState to CLOSED to mirror ws, so the bridge's
 * `readyState === OPEN` guards behave realistically.
 */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = this.OPEN;
  readonly send = vi.fn<(payload: string) => void>();
  readonly close = vi.fn<(code?: number, reason?: string) => void>();

  constructor() {
    super();
    this.close.mockImplementation(() => {
      this.readyState = this.CLOSED;
    });
  }
}

const tmuxConfig: ResolvedConfig["backend"]["tmux"] = {
  socketName: "arcane-sock",
  sessionName: "arcane-sess",
  pollIntervalMs: 2500
};

const tmpDirs: string[] = [];

function makeRepo(): WorkerRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcane-terminalbridge-"));
  tmpDirs.push(dir);
  return new WorkerRepository(path.join(dir, "workers.db"));
}

function makeWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: "worker-1",
    name: "worker-1",
    displayName: "Worker 1",
    projectId: "proj",
    projectPath: "/tmp/proj-worker-1",
    runtimeId: "shell",
    runtimeLabel: "Shell",
    command: ["bash"],
    status: "idle",
    avatarType: "wizard",
    movementMode: "hold",
    silenced: false,
    position: { x: 10, y: 10 },
    tmuxRef: { session: "sess-1", window: "win-1", pane: "%1" },
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z",
    ...overrides
  };
}

function resizeFrame(cols: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols, rows });
}

interface Harness {
  bridge: TerminalBridge;
  socket: FakeSocket;
  worker: Worker;
  onSubmittedInput: ReturnType<typeof vi.fn>;
  onTerminalOutput: ReturnType<typeof vi.fn>;
}

function connect(overrides: Partial<Worker> = {}, connectWorkerId?: string): Harness {
  const repo = makeRepo();
  const worker = makeWorker(overrides);
  repo.saveWorker(worker);

  const onSubmittedInput = vi.fn();
  const onTerminalOutput = vi.fn();
  const bridge = new TerminalBridge(repo, tmuxConfig, { onSubmittedInput, onTerminalOutput });

  const socket = new FakeSocket();
  bridge.connect(connectWorkerId ?? worker.id, socket as unknown as WebSocket);

  return { bridge, socket, worker, onSubmittedInput, onTerminalOutput };
}

/** Emit a resize frame that spawns the pty and return the (mocked) handle. */
function spawnVia(socket: FakeSocket, term: FakePty, cols = 80, rows = 24): void {
  spawnMock.mockReturnValue(term as unknown as pty.IPty);
  socket.emit("message", resizeFrame(cols, rows));
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("TerminalBridge spawn trigger", () => {
  it("does not spawn a pty until the first resize frame arrives", () => {
    const { socket } = connect();

    // Plain input before any resize is dropped and must not spawn a pty.
    socket.emit("message", "ls -la\r");
    socket.emit("message", "some output");
    expect(spawnMock).not.toHaveBeenCalled();

    const term = new FakePty();
    spawnVia(socket, term, 80, 24);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("builds the tmux attach spawn from the worker tmuxRef and config", () => {
    const term = new FakePty();
    const { socket, worker } = connect({ tmuxRef: { session: "sX", window: "wY", pane: "%9" } });

    spawnVia(socket, term, 80, 24);

    const [command, args, options] = spawnMock.mock.calls[0] ?? [];
    expect(command).toBe("tmux");
    expect(args).toEqual(buildTmuxAttachArgs("sX:wY", tmuxConfig));
    expect(options).toMatchObject({
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: worker.projectPath
    });
  });

  it("drops pre-ready input without invoking the submitted-input callback", () => {
    const { socket, onSubmittedInput } = connect();

    // Contains a newline, but the terminal is not ready yet: submitted-input
    // detection only runs after spawn, so this must be a no-op.
    socket.emit("message", "\n");
    expect(spawnMock).not.toHaveBeenCalled();
    expect(onSubmittedInput).not.toHaveBeenCalled();
  });
});

describe("TerminalBridge resize handling", () => {
  it("clamps below-floor dimensions to the 20x5 floor at spawn", () => {
    const term = new FakePty();
    const { socket } = connect();

    spawnVia(socket, term, 1, 1);

    const options = spawnMock.mock.calls[0]?.[2];
    expect(options).toMatchObject({ cols: 20, rows: 5 });
  });

  it("passes normal dimensions through unchanged at spawn", () => {
    const term = new FakePty();
    const { socket } = connect();

    spawnVia(socket, term, 120, 40);

    const options = spawnMock.mock.calls[0]?.[2];
    expect(options).toMatchObject({ cols: 120, rows: 40 });
  });

  it("clamps subsequent resizes and forwards them to the live pty", () => {
    const term = new FakePty();
    const { socket } = connect();

    spawnVia(socket, term, 80, 24);
    // A second resize hits the already-spawned branch -> terminal.resize.
    socket.emit("message", resizeFrame(2, 2));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(term.resize).toHaveBeenCalledTimes(1);
    expect(term.resize).toHaveBeenCalledWith(20, 5);
  });

  it("ignores garbage / non-resize payloads and never spawns from them", () => {
    const { socket } = connect();

    socket.emit("message", "not json at all");
    socket.emit("message", JSON.stringify({ type: "resize" })); // missing cols/rows
    socket.emit("message", JSON.stringify({ type: "resize", cols: "80", rows: 24 })); // non-numeric
    socket.emit("message", JSON.stringify({ type: "other", cols: 80, rows: 24 })); // wrong type

    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("TerminalBridge unknown worker", () => {
  it("sends an error frame and closes when the worker id is unknown", () => {
    const { socket } = connect({}, "no-such-worker");

    expect(spawnMock).not.toHaveBeenCalled();
    expect(socket.send).toHaveBeenCalledTimes(1);

    const payload = socket.send.mock.calls[0]?.[0];
    expect(JSON.parse(String(payload))).toMatchObject({ type: "error" });

    // Unknown worker is a protocol violation: close with 1008 (policy
    // violation), consistent with websocketUpgrade's "Invalid agent id" path.
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.close.mock.calls[0]?.[0]).toBe(1008);
  });
});

describe("TerminalBridge spawn failure", () => {
  it("closes the socket with 1011 when the pty fails to spawn", () => {
    const { socket } = connect();

    spawnMock.mockImplementation(() => {
      throw new Error("pty boom");
    });
    socket.emit("message", resizeFrame(80, 24));

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.close.mock.calls[0]?.[0]).toBe(1011);
  });

  it("does not re-attempt the spawn on a later resize after a failure", () => {
    const { socket } = connect();

    spawnMock.mockImplementationOnce(() => {
      throw new Error("pty boom");
    });
    const term = new FakePty();
    spawnMock.mockReturnValue(term as unknown as pty.IPty);

    socket.emit("message", resizeFrame(80, 24)); // throws + close(1011) + teardown
    socket.emit("message", resizeFrame(80, 24)); // message handler detached -> ignored

    // A failed spawn tears down the message handler, so a subsequent resize can
    // no longer re-attempt pty.spawn against the already-closed socket (no
    // orphaned `tmux attach`).
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});

describe("TerminalBridge data flow", () => {
  it("forwards pty output bytes to the socket", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    term.emitData("hello-from-pty");

    expect(socket.send).toHaveBeenCalledWith("hello-from-pty");
  });

  it("does not forward pty output once the socket is no longer open", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    socket.close();
    socket.send.mockClear();
    term.emitData("late output");

    expect(socket.send).not.toHaveBeenCalled();
  });

  it("writes socket input through to the pty", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    socket.emit("message", "echo hi");

    expect(term.write).toHaveBeenCalledWith("echo hi");
  });

  it("decodes Buffer frames before writing to the pty", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    socket.emit("message", Buffer.from("buffered", "utf8"));

    expect(term.write).toHaveBeenCalledWith("buffered");
  });
});

describe("TerminalBridge lifecycle symmetry", () => {
  it("closes the socket when the pty exits", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    term.emitExit();

    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("does not double-close the socket if the pty exits twice", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    term.emitExit();
    term.emitExit();

    // The readyState guard means the second exit is a no-op.
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("kills the pty when the socket closes", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    socket.emit("close");

    expect(term.kill).toHaveBeenCalledTimes(1);
  });

  it("kills the pty on socket error without throwing", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    expect(() => socket.emit("error", new Error("socket blew up"))).not.toThrow();
    expect(term.kill).toHaveBeenCalledTimes(1);
  });

  it("does not throw when both close and error fire", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    expect(() => {
      socket.emit("close");
      socket.emit("error", new Error("post-close error"));
    }).not.toThrow();

    // Teardown is run-once guarded, so kill() fires exactly once even when both
    // close and error fire — no node-pty double-kill on an already-dead pty.
    expect(term.kill).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the socket closes before any pty was spawned", () => {
    const { socket } = connect();

    // No resize arrived, so terminal is undefined; cleanup must no-op.
    expect(() => socket.emit("close")).not.toThrow();
  });
});

describe("TerminalBridge status nudges", () => {
  it("pokes onSubmittedInput only when input carries a newline / carriage return", () => {
    const term = new FakePty();
    const { socket, onSubmittedInput, worker } = connect();
    spawnVia(socket, term, 80, 24);

    socket.emit("message", "partial command"); // no newline
    expect(onSubmittedInput).not.toHaveBeenCalled();

    socket.emit("message", "run it\r"); // carriage return = submit
    socket.emit("message", "and again\n"); // newline = submit

    expect(onSubmittedInput).toHaveBeenCalledTimes(2);
    expect(onSubmittedInput).toHaveBeenCalledWith(worker.id);
  });

  it("does not treat resize frames as submitted input", () => {
    const term = new FakePty();
    const { socket, onSubmittedInput } = connect();

    spawnVia(socket, term, 80, 24); // first resize spawns
    socket.emit("message", resizeFrame(90, 30)); // second resize

    expect(onSubmittedInput).not.toHaveBeenCalled();
  });

  it("debounces onTerminalOutput to at most one nudge per 120ms window", () => {
    const term = new FakePty();
    const { socket, onTerminalOutput } = connect();
    spawnVia(socket, term, 80, 24);

    vi.useFakeTimers();

    term.emitData("a"); // first output -> nudge
    term.emitData("b"); // within the same instant -> suppressed
    expect(onTerminalOutput).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200); // past the 120ms window
    term.emitData("c"); // -> nudge again
    expect(onTerminalOutput).toHaveBeenCalledTimes(2);
  });
});

describe("TerminalBridge resize against a dead pty", () => {
  // Regression: stopping a worker kills its tmux window, so the attach pty
  // exits and closes its fd. The browser refits the terminal column as the
  // panel unmounts, and the in-flight resize reached node-pty's ioctl on the
  // closed fd (EBADF). The throw escaped this ws 'message' callback and took
  // the whole server down with it.
  it("survives a pty resize failure and tears the connection down", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    term.resize.mockImplementation(() => {
      throw new Error("ioctl(2) failed, EBADF");
    });

    expect(() => socket.emit("message", resizeFrame(100, 40))).not.toThrow();
    expect(socket.close).toHaveBeenCalled();

    // Torn down: later frames must not reach the dead handle at all.
    socket.emit("message", resizeFrame(120, 50));
    expect(term.resize).toHaveBeenCalledTimes(1);
  });

  it("stops routing frames to the pty once it has exited", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    term.emitExit();

    socket.emit("message", resizeFrame(100, 40));
    socket.emit("message", "ls -la\r");

    expect(term.resize).not.toHaveBeenCalled();
    expect(term.write).not.toHaveBeenCalled();
  });

  it("does not throw when killing a pty that has already exited", () => {
    const term = new FakePty();
    const { socket } = connect();
    spawnVia(socket, term, 80, 24);

    term.kill.mockImplementation(() => {
      throw new Error("ESRCH");
    });

    expect(() => term.emitExit()).not.toThrow();
  });
});
