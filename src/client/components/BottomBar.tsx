import type { ShortcutConfig, Worker } from "../../shared/types";

interface BottomBarProps {
  shortcuts: ShortcutConfig[];
  selectedWorker?: Worker;
  onSpawnShortcut: (shortcutIndex: number) => void;
  onOpenSpawnDialog: () => void;
  onOpenPalette: () => void;
  onDeselect: () => void;
  onKillSelected: () => void;
  onRenameSelected: () => void;
  onToggleMovementMode: () => void;
}

export function BottomBar({
  shortcuts,
  selectedWorker,
  onSpawnShortcut,
  onOpenSpawnDialog,
  onOpenPalette,
  onDeselect,
  onKillSelected,
  onRenameSelected,
  onToggleMovementMode
}: BottomBarProps): JSX.Element {
  if (selectedWorker) {
    const stopped = selectedWorker.status === "stopped";
    const displayLabel = selectedWorker.displayName ?? selectedWorker.name;
    const movementModeLabel = selectedWorker.movementMode === "wander" ? "Wander" : "Hold";

    return (
      <div className="bottom-bar">
        <button className="bar-btn subtle" onClick={onDeselect}>
          Back
        </button>
        <div className="selected-worker-meta">
          <div className="selected-worker-name">{displayLabel}</div>
          <div className="selected-worker-subline">
            {selectedWorker.projectId} · {selectedWorker.runtimeId} · {selectedWorker.status} · {movementModeLabel}
          </div>
        </div>

        <button className="bar-btn" onClick={onToggleMovementMode}>
          {movementModeLabel === "Wander" ? "Mode: Wander" : "Mode: Hold"}
        </button>
        <button className="bar-btn" onClick={onRenameSelected}>
          Rename
        </button>
        <button className="bar-btn danger" onClick={onKillSelected} disabled={stopped}>
          Kill
        </button>
      </div>
    );
  }

  return (
    <div className="bottom-bar">
      {shortcuts.map((shortcut, index) => (
        <button key={`${shortcut.label}-${index}`} className="bar-btn" onClick={() => onSpawnShortcut(index)}>
          {shortcut.label}
        </button>
      ))}

      <button className="bar-btn accent" onClick={onOpenSpawnDialog}>
        +
      </button>

      <button className="bar-btn subtle" onClick={onOpenPalette}>
        /
      </button>
    </div>
  );
}
