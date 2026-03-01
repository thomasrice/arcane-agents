import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchConfig,
  fetchWorkers,
  openWorkerInTerminal,
  renameWorker,
  setWorkerMovementMode,
  spawnWorker,
  stopWorker,
  updateWorkerPosition
} from "./api";
import { BottomBar } from "./components/BottomBar";
import { CommandPalette } from "./components/CommandPalette";
import { MapCanvas } from "./components/MapCanvas";
import { SpawnDialog } from "./components/SpawnDialog";
import { TerminalPanel } from "./components/TerminalPanel";
import { resolveSpriteAssetType } from "./sprites/spriteLoader";
import type { ResolvedConfig, ShortcutConfig, Worker, WorkerSpawnInput, WsServerEvent } from "../shared/types";

type ControlGroupMap = Partial<Record<number, string>>;

interface FadingWorker {
  worker: Worker;
  startedAtMs: number;
}

type RosterEntry =
  | { kind: "worker"; worker: Worker }
  | { kind: "shortcut"; shortcut: ShortcutConfig; shortcutIndex: number };

const controlGroupStorageKey = "overworld.control-groups.v1";
const layoutSplitStorageKey = "overworld.layout-split.v1";
const killFadeDurationMs = 420;
const defaultMapColumnRatio = 0.61;
const minMapColumnRatio = 0.42;
const maxMapColumnRatio = 0.78;
const mapColumnRatioStep = 0.03;

