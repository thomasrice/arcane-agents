import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express, { type Request, type Response } from "express";
import { WebSocketServer } from "ws";
import type { WorkerSpawnInput, WsServerEvent } from "../shared/types";
import { DiscoveryService } from "./config/discovery";
import { getOverworldPaths, loadResolvedConfig } from "./config/loadConfig";
import { OrchestratorService } from "./orchestrator/orchestratorService";
import { WorkerRepository } from "./persistence/workerRepository";
import { StatusMonitor } from "./status/statusMonitor";
import { TmuxAdapter } from "./tmux/tmuxAdapter";
import { RealtimeHub } from "./ws/realtimeHub";
import { TerminalBridge } from "./ws/terminalBridge";

async function bootstrap(): Promise<void> {
  const paths = getOverworldPaths();
  fs.mkdirSync(paths.configDir, { recursive: true });
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.mkdirSync(paths.cacheDir, { recursive: true });

  const baseConfig = loadResolvedConfig(paths);
  const discoveryService = new DiscoveryService();
  const initialDiscovery = await discoveryService.discover(baseConfig);
  for (const warning of initialDiscovery.warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[overworld] ${warning}`);
  }

  const workers = new WorkerRepository(paths.dbPath);
  const tmux = new TmuxAdapter(baseConfig.backend.tmux.sessionName);
  const orchestrator = new OrchestratorService(baseConfig, workers, tmux);
  orchestrator.setDiscoveredProjects(initialDiscovery.projects);

  const hub = new RealtimeHub();
  const terminalBridge = new TerminalBridge(workers);

  await orchestrator.reconcileWithTmux();

  const statusMonitor = new StatusMonitor(
    workers,
    tmux,
    baseConfig.backend.tmux.pollIntervalMs,
    (worker) => {
      hub.broadcast({
        type: "worker-updated",
        worker
      });
    },
    (workerId) => {
      hub.broadcast({
        type: "worker-removed",
        workerId
      });
    }
  );
  statusMonitor.start();

  const app = express();
  app.use(express.json());

  const assetsDir = path.resolve(process.cwd(), "assets");
  if (fs.existsSync(assetsDir)) {
    app.use("/api/assets", express.static(assetsDir));
  }

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString()
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json(orchestrator.getConfig());
  });

  app.get("/api/config/projects", (_req, res) => {
    const projects = Object.entries(orchestrator.getConfig().projects).map(([id, project]) => ({
      id,
      ...project
    }));
    res.json({
      projects
    });
  });

  app.post("/api/config/rediscover", async (_req, res) => {
    try {
      const discovery = await discoveryService.discover(baseConfig);
      const config = orchestrator.setDiscoveredProjects(discovery.projects);
      res.json({
        discovered: Object.entries(config.projects)
          .filter(([, project]) => project.source === "discovered")
          .map(([id, project]) => ({ id, ...project })),
        warnings: discovery.warnings
      });
    } catch (error) {
      handleRequestError(res, error);
    }
  });

  app.get("/api/workers", (_req, res) => {
    res.json({
      workers: orchestrator.listWorkers()
    });
  });

  app.post("/api/workers/spawn", async (req, res) => {
    try {
      const spawnInput = parseSpawnInput(req.body);
      const worker = await orchestrator.spawn(spawnInput);
      hub.broadcast({ type: "worker-created", worker });
      res.status(201).json(worker);
    } catch (error) {
      handleRequestError(res, error);
    }
  });

  app.post("/api/workers/:workerId/stop", async (req, res) => {
    try {
      const workerId = await orchestrator.stop(req.params.workerId);
      hub.broadcast({ type: "worker-removed", workerId });
      res.json({ ok: true, workerId });
    } catch (error) {
      handleRequestError(res, error);
    }
  });

  app.post("/api/workers/:workerId/restart", async (req, res) => {
    try {
      const worker = await orchestrator.restart(req.params.workerId);
      hub.broadcast({ type: "worker-updated", worker });
      res.json(worker);
    } catch (error) {
      handleRequestError(res, error);
    }
  });

  app.patch("/api/workers/:workerId/position", (req, res) => {
    try {
      const x = Number(req.body?.x);
      const y = Number(req.body?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("Position requires numeric x and y values.");
      }

      const worker = orchestrator.updatePosition(req.params.workerId, { x, y });
      hub.broadcast({ type: "worker-updated", worker });
      res.json(worker);
    } catch (error) {
      handleRequestError(res, error);
    }
  });

  app.delete("/api/workers/:workerId", async (req, res) => {
    try {
      const removed = await orchestrator.remove(req.params.workerId);
      if (!removed) {
        res.status(404).json({ error: "Worker not found." });
        return;
      }

      hub.broadcast({ type: "worker-removed", workerId: req.params.workerId });
      res.status(204).send();
    } catch (error) {
      handleRequestError(res, error);
    }
  });

  app.post("/api/workers/:workerId/open-terminal", async (req, res) => {
    try {
      await orchestrator.openInExternalTerminal(req.params.workerId);
      res.json({ ok: true });
    } catch (error) {
      handleRequestError(res, error);
    }
  });

  const clientDistPath = path.resolve(process.cwd(), "dist/client");
  if (process.env.NODE_ENV === "production" && fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDistPath, "index.html"));
    });
  }

  const server = http.createServer(app);

  const realtimeWss = new WebSocketServer({ noServer: true });
  realtimeWss.on("connection", (socket) => {
    hub.addClient(socket);
    const initialEvent: WsServerEvent = {
      type: "init",
      workers: orchestrator.listWorkers(),
      config: orchestrator.getConfig()
    };
    hub.sendTo(socket, initialEvent);

  });

  const terminalWss = new WebSocketServer({ noServer: true });
  terminalWss.on("connection", (socket) => {
    const workerId = (socket as { workerId?: string }).workerId;
    if (!workerId) {
      socket.close();
      return;
    }

    terminalBridge.connect(workerId, socket);
  });

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

  const host = process.env.OVERWORLD_API_HOST ?? baseConfig.server.host;
  const port = Number(process.env.OVERWORLD_API_PORT ?? baseConfig.server.port);

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`[overworld] server listening on http://${host}:${port}`);
  });

  const shutdown = () => {
    statusMonitor.stop();
    server.close();
    workers.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function parseSpawnInput(body: unknown): WorkerSpawnInput {
  if (!body || typeof body !== "object") {
    throw new Error("Spawn body must be an object.");
  }

  const record = body as Record<string, unknown>;

  if (typeof record.shortcutIndex === "number" && Number.isInteger(record.shortcutIndex)) {
    return { shortcutIndex: record.shortcutIndex };
  }

  if (typeof record.profileId === "string" && record.profileId.trim().length > 0) {
    return { profileId: record.profileId };
  }

  if (typeof record.projectId === "string" && typeof record.runtimeId === "string") {
    const command = Array.isArray(record.command)
      ? record.command.filter((value): value is string => typeof value === "string")
      : undefined;
    return {
      projectId: record.projectId,
      runtimeId: record.runtimeId,
      command
    };
  }

  throw new Error("Invalid spawn request: expected shortcutIndex, profileId, or projectId+runtimeId.");
}

function handleRequestError(res: Response, error: unknown): void {
  if (error instanceof Error) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: "Unknown error" });
}

void bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[overworld] fatal startup error", error);
  process.exit(1);
});
