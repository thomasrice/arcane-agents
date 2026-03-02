import type http from "node:http";
import { WorkerRepository } from "../persistence/workerRepository";
import { StatusMonitor } from "../status/statusMonitor";

interface RegisterShutdownHandlersInput {
  statusMonitor: StatusMonitor;
  server: http.Server;
  workers: WorkerRepository;
}

export function registerShutdownHandlers({ statusMonitor, server, workers }: RegisterShutdownHandlersInput): void {
  const shutdown = () => {
    statusMonitor.stop();
    server.close();
    workers.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
