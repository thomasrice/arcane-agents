import type { WebSocket } from "ws";
import type { WsServerEvent } from "../../shared/types";

export class RealtimeHub {
  private readonly clients = new Set<WebSocket>();

  addClient(socket: WebSocket): void {
    this.clients.add(socket);

    socket.on("close", () => {
      this.clients.delete(socket);
    });

    socket.on("error", () => {
      this.clients.delete(socket);
    });
  }

  sendTo(socket: WebSocket, event: WsServerEvent): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(event));
  }

  broadcast(event: WsServerEvent): void {
    const payload = JSON.stringify(event);

    for (const socket of this.clients) {
      if (socket.readyState !== socket.OPEN) {
        continue;
      }
      socket.send(payload);
    }
  }
}
