import type { ShortcutHotkeyBinding } from "./shortcutHotkeys";

// The hotkey layer reads all of its state and store actions directly from the store
// (assembled in useAppHotkeys). These are the only inputs App still has to supply:
// the worker-action callbacks that own their own flows, the rally-card / map focus
// handles, and the config-derived summon + leave-terminal chords.
export interface AppHotkeyDeps {
  shortcutHotkeyBindings: ShortcutHotkeyBinding[];
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
