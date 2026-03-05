import http from "node:http";
import { createHttpApp } from "./bootstrap/httpApp";
import { createServerContext } from "./bootstrap/serverContext";
import { registerShutdownHandlers } from "./bootstrap/shutdown";
import { attachUpgradeHandler, createWsServers } from "./bootstrap/websocketUpgrade";

export async function bootstrap(): Promise<void> {
  const context = await createServerContext();
  context.statusMonitor.start();

  const app = createHttpApp(context);
  const server = http.createServer(app);
  const wsServers = createWsServers(context);
  attachUpgradeHandler(server, wsServers);

  const host = process.env.ARCANE_AGENTS_API_HOST ?? context.config.server.host;
  const port = Number(process.env.ARCANE_AGENTS_API_PORT ?? context.config.server.port);

  server.listen(port, host, () => {
    console.log(`[arcane-agents] using config file: ${context.paths.configPath}`);
    console.log(`[arcane-agents] server listening on http://${host}:${port}`);
  });

  registerShutdownHandlers({
    statusMonitor: context.statusMonitor,
    server,
    workers: context.workers
  });
}
