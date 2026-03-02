import type express from "express";
import { RealtimeHub } from "../../ws/realtimeHub";
import { OrchestratorService } from "../../orchestrator/orchestratorService";
import type { StatusMonitor } from "../../status/statusMonitor";
import { handleRequestError } from "../errorResponse";
import { parseBroadcastInput, parseSpawnInput } from "../requestParsers";

interface RegisterApiRoutesDeps {
  orchestrator: OrchestratorService;
  hub: RealtimeHub;
  statusMonitor: StatusMonitor;
}

export function registerApiRoutes(app: express.Express, { orchestrator, hub, statusMonitor }: RegisterApiRoutesDeps): void {
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString()
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json(orchestrator.getConfig());
  });

  app.get("/api/workers", (_req, res) => {
    res.json({
      workers: orchestrator.listWorkers()
    });
  });

  app.get("/api/status-debug", (_req, res) => {
    res.json({
      workers: statusMonitor.listWorkerStatusDebug()
    });
  });

  app.get("/api/workers/:workerId/status-debug", (req, res) => {
    const debug = statusMonitor.getWorkerStatusDebug(req.params.workerId);
    if (!debug) {
      res.status(404).json({
        error: `No status debug snapshot found for worker '${req.params.workerId}'.`
      });
      return;
    }

    res.json({
      ...debug,
      transitions: statusMonitor.getWorkerStatusHistory(req.params.workerId)
    });
  });

  app.get("/api/workers/:workerId/status-history", (req, res) => {
    res.json({
      workerId: req.params.workerId,
      transitions: statusMonitor.getWorkerStatusHistory(req.params.workerId)
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

  app.patch("/api/workers/:workerId/rename", (req, res) => {
    try {
      const displayName = req.body?.displayName;
      if (typeof displayName !== "string") {
        throw new Error("Rename request requires a string displayName.");
      }

      const worker = orchestrator.rename(req.params.workerId, displayName);
      hub.broadcast({ type: "worker-updated", worker });
      res.json(worker);
    } catch (error) {
      handleRequestError(res, error);
    }
  });

  app.patch("/api/workers/:workerId/movement-mode", (req, res) => {
    try {
      const movementMode = req.body?.movementMode;
      if (movementMode !== "hold" && movementMode !== "wander") {
        throw new Error("movementMode must be 'hold' or 'wander'.");
      }

      const worker = orchestrator.setMovementMode(req.params.workerId, movementMode);
      hub.broadcast({ type: "worker-updated", worker });
      res.json(worker);
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

  app.post("/api/workers/broadcast-input", async (req, res) => {
    try {
      const input = parseBroadcastInput(req.body);
      const result = await orchestrator.broadcastInput(input.workerIds, input.text, {
        submit: input.submit
      });
      res.json(result);
    } catch (error) {
      handleRequestError(res, error);
    }
  });
}
