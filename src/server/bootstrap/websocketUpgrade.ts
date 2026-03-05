import type http from "node:http";
import { WebSocketServer } from "ws";
import type { WsServerEvent } from "../../shared/types";
import type { ServerContext } from "./serverContext";

const terminalPathPrefix = "/api/terminal/";
const validWorkerIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

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
      socket.close(1008, "Invalid agent id");
      return;
    }

    try {
      context.terminalBridge.connect(workerId, socket);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[arcane-agents] terminal connection error for ${workerId}: ${detail}`);
      if (socket.readyState === socket.OPEN) {
        socket.close(1011, "Terminal connection failed");
      }
    }
  });

  return {
    realtimeWss,
    terminalWss
  };
}

export function attachUpgradeHandler(server: http.Server, { realtimeWss, terminalWss }: WsServers): void {
  server.on("upgrade", (request, socket, head) => {
    const requestUrl = parseRequestUrl(request);
    if (!requestUrl) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    const pathname = requestUrl.pathname;

    if (pathname === "/api/ws") {
      try {
        realtimeWss.handleUpgrade(request, socket, head, (websocket) => {
          realtimeWss.emit("connection", websocket, request);
        });
      } catch {
        rejectUpgrade(socket, 500, "Internal Server Error");
      }
      return;
    }

    if (pathname.startsWith(terminalPathPrefix)) {
      const workerId = decodeTerminalWorkerId(pathname.slice(terminalPathPrefix.length));
      if (!workerId) {
        rejectUpgrade(socket, 400, "Bad Request");
        return;
      }

      try {
        terminalWss.handleUpgrade(request, socket, head, (websocket) => {
          (websocket as { workerId?: string }).workerId = workerId;
          terminalWss.emit("connection", websocket, request);
        });
      } catch {
        rejectUpgrade(socket, 500, "Internal Server Error");
      }
      return;
    }

    rejectUpgrade(socket, 404, "Not Found");
  });
}

export function decodeTerminalWorkerId(rawPathToken: string): string | undefined {
  if (!rawPathToken) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPathToken);
  } catch {
    return undefined;
  }

  if (!validWorkerIdPattern.test(decoded)) {
    return undefined;
  }

  return decoded;
}

function parseRequestUrl(request: http.IncomingMessage): URL | undefined {
  try {
    return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  } catch {
    return undefined;
  }
}

function rejectUpgrade(
  socket: {
    writable: boolean;
    write: (chunk: string) => unknown;
    destroy: () => void;
  },
  statusCode: number,
  statusText: string
): void {
  if (socket.writable) {
    socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  socket.destroy();
}
