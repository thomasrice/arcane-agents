import type http from "node:http";
import { WorkerRepository } from "../persistence/workerRepository";
import { StatusMonitor } from "../status/statusMonitor";
import type { WsServers } from "./websocketUpgrade";

interface RegisterShutdownHandlersInput {
  statusMonitor: StatusMonitor;
  server: http.Server;
  workers: WorkerRepository;
  wsServers?: WsServers;
  timeoutMs?: number;
  exit?: (code: number) => void;
}

export function registerShutdownHandlers({
  statusMonitor,
  server,
  workers,
  wsServers,
  timeoutMs,
  exit
}: RegisterShutdownHandlersInput): void {
  const shutdown = createShutdownHandler({
    statusMonitor,
    server,
    workers,
    wsServers,
    timeoutMs,
    exit
  });

  const forceExit = exit ?? process.exit;
  let isShuttingDown = false;

  const handleSignal = (signal: NodeJS.Signals): void => {
    const forceCode = signal === "SIGINT" ? 130 : 143;

    if (!isShuttingDown) {
      isShuttingDown = true;
      console.log(`[arcane-agents] received ${signal}; shutting down... (press Ctrl-C again to force exit)`);
      void shutdown();
      return;
    }

    console.warn(`[arcane-agents] received ${signal} again; forcing exit.`);
    forceExit(forceCode);
  };

  process.on("SIGINT", () => {
    handleSignal("SIGINT");
  });

  process.on("SIGTERM", () => {
    handleSignal("SIGTERM");
  });
}

export function createShutdownHandler({
  statusMonitor,
  server,
  workers,
  wsServers,
  timeoutMs = 2_000,
  exit = process.exit
}: RegisterShutdownHandlersInput): () => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  return async () => {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    shutdownPromise = runGracefulShutdown({
      statusMonitor,
      server,
      workers,
      wsServers,
      timeoutMs,
      exit
    });

    await shutdownPromise;
  };
}

interface RunGracefulShutdownInput {
  statusMonitor: StatusMonitor;
  server: http.Server;
  workers: WorkerRepository;
  wsServers?: WsServers;
  timeoutMs: number;
  exit: (code: number) => void;
}

async function runGracefulShutdown({
  statusMonitor,
  server,
  workers,
  wsServers,
  timeoutMs,
  exit
}: RunGracefulShutdownInput): Promise<void> {
  let exited = false;
  let timeoutId: NodeJS.Timeout;

  const complete = (code: number): void => {
    if (exited) {
      return;
    }

    exited = true;
    clearTimeout(timeoutId);
    exit(code);
  };

  const timeoutPromise = new Promise<number>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(1);
    }, timeoutMs);

    if (typeof timeoutId.unref === "function") {
      timeoutId.unref();
    }
  });

  statusMonitor.stop();

  const cleanupPromise = (async (): Promise<number> => {
    let hadError = false;

    if (wsServers) {
      terminateWsClients(wsServers.realtimeWss);
      terminateWsClients(wsServers.terminalWss);

      const wsCloseResults = await Promise.allSettled([
        closeWsServer(wsServers.realtimeWss),
        closeWsServer(wsServers.terminalWss)
      ]);

      if (wsCloseResults.some((result) => result.status === "rejected")) {
        hadError = true;
      }
    }

    try {
      await closeHttpServer(server);
    } catch {
      hadError = true;
    }

    try {
      workers.close();
    } catch {
      hadError = true;
    }

    return hadError ? 1 : 0;
  })();

  const exitCode = await Promise.race([cleanupPromise, timeoutPromise]);
  complete(exitCode);
}

function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      server.close((error?: Error) => {
        if (!error || isServerNotRunningError(error)) {
          resolve();
          return;
        }

        reject(error);
      });

      if (typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
      }

      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    } catch (error) {
      reject(error);
    }
  });
}

function closeWsServer(wsServer: WsServers["realtimeWss"]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      wsServer.close((error?: Error) => {
        if (!error) {
          resolve();
          return;
        }

        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function terminateWsClients(wsServer: WsServers["realtimeWss"]): void {
  for (const client of wsServer.clients) {
    try {
      client.terminate();
    } catch {
      // no-op
    }
  }
}

function isServerNotRunningError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING";
}
