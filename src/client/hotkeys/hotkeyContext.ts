import type { ShortcutHotkeyBinding } from "./shortcutHotkeys";

// The hotkey layer reads store-owned state and actions directly from the store
// (assembled in useAppHotkeys). App supplies the client-local completion IDs,
// callbacks that own their own flows, command handles, and config-derived
// summon + leave-terminal chords.
export interface AppHotkeyDeps {
  shortcutHotkeyBindings: ShortcutHotkeyBinding[];
  pendingCompletionWorkerIds: string[];
  confirmPending: () => void;
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
