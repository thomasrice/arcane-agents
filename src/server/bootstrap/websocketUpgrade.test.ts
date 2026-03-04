import { EventEmitter } from "node:events";
import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { attachUpgradeHandler, decodeTerminalWorkerId, type WsServers } from "./websocketUpgrade";

class FakeSocket {
  writable = true;
  readonly write = vi.fn<(payload: string) => void>();
  readonly destroy = vi.fn<() => void>();
}

function createRequest(url: string): http.IncomingMessage {
  return {
    url,
    headers: {
      host: "localhost:7601"
    }
  } as unknown as http.IncomingMessage;
}

function createWsServers(): {
  servers: WsServers;
  realtimeHandleUpgrade: ReturnType<typeof vi.fn>;
  terminalHandleUpgrade: ReturnType<typeof vi.fn>;
  terminalEmit: ReturnType<typeof vi.fn>;
} {
  const realtimeHandleUpgrade = vi.fn((_request, _socket, _head, callback: (socket: unknown) => void) => {
    callback({});
  });

  const terminalEmit = vi.fn();
  const terminalHandleUpgrade = vi.fn((_request, _socket, _head, callback: (socket: unknown) => void) => {
    callback({});
  });

  return {
    servers: {
      realtimeWss: {
        handleUpgrade: realtimeHandleUpgrade,
        emit: vi.fn()
      } as unknown as WsServers["realtimeWss"],
      terminalWss: {
        handleUpgrade: terminalHandleUpgrade,
        emit: terminalEmit
      } as unknown as WsServers["terminalWss"]
    },
    realtimeHandleUpgrade,
    terminalHandleUpgrade,
    terminalEmit
  };
}

describe("decodeTerminalWorkerId", () => {
  it("accepts valid worker IDs and rejects malformed tokens", () => {
    expect(decodeTerminalWorkerId("worker-1")).toBe("worker-1");
    expect(decodeTerminalWorkerId("worker_1")).toBe("worker_1");
    expect(decodeTerminalWorkerId("worker%2F1")).toBeUndefined();
    expect(decodeTerminalWorkerId("%E0%A4%A")).toBeUndefined();
    expect(decodeTerminalWorkerId("")).toBeUndefined();
  });
});

describe("attachUpgradeHandler", () => {
  it("rejects malformed terminal worker IDs with a clean 400 response", () => {
    const server = new EventEmitter() as unknown as http.Server;
    const { servers, terminalHandleUpgrade } = createWsServers();
    attachUpgradeHandler(server, servers);

    const socket = new FakeSocket();
    server.emit("upgrade", createRequest("/api/terminal/%E0%A4%A"), socket, Buffer.alloc(0));

    expect(terminalHandleUpgrade).not.toHaveBeenCalled();
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("400 Bad Request"));
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown websocket paths with a clean 404 response", () => {
    const server = new EventEmitter() as unknown as http.Server;
    const { servers } = createWsServers();
    attachUpgradeHandler(server, servers);

    const socket = new FakeSocket();
    server.emit("upgrade", createRequest("/api/unknown"), socket, Buffer.alloc(0));

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("404 Not Found"));
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("upgrades valid terminal websocket requests", () => {
    const server = new EventEmitter() as unknown as http.Server;
    const { servers, terminalHandleUpgrade, terminalEmit } = createWsServers();
    attachUpgradeHandler(server, servers);

    const socket = new FakeSocket();
    server.emit("upgrade", createRequest("/api/terminal/worker-22"), socket, Buffer.alloc(0));

    expect(terminalHandleUpgrade).toHaveBeenCalledTimes(1);
    expect(terminalEmit).toHaveBeenCalledTimes(1);

    const [, websocket] = terminalEmit.mock.calls[0] ?? [];
    expect((websocket as { workerId?: string }).workerId).toBe("worker-22");
  });
});
