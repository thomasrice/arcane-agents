import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { describe, expect, it, vi } from "vitest";
import type { WsServerEvent } from "../../shared/types";
import { RealtimeHub } from "./realtimeHub";

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  readonly send = vi.fn<(payload: string) => void>();
  readonly terminate = vi.fn<() => void>();
}

const sampleEvent: WsServerEvent = {
  type: "worker-removed",
  workerId: "worker-1"
};

describe("RealtimeHub", () => {
  it("does not throw when sendTo targets a stale socket", () => {
    const hub = new RealtimeHub();
    const socket = new FakeSocket();
    socket.send.mockImplementation(() => {
      throw new Error("stale socket");
    });

    hub.addClient(socket as unknown as WebSocket);

    expect(() => hub.sendTo(socket as unknown as WebSocket, sampleEvent)).not.toThrow();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not throw when broadcast encounters stale sockets", () => {
    const hub = new RealtimeHub();
    const failingSocket = new FakeSocket();
    const healthySocket = new FakeSocket();

    failingSocket.send.mockImplementation(() => {
      throw new Error("socket closed mid-send");
    });

    hub.addClient(failingSocket as unknown as WebSocket);
    hub.addClient(healthySocket as unknown as WebSocket);

    expect(() => hub.broadcast(sampleEvent)).not.toThrow();
    expect(failingSocket.terminate).toHaveBeenCalledTimes(1);
    expect(healthySocket.send).toHaveBeenCalledTimes(1);

    hub.broadcast(sampleEvent);
    expect(failingSocket.send).toHaveBeenCalledTimes(1);
    expect(healthySocket.send).toHaveBeenCalledTimes(2);
  });
});
