import type { ControlGroupMap } from "../app/types";
import type { AppHotkeyContext } from "./hotkeyContext";

export function handleSystemHotkeys(event: KeyboardEvent, context: AppHotkeyContext): boolean {
  if (context.killConfirmWorkerIds.length > 0) {
    if (isUnmodifiedEnter(event)) {
      event.preventDefault();
      context.confirmKillSelection();
      return true;
    }

    event.preventDefault();
    context.closeKillConfirm();
    return true;
  }

  if (!context.isEditableTarget(event.target) && !context.isTerminalTarget(event.target)) {
    const hotkeyShortcutIndexes = context.findMatchingShortcutIndexes(context.shortcutHotkeyBindings, event);
    if (hotkeyShortcutIndexes.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      for (const shortcutIndex of hotkeyShortcutIndexes) {
        void context.runSpawn({ shortcutIndex });
      }
      return true;
    }
  }

  if (event.key === "Escape") {
    if (context.renameModalOpen) {
      event.preventDefault();
      context.closeRenameModal();
      return true;
    }

    if (context.batchSpawnDialogOpen) {
      event.preventDefault();
      context.setBatchSpawnDialogOpen(false);
      return true;
    }

    if (context.shortcutsOverlayOpen) {
      event.preventDefault();
      context.setShortcutsOverlayOpen(false);
      return true;
    }

    if (context.paletteOpen || context.spawnDialogOpen) {
      event.preventDefault();
      context.setPaletteOpen(false);
      context.setSpawnDialogOpen(false);
      return true;
    }

    if (context.isTerminalTarget(event.target)) {
      return true;
    }

    if (context.selectedWorkerId) {
      event.preventDefault();
      context.applySelection([]);
    }
    return true;
  }

  if (context.isTerminalEscapeShortcut(event)) {
    if (
      !context.renameModalOpen &&
      !context.batchSpawnDialogOpen &&
      !context.shortcutsOverlayOpen &&
      !context.paletteOpen &&
      !context.spawnDialogOpen &&
      context.selectedWorkers.length > 1 &&
      context.focusedSelectedWorkerId
    ) {
      const escaped = context.escapeTerminalFocus();
      event.preventDefault();
      if (escaped) {
        event.stopPropagation();
      }
      context.setFocusedSelectedWorkerId(undefined);
      return true;
    }

    const escaped = context.escapeTerminalFocus();
    if (escaped) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (
      !context.renameModalOpen &&
      !context.batchSpawnDialogOpen &&
      !context.shortcutsOverlayOpen &&
      !context.paletteOpen &&
      !context.spawnDialogOpen &&
      context.selectedWorkerIds.length > 0
    ) {
      event.preventDefault();
      if (context.selectedWorkerId) {
        const selectedIndex = context.rosterEntries.findIndex(
          (entry) => entry.kind === "worker" && entry.worker.id === context.selectedWorkerId
        );
        if (selectedIndex >= 0) {
          context.setRosterActiveIndex(selectedIndex);
        }
      }
      context.applySelection([]);
    }
    return true;
  }

  if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!context.isEditableTarget(event.target) || context.shortcutsOverlayOpen) {
      event.preventDefault();
      context.setShortcutsOverlayOpen((current) => !current);
    }
    return true;
  }

  if (
    (event.code === "BracketLeft" ||
      event.code === "BracketRight" ||
      (event.key === "=" && !event.shiftKey)) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !context.isEditableTarget(event.target) &&
    !context.isTerminalTarget(event.target)
  ) {
    event.preventDefault();
    if (event.code === "BracketLeft") {
      context.nudgeMapColumnRatio(event.shiftKey ? -1 : -context.mapColumnRatioStep);
    } else if (event.code === "BracketRight") {
      context.nudgeMapColumnRatio(event.shiftKey ? 1 : context.mapColumnRatioStep);
    } else {
      context.resetMapColumnRatio();
    }
    return true;
  }

  return false;
}

export function handleNavigationHotkeys(event: KeyboardEvent, context: AppHotkeyContext): boolean {
  if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey && !context.isEditableTarget(event.target)) {
    if (context.isTerminalTarget(event.target)) {
      return true;
    }

    event.preventDefault();
    if (context.selectedWorkers.length > 1) {
      context.cycleSelectedGroupFocus(event.shiftKey ? -1 : 1);
      return true;
    }

    context.cycleSelection(event.shiftKey ? -1 : 1);
    return true;
  }

  if (event.code === "Period" && !event.ctrlKey && !event.metaKey && !event.altKey && !context.isEditableTarget(event.target)) {
    if (context.isTerminalTarget(event.target)) {
      return true;
    }

    event.preventDefault();
    context.cycleIdleSelection(event.shiftKey ? -1 : 1);
    return true;
  }

  if (event.code === "Comma" && !event.ctrlKey && !event.metaKey && !event.altKey && !context.isEditableTarget(event.target)) {
    if (context.isTerminalTarget(event.target)) {
      return true;
    }

    event.preventDefault();
    context.cycleIdleSelection(-1);
    return true;
  }

  const groupDigit = context.parseControlGroupDigit(event);
  if (groupDigit === undefined) {
    return false;
  }

  if ((event.ctrlKey || event.metaKey) && !event.altKey && context.selectedWorkerIds.length > 0) {
    event.preventDefault();
    context.setControlGroups((current) => {
      const selectionSet = new Set(context.selectedWorkerIds);
      const existing = current[groupDigit] ?? [];
      const existingSet = new Set(existing);
      const sameSelection =
        existing.length === context.selectedWorkerIds.length &&
        context.selectedWorkerIds.every((workerId) => existingSet.has(workerId));

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

      next[groupDigit] = [...context.selectedWorkerIds];
      return next;
    });
    return true;
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !context.isEditableTarget(event.target)) {
    const workerIds = context.controlGroupByDigitRef.current[groupDigit] ?? [];
    if (workerIds.length === 0) {
      return true;
    }

    const activeWorkerIdSet = new Set(context.activeWorkers.map((worker) => worker.id));
    const existingWorkerIds = workerIds.filter((workerId) => activeWorkerIdSet.has(workerId));
    if (existingWorkerIds.length === 0) {
      context.setControlGroups((current) => {
        if (!(groupDigit in current)) {
          return current;
        }

        const next = { ...current };
        delete next[groupDigit];
        return next;
      });
      return true;
    }

    event.preventDefault();
    context.applySelection(existingWorkerIds, { center: existingWorkerIds.length === 1 });
  }

  return true;
}

