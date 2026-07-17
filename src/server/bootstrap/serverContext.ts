import fs from "node:fs";
import type { ResolvedConfig } from "../../shared/types";
import { DiscoveryService } from "../config/discovery";
import { applySessionOverrides, getArcaneAgentsPaths, loadResolvedConfig } from "../config/loadConfig";
import { OrchestratorService } from "../orchestrator/orchestratorService";
import { WorkerRepository } from "../persistence/workerRepository";
import { StatusMonitor } from "../status/statusMonitor";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import { RealtimeHub } from "../ws/realtimeHub";
import { TerminalBridge } from "../ws/terminalBridge";

export interface ServerContext {
  paths: ReturnType<typeof getArcaneAgentsPaths>;
  config: ResolvedConfig;
  workers: WorkerRepository;
  tmux: TmuxAdapter;
  orchestrator: OrchestratorService;
  hub: RealtimeHub;
  terminalBridge: TerminalBridge;
  statusMonitor: StatusMonitor;
}

export async function createServerContext(sessionName?: string): Promise<ServerContext> {
  const paths = getArcaneAgentsPaths(sessionName);
  fs.mkdirSync(paths.configDir, { recursive: true });
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.mkdirSync(paths.cacheDir, { recursive: true });

  const baseConfig = applySessionOverrides(loadResolvedConfig(paths), sessionName);

  const discoveryService = new DiscoveryService();
  const initialDiscovery = await discoveryService.discover(baseConfig);
  for (const warning of initialDiscovery.warnings) {
    console.warn(`[arcane-agents] ${warning}`);
  }

  const workers = new WorkerRepository(paths.dbPath);
  const tmux = new TmuxAdapter(baseConfig.backend.tmux);
  await tmux.ensureManagedDefaults();
  const orchestrator = new OrchestratorService(baseConfig, workers, tmux);
  orchestrator.setDiscoveredProjects(initialDiscovery.projects);

  const hub = new RealtimeHub();

  // Adopted workers (managed tmux windows with no persisted record) are new to
  // any connected client, so announce them over the realtime hub instead of
  // waiting for the next status poll to surface them. The client's ws handler
  // treats worker-created/worker-updated identically (both upsert), so
  // worker-created is the correct shape for a first-time appearance.
  const reconciliation = await orchestrator.reconcileWithTmux();
  for (const worker of reconciliation.adoptedWorkers) {
    hub.broadcast({
      type: "worker-created",
      worker
    });
  }

  const statusMonitor = new StatusMonitor({
    workers,
    tmux,
    pollIntervalMs: baseConfig.backend.tmux.pollIntervalMs,
    onWorkerUpdated: (worker) => {
      hub.broadcast({
        type: "worker-updated",
        worker
      });
    },
    onWorkerRemoved: (workerId) => {
      hub.broadcast({
        type: "worker-removed",
        workerId
      });
    },
    config: baseConfig
  });

  const terminalBridge = new TerminalBridge(workers, baseConfig.backend.tmux, {
    onSubmittedInput: () => {
      statusMonitor.requestPollSoon();
    },
    onTerminalOutput: () => {
      statusMonitor.requestPollSoon(20);
    }
  });

  return {
    paths,
    config: baseConfig,
    workers,
    tmux,
    orchestrator,
    hub,
    terminalBridge,
    statusMonitor
  };
}