export default function App(): JSX.Element {
  const [config, setConfig] = useState<ResolvedConfig | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | undefined>(undefined);
  const [mapCenterToken, setMapCenterToken] = useState(0);
  const [mapCenterWorkerId, setMapCenterWorkerId] = useState<string | undefined>(undefined);
  const [terminalFocusToken, setTerminalFocusToken] = useState<number | undefined>(undefined);
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [killConfirmWorkerId, setKillConfirmWorkerId] = useState<string | undefined>(undefined);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameTargetWorkerId, setRenameTargetWorkerId] = useState<string | undefined>(undefined);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const [fadingWorkers, setFadingWorkers] = useState<FadingWorker[]>([]);
  const [mapColumnRatio, setMapColumnRatio] = useState<number>(() => loadMapColumnRatioFromStorage());
  const [rosterActiveIndex, setRosterActiveIndex] = useState(0);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [controlGroups, setControlGroups] = useState<ControlGroupMap>(() => loadControlGroupsFromStorage());
  const controlGroupByDigitRef = useRef<ControlGroupMap>(controlGroups);

  const activeWorkers = useMemo(() => workers.filter((worker) => worker.status !== "stopped"), [workers]);

  const selectedWorker = useMemo(
    () => activeWorkers.find((worker) => worker.id === selectedWorkerId),
    [activeWorkers, selectedWorkerId]
  );

  const renameTargetWorker = useMemo(
    () => workers.find((worker) => worker.id === renameTargetWorkerId),
    [renameTargetWorkerId, workers]
  );

  const killConfirmWorker = useMemo(
    () => workers.find((worker) => worker.id === killConfirmWorkerId),
    [killConfirmWorkerId, workers]
  );

  const summonShortcuts = useMemo(() => config?.shortcuts ?? [], [config]);

  const rosterEntries = useMemo<RosterEntry[]>(
    () => [
      ...activeWorkers.map((worker) => ({ kind: "worker", worker }) as const),
      ...summonShortcuts.map((shortcut, shortcutIndex) => ({ kind: "shortcut", shortcut, shortcutIndex }) as const)
    ],
    [activeWorkers, summonShortcuts]
  );

  const firstSummonEntryIndex = useMemo(() => {
    const firstIndex = rosterEntries.findIndex((entry) => entry.kind === "shortcut");
    return firstIndex >= 0 ? firstIndex : undefined;
  }, [rosterEntries]);

  useEffect(() => {
    if (rosterEntries.length === 0) {
      setRosterActiveIndex(0);
      return;
    }

    if (selectedWorkerId) {
      const selectedIndex = rosterEntries.findIndex((entry) => entry.kind === "worker" && entry.worker.id === selectedWorkerId);
      if (selectedIndex >= 0) {
        setRosterActiveIndex(selectedIndex);
      }
      return;
    }

    setRosterActiveIndex((current) => clampNumber(current, 0, rosterEntries.length - 1));
  }, [rosterEntries, selectedWorkerId]);

  useEffect(() => {
    if (!selectedWorkerId) {
      return;
    }

    if (!activeWorkers.some((worker) => worker.id === selectedWorkerId)) {
      setSelectedWorkerId(undefined);
    }
  }, [activeWorkers, selectedWorkerId]);

  useEffect(() => {
    setTerminalFocusToken(undefined);
  }, [selectedWorkerId]);

  useEffect(() => {
    if (!selectedWorkerId) {
      setTerminalFocused(false);
    }
  }, [selectedWorkerId]);

  useEffect(() => {
    const updateTerminalFocus = () => {
      setTerminalFocused(isElementInTerminalPanel(document.activeElement));
    };

    const handleFocusOut = () => {
      setTimeout(updateTerminalFocus, 0);
    };

    const handleWindowBlur = () => {
      setTerminalFocused(false);
    };

    window.addEventListener("focusin", updateTerminalFocus, true);
    window.addEventListener("focusout", handleFocusOut, true);
    window.addEventListener("blur", handleWindowBlur);

    updateTerminalFocus();
    return () => {
      window.removeEventListener("focusin", updateTerminalFocus, true);
      window.removeEventListener("focusout", handleFocusOut, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    controlGroupByDigitRef.current = controlGroups;
    persistControlGroups(controlGroups);
  }, [controlGroups]);

  useEffect(() => {
    persistMapColumnRatio(mapColumnRatio);
  }, [mapColumnRatio]);

  useEffect(() => {
    const activeIds = new Set(activeWorkers.map((worker) => worker.id));
    setControlGroups((current) => {
      let changed = false;
      const next: ControlGroupMap = { ...current };

      for (const [digitText, workerId] of Object.entries(next)) {
        if (!workerId || activeIds.has(workerId)) {
          continue;
        }

        delete next[Number(digitText)];
        changed = true;
      }

      return changed ? next : current;
    });
  }, [activeWorkers]);

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

  const escapeTerminalFocus = useCallback((): boolean => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {
      return false;
    }

    if (!activeElement.closest(".terminal-panel")) {
      return false;
    }

    activeElement.blur();
    const mapCanvas = document.querySelector<HTMLCanvasElement>(".map-canvas");
    mapCanvas?.focus();
    return true;
  }, []);

  const showError = useCallback((error: unknown) => {
    setErrorText(error instanceof Error ? error.message : "Unknown request failure");
  }, []);

  const runSpawn = useCallback(
    async (input: WorkerSpawnInput) => {
      try {
        const worker = await spawnWorker(input);
        setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
        setSelectedWorkerId(worker.id);
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

  const requestTerminalFocus = useCallback(() => {
    setTerminalFocusToken((current) => (current ?? 0) + 1);
  }, []);

  const queueWorkerFade = useCallback((worker: Worker) => {
    setFadingWorkers((current) => [
      {
        worker,
        startedAtMs: Date.now()
      },
      ...current.filter((item) => item.worker.id !== worker.id)
    ]);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setFadingWorkers((current) =>
        current.filter((item) => now - item.startedAtMs < killFadeDurationMs)
      );
    }, 80);

    return () => clearInterval(timer);
  }, []);

  const closeRenameModal = useCallback(() => {
    setRenameModalOpen(false);
    setRenameTargetWorkerId(undefined);
  }, []);

  const closeKillConfirm = useCallback(() => {
    setKillConfirmWorkerId(undefined);
  }, []);

  const openRenameForWorker = useCallback((worker: Worker) => {
    setRenameDraft(worker.displayName ?? worker.name);
    setRenameTargetWorkerId(worker.id);
    setRenameModalOpen(true);
  }, []);

  const submitRename = useCallback(async () => {
    const targetWorkerId = renameTargetWorkerId;
    if (!targetWorkerId) {
      closeRenameModal();
      return;
    }

    try {
      const worker = await renameWorker(targetWorkerId, renameDraft);
      setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
      closeRenameModal();
    } catch (error) {
      showError(error);
    }
  }, [closeRenameModal, renameDraft, renameTargetWorkerId, showError]);

  const onKillWorker = useCallback(async (workerId: string) => {
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) {
      return;
    }

    closeKillConfirm();
    queueWorkerFade(worker);

    try {
      const result = await stopWorker(workerId);
      setWorkers((currentWorkers) => currentWorkers.filter((item) => item.id !== result.workerId));
      setSelectedWorkerId((current) => (current === result.workerId ? undefined : current));
    } catch (error) {
      setFadingWorkers((current) => current.filter((item) => item.worker.id !== workerId));
      showError(error);
    }
  }, [closeKillConfirm, queueWorkerFade, showError, workers]);

  const onKillSelected = useCallback(() => {
    if (!selectedWorkerId) {
      return;
    }

    setKillConfirmWorkerId(selectedWorkerId);
  }, [selectedWorkerId]);

  const onToggleMovementModeSelected = useCallback(async () => {
    if (!selectedWorker) {
      return;
    }

    const nextMode = selectedWorker.movementMode === "wander" ? "hold" : "wander";

    try {
      const worker = await setWorkerMovementMode(selectedWorker.id, nextMode);
      setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
    } catch (error) {
      showError(error);
    }
  }, [selectedWorker, showError]);

  const nudgeMapColumnRatio = useCallback((delta: number) => {
    setMapColumnRatio((current) => clampNumber(current + delta, minMapColumnRatio, maxMapColumnRatio));
  }, []);

  const resetMapColumnRatio = useCallback(() => {
    setMapColumnRatio(defaultMapColumnRatio);
  }, []);

  const cycleSelection = useCallback(
    (direction: 1 | -1) => {
      if (activeWorkers.length === 0) {
        return;
      }

      const currentIndex = activeWorkers.findIndex((worker) => worker.id === selectedWorkerId);
      const startIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
      const nextIndex = (startIndex + direction + activeWorkers.length) % activeWorkers.length;
      const nextWorker = activeWorkers[nextIndex];
      if (!nextWorker) {
        return;
      }

      setSelectedWorkerId(nextWorker.id);
      setMapCenterWorkerId(nextWorker.id);
      setMapCenterToken((current) => current + 1);
    },
    [activeWorkers, selectedWorkerId]
  );

  const onActivateRosterIndex = useCallback(
    (index: number) => {
      const entry = rosterEntries[index];
      if (!entry) {
        return;
      }

      setRosterActiveIndex(index);

      if (entry.kind === "worker") {
        setSelectedWorkerId(entry.worker.id);
        setMapCenterWorkerId(entry.worker.id);
        setMapCenterToken((current) => current + 1);
        return;
      }

      void runSpawn({ shortcutIndex: entry.shortcutIndex });
    },
    [rosterEntries, runSpawn]
  );

  useEffect(() => {
    if (!renameModalOpen || !renameTargetWorkerId) {
      return;
    }

    if (!activeWorkers.some((worker) => worker.id === renameTargetWorkerId)) {
      closeRenameModal();
    }
  }, [activeWorkers, closeRenameModal, renameModalOpen, renameTargetWorkerId]);

  useEffect(() => {
    if (!killConfirmWorkerId) {
      return;
    }

    if (!activeWorkers.some((worker) => worker.id === killConfirmWorkerId)) {
      closeKillConfirm();
    }
  }, [activeWorkers, closeKillConfirm, killConfirmWorkerId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (killConfirmWorkerId) {
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          void onKillWorker(killConfirmWorkerId);
          return;
        }

        event.preventDefault();
        closeKillConfirm();
        return;
      }

      if (event.key === "Escape") {
        if (renameModalOpen) {
          event.preventDefault();
          closeRenameModal();
          return;
        }

        if (shortcutsOverlayOpen) {
          event.preventDefault();
          setShortcutsOverlayOpen(false);
          return;
        }

        if (paletteOpen || spawnDialogOpen) {
          event.preventDefault();
          setPaletteOpen(false);
          setSpawnDialogOpen(false);
          return;
        }

        if (isTerminalTarget(event.target)) {
          return;
        }

        if (selectedWorkerId) {
          event.preventDefault();
          setSelectedWorkerId(undefined);
        }
        return;
      }

      if (isTerminalEscapeShortcut(event)) {
        const escaped = escapeTerminalFocus();
        if (escaped) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (!renameModalOpen && !shortcutsOverlayOpen && !paletteOpen && !spawnDialogOpen && selectedWorkerId) {
          event.preventDefault();
          const selectedIndex = rosterEntries.findIndex(
            (entry) => entry.kind === "worker" && entry.worker.id === selectedWorkerId
          );
          if (selectedIndex >= 0) {
            setRosterActiveIndex(selectedIndex);
          }
          setSelectedWorkerId(undefined);
        }
        return;
      }

      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (!isEditableTarget(event.target) || shortcutsOverlayOpen) {
          event.preventDefault();
          setShortcutsOverlayOpen((current) => !current);
        }
        return;
      }

      if (
        (event.key === "[" || event.key === "]" || event.key === "=") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableTarget(event.target) &&
        !isTerminalTarget(event.target)
      ) {
        event.preventDefault();
        if (event.key === "=") {
          resetMapColumnRatio();
        } else {
          nudgeMapColumnRatio(event.key === "]" ? mapColumnRatioStep : -mapColumnRatioStep);
        }
        return;
      }

      if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditableTarget(event.target)) {
        if (isTerminalTarget(event.target)) {
          return;
        }

        event.preventDefault();
        cycleSelection(event.shiftKey ? -1 : 1);
        return;
      }

      const groupDigit = parseControlGroupDigit(event);
      if (groupDigit !== undefined) {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && selectedWorkerId) {
          event.preventDefault();
          setControlGroups((current) => {
            const existingForSelected = Object.entries(current).find(([, workerId]) => workerId === selectedWorkerId)?.[0];
            const existingDigit = existingForSelected !== undefined ? Number(existingForSelected) : undefined;
            if (current[groupDigit] === selectedWorkerId && existingDigit === groupDigit) {
              return current;
            }

            const next: ControlGroupMap = {};
            for (const [digitText, workerId] of Object.entries(current)) {
              const digit = Number(digitText);
              if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
                continue;
              }

              if (workerId === selectedWorkerId || digit === groupDigit) {
                continue;
              }

              next[digit] = workerId;
            }

            next[groupDigit] = selectedWorkerId;
            return next;
          });
          return;
        }

        if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !isEditableTarget(event.target)) {
          const workerId = controlGroupByDigitRef.current[groupDigit];
          if (!workerId) {
            return;
          }

          const workerExists = activeWorkers.some((worker) => worker.id === workerId);
          if (!workerExists) {
            setControlGroups((current) => {
              if (!(groupDigit in current)) {
                return current;
              }

              const next = { ...current };
              delete next[groupDigit];
              return next;
            });
            return;
          }

          event.preventDefault();
          setSelectedWorkerId(workerId);
          setMapCenterWorkerId(workerId);
          setMapCenterToken((current) => current + 1);
        }
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (!selectedWorkerId && rosterEntries.length > 0 && !isTerminalTarget(event.target)) {
        const keyLower = event.key.toLowerCase();
        if (
          keyLower === "n" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          firstSummonEntryIndex !== undefined
        ) {
          event.preventDefault();
          setRosterActiveIndex(firstSummonEntryIndex);
          return;
        }

        if ((keyLower === "j" || keyLower === "k") && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          setRosterActiveIndex((current) => {
            const delta = keyLower === "j" ? 1 : -1;
            return clampNumber(current + delta, 0, rosterEntries.length - 1);
          });
          return;
        }

        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          onActivateRosterIndex(rosterActiveIndex);
          return;
        }
      }

      if (event.key.toLowerCase() === "k" && !event.ctrlKey && !event.metaKey && !event.altKey && selectedWorkerId) {
        event.preventDefault();
        onKillSelected();
        return;
      }

      if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey && !event.altKey && selectedWorker) {
        event.preventDefault();
        openRenameForWorker(selectedWorker);
        return;
      }

      if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.metaKey && !event.altKey && selectedWorker) {
        event.preventDefault();
        void onToggleMovementModeSelected();
        return;
      }

      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && selectedWorkerId) {
        event.preventDefault();
        requestTerminalFocus();
        return;
      }

      if (event.key !== "/") {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      event.preventDefault();
      setPaletteOpen(true);
      setSpawnDialogOpen(false);
      setShortcutsOverlayOpen(false);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    activeWorkers,
    closeKillConfirm,
    closeRenameModal,
    cycleSelection,
    escapeTerminalFocus,
    firstSummonEntryIndex,
    killConfirmWorkerId,
    nudgeMapColumnRatio,
    onActivateRosterIndex,
    resetMapColumnRatio,
    onKillWorker,
    onKillSelected,
    onToggleMovementModeSelected,
    openRenameForWorker,
    paletteOpen,
    renameModalOpen,
    requestTerminalFocus,
    rosterEntries,
    rosterActiveIndex,
    selectedWorker,
    selectedWorkerId,
    shortcutsOverlayOpen,
    spawnDialogOpen
  ]);

  const onSelectWorker = useCallback((workerId: string | undefined) => {
    setSelectedWorkerId(workerId);
  }, []);

  const onActivateWorker = useCallback((workerId: string) => {
    setSelectedWorkerId(workerId);
    requestTerminalFocus();
  }, [requestTerminalFocus]);

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

  const onRenameSelected = useCallback(() => {
    if (!selectedWorker) {
      return;
    }

    openRenameForWorker(selectedWorker);
  }, [openRenameForWorker, selectedWorker]);

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
    <div
      className="app-shell"
      style={{
        gridTemplateColumns: `minmax(380px, ${mapColumnRatio.toFixed(3)}fr) minmax(360px, ${(1 - mapColumnRatio).toFixed(3)}fr)`
      }}
    >
      <div className="map-column">
        <MapCanvas
          workers={activeWorkers}
          fadingWorkers={fadingWorkers}
          selectedWorkerId={selectedWorkerId}
          terminalFocusedSelected={Boolean(selectedWorkerId && terminalFocused)}
          controlGroups={controlGroups}
          onSelect={onSelectWorker}
          onActivateWorker={onActivateWorker}
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
          onKillSelected={() => {
            void onKillSelected();
          }}
          onRenameSelected={() => {
            onRenameSelected();
          }}
          onToggleMovementMode={() => {
            void onToggleMovementModeSelected();
          }}
        />
      </div>

      <div
        className={`terminal-column${selectedWorker ? " terminal-column-selected" : ""}${
          selectedWorker && terminalFocused ? " terminal-column-focused" : ""
        }`}
      >
        <div className="terminal-header">
          <div className="terminal-header-title">
            {selectedWorker
              ? `${selectedWorker.displayName ?? selectedWorker.name} (${selectedWorker.status})`
              : `Agents (${activeWorkers.length})`}
          </div>

          {selectedWorker ? (
            <button
              className="terminal-open-external"
              onClick={() => {
                void onOpenSelectedInTerminal();
              }}
              disabled={selectedWorker.status === "stopped"}
              title="Open in external terminal"
              type="button"
            >
              ↗
            </button>
          ) : null}
        </div>

        {selectedWorker ? (
          <TerminalPanel
            workerId={selectedWorker.id}
            workerName={selectedWorker.displayName ?? selectedWorker.name}
            focusRequestKey={terminalFocusToken}
          />
        ) : (
          <div className="worker-roster">
            {rosterEntries.length === 0 ? (
              <div className="worker-roster-empty">No active agents yet. Summon one from the bottom bar.</div>
            ) : (
              rosterEntries.map((entry, index) => (
                <div key={entry.kind === "worker" ? entry.worker.id : `shortcut-${entry.shortcutIndex}-${entry.shortcut.label}`}>
                  {entry.kind === "shortcut" && (index === 0 || rosterEntries[index - 1]?.kind !== "shortcut") ? (
                    <div className="worker-roster-section-label">Summon</div>
                  ) : null}

                  {entry.kind === "worker" ? (
                    <button
                      className={`worker-roster-item ${index === rosterActiveIndex ? "active" : ""}`}
                      onMouseEnter={() => setRosterActiveIndex(index)}
                      onClick={() => onActivateRosterIndex(index)}
                      type="button"
                    >
                      <div className="worker-roster-main">
                        <img
                          className="worker-roster-avatar"
                          src={`/api/assets/characters/${encodeURIComponent(resolveSpriteAssetType(entry.worker.avatarType))}/rotations/south.png`}
                          alt=""
                          loading="lazy"
                          aria-hidden="true"
                        />
                        <div className="worker-roster-text">
                          <div className="worker-roster-name">{entry.worker.displayName ?? entry.worker.name}</div>
                          <div className="worker-roster-meta">
                            {entry.worker.projectId} · {entry.worker.runtimeId} · {entry.worker.status}
                          </div>
                          {entry.worker.activityText ? <div className="worker-roster-activity">{entry.worker.activityText}</div> : null}
                        </div>
                      </div>
                    </button>
                  ) : (
                    <button
                      className={`worker-roster-item worker-roster-item-summon ${index === rosterActiveIndex ? "active" : ""}`}
                      onMouseEnter={() => setRosterActiveIndex(index)}
                      onClick={() => onActivateRosterIndex(index)}
                      type="button"
                    >
                      <div className="worker-roster-main">
                        <div className="worker-roster-summon-glyph" aria-hidden="true">
                          +
                        </div>
                        <div className="worker-roster-text">
                          <div className="worker-roster-name">{entry.shortcut.label}</div>
                          <div className="worker-roster-meta">
                            {entry.shortcut.project} · {entry.shortcut.runtime}
                          </div>
                          <div className="worker-roster-activity">Summon agent</div>
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
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

      {shortcutsOverlayOpen ? (
        <div className="overlay" onClick={() => setShortcutsOverlayOpen(false)}>
          <div className="dialog shortcuts-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-title">Keyboard Shortcuts</div>
            <div className="shortcut-grid">
              <div className="shortcut-row">
                <kbd>1-0</kbd>
                <span>Select control group</span>
              </div>
              <div className="shortcut-row">
                <kbd>Ctrl+1-0</kbd>
                <span>Assign selected agent to group</span>
              </div>
              <div className="shortcut-row">
                <kbd>Tab</kbd>
                <span>Select next agent</span>
              </div>
              <div className="shortcut-row">
                <kbd>Shift+Tab</kbd>
                <span>Select previous agent</span>
              </div>
              <div className="shortcut-row">
                <kbd>J / K</kbd>
                <span>Move selection in roster and summon list</span>
              </div>
              <div className="shortcut-row">
                <kbd>N</kbd>
                <span>Jump to summon list</span>
              </div>
              <div className="shortcut-row">
                <kbd>[ / ] / =</kbd>
                <span>Resize columns or reset split</span>
              </div>
              <div className="shortcut-row">
                <kbd>Enter</kbd>
                <span>Activate highlighted item or focus terminal</span>
              </div>
              <div className="shortcut-row">
                <kbd>Ctrl+]</kbd>
                <span>Leave terminal focus, then deselect agent</span>
              </div>
              <div className="shortcut-row">
                <kbd>R</kbd>
                <span>Rename selected agent</span>
              </div>
              <div className="shortcut-row">
                <kbd>M</kbd>
                <span>Toggle mode on selected agent</span>
              </div>
              <div className="shortcut-row">
                <kbd>K</kbd>
                <span>Open kill confirm (then Enter)</span>
              </div>
              <div className="shortcut-row">
                <kbd>?</kbd>
                <span>Toggle this shortcut panel</span>
              </div>
              <div className="shortcut-row">
                <kbd>Esc</kbd>
                <span>Close overlay/dialog, then deselect</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {killConfirmWorkerId ? (
        <div className="overlay" onClick={closeKillConfirm}>
          <div className="dialog kill-confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-title">Kill Worker?</div>
            <div className="rename-subtitle">{killConfirmWorker?.displayName ?? killConfirmWorker?.name ?? "Selected worker"}</div>
            <div className="kill-confirm-copy">This will terminate the session and remove this worker from the map.</div>
            <div className="dialog-actions">
              <button className="bar-btn subtle" type="button" onClick={closeKillConfirm}>
                Cancel
              </button>
              <button
                className="bar-btn danger"
                type="button"
                onClick={() => {
                  if (killConfirmWorkerId) {
                    void onKillWorker(killConfirmWorkerId);
                  }
                }}
              >
                Kill (Enter)
              </button>
            </div>
            <div className="kill-confirm-hint">Press any other key to dismiss.</div>
          </div>
        </div>
      ) : null}

      {renameModalOpen ? (
        <div className="overlay" onClick={closeRenameModal}>
          <div className="dialog rename-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-title">Rename Worker</div>
            <div className="rename-subtitle">{renameTargetWorker?.name ?? "Selected worker"}</div>
            <form
              className="rename-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRename();
              }}
            >
              <input
                className="input"
                autoFocus
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                placeholder="Display name"
              />
              <div className="dialog-actions">
                <button className="bar-btn subtle" type="button" onClick={closeRenameModal}>
                  Cancel (Esc)
                </button>
                <button className="bar-btn" type="submit">
                  Save (Enter)
                </button>
              </div>
            </form>
          </div>
        </div>
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

function loadControlGroupsFromStorage(): ControlGroupMap {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(controlGroupStorageKey);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const next: ControlGroupMap = {};
    const digitByWorkerId = new Map<string, number>();
    for (const [key, value] of Object.entries(parsed)) {
      const digit = Number(key);
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
        continue;
      }

      if (typeof value !== "string" || value.trim().length === 0) {
        continue;
      }

      const previousDigit = digitByWorkerId.get(value);
      if (previousDigit !== undefined) {
        delete next[previousDigit];
      }

      digitByWorkerId.set(value, digit);
      next[digit] = value;
    }

    return next;
  } catch {
    return {};
  }
}

function persistControlGroups(groups: ControlGroupMap): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const serializable: Record<string, string> = {};
    for (const [key, value] of Object.entries(groups)) {
      const digit = Number(key);
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
        continue;
      }

      if (typeof value !== "string" || value.trim().length === 0) {
        continue;
      }

      serializable[String(digit)] = value;
    }

    window.localStorage.setItem(controlGroupStorageKey, JSON.stringify(serializable));
  } catch {
    // ignore storage errors
  }
}

function loadMapColumnRatioFromStorage(): number {
  if (typeof window === "undefined") {
    return defaultMapColumnRatio;
  }

  try {
    const raw = window.localStorage.getItem(layoutSplitStorageKey);
    if (!raw) {
      return defaultMapColumnRatio;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return defaultMapColumnRatio;
    }

    return clampNumber(parsed, minMapColumnRatio, maxMapColumnRatio);
  } catch {
    return defaultMapColumnRatio;
  }
}

function persistMapColumnRatio(value: number): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(layoutSplitStorageKey, String(clampNumber(value, minMapColumnRatio, maxMapColumnRatio)));
  } catch {
    // ignore storage errors
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea";
}

function isTerminalTarget(target: EventTarget | null): boolean {
  return isElementInTerminalPanel(target);
}

function isElementInTerminalPanel(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".terminal-panel"));
}

function parseControlGroupDigit(event: KeyboardEvent): number | undefined {
  if (/^[0-9]$/.test(event.key)) {
    return Number(event.key);
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return Number(event.code.slice("Digit".length));
  }

  if (/^Numpad[0-9]$/.test(event.code)) {
    return Number(event.code.slice("Numpad".length));
  }

  return undefined;
}

function isTerminalEscapeShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false;
  }

  return event.key === "]" || event.code === "BracketRight";
}
