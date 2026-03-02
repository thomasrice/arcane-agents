import type http from "node:http";
import { WebSocketServer } from "ws";
import type { WsServerEvent } from "../../shared/types";
import type { ServerContext } from "./serverContext";

export interface WsServers {
  realtimeWss: WebSocketServer;
  terminalWss: WebSocketServer;
}

export function createWsServers(context: ServerContext): WsServers {
  const realtimeWss = new WebSocketServer({ noServer: true });
  realtimeWss.on("connection", (socket) => {
    context.hub.addClient(socket);
    const initialEvent: WsServerEvent = {
      type: "init",
      workers: context.orchestrator.listWorkers(),
      config: context.orchestrator.getConfig()
    };
    context.hub.sendTo(socket, initialEvent);
  });

  const terminalWss = new WebSocketServer({ noServer: true });
  terminalWss.on("connection", (socket) => {
    const workerId = (socket as { workerId?: string }).workerId;
    if (!workerId) {
      socket.close();
      return;
    }

    context.terminalBridge.connect(workerId, socket);
  });

  return {
    realtimeWss,
    terminalWss
  };
}

export function attachUpgradeHandler(server: http.Server, { realtimeWss, terminalWss }: WsServers): void {
  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pathname = requestUrl.pathname;

    if (pathname === "/api/ws") {
      realtimeWss.handleUpgrade(request, socket, head, (websocket) => {
        realtimeWss.emit("connection", websocket, request);
      });
      return;
    }

    if (pathname.startsWith("/api/terminal/")) {
      const workerId = decodeURIComponent(pathname.slice("/api/terminal/".length));
      terminalWss.handleUpgrade(request, socket, head, (websocket) => {
        (websocket as { workerId?: string }).workerId = workerId;
        terminalWss.emit("connection", websocket, request);
      });
      return;
    }

    socket.destroy();
  });
}
