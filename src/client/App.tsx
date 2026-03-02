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

type ControlGroupMap = Partial<Record<number, string[]>>;

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
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [mapCenterToken, setMapCenterToken] = useState(0);
  const [mapCenterWorkerId, setMapCenterWorkerId] = useState<string | undefined>(undefined);
  const [terminalFocusToken, setTerminalFocusToken] = useState<number | undefined>(undefined);
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [killConfirmWorkerIds, setKillConfirmWorkerIds] = useState<string[]>([]);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameTargetWorkerIds, setRenameTargetWorkerIds] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const [fadingWorkers, setFadingWorkers] = useState<FadingWorker[]>([]);
  const [mapColumnRatio, setMapColumnRatio] = useState<number>(() => loadMapColumnRatioFromStorage());
  const [rosterActiveIndex, setRosterActiveIndex] = useState(0);
  const [selectedGroupActiveIndex, setSelectedGroupActiveIndex] = useState(0);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [workersHydrated, setWorkersHydrated] = useState(false);
  const [controlGroups, setControlGroups] = useState<ControlGroupMap>(() => loadControlGroupsFromStorage());
  const controlGroupByDigitRef = useRef<ControlGroupMap>(controlGroups);

  const activeWorkers = useMemo(() => workers.filter((worker) => worker.status !== "stopped"), [workers]);
  const idleWorkers = useMemo(() => activeWorkers.filter((worker) => worker.status === "idle"), [activeWorkers]);

  const selectedWorkerId = selectedWorkerIds.length === 1 ? selectedWorkerIds[0] : undefined;
  const selectedWorkerIdSet = useMemo(() => new Set(selectedWorkerIds), [selectedWorkerIds]);
  const selectedWorkers = useMemo(
    () => activeWorkers.filter((worker) => selectedWorkerIdSet.has(worker.id)),
    [activeWorkers, selectedWorkerIdSet]
  );

  const selectedWorker = useMemo(
    () => activeWorkers.find((worker) => worker.id === selectedWorkerId),
    [activeWorkers, selectedWorkerId]
  );

  const renameTargetWorkers = useMemo(() => {
    if (renameTargetWorkerIds.length === 0) {
      return [];
    }

    const workerById = new Map(workers.map((worker) => [worker.id, worker]));
    return renameTargetWorkerIds
      .map((workerId) => workerById.get(workerId))
      .filter((worker): worker is Worker => Boolean(worker));
  }, [renameTargetWorkerIds, workers]);

  const killConfirmWorkers = useMemo(() => {
    if (killConfirmWorkerIds.length === 0) {
      return [];
    }

    const workerById = new Map(workers.map((worker) => [worker.id, worker]));
    return killConfirmWorkerIds
      .map((workerId) => workerById.get(workerId))
      .filter((worker): worker is Worker => Boolean(worker));
  }, [killConfirmWorkerIds, workers]);

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
    if (selectedWorkers.length <= 1) {
      setSelectedGroupActiveIndex(0);
      return;
    }

    setSelectedGroupActiveIndex((current) => clampNumber(current, 0, selectedWorkers.length - 1));
  }, [selectedWorkers]);

  useEffect(() => {
    const activeIds = new Set(activeWorkers.map((worker) => worker.id));
    setSelectedWorkerIds((current) => current.filter((workerId) => activeIds.has(workerId)));
  }, [activeWorkers]);

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
    if (!workersHydrated) {
      return;
    }

    const activeIds = new Set(activeWorkers.map((worker) => worker.id));
    setControlGroups((current) => {
      let changed = false;
      const next: ControlGroupMap = { ...current };

      for (const [digitText, workerIds] of Object.entries(next)) {
        if (!Array.isArray(workerIds) || workerIds.length === 0) {
          delete next[Number(digitText)];
          changed = true;
          continue;
        }

        const filtered = workerIds.filter((workerId) => activeIds.has(workerId));
        if (filtered.length === workerIds.length) {
          continue;
        }

        if (filtered.length === 0) {
          delete next[Number(digitText)];
        } else {
          next[Number(digitText)] = filtered;
        }
        changed = true;
      }

      return changed ? next : current;
    });
  }, [activeWorkers, workersHydrated]);

  useEffect(() => {
    void Promise.all([fetchConfig(), fetchWorkers()])
      .then(([nextConfig, nextWorkers]) => {
        setConfig(nextConfig);
        setWorkers(nextWorkers);
        setWorkersHydrated(true);
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
          setWorkersHydrated(true);
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

  const applySelection = useCallback(
    (workerIds: string[], options?: { center?: boolean; focusTerminal?: boolean }) => {
      const deduped = Array.from(new Set(workerIds));
      setSelectedWorkerIds(deduped);

      const primaryWorkerId = deduped.length === 1 ? deduped[0] : undefined;
      if (options?.center && primaryWorkerId) {
        setMapCenterWorkerId(primaryWorkerId);
        setMapCenterToken((current) => current + 1);
      }

      if (options?.focusTerminal && primaryWorkerId) {
        setTerminalFocusToken((current) => (current ?? 0) + 1);
      }
    },
    []
  );

  const runSpawn = useCallback(
    async (input: WorkerSpawnInput) => {
      try {
        const worker = await spawnWorker(input);
        setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
        applySelection([worker.id], { center: true });
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
    setRenameTargetWorkerIds([]);
  }, []);

  const closeKillConfirm = useCallback(() => {
    setKillConfirmWorkerIds([]);
  }, []);

  const openRenameForWorkers = useCallback((workersToRename: Worker[]) => {
    if (workersToRename.length === 0) {
      return;
    }

    setRenameDraft(workersToRename.length === 1 ? workersToRename[0].displayName ?? workersToRename[0].name : "");
    setRenameTargetWorkerIds(workersToRename.map((worker) => worker.id));
    setRenameModalOpen(true);
  }, []);

  const submitRename = useCallback(async () => {
    const targetWorkerIds = [...renameTargetWorkerIds];
    if (targetWorkerIds.length === 0) {
      closeRenameModal();
      return;
    }

    try {
      if (targetWorkerIds.length === 1) {
        const worker = await renameWorker(targetWorkerIds[0], renameDraft);
        setWorkers((currentWorkers) => upsertWorker(currentWorkers, worker));
      } else {
        const baseName = renameDraft.trim();
        const renamedWorkers = await Promise.all(
          targetWorkerIds.map((workerId, index) => renameWorker(workerId, baseName.length > 0 ? `${baseName} ${index + 1}` : ""))
        );
        setWorkers((currentWorkers) => {
          let nextWorkers = currentWorkers;
          for (const worker of renamedWorkers) {
            nextWorkers = upsertWorker(nextWorkers, worker);
          }
          return nextWorkers;
        });
      }
      closeRenameModal();
    } catch (error) {
      showError(error);
    }
  }, [closeRenameModal, renameDraft, renameTargetWorkerIds, showError]);

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
      setSelectedWorkerIds((current) => current.filter((workerId) => workerId !== result.workerId));
    } catch (error) {
      setFadingWorkers((current) => current.filter((item) => item.worker.id !== workerId));
      showError(error);
    }
  }, [closeKillConfirm, queueWorkerFade, showError, workers]);

  const onKillSelected = useCallback(() => {
    if (selectedWorkerIds.length === 0) {
      return;
    }

    setKillConfirmWorkerIds(selectedWorkerIds);
  }, [selectedWorkerIds]);

  const onKillRosterActive = useCallback(() => {
    const entry = rosterEntries[rosterActiveIndex];
    if (!entry || entry.kind !== "worker") {
      return;
    }

    setKillConfirmWorkerIds([entry.worker.id]);
  }, [rosterActiveIndex, rosterEntries]);

  const confirmKillSelection = useCallback(() => {
    if (killConfirmWorkerIds.length === 0) {
      return;
    }

    const workerIds = [...killConfirmWorkerIds];
    closeKillConfirm();
    for (const workerId of workerIds) {
      void onKillWorker(workerId);
    }
  }, [closeKillConfirm, killConfirmWorkerIds, onKillWorker]);

  const onToggleMovementModeSelected = useCallback(async () => {
    if (selectedWorkers.length === 0) {
      return;
    }

    const nextMode = selectedWorkers.every((worker) => worker.movementMode === "hold") ? "wander" : "hold";

    try {
      const updatedWorkers = await Promise.all(selectedWorkers.map((worker) => setWorkerMovementMode(worker.id, nextMode)));
      setWorkers((currentWorkers) => {
        let nextWorkers = currentWorkers;
        for (const worker of updatedWorkers) {
          nextWorkers = upsertWorker(nextWorkers, worker);
        }
        return nextWorkers;
      });
    } catch (error) {
      showError(error);
    }
  }, [selectedWorkers, showError]);

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

      applySelection([nextWorker.id], { center: true });
    },
    [activeWorkers, selectedWorkerId]
  );

  const cycleIdleSelection = useCallback(
    (direction: 1 | -1) => {
      if (idleWorkers.length === 0) {
        return;
      }

      const currentIndex = idleWorkers.findIndex((worker) => worker.id === selectedWorkerId);
      const startIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
      const nextIndex = (startIndex + direction + idleWorkers.length) % idleWorkers.length;
      const nextWorker = idleWorkers[nextIndex];
      if (!nextWorker) {
        return;
      }

      applySelection([nextWorker.id], { center: true });
    },
    [idleWorkers, selectedWorkerId]
  );

  const onActivateRosterIndex = useCallback(
    (index: number) => {
      const entry = rosterEntries[index];
      if (!entry) {
        return;
      }

      setRosterActiveIndex(index);

      if (entry.kind === "worker") {
        applySelection([entry.worker.id], { center: true });
        return;
      }

      void runSpawn({ shortcutIndex: entry.shortcutIndex });
    },
    [rosterEntries, runSpawn]
  );

  useEffect(() => {
    if (!renameModalOpen || renameTargetWorkerIds.length === 0) {
      return;
    }

    const activeWorkerIdSet = new Set(activeWorkers.map((worker) => worker.id));
    if (!renameTargetWorkerIds.some((workerId) => activeWorkerIdSet.has(workerId))) {
      closeRenameModal();
    }
  }, [activeWorkers, closeRenameModal, renameModalOpen, renameTargetWorkerIds]);

  useEffect(() => {
    if (killConfirmWorkerIds.length === 0) {
      return;
    }

    const activeIds = new Set(activeWorkers.map((worker) => worker.id));
    if (!killConfirmWorkerIds.some((workerId) => activeIds.has(workerId))) {
      closeKillConfirm();
    }
  }, [activeWorkers, closeKillConfirm, killConfirmWorkerIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (killConfirmWorkerIds.length > 0) {
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          confirmKillSelection();
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
          applySelection([]);
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

        if (!renameModalOpen && !shortcutsOverlayOpen && !paletteOpen && !spawnDialogOpen && selectedWorkerIds.length > 0) {
          event.preventDefault();
          if (selectedWorkerId) {
            const selectedIndex = rosterEntries.findIndex(
              (entry) => entry.kind === "worker" && entry.worker.id === selectedWorkerId
            );
            if (selectedIndex >= 0) {
              setRosterActiveIndex(selectedIndex);
            }
          }
          applySelection([]);
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

      if (
        event.code === "Period" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        if (isTerminalTarget(event.target)) {
          return;
        }

        event.preventDefault();
        cycleIdleSelection(event.shiftKey ? -1 : 1);
        return;
      }

      if (
        event.code === "Comma" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        if (isTerminalTarget(event.target)) {
          return;
        }

        event.preventDefault();
        cycleIdleSelection(-1);
        return;
      }

      if (
        event.key.toLowerCase() === "a" &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditableTarget(event.target) &&
        !isTerminalTarget(event.target)
      ) {
        const shortcutIndex = event.shiftKey ? 1 : 0;
        if (summonShortcuts.length <= shortcutIndex) {
          return;
        }

        event.preventDefault();
        void runSpawn({ shortcutIndex });
        return;
      }

      const groupDigit = parseControlGroupDigit(event);
      if (groupDigit !== undefined) {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && selectedWorkerIds.length > 0) {
          event.preventDefault();
          setControlGroups((current) => {
            const selectionSet = new Set(selectedWorkerIds);
            const existing = current[groupDigit] ?? [];
            const existingSet = new Set(existing);
            const sameSelection =
              existing.length === selectedWorkerIds.length && selectedWorkerIds.every((workerId) => existingSet.has(workerId));

            if (sameSelection) {
              const next = { ...current };
              delete next[groupDigit];
              return next;
            }

            const next: ControlGroupMap = { ...current };
            for (const [digitText, workerIds] of Object.entries(next)) {
              const digit = Number(digitText);
              if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
                continue;
              }

              if (digit === groupDigit || !Array.isArray(workerIds)) {
                continue;
              }

              next[digit] = workerIds.filter((workerId) => !selectionSet.has(workerId));
            }

            next[groupDigit] = [...selectedWorkerIds];
            return next;
          });
          return;
        }

        if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !isEditableTarget(event.target)) {
          const workerIds = controlGroupByDigitRef.current[groupDigit] ?? [];
          if (workerIds.length === 0) {
            return;
          }

          const activeWorkerIdSet = new Set(activeWorkers.map((worker) => worker.id));
          const existingWorkerIds = workerIds.filter((workerId) => activeWorkerIdSet.has(workerId));
          if (existingWorkerIds.length === 0) {
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
          applySelection(existingWorkerIds, { center: existingWorkerIds.length === 1 });
        }
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (
        (event.key.toLowerCase() === "k" || event.key === "Delete") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        selectedWorkerIds.length > 0
      ) {
        event.preventDefault();
        onKillSelected();
        return;
      }

      if (selectedWorkers.length > 1 && !isTerminalTarget(event.target)) {
        const keyLower = event.key.toLowerCase();
        if ((keyLower === "j" || keyLower === "k") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          setSelectedGroupActiveIndex((current) => {
            const delta = keyLower === "j" ? 1 : -1;
            return clampNumber(current + delta, 0, selectedWorkers.length - 1);
          });
          return;
        }

        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          const focusedWorker = selectedWorkers[selectedGroupActiveIndex] ?? selectedWorkers[0];
          if (!focusedWorker) {
            return;
          }

          event.preventDefault();
          applySelection([focusedWorker.id], { center: true });
          return;
        }
      }

      if (selectedWorkerIds.length === 0 && rosterEntries.length > 0 && !isTerminalTarget(event.target)) {
        const keyLower = event.key.toLowerCase();
        if (keyLower === "k" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          onKillRosterActive();
          return;
        }

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

        if ((keyLower === "j" || keyLower === "k") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
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

      if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey && !event.altKey && selectedWorkers.length > 0) {
        event.preventDefault();
        openRenameForWorkers(selectedWorkers);
        return;
      }

      if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.metaKey && !event.altKey && selectedWorkers.length > 0) {
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
    applySelection,
    activeWorkers,
    closeKillConfirm,
    closeRenameModal,
    cycleIdleSelection,
    cycleSelection,
    escapeTerminalFocus,
    firstSummonEntryIndex,
    killConfirmWorkerIds,
    nudgeMapColumnRatio,
    onActivateRosterIndex,
    onKillRosterActive,
    resetMapColumnRatio,
    onKillWorker,
    onKillSelected,
    confirmKillSelection,
    onToggleMovementModeSelected,
    openRenameForWorkers,
    paletteOpen,
    renameModalOpen,
    requestTerminalFocus,
    rosterEntries,
    rosterActiveIndex,
    selectedGroupActiveIndex,
    selectedWorkers,
    selectedWorkerId,
    summonShortcuts,
    shortcutsOverlayOpen,
    spawnDialogOpen,
    runSpawn
  ]);

  const onSelectWorker = useCallback((workerId: string | undefined) => {
    applySelection(workerId ? [workerId] : []);
  }, [applySelection]);

  const onSelectionChange = useCallback(
    (workerIds: string[]) => {
      applySelection(workerIds);
    },
    [applySelection]
  );

  const onActivateWorker = useCallback((workerId: string) => {
    applySelection([workerId], { focusTerminal: true });
  }, [applySelection]);

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
    if (selectedWorkers.length === 0) {
      return;
    }

    openRenameForWorkers(selectedWorkers);
  }, [openRenameForWorkers, selectedWorkers]);

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
          selectedWorkerIds={selectedWorkerIds}
          terminalFocusedSelected={Boolean(selectedWorkerId && terminalFocused)}
          controlGroups={controlGroups}
          onSelect={onSelectWorker}
          onSelectionChange={onSelectionChange}
          onActivateWorker={onActivateWorker}
          onPositionCommit={onPositionCommit}
          centerOnWorkerId={mapCenterWorkerId}
          centerRequestKey={mapCenterToken}
        />
        <BottomBar
          shortcuts={config?.shortcuts ?? []}
          selectedWorker={selectedWorker}
          selectedWorkers={selectedWorkers}
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
              {selectedWorkers.length > 1
                ? `${selectedWorkers.length} selected agents`
                : selectedWorker
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

        {selectedWorkers.length > 1 ? (
          <div className="worker-roster">
            <div className="worker-roster-section-label">Selected Group</div>
            {selectedWorkers.map((worker, index) => (
              <button
                key={worker.id}
                className={`worker-roster-item ${index === selectedGroupActiveIndex ? "active" : ""}`}
                onMouseEnter={() => setSelectedGroupActiveIndex(index)}
                onClick={() => applySelection([worker.id], { center: true })}
                type="button"
              >
                <div className="worker-roster-main">
                  <img
                    className="worker-roster-avatar"
                    src={`/api/assets/characters/${encodeURIComponent(resolveSpriteAssetType(worker.avatarType))}/rotations/south.png`}
                    alt=""
                    loading="lazy"
                    aria-hidden="true"
                  />
                  <div className="worker-roster-text">
                    <div className="worker-roster-name">{worker.displayName ?? worker.name}</div>
                    <div className="worker-roster-meta">
                      {worker.projectId} · {worker.runtimeId} · {worker.status}
                    </div>
                    {worker.activityText ? <div className="worker-roster-activity">{worker.activityText}</div> : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : selectedWorker ? (
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
                <kbd>. / , / Shift+.</kbd>
                <span>Cycle idle agents only</span>
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
                <kbd>W/A/S/D</kbd>
                <span>Move selected agent (hold)</span>
              </div>
              <div className="shortcut-row">
                <kbd>Shift+W/A/S/D</kbd>
                <span>Pan map</span>
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
                <kbd>Ctrl+] / Ctrl+D</kbd>
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
                <kbd>Shift+K</kbd>
                <span>Kill highlighted roster agent (then Enter)</span>
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

      {killConfirmWorkerIds.length > 0 ? (
        <div className="overlay" onClick={closeKillConfirm}>
          <div className="dialog kill-confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-title">{killConfirmWorkerIds.length > 1 ? "Kill Agents?" : "Kill Agent?"}</div>
            <div className="rename-subtitle">
              {killConfirmWorkerIds.length > 1
                ? `${killConfirmWorkerIds.length} selected agents`
                : killConfirmWorkers[0]?.displayName ?? killConfirmWorkers[0]?.name ?? "Selected agent"}
            </div>
            <div className="kill-confirm-copy">
              {killConfirmWorkerIds.length > 1
                ? "This will terminate all selected sessions and remove those agents from the map."
                : "This will terminate the session and remove this agent from the map."}
            </div>
            <div className="dialog-actions">
              <button className="bar-btn subtle" type="button" onClick={closeKillConfirm}>
                Cancel
              </button>
              <button
                className="bar-btn danger"
                type="button"
                onClick={confirmKillSelection}
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
            <div className="dialog-title">{renameTargetWorkerIds.length > 1 ? "Rename Selected Agents" : "Rename Worker"}</div>
            <div className="rename-subtitle">
              {renameTargetWorkerIds.length > 1
                ? `${renameTargetWorkerIds.length} selected agents`
                : renameTargetWorkers[0]?.name ?? "Selected worker"}
            </div>
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
                  placeholder={renameTargetWorkerIds.length > 1 ? "Base name (e.g. Builder)" : "Display name"}
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
    for (const [key, value] of Object.entries(parsed)) {
      const digit = Number(key);
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
        continue;
      }

      if (typeof value === "string" && value.trim().length > 0) {
        next[digit] = [value];
        continue;
      }

      if (!Array.isArray(value)) {
        continue;
      }

      const workerIds = value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .filter((entry, index, array) => array.indexOf(entry) === index);
      if (workerIds.length > 0) {
        next[digit] = workerIds;
      }
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
    const serializable: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(groups)) {
      const digit = Number(key);
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
        continue;
      }

      if (!Array.isArray(value) || value.length === 0) {
        continue;
      }

      const workerIds = value
        .filter((workerId) => typeof workerId === "string" && workerId.trim().length > 0)
        .filter((workerId, index, array) => array.indexOf(workerId) === index);
      if (workerIds.length > 0) {
        serializable[String(digit)] = workerIds;
      }
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

  return event.key === "]" || event.code === "BracketRight" || event.key.toLowerCase() === "d" || event.code === "KeyD";
}
