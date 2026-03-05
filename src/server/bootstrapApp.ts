import http from "node:http";
import { createHttpApp } from "./bootstrap/httpApp";
import { createServerContext } from "./bootstrap/serverContext";
import { registerShutdownHandlers } from "./bootstrap/shutdown";
import { attachUpgradeHandler, createWsServers } from "./bootstrap/websocketUpgrade";

export async function bootstrap(): Promise<void> {
  console.log("[arcane-agents] launching Arcane Agents...");

  const context = await createServerContext();
  context.statusMonitor.start();

  const app = createHttpApp(context);
  const server = http.createServer(app);
  const wsServers = createWsServers(context);
  attachUpgradeHandler(server, wsServers);

  const host = process.env.ARCANE_AGENTS_API_HOST ?? context.config.server.host;
  const port = Number(process.env.ARCANE_AGENTS_API_PORT ?? context.config.server.port);
  const appUrl = `http://${host}:${port}`;

  server.listen(port, host, () => {
    console.log("[arcane-agents] Arcane Agents is ready.");
    console.log(`[arcane-agents] app: ${appUrl}`);
    console.log(`[arcane-agents] config: ${context.paths.configPath}`);
    console.log("[arcane-agents] press Ctrl-C to stop.");
  });

  registerShutdownHandlers({
    statusMonitor: context.statusMonitor,
    server,
    wsServers,
    workers: context.workers
  });
}
