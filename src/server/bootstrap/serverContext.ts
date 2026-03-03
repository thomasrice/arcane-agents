import fs from "node:fs";
import type { ResolvedConfig } from "../../shared/types";
import { DiscoveryService } from "../config/discovery";
import { getOverworldPaths, loadResolvedConfig } from "../config/loadConfig";
import { OrchestratorService } from "../orchestrator/orchestratorService";
import { WorkerRepository } from "../persistence/workerRepository";
import { StatusMonitor } from "../status/statusMonitor";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import { RealtimeHub } from "../ws/realtimeHub";
import { TerminalBridge } from "../ws/terminalBridge";

export interface ServerContext {
  paths: ReturnType<typeof getOverworldPaths>;
  config: ResolvedConfig;
  workers: WorkerRepository;
  tmux: TmuxAdapter;
  orchestrator: OrchestratorService;
  hub: RealtimeHub;
  terminalBridge: TerminalBridge;
  statusMonitor: StatusMonitor;
}

export async function createServerContext(): Promise<ServerContext> {
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

  const terminalBridge = new TerminalBridge(workers, {
    onSubmittedInput: () => {
      statusMonitor.requestPollSoon();
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
