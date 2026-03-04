import type http from "node:http";
import { WorkerRepository } from "../persistence/workerRepository";
import { StatusMonitor } from "../status/statusMonitor";

interface RegisterShutdownHandlersInput {
  statusMonitor: StatusMonitor;
  server: http.Server;
  workers: WorkerRepository;
  timeoutMs?: number;
  exit?: (code: number) => void;
}

export function registerShutdownHandlers({ statusMonitor, server, workers, timeoutMs, exit }: RegisterShutdownHandlersInput): void {
  const shutdown = createShutdownHandler({
    statusMonitor,
    server,
    workers,
    timeoutMs,
    exit
  });

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

export function createShutdownHandler({
  statusMonitor,
  server,
  workers,
  timeoutMs = 7_500,
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
  timeoutMs: number;
  exit: (code: number) => void;
}

async function runGracefulShutdown({
  statusMonitor,
  server,
  workers,
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
    } catch (error) {
      reject(error);
    }
  });
}

function isServerNotRunningError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING";
}
