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

  const host = process.env.OVERWORLD_API_HOST ?? context.config.server.host;
  const port = Number(process.env.OVERWORLD_API_PORT ?? context.config.server.port);

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`[overworld] server listening on http://${host}:${port}`);
  });

  registerShutdownHandlers({
    statusMonitor: context.statusMonitor,
    server,
    workers: context.workers
  });
}

void bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[overworld] fatal startup error", error);
  process.exit(1);
});
