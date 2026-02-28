import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchConfig,
  fetchWorkers,
  openWorkerInTerminal,
  removeWorker,
  restartWorker,
  spawnWorker,
  stopWorker,
  updateWorkerPosition
} from "./api";
import { BottomBar } from "./components/BottomBar";
import { CommandPalette } from "./components/CommandPalette";
import { MapCanvas } from "./components/MapCanvas";
import { SpawnDialog } from "./components/SpawnDialog";
import { TerminalPanel } from "./components/TerminalPanel";
import type { ResolvedConfig, Worker, WorkerSpawnInput, WsServerEvent } from "../shared/types";

export default function App(): JSX.Element {
  const [config, setConfig] = useState<ResolvedConfig | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | undefined>(undefined);
  const [mapCenterToken, setMapCenterToken] = useState(0);
  const [mapCenterWorkerId, setMapCenterWorkerId] = useState<string | undefined>(undefined);
  const [terminalFocusToken, setTerminalFocusToken] = useState(0);
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);

  const activeWorkers = useMemo(() => workers.filter((worker) => worker.status !== "stopped"), [workers]);

  const selectedWorker = useMemo(
    () => activeWorkers.find((worker) => worker.id === selectedWorkerId),
    [activeWorkers, selectedWorkerId]
  );

  useEffect(() => {
    if (!selectedWorkerId) {
      return;
    }

    if (!activeWorkers.some((worker) => worker.id === selectedWorkerId)) {
      setSelectedWorkerId(undefined);
    }
  }, [activeWorkers, selectedWorkerId]);

  useEffect(() => {
    void Promise.all([fetchConfig(), fetchWorkers()])
      .then(([nextConfig, nextWorkers]) => {
        setConfig(nextConfig);
        setWorkers(nextWorkers);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to load Overworld data";
        setErrorText(message);
      });
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/ws`);

      socket.addEventListener("open", () => {
        setErrorText(undefined);
      });

      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(String(event.data)) as WsServerEvent;

        if (payload.type === "init") {
          setConfig(payload.config);
          setWorkers(payload.workers);
          return;
        }

        if (payload.type === "worker-created" || payload.type === "worker-updated") {
          setWorkers((currentWorkers) => upsertWorker(currentWorkers, payload.worker));
          return;
        }

        if (payload.type === "worker-removed") {
          setWorkers((currentWorkers) => currentWorkers.filter((worker) => worker.id !== payload.workerId));
        }
      });

      socket.addEventListener("error", () => {
        setErrorText("Realtime connection failed. Retrying...");
      });

      socket.addEventListener("close", () => {
        if (!cancelled) {
          retryTimer = setTimeout(connect, 2000);
        }
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (paletteOpen || spawnDialogOpen) {
          event.preventDefault();
          setPaletteOpen(false);
          setSpawnDialogOpen(false);
        }
        return;
      }

      if (event.key !== "/") {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setPaletteOpen(true);
      setSpawnDialogOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, spawnDialogOpen]);

  const showError = useCallback((error: unknown) => {
    setErrorText(error instanceof Error ? error.message : "Unknown request failure");
  }, []);

  const onSelectWorker = useCallback((workerId: string | undefined) => {
    setSelectedWorkerId(workerId);
    if (workerId) {
      setTerminalFocusToken((current) => current + 1);
    }
  }, []);

  const runSpawn = useCallback(
    async (input: WorkerSpawnInput) => {
      try {
        const worker = await spawnWorker(input);
        setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
        setSelectedWorkerId(worker.id);
        setTerminalFocusToken((current) => current + 1);
        setMapCenterWorkerId(worker.id);
        setMapCenterToken((current) => current + 1);
        setSpawnDialogOpen(false);
        setPaletteOpen(false);
      } catch (error) {
        showError(error);
      }
    },
    [showError]
  );

  const onStopSelected = useCallback(async () => {
    if (!selectedWorkerId) {
      return;
    }

    try {
      const result = await stopWorker(selectedWorkerId);
      setWorkers((currentWorkers) => currentWorkers.filter((worker) => worker.id !== result.workerId));
      setSelectedWorkerId(undefined);
    } catch (error) {
      showError(error);
    }
  }, [selectedWorkerId, showError]);

  const onRestartSelected = useCallback(async () => {
    if (!selectedWorkerId) {
      return;
    }

    try {
      const worker = await restartWorker(selectedWorkerId);
      setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
    } catch (error) {
      showError(error);
    }
  }, [selectedWorkerId, showError]);

  const onRemoveSelected = useCallback(async () => {
    if (!selectedWorkerId) {
      return;
    }

    try {
      await removeWorker(selectedWorkerId);
      setWorkers((currentWorkers) => currentWorkers.filter((worker) => worker.id !== selectedWorkerId));
      setSelectedWorkerId(undefined);
    } catch (error) {
      showError(error);
    }
  }, [selectedWorkerId, showError]);

  const onOpenSelectedInTerminal = useCallback(async () => {
    if (!selectedWorkerId) {
      return;
    }

    try {
      await openWorkerInTerminal(selectedWorkerId);
    } catch (error) {
      showError(error);
    }
  }, [selectedWorkerId, showError]);

  const onPositionCommit = useCallback(
    (workerId: string, position: { x: number; y: number }) => {
      void updateWorkerPosition(workerId, position.x, position.y)
        .then((worker) => {
          setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
        })
        .catch((error) => {
          showError(error);
        });
    },
    [showError]
  );

  return (
    <div className="app-shell">
      <div className="map-column">
        <MapCanvas
          workers={activeWorkers}
          selectedWorkerId={selectedWorkerId}
          onSelect={onSelectWorker}
          onPositionCommit={onPositionCommit}
          centerOnWorkerId={mapCenterWorkerId}
          centerRequestKey={mapCenterToken}
        />
        <BottomBar
          shortcuts={config?.shortcuts ?? []}
          selectedWorker={selectedWorker}
          onSpawnShortcut={(shortcutIndex) => {
            void runSpawn({ shortcutIndex });
          }}
          onOpenSpawnDialog={() => {
            setSpawnDialogOpen(true);
            setPaletteOpen(false);
          }}
          onOpenPalette={() => {
            setPaletteOpen(true);
            setSpawnDialogOpen(false);
          }}
          onDeselect={() => onSelectWorker(undefined)}
          onOpenSelectedInTerminal={() => {
            void onOpenSelectedInTerminal();
          }}
          onStopSelected={() => {
            void onStopSelected();
          }}
          onRestartSelected={() => {
            void onRestartSelected();
          }}
          onRemoveSelected={() => {
            void onRemoveSelected();
          }}
        />
      </div>

      <div className="terminal-column">
        <div className="terminal-header">
          {selectedWorker ? `${selectedWorker.name} (${selectedWorker.status})` : "Select a worker"}
        </div>
        <TerminalPanel
          workerId={selectedWorker?.id}
          workerName={selectedWorker?.name}
          focusRequestKey={terminalFocusToken}
        />
      </div>

      {config ? (
        <SpawnDialog
          open={spawnDialogOpen}
          projects={config.projects}
          runtimes={config.runtimes}
          onClose={() => setSpawnDialogOpen(false)}
          onSpawn={(projectId, runtimeId) => {
            void runSpawn({ projectId, runtimeId });
          }}
        />
      ) : null}

      {config ? (
        <CommandPalette
          open={paletteOpen}
          config={config}
          onClose={() => setPaletteOpen(false)}
          onSpawnShortcut={(shortcutIndex) => {
            void runSpawn({ shortcutIndex });
          }}
          onSpawnProfile={(profileId) => {
            void runSpawn({ profileId });
          }}
          onSpawnProjectRuntime={(projectId, runtimeId) => {
            void runSpawn({ projectId, runtimeId });
          }}
        />
      ) : null}

      {errorText ? (
        <div className="error-toast" onClick={() => setErrorText(undefined)}>
          {errorText}
        </div>
      ) : null}
    </div>
  );
}

function upsertWorker(currentWorkers: Worker[], worker: Worker): Worker[] {
  const existingIndex = currentWorkers.findIndex((item) => item.id === worker.id);
  if (existingIndex < 0) {
    return [...currentWorkers, worker];
  }

  const nextWorkers = [...currentWorkers];
  nextWorkers[existingIndex] = worker;
  return nextWorkers;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea";
}
