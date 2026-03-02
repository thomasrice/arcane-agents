import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Worker } from "../../shared/types";
import type { ShortcutHotkeyBinding } from "../hotkeys/shortcutHotkeys";

type ControlGroupMap = Partial<Record<number, string[]>>;

type RosterEntry = { kind: "worker"; worker: Worker } | { kind: "shortcut"; shortcutIndex: number };

interface UseAppHotkeysParams {
  activeWorkers: Worker[];
  applySelection: (workerIds: string[], options?: { center?: boolean; focusTerminal?: boolean }) => void;
  clampNumber: (value: number, min: number, max: number) => number;
  closeKillConfirm: () => void;
  closeRenameModal: () => void;
  confirmKillSelection: () => void;
  controlGroupByDigitRef: MutableRefObject<ControlGroupMap>;
  cycleIdleSelection: (direction: 1 | -1) => void;
  cycleSelectedGroupFocus: (direction: 1 | -1) => void;
  cycleSelection: (direction: 1 | -1) => void;
  escapeTerminalFocus: () => boolean;
  findMatchingShortcutIndexes: (bindings: ShortcutHotkeyBinding[], event: KeyboardEvent) => number[];
  firstSummonEntryIndex: number | undefined;
  focusRallyCommandInput: () => boolean;
  focusedSelectedWorkerId: string | undefined;
  inSelectedGroupView: boolean;
  isEditableTarget: (target: EventTarget | null) => boolean;
  isTerminalEscapeShortcut: (event: KeyboardEvent) => boolean;
  isTerminalTarget: (target: EventTarget | null) => boolean;
  killConfirmWorkerIds: string[];
  mapColumnRatioStep: number;
  nudgeMapColumnRatio: (delta: number) => void;
  onActivateRosterIndex: (index: number) => void;
  onKillRosterActive: () => void;
  onKillSelected: () => void;
  onToggleMovementModeSelected: () => void | Promise<void>;
  openRenameForWorkers: (workersToRename: Worker[]) => void;
  paletteOpen: boolean;
  parseControlGroupDigit: (event: KeyboardEvent) => number | undefined;
  renameModalOpen: boolean;
  requestTerminalFocus: () => void;
  resetMapColumnRatio: () => void;
  rosterActiveIndex: number;
  rosterEntries: RosterEntry[];
  runSpawn: (input: { shortcutIndex: number }) => void | Promise<void>;
  selectedGroupActiveIndex: number;
  selectedWorkerId: string | undefined;
  selectedWorkerIds: string[];
  selectedWorkers: Worker[];
  setControlGroups: Dispatch<SetStateAction<ControlGroupMap>>;
  setFocusedSelectedWorkerId: Dispatch<SetStateAction<string | undefined>>;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setRosterActiveIndex: Dispatch<SetStateAction<number>>;
  setSelectedGroupActiveIndex: Dispatch<SetStateAction<number>>;
  setShortcutsOverlayOpen: Dispatch<SetStateAction<boolean>>;
  setSpawnDialogOpen: Dispatch<SetStateAction<boolean>>;
  shortcutHotkeyBindings: ShortcutHotkeyBinding[];
  shortcutsOverlayOpen: boolean;
  spawnDialogOpen: boolean;
}

