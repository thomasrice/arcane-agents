import type { ShortcutConfig, Worker } from "../../shared/types";

interface BottomBarProps {
  shortcuts: ShortcutConfig[];
  selectedWorker?: Worker;
  selectedWorkers?: Worker[];
  onSpawnShortcut: (shortcutIndex: number) => void;
  onOpenSpawnDialog: () => void;
  onOpenPalette: () => void;
  onDeselect: () => void;
  onKillSelected: () => void;
  onRenameSelected: () => void;
  onToggleMovementMode: () => void;
  onScatterSelected: () => void;
}

export function BottomBar({
  shortcuts,
  selectedWorker,
  selectedWorkers = selectedWorker ? [selectedWorker] : [],
  onSpawnShortcut,
  onOpenSpawnDialog,
  onOpenPalette,
  onDeselect,
  onKillSelected,
  onRenameSelected,
  onToggleMovementMode,
  onScatterSelected
}: BottomBarProps): JSX.Element {
  if (selectedWorkers.length > 0) {
    const stopped = selectedWorkers.every((worker) => worker.status === "stopped");
    const movementModes = new Set(selectedWorkers.map((worker) => worker.movementMode));
    const movementModeLabel =
      movementModes.size === 1
        ? selectedWorkers[0]?.movementMode === "wander"
          ? "Wander"
          : "Hold"
        : "Mixed";
    const displayLabel =
      selectedWorkers.length === 1
        ? (selectedWorkers[0]?.displayName ?? selectedWorkers[0]?.name ?? "Selected")
        : `${selectedWorkers.length} selected agents`;
    const subline =
      selectedWorkers.length === 1
        ? `${selectedWorkers[0]?.projectId} · ${selectedWorkers[0]?.runtimeId} · ${selectedWorkers[0]?.status} · ${movementModeLabel}`
        : `${selectedWorkers.filter((worker) => worker.status === "working").length} working · ${selectedWorkers.filter((worker) => worker.status === "idle").length} idle · ${movementModeLabel}`;

    return (
      <div className="bottom-bar">
        <button className="bar-btn subtle" onClick={onDeselect}>
          Back
        </button>
        <div className="selected-worker-meta">
          <div className="selected-worker-name">{displayLabel}</div>
          <div className="selected-worker-subline">{subline}</div>
        </div>

        <button className="bar-btn" onClick={onToggleMovementMode}>
          {movementModeLabel === "Mixed" ? "Mode: Mixed" : `Mode: ${movementModeLabel}`}
        </button>
        {selectedWorkers.length > 1 ? (
          <button className="bar-btn" onClick={onScatterSelected}>
            Scatter
          </button>
        ) : null}
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
