import type express from "express";
import type { Response } from "express";
import { getCharacterManifest } from "../../assets/characterManifest";
import { listAvatarVoiceLineFiles } from "../../assets/voiceLineCatalog";
import { RealtimeHub } from "../../ws/realtimeHub";
import { OrchestratorService } from "../../orchestrator/orchestratorService";
import type { StatusMonitor } from "../../status/statusMonitor";
import type { Worker } from "../../../shared/types";
import { notFoundError } from "../appError";
import { asyncRoute } from "../asyncRoute";
import {
  broadcastInputSchema,
  movementModeSchema,
  parseOrThrow,
  positionSchema,
  renameSchema,
  spawnSchema
} from "../schemas";

interface RegisterApiRoutesDeps {
  orchestrator: OrchestratorService;
  hub: RealtimeHub;
  statusMonitor: StatusMonitor;
}

function respondWorker(res: Response, hub: RealtimeHub, worker: Worker): void {
  hub.broadcast({ type: "worker-updated", worker });
  res.json(worker);
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

  app.get("/api/assets/characters/:characterType/manifest", asyncRoute((req, res) => {
    const manifest = getCharacterManifest(req.params.characterType);
    if (!manifest) {
      throw notFoundError(`No sprite manifest for character '${req.params.characterType}'.`, "character_not_found");
    }

    res.json(manifest);
  }));

  app.get("/api/avatars/:avatarType/voice-lines", (req, res) => {
    const avatarType = req.params.avatarType;
    const files = listAvatarVoiceLineFiles(avatarType);
    res.json({
      avatarType,
      files
    });
  });

  app.get("/api/workers", (_req, res) => {
    res.json({
      workers: orchestrator.listWorkers()
    });
  });

  app.get("/api/status-debug", (_req, res) => {
    res.json({
      workers: statusMonitor.listWorkerStatusDebug(),
      performance: statusMonitor.getStatusPerformanceDebug()
    });
  });

  app.get("/api/workers/:workerId/status-debug", (req, res) => {
    const debug = statusMonitor.getWorkerStatusDebug(req.params.workerId);
    if (!debug) {
      res.status(404).json({
        error: `No status debug snapshot found for agent '${req.params.workerId}'.`
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

  app.post("/api/workers/spawn", asyncRoute(async (req, res) => {
    const spawnInput = parseOrThrow(spawnSchema, req.body, "spawn_invalid_payload");
    const worker = await orchestrator.spawn(spawnInput);
    hub.broadcast({ type: "worker-created", worker });
    res.status(201).json(worker);
  }));

  app.post("/api/workers/:workerId/stop", asyncRoute(async (req, res) => {
    const result = await orchestrator.stop(req.params.workerId);
    if (result.removed) {
      hub.broadcast({ type: "worker-removed", workerId: result.workerId });
    }
    res.json({ ok: true, ...result });
  }));

  app.post("/api/workers/:workerId/restart", asyncRoute(async (req, res) => {
    const worker = await orchestrator.restart(req.params.workerId);
    respondWorker(res, hub, worker);
  }));

  app.patch("/api/workers/:workerId/position", asyncRoute((req, res) => {
    const { x, y } = parseOrThrow(positionSchema, req.body, "position_invalid_payload");
    const worker = orchestrator.updatePosition(req.params.workerId, { x, y });
    respondWorker(res, hub, worker);
  }));

  app.patch("/api/workers/:workerId/rename", asyncRoute((req, res) => {
    const { displayName } = parseOrThrow(renameSchema, req.body, "rename_invalid_payload");
    const worker = orchestrator.rename(req.params.workerId, displayName);
    respondWorker(res, hub, worker);
  }));

  app.patch("/api/workers/:workerId/movement-mode", asyncRoute((req, res) => {
    const { movementMode } = parseOrThrow(movementModeSchema, req.body, "movement_mode_invalid_payload");
    const worker = orchestrator.setMovementMode(req.params.workerId, movementMode);
    respondWorker(res, hub, worker);
  }));

  app.post("/api/workers/:workerId/open-terminal", asyncRoute(async (req, res) => {
    await orchestrator.openInExternalTerminal(req.params.workerId);
    res.json({ ok: true });
  }));

  app.post("/api/workers/broadcast-input", asyncRoute(async (req, res) => {
    const input = parseOrThrow(broadcastInputSchema, req.body, "broadcast_invalid_payload");
    const result = await orchestrator.broadcastInput(input.workerIds, input.text, {
      submit: input.submit
    });

    if (result.deliveredWorkerIds.length > 0) {
      statusMonitor.requestPollSoon();
    }

    res.json(result);
  }));
}
