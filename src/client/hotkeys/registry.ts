import type { Dispatch, SetStateAction } from "react";
import type { Worker } from "../../shared/types";
import type { ControlGroupMap, OpenDialog, PendingConfirm, RosterEntry } from "../app/types";
import { mapColumnRatioStep } from "../app/constants";
import { clampNumber, isEditableTarget, isTerminalTarget, parseControlGroupDigit } from "../app/utils";
import { findMatchingShortcutIndexes, type ShortcutHotkeyBinding } from "./shortcutHotkeys";

// Declarative replacement for the former three-function if-cascade. The whole hotkey
// layer is now one ordered table of bindings walked in priority order: the first whose
// scope is active and whose `match` fires `run`s and (unless it returns false) claims
// the event. Scope gating reproduces the cascade's structural guards; `match` carries
// the per-key modifier/target guards. `ShortcutsDialog` renders `getHotkeyReference`
// off the same bindings, so the on-screen reference can no longer drift from behaviour.

export type HotkeyScope = "confirm" | "global" | "hasSelection" | "groupView" | "rosterView";

export interface HotkeyDoc {
  section: string;
  keys: string;
  description: string;
}

export interface HotkeyBinding {
  id: string;
  scope: HotkeyScope;
  match: (event: KeyboardEvent, ctx: HotkeyContext) => boolean;
  /** Perform the action. Returns true when the event is handled (stops the walk). */
  run: (event: KeyboardEvent, ctx: HotkeyContext) => boolean;
  doc?: HotkeyDoc;
}

// The state + actions a binding may read at event time. `useAppHotkeys` assembles this
// from the store (state + store actions) plus the few external callbacks App injects.
export interface HotkeyContext {
  activeWorkers: Worker[];
  selectedWorkerId: string | undefined;
  selectedWorkerIds: string[];
  selectedWorkers: Worker[];
  focusedSelectedWorkerId: string | undefined;
  inSelectedGroupView: boolean;
  rosterEntries: RosterEntry[];
  rosterActiveIndex: number;
  selectedGroupActiveIndex: number;
  firstSummonEntryIndex: number | undefined;
  controlGroups: ControlGroupMap;
  pendingConfirm: PendingConfirm | null;
  openDialog: OpenDialog;
  shortcutHotkeyBindings: ShortcutHotkeyBinding[];

  applySelection: (
    workerIds: string[],
    options?: { center?: boolean; focusTerminal?: boolean; focusWorkerId?: string }
  ) => void;
  cycleSelection: (direction: 1 | -1) => void;
  cycleIdleSelection: (direction: 1 | -1) => void;
  cycleReviewSelection: (direction: 1 | -1) => void;
  cycleSelectedGroupFocus: (direction: 1 | -1) => void;
  setControlGroups: Dispatch<SetStateAction<ControlGroupMap>>;
  setRosterActiveIndex: Dispatch<SetStateAction<number>>;
  setSelectedGroupActiveIndex: Dispatch<SetStateAction<number>>;
  setFocusedSelectedWorkerId: Dispatch<SetStateAction<string | undefined>>;
  requestTerminalFocus: () => void;
  clearConfirm: () => void;
  confirmPending: () => void;
  closeRename: () => void;
  setBatchSpawnDialogOpen: (open: boolean) => void;
  setShortcutsOverlayOpen: Dispatch<SetStateAction<boolean>>;
  setPaletteOpen: (open: boolean) => void;
  setGoToDialogOpen: (open: boolean) => void;
  setSpawnDialogOpen: (open: boolean) => void;
  nudgeMapColumnRatio: (delta: number) => void;
  resetMapColumnRatio: () => void;
  onKillSelected: () => void;
  onKillRosterActive: () => void;
  onRestartSelected: () => void;
  onRestartRosterActive: () => void;
  onRenameSelected: () => void;
  onToggleMovementModeSelected: () => void | Promise<void>;
  onActivateRosterIndex: (index: number) => void;
  onScatterSelected: () => void;
  runSpawn: (input: { shortcutIndex: number }) => void | Promise<void>;
  focusRallyCommandInput: () => boolean;
  escapeTerminalFocus: () => boolean;
  isTerminalEscapeShortcut: (event: KeyboardEvent) => boolean;
}

const controlGroupCycleOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;

// Bare modifier and lock keys carry no intent on their own (e.g. pressing Shift on the
// way to Shift+Enter); they must not dismiss an open confirm dialog.
const modifierOnlyKeys = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
  "CapsLock",
  "NumLock",
  "ScrollLock"
]);

function isModifierOnlyKey(event: KeyboardEvent): boolean {
  return modifierOnlyKeys.has(event.key);
}

function isUnmodifiedEnter(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

/** No plain modifier held (Shift is still allowed). */
function noPlainModifiers(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey;
}

function noDialogOpen(ctx: HotkeyContext): boolean {
  return ctx.openDialog === null;
}

export const hotkeyBindings: HotkeyBinding[] = [
  // --- Confirm dialog (exclusive while a confirm is pending) ---
  {
    id: "confirm-accept",
    scope: "confirm",
    match: (event) => isUnmodifiedEnter(event),
    run: (event, ctx) => {
      event.preventDefault();
      ctx.confirmPending();
      return true;
    }
  },
  {
    id: "confirm-dismiss",
    scope: "confirm",
    match: (event) => !isModifierOnlyKey(event) && !isUnmodifiedEnter(event),
    run: (event, ctx) => {
      event.preventDefault();
      ctx.clearConfirm();
      return true;
    }
  },

  // --- System ---
  {
    id: "open-go-to-character",
    scope: "global",
    match: (event, ctx) =>
      ctx.openDialog === null &&
      event.key.toLowerCase() === "g" &&
      noPlainModifiers(event) &&
      !event.shiftKey &&
      !isEditableTarget(event.target) &&
      !isTerminalTarget(event.target),
    doc: { section: "Overlays", keys: "G", description: "Go to a character by name" },
    run: (event, ctx) => {
      event.preventDefault();
      ctx.setGoToDialogOpen(true);
      return true;
    }
  },
  {
    id: "summon-shortcut",
    scope: "global",
    match: (event, ctx) =>
      !isEditableTarget(event.target) &&
      !isTerminalTarget(event.target) &&
      findMatchingShortcutIndexes(ctx.shortcutHotkeyBindings ?? [], event).length > 0,
    run: (event, ctx) => {
      event.preventDefault();
      event.stopPropagation();
      for (const shortcutIndex of findMatchingShortcutIndexes(ctx.shortcutHotkeyBindings ?? [], event)) {
        void ctx.runSpawn({ shortcutIndex });
      }
      return true;
    }
  },
  {
    id: "escape",
    scope: "global",
    match: (event) => event.key === "Escape",
    doc: { section: "Overlays", keys: "Esc", description: "Close overlay/dialog, then deselect" },
    run: (event, ctx) => {
      if (ctx.openDialog === "rename") {
        event.preventDefault();
        ctx.closeRename();
        return true;
      }
      if (ctx.openDialog === "goTo") {
        event.preventDefault();
        ctx.setGoToDialogOpen(false);
        return true;
      }
      if (ctx.openDialog === "batchSpawn") {
        event.preventDefault();
        ctx.setBatchSpawnDialogOpen(false);
        return true;
      }
      if (ctx.openDialog === "shortcuts") {
        event.preventDefault();
        ctx.setShortcutsOverlayOpen(false);
        return true;
      }
      if (ctx.openDialog === "palette" || ctx.openDialog === "spawn") {
        event.preventDefault();
        ctx.setPaletteOpen(false);
        ctx.setSpawnDialogOpen(false);
        return true;
      }
      if (isTerminalTarget(event.target)) {
        return true;
      }
      if (ctx.selectedWorkerId) {
        event.preventDefault();
        ctx.applySelection([]);
      }
      return true;
    }
  },
  {
    id: "terminal-escape",
    scope: "global",
    match: (event, ctx) => ctx.isTerminalEscapeShortcut(event),
    run: (event, ctx) => {
      if (noDialogOpen(ctx) && ctx.selectedWorkers.length > 1 && ctx.focusedSelectedWorkerId) {
        const escaped = ctx.escapeTerminalFocus();
        event.preventDefault();
        if (escaped) {
          event.stopPropagation();
        }
        ctx.setFocusedSelectedWorkerId(undefined);
        return true;
      }

      const escaped = ctx.escapeTerminalFocus();
      if (escaped) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }

      if (noDialogOpen(ctx) && ctx.selectedWorkerIds.length > 0) {
        event.preventDefault();
        if (ctx.selectedWorkerId) {
          const selectedIndex = ctx.rosterEntries.findIndex(
            (entry) => entry.kind === "worker" && entry.worker.id === ctx.selectedWorkerId
          );
          if (selectedIndex >= 0) {
            ctx.setRosterActiveIndex(selectedIndex);
          }
        }
        ctx.applySelection([]);
      }
      return true;
    }
  },
  {
    id: "toggle-shortcuts",
    scope: "global",
    match: (event) => event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey,
    doc: { section: "Overlays", keys: "?", description: "Toggle this shortcut panel" },
    run: (event, ctx) => {
      if (!isEditableTarget(event.target) || ctx.openDialog === "shortcuts") {
        event.preventDefault();
        ctx.setShortcutsOverlayOpen((current) => !current);
      }
      return true;
    }
  },
  {
    id: "column-resize",
    scope: "global",
    match: (event) =>
      (event.code === "BracketLeft" || event.code === "BracketRight" || (event.key === "=" && !event.shiftKey)) &&
      noPlainModifiers(event) &&
      !isEditableTarget(event.target) &&
      !isTerminalTarget(event.target),
    doc: { section: "Move & Layout", keys: "[ / ] / Shift + [ / ] / =", description: "Resize columns, jump split to edge, or reset split" },
    run: (event, ctx) => {
      event.preventDefault();
      if (event.code === "BracketLeft") {
        ctx.nudgeMapColumnRatio(event.shiftKey ? -1 : -mapColumnRatioStep);
      } else if (event.code === "BracketRight") {
        ctx.nudgeMapColumnRatio(event.shiftKey ? 1 : mapColumnRatioStep);
      } else {
        ctx.resetMapColumnRatio();
      }
      return true;
    }
  },

  // --- Navigation ---
  {
    id: "cycle-selection",
    scope: "global",
    match: (event) => event.key === "Tab" && noPlainModifiers(event) && !isEditableTarget(event.target),
    doc: { section: "Selection & Groups", keys: "Tab / Shift + Tab", description: "Select next / previous agent (or cycle selected group focus)" },
    run: (event, ctx) => {
      if (isTerminalTarget(event.target)) {
        return true;
      }
      event.preventDefault();
      if (ctx.selectedWorkers.length > 1) {
        ctx.cycleSelectedGroupFocus(event.shiftKey ? -1 : 1);
        return true;
      }
      ctx.cycleSelection(event.shiftKey ? -1 : 1);
      return true;
    }
  },
  {
    id: "cycle-review",
    scope: "global",
    match: (event) => event.code === "Space" && noPlainModifiers(event) && !isEditableTarget(event.target),
    doc: {
      section: "Selection & Groups",
      keys: "Space / Shift + Space",
      description: "Cycle agents ready or needing input"
    },
    run: (event, ctx) => {
      if (isTerminalTarget(event.target)) {
        return true;
      }
      event.preventDefault();
      ctx.cycleReviewSelection(event.shiftKey ? -1 : 1);
      return true;
    }
  },
  {
    id: "cycle-idle-forward",
    scope: "global",
    match: (event) => event.code === "Period" && noPlainModifiers(event) && !isEditableTarget(event.target),
    doc: { section: "Selection & Groups", keys: ". / Shift + . / ,", description: "Cycle idle agents only" },
    run: (event, ctx) => {
      if (isTerminalTarget(event.target)) {
        return true;
      }
      event.preventDefault();
      ctx.cycleIdleSelection(event.shiftKey ? -1 : 1);
      return true;
    }
  },
  {
    id: "cycle-idle-back",
    scope: "global",
    match: (event) => event.code === "Comma" && noPlainModifiers(event) && !isEditableTarget(event.target),
    run: (event, ctx) => {
      if (isTerminalTarget(event.target)) {
        return true;
      }
      event.preventDefault();
      ctx.cycleIdleSelection(-1);
      return true;
    }
  },
  {
    id: "cycle-control-groups",
    scope: "global",
    match: (event) =>
      (event.key === "`" || event.key === "~" || event.code === "Backquote") &&
      noPlainModifiers(event) &&
      !isEditableTarget(event.target),
    doc: {
      section: "Selection & Groups",
      keys: "` / Shift + `",
      description: "Cycle populated control groups forwards / backwards, opening the first member"
    },
    run: (event, ctx) => {
      if (isTerminalTarget(event.target)) {
        return true;
      }

      const activeWorkerIdSet = new Set(ctx.activeWorkers.map((worker) => worker.id));
      const populatedGroups = controlGroupCycleOrder.flatMap((digit) => {
        const workerIds = (ctx.controlGroups[digit] ?? []).filter((workerId) => activeWorkerIdSet.has(workerId));
        return workerIds.length > 0 ? [workerIds] : [];
      });
      if (populatedGroups.length === 0) {
        return true;
      }

      const focusedWorkerId =
        ctx.focusedSelectedWorkerId ??
        (ctx.selectedWorkerIds.length === 1 ? ctx.selectedWorkerIds[0] : undefined);
      const selectedWorkerIdSet = new Set(ctx.selectedWorkerIds);
      const currentGroupIndex = populatedGroups.findIndex(
        (workerIds) =>
          Boolean(focusedWorkerId && workerIds.includes(focusedWorkerId)) ||
          (workerIds.length === selectedWorkerIdSet.size &&
            workerIds.every((workerId) => selectedWorkerIdSet.has(workerId)))
      );
      const direction = event.shiftKey ? -1 : 1;
      const nextGroupIndex =
        currentGroupIndex < 0
          ? direction > 0
            ? 0
            : populatedGroups.length - 1
          : (currentGroupIndex + direction + populatedGroups.length) % populatedGroups.length;
      const nextGroup = populatedGroups[nextGroupIndex];
      if (!nextGroup) {
        return true;
      }

      event.preventDefault();
      // Cycling is for scanning groups, so land on a member's terminal rather than the
      // group page. Order follows activeWorkers to match the group page listing and Tab.
      const nextGroupIdSet = new Set(nextGroup);
      const firstGroupMemberId = ctx.activeWorkers.find((worker) => nextGroupIdSet.has(worker.id))?.id;
      ctx.applySelection(nextGroup, { center: true, focusWorkerId: firstGroupMemberId });
      return true;
    }
  },
  {
    id: "control-group-assign",
    scope: "global",
    match: (event, ctx) =>
      parseControlGroupDigit(event) !== undefined &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      ctx.selectedWorkerIds.length > 0,
    doc: { section: "Selection & Groups", keys: "Ctrl + 1 – 0", description: "Assign selected agent(s) to control group" },
    run: (event, ctx) => {
      const groupDigit = parseControlGroupDigit(event);
      if (groupDigit === undefined) {
        return false;
      }
      event.preventDefault();
      ctx.setControlGroups((current) => {
        const selectionSet = new Set(ctx.selectedWorkerIds);
        const existing = current[groupDigit] ?? [];
        const existingSet = new Set(existing);
        const sameSelection =
          existing.length === ctx.selectedWorkerIds.length &&
          ctx.selectedWorkerIds.every((workerId) => existingSet.has(workerId));

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

        next[groupDigit] = [...ctx.selectedWorkerIds];
        return next;
      });
      return true;
    }
  },
  {
    id: "control-group-select",
    scope: "global",
    match: (event) =>
      parseControlGroupDigit(event) !== undefined &&
      noPlainModifiers(event) &&
      !event.shiftKey &&
      !isEditableTarget(event.target),
    doc: { section: "Selection & Groups", keys: "1 – 0", description: "Select control group (opens group page)" },
    run: (event, ctx) => {
      const groupDigit = parseControlGroupDigit(event);
      if (groupDigit === undefined) {
        return false;
      }
      const workerIds = ctx.controlGroups[groupDigit] ?? [];
      if (workerIds.length === 0) {
        return true;
      }

      const activeWorkerIdSet = new Set(ctx.activeWorkers.map((worker) => worker.id));
      const existingWorkerIds = workerIds.filter((workerId) => activeWorkerIdSet.has(workerId));
      if (existingWorkerIds.length === 0) {
        ctx.setControlGroups((current) => {
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
      ctx.applySelection(existingWorkerIds, { center: true });
      return true;
    }
  },
  {
    // Any remaining digit is swallowed (matches the cascade's blanket `return true`),
    // so a stray digit never leaks into the action bindings below.
    id: "control-group-swallow",
    scope: "global",
    match: (event) => parseControlGroupDigit(event) !== undefined,
    run: () => true
  },


  // --- Actions (an editable target swallows everything below, as before) ---
  {
    id: "editable-swallow",
    scope: "global",
    match: (event) => isEditableTarget(event.target),
    run: () => true
  },
  {
    id: "kill-selected",
    scope: "hasSelection",
    match: (event, ctx) => {
      const keyLower = event.key.toLowerCase();
      const killViaK =
        keyLower === "k" &&
        noPlainModifiers(event) &&
        (ctx.inSelectedGroupView ? event.shiftKey : ctx.selectedWorkerIds.length === 1 || !event.shiftKey);
      return (killViaK || event.key === "Delete") && noPlainModifiers(event);
    },
    doc: { section: "Agents", keys: "K", description: "Open kill confirm (Shift + K in selected group view)" },
    run: (event, ctx) => {
      event.preventDefault();
      ctx.onKillSelected();
      return true;
    }
  },
  {
    id: "restart-selected",
    scope: "hasSelection",
    match: (event) => event.key.toLowerCase() === "p" && noPlainModifiers(event),
    doc: { section: "Agents", keys: "P", description: "Open respawn confirm for the selected agent(s)" },
    run: (event, ctx) => {
      event.preventDefault();
      ctx.onRestartSelected();
      return true;
    }
  },

  // --- Selected group view ---
  {
    id: "group-focus-rally",
    scope: "groupView",
    match: (event, ctx) =>
      ctx.inSelectedGroupView &&
      event.key.toLowerCase() === "c" &&
      noPlainModifiers(event) &&
      !event.shiftKey &&
      !isTerminalTarget(event.target),
    doc: { section: "Selection & Groups", keys: "C", description: "Focus Rally Command input (selected group view)" },
    run: (event, ctx) => {
      const focused = ctx.focusRallyCommandInput();
      if (focused) {
        event.preventDefault();
      }
      return true;
    }
  },
  {
    id: "group-cursor",
    scope: "groupView",
    match: (event) => {
      const keyLower = event.key.toLowerCase();
      return (keyLower === "j" || keyLower === "k") && noPlainModifiers(event) && !event.shiftKey && !isTerminalTarget(event.target);
    },
    doc: { section: "Selection & Groups", keys: "J / K", description: "Move the selection cursor in the group and roster lists" },
    run: (event, ctx) => {
      event.preventDefault();
      const delta = event.key.toLowerCase() === "j" ? 1 : -1;
      const nextIndex = clampNumber(ctx.selectedGroupActiveIndex + delta, 0, ctx.selectedWorkers.length - 1);
      const nextWorker = ctx.selectedWorkers[nextIndex];
      ctx.setSelectedGroupActiveIndex(nextIndex);
      if (ctx.focusedSelectedWorkerId && nextWorker) {
        ctx.setFocusedSelectedWorkerId(nextWorker.id);
      }
      return true;
    }
  },
  {
    id: "group-open-terminal",
    scope: "groupView",
    match: (event) => isUnmodifiedEnter(event) && !isTerminalTarget(event.target),
    run: (event, ctx) => {
      const focusedWorker =
        ctx.selectedWorkers.find((worker) => worker.id === ctx.focusedSelectedWorkerId) ??
        ctx.selectedWorkers[ctx.selectedGroupActiveIndex] ??
        ctx.selectedWorkers[0];
      if (!focusedWorker) {
        return true;
      }
      event.preventDefault();
      ctx.setFocusedSelectedWorkerId(focusedWorker.id);
      ctx.requestTerminalFocus();
      return true;
    }
  },

  // --- Roster view (no selection) ---
  {
    id: "roster-restart",
    scope: "rosterView",
    match: (event, ctx) =>
      ctx.rosterEntries.length > 0 &&
      !isTerminalTarget(event.target) &&
      event.key.toLowerCase() === "p" &&
      noPlainModifiers(event) &&
      !event.shiftKey,
    run: (event, ctx) => {
      event.preventDefault();
      ctx.onRestartRosterActive();
      return true;
    }
  },
  {
    id: "roster-kill",
    scope: "rosterView",
    match: (event, ctx) =>
      ctx.rosterEntries.length > 0 &&
      !isTerminalTarget(event.target) &&
      event.key.toLowerCase() === "k" &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey,
    doc: { section: "Agents", keys: "Shift + K", description: "Kill highlighted roster agent (then Enter)" },
    run: (event, ctx) => {
      event.preventDefault();
      ctx.onKillRosterActive();
      return true;
    }
  },
  {
    id: "roster-jump-summon",
    scope: "rosterView",
    match: (event, ctx) =>
      ctx.rosterEntries.length > 0 &&
      !isTerminalTarget(event.target) &&
      event.key.toLowerCase() === "n" &&
      noPlainModifiers(event) &&
      !event.shiftKey &&
      ctx.firstSummonEntryIndex !== undefined,
    doc: { section: "Selection & Groups", keys: "N", description: "Jump to summon list" },
    run: (event, ctx) => {
      event.preventDefault();
      if (ctx.firstSummonEntryIndex !== undefined) {
        ctx.setRosterActiveIndex(ctx.firstSummonEntryIndex);
      }
      return true;
    }
  },
  {
    id: "roster-cursor",
    scope: "rosterView",
    match: (event, ctx) => {
      const keyLower = event.key.toLowerCase();
      return (
        ctx.rosterEntries.length > 0 &&
        !isTerminalTarget(event.target) &&
        (keyLower === "j" || keyLower === "k") &&
        noPlainModifiers(event) &&
        !event.shiftKey
      );
    },
    run: (event, ctx) => {
      event.preventDefault();
      const keyLower = event.key.toLowerCase();
      ctx.setRosterActiveIndex((current) => {
        const delta = keyLower === "j" ? 1 : -1;
        return clampNumber(current + delta, 0, ctx.rosterEntries.length - 1);
      });
      return true;
    }
  },
  {
    id: "roster-activate",
    scope: "rosterView",
    match: (event, ctx) => ctx.rosterEntries.length > 0 && !isTerminalTarget(event.target) && isUnmodifiedEnter(event),
    run: (event, ctx) => {
      event.preventDefault();
      ctx.onActivateRosterIndex(ctx.rosterActiveIndex);
      return true;
    }
  },

  // --- Actions on the current selection ---
  {
    id: "rename",
    scope: "hasSelection",
    match: (event, ctx) => event.key.toLowerCase() === "r" && noPlainModifiers(event) && ctx.selectedWorkers.length > 0,
    doc: { section: "Agents", keys: "R", description: "Rename selected agent" },
    run: (event, ctx) => {
      event.preventDefault();
      ctx.onRenameSelected();
      return true;
    }
  },
  {
    id: "toggle-movement-mode",
    scope: "hasSelection",
    match: (event, ctx) => event.key.toLowerCase() === "m" && noPlainModifiers(event) && ctx.selectedWorkers.length > 0,
    doc: { section: "Agents", keys: "M", description: "Toggle movement mode on selected agent(s)" },
    run: (event, ctx) => {
      event.preventDefault();
      void ctx.onToggleMovementModeSelected();
      return true;
    }
  },
  {
    id: "scatter",
    scope: "hasSelection",
    match: (event, ctx) =>
      event.key.toLowerCase() === "s" && noPlainModifiers(event) && !event.shiftKey && ctx.selectedWorkers.length > 1,
    doc: { section: "Agents", keys: "S", description: "Scatter the selected group across the map" },
    run: (event, ctx) => {
      event.preventDefault();
      ctx.onScatterSelected();
      return true;
    }
  },
  {
    id: "focus-terminal",
    scope: "hasSelection",
    match: (event, ctx) => isUnmodifiedEnter(event) && Boolean(ctx.selectedWorkerId),
    doc: { section: "Agents", keys: "Enter", description: "Activate highlighted item or focus the terminal" },
    run: (event, ctx) => {
      event.preventDefault();
      ctx.requestTerminalFocus();
      return true;
    }
  },

  // --- Command palette ---
  {
    id: "open-palette",
    scope: "global",
    match: (event) => event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey,
    doc: { section: "Overlays", keys: "/", description: "Open the command palette" },
    run: (event, ctx) => {
      event.preventDefault();
      ctx.setPaletteOpen(true);
      ctx.setSpawnDialogOpen(false);
      ctx.setShortcutsOverlayOpen(false);
      return true;
    }
  }
];

function isScopeActive(scope: HotkeyScope, ctx: HotkeyContext): boolean {
  switch (scope) {
    case "confirm":
      return ctx.pendingConfirm !== null;
    case "global":
      return true;
    case "hasSelection":
      return ctx.selectedWorkerIds.length > 0;
    case "groupView":
      return ctx.selectedWorkers.length > 1;
    case "rosterView":
      return ctx.selectedWorkerIds.length === 0;
  }
}

/**
 * Walk the registry in order; the first binding whose scope is active and whose `match`
 * fires runs and (unless it returns false) claims the event. While a confirm dialog is
 * open only confirm-scope bindings are eligible — reproducing the cascade's exclusivity,
 * so a bare modifier key passes through unhandled while any other key confirms/dismisses.
 * Returns whether the event was handled.
 */
export function runHotkeyRegistry(event: KeyboardEvent, ctx: HotkeyContext): boolean {
  const confirmActive = ctx.pendingConfirm !== null;
  for (const binding of hotkeyBindings) {
    if (confirmActive !== (binding.scope === "confirm")) {
      continue;
    }
    if (!isScopeActive(binding.scope, ctx)) {
      continue;
    }
    if (!binding.match(event, ctx)) {
      continue;
    }
    if (binding.run(event, ctx)) {
      return true;
    }
  }
  return false;
}

// --- On-screen reference (rendered by ShortcutsDialog) ---

export interface HotkeyReferenceRow {
  keys: string;
  description: string;
}

export interface HotkeyReferenceSection {
  title: string;
  rows: HotkeyReferenceRow[];
}

// Map-motion and divider shortcuts are handled in the map layer (useMapKeyboardMotion /
// SplitDivider), not the registry, but belong in the same on-screen reference.
const mapMotionReferenceRows: HotkeyReferenceRow[] = [
  { keys: "W / A / S / D", description: "Move selected agent(s) smoothly (hold)" },
  { keys: "Shift + W / A / S / D", description: "Pan the map" },
  { keys: "+ / -", description: "Zoom map in or out (outside terminal focus)" },
  { keys: "Left-drag divider", description: "Drag to resize the map and terminal columns" }
];

const referenceSectionOrder = ["Selection & Groups", "Move & Layout", "Agents", "Overlays"] as const;

/**
 * Build the keyboard reference straight from the registry so it can never drift from the
 * bindings. The configured "leave terminal focus" chord is injected because it is
 * user-defined rather than a static binding.
 */
export function getHotkeyReference(options: { leaveTerminalFocusHotkeys: string[] }): HotkeyReferenceSection[] {
  const rowsBySection = new Map<string, HotkeyReferenceRow[]>();
  for (const section of referenceSectionOrder) {
    rowsBySection.set(section, []);
  }

  for (const binding of hotkeyBindings) {
    if (!binding.doc) {
      continue;
    }
    const rows = rowsBySection.get(binding.doc.section);
    if (rows) {
      rows.push({ keys: binding.doc.keys, description: binding.doc.description });
    }
  }

  // Motion rows lead the Move & Layout section.
  rowsBySection.set("Move & Layout", [...mapMotionReferenceRows, ...(rowsBySection.get("Move & Layout") ?? [])]);

  // The configured leave-terminal-focus chord sits with the other agent actions.
  const agentRows = rowsBySection.get("Agents") ?? [];
  agentRows.push({
    keys: options.leaveTerminalFocusHotkeys.join(" / ") || "Not configured",
    description: "Leave terminal focus; in selected group view, return to the group list"
  });

  return referenceSectionOrder.map((title) => ({ title, rows: rowsBySection.get(title) ?? [] }));
}