export function handleActionHotkeys(event: KeyboardEvent, context: AppHotkeyContext): boolean {
  if (context.isEditableTarget(event.target)) {
    return true;
  }

  const keyLower = event.key.toLowerCase();
  const killViaK =
    keyLower === "k" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    (context.inSelectedGroupView ? event.shiftKey : context.selectedWorkerIds.length === 1 || !event.shiftKey);

  if (
    (killViaK || event.key === "Delete") &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    context.selectedWorkerIds.length > 0
  ) {
    event.preventDefault();
    context.onKillSelected();
    return true;
  }

  if (context.selectedWorkers.length > 1 && !context.isTerminalTarget(event.target)) {
    if (context.inSelectedGroupView && keyLower === "c" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      const focused = context.focusRallyCommandInput();
      if (focused) {
        event.preventDefault();
      }
      return true;
    }

    if ((keyLower === "j" || keyLower === "k") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      const delta = keyLower === "j" ? 1 : -1;
      const nextIndex = context.clampNumber(context.selectedGroupActiveIndex + delta, 0, context.selectedWorkers.length - 1);
      const nextWorker = context.selectedWorkers[nextIndex];
      context.setSelectedGroupActiveIndex(nextIndex);
      if (context.focusedSelectedWorkerId && nextWorker) {
        context.setFocusedSelectedWorkerId(nextWorker.id);
      }
      return true;
    }

    if (isUnmodifiedEnter(event)) {
      const focusedWorker =
        context.selectedWorkers.find((worker) => worker.id === context.focusedSelectedWorkerId) ??
        context.selectedWorkers[context.selectedGroupActiveIndex] ??
        context.selectedWorkers[0];
      if (!focusedWorker) {
        return true;
      }

      event.preventDefault();
      context.setFocusedSelectedWorkerId(focusedWorker.id);
      context.requestTerminalFocus();
      return true;
    }
  }

  if (context.selectedWorkerIds.length === 0 && context.rosterEntries.length > 0 && !context.isTerminalTarget(event.target)) {
    if (keyLower === "k" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      context.onKillRosterActive();
      return true;
    }

    if (
      keyLower === "n" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      context.firstSummonEntryIndex !== undefined
    ) {
      event.preventDefault();
      context.setRosterActiveIndex(context.firstSummonEntryIndex);
      return true;
    }

    if ((keyLower === "j" || keyLower === "k") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      context.setRosterActiveIndex((current) => {
        const delta = keyLower === "j" ? 1 : -1;
        return context.clampNumber(current + delta, 0, context.rosterEntries.length - 1);
      });
      return true;
    }

    if (isUnmodifiedEnter(event)) {
      event.preventDefault();
      context.onActivateRosterIndex(context.rosterActiveIndex);
      return true;
    }
  }

  if (keyLower === "r" && !event.ctrlKey && !event.metaKey && !event.altKey && context.selectedWorkers.length > 0) {
    event.preventDefault();
    const focusedGroupWorker =
      context.selectedWorkers.length > 1
        ? context.selectedWorkers.find((worker) => worker.id === context.focusedSelectedWorkerId)
        : undefined;
    context.openRenameForWorkers(focusedGroupWorker ? [focusedGroupWorker] : context.selectedWorkers);
    return true;
  }

  if (keyLower === "m" && !event.ctrlKey && !event.metaKey && !event.altKey && context.selectedWorkers.length > 0) {
    event.preventDefault();
    void context.onToggleMovementModeSelected();
    return true;
  }

  if (keyLower === "s" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && context.selectedWorkers.length > 1) {
    event.preventDefault();
    void context.onScatterSelected();
    return true;
  }

  if (isUnmodifiedEnter(event) && context.selectedWorkerId) {
    event.preventDefault();
    context.requestTerminalFocus();
    return true;
  }

  if (event.key !== "/") {
    return false;
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  event.preventDefault();
  context.setPaletteOpen(true);
  context.setSpawnDialogOpen(false);
  context.setShortcutsOverlayOpen(false);
  return true;
}

function isUnmodifiedEnter(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}