export function useAppHotkeys({
  activeWorkers,
  applySelection,
  clampNumber,
  closeKillConfirm,
  closeRenameModal,
  confirmKillSelection,
  controlGroupByDigitRef,
  cycleIdleSelection,
  cycleSelectedGroupFocus,
  cycleSelection,
  escapeTerminalFocus,
  findMatchingShortcutIndexes,
  firstSummonEntryIndex,
  focusRallyCommandInput,
  focusedSelectedWorkerId,
  inSelectedGroupView,
  isEditableTarget,
  isTerminalEscapeShortcut,
  isTerminalTarget,
  killConfirmWorkerIds,
  mapColumnRatioStep,
  nudgeMapColumnRatio,
  onActivateRosterIndex,
  onKillRosterActive,
  onKillSelected,
  onToggleMovementModeSelected,
  openRenameForWorkers,
  paletteOpen,
  parseControlGroupDigit,
  renameModalOpen,
  requestTerminalFocus,
  resetMapColumnRatio,
  rosterActiveIndex,
  rosterEntries,
  runSpawn,
  selectedGroupActiveIndex,
  selectedWorkerId,
  selectedWorkerIds,
  selectedWorkers,
  setControlGroups,
  setFocusedSelectedWorkerId,
  setPaletteOpen,
  setRosterActiveIndex,
  setSelectedGroupActiveIndex,
  setShortcutsOverlayOpen,
  setSpawnDialogOpen,
  shortcutHotkeyBindings,
  shortcutsOverlayOpen,
  spawnDialogOpen
}: UseAppHotkeysParams): void {
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

      if (!isEditableTarget(event.target) && !isTerminalTarget(event.target)) {
        const hotkeyShortcutIndexes = findMatchingShortcutIndexes(shortcutHotkeyBindings, event);
        if (hotkeyShortcutIndexes.length > 0) {
          event.preventDefault();
          for (const shortcutIndex of hotkeyShortcutIndexes) {
            void runSpawn({ shortcutIndex });
          }
        }
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
        if (
          !renameModalOpen &&
          !shortcutsOverlayOpen &&
          !paletteOpen &&
          !spawnDialogOpen &&
          selectedWorkers.length > 1 &&
          focusedSelectedWorkerId
        ) {
          const escaped = escapeTerminalFocus();
          event.preventDefault();
          if (escaped) {
            event.stopPropagation();
          }
          setFocusedSelectedWorkerId(undefined);
          return;
        }

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
        if (selectedWorkers.length > 1) {
          cycleSelectedGroupFocus(event.shiftKey ? -1 : 1);
          return;
        }

        cycleSelection(event.shiftKey ? -1 : 1);
        return;
      }

      if (event.code === "Period" && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditableTarget(event.target)) {
        if (isTerminalTarget(event.target)) {
          return;
        }

        event.preventDefault();
        cycleIdleSelection(event.shiftKey ? -1 : 1);
        return;
      }

      if (event.code === "Comma" && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditableTarget(event.target)) {
        if (isTerminalTarget(event.target)) {
          return;
        }

        event.preventDefault();
        cycleIdleSelection(-1);
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

      const keyLower = event.key.toLowerCase();
      const killViaK =
        keyLower === "k" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (!inSelectedGroupView ? !event.shiftKey : event.shiftKey);

      if (
        (killViaK || event.key === "Delete") &&
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
        if (inSelectedGroupView && keyLower === "c" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          const focused = focusRallyCommandInput();
          if (focused) {
            event.preventDefault();
          }
          return;
        }

        if ((keyLower === "j" || keyLower === "k") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          const delta = keyLower === "j" ? 1 : -1;
          const nextIndex = clampNumber(selectedGroupActiveIndex + delta, 0, selectedWorkers.length - 1);
          const nextWorker = selectedWorkers[nextIndex];
          setSelectedGroupActiveIndex(nextIndex);
          if (focusedSelectedWorkerId && nextWorker) {
            setFocusedSelectedWorkerId(nextWorker.id);
          }
          return;
        }

        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          const focusedWorker =
            selectedWorkers.find((worker) => worker.id === focusedSelectedWorkerId) ??
            selectedWorkers[selectedGroupActiveIndex] ??
            selectedWorkers[0];
          if (!focusedWorker) {
            return;
          }

          event.preventDefault();
          setFocusedSelectedWorkerId(focusedWorker.id);
          requestTerminalFocus();
          return;
        }
      }

      if (selectedWorkerIds.length === 0 && rosterEntries.length > 0 && !isTerminalTarget(event.target)) {
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
        const focusedGroupWorker =
          selectedWorkers.length > 1
            ? selectedWorkers.find((worker) => worker.id === focusedSelectedWorkerId)
            : undefined;
        openRenameForWorkers(focusedGroupWorker ? [focusedGroupWorker] : selectedWorkers);
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
    activeWorkers,
    applySelection,
    clampNumber,
    closeKillConfirm,
    closeRenameModal,
    confirmKillSelection,
    controlGroupByDigitRef,
    cycleIdleSelection,
    cycleSelectedGroupFocus,
    cycleSelection,
    escapeTerminalFocus,
    findMatchingShortcutIndexes,
    firstSummonEntryIndex,
    focusRallyCommandInput,
    focusedSelectedWorkerId,
    inSelectedGroupView,
    isEditableTarget,
    isTerminalEscapeShortcut,
    isTerminalTarget,
    killConfirmWorkerIds,
    mapColumnRatioStep,
    nudgeMapColumnRatio,
    onActivateRosterIndex,
    onKillRosterActive,
    onKillSelected,
    onToggleMovementModeSelected,
    openRenameForWorkers,
    paletteOpen,
    parseControlGroupDigit,
    renameModalOpen,
    requestTerminalFocus,
    resetMapColumnRatio,
    rosterActiveIndex,
    rosterEntries,
    runSpawn,
    selectedGroupActiveIndex,
    selectedWorkerId,
    selectedWorkerIds,
    selectedWorkers,
    setControlGroups,
    setFocusedSelectedWorkerId,
    setPaletteOpen,
    setRosterActiveIndex,
    setSelectedGroupActiveIndex,
    setShortcutsOverlayOpen,
    setSpawnDialogOpen,
    shortcutHotkeyBindings,
    shortcutsOverlayOpen,
    spawnDialogOpen
  ]);
}
