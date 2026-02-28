import type { ShortcutConfig, Worker } from "../../shared/types";

interface BottomBarProps {
  shortcuts: ShortcutConfig[];
  selectedWorker?: Worker;
  onSpawnShortcut: (shortcutIndex: number) => void;
  onOpenSpawnDialog: () => void;
  onOpenPalette: () => void;
  onDeselect: () => void;
  onOpenSelectedInTerminal: () => void;
  onStopSelected: () => void;
  onRestartSelected: () => void;
  onRemoveSelected: () => void;
}

export function BottomBar({
  shortcuts,
  selectedWorker,
  onSpawnShortcut,
  onOpenSpawnDialog,
  onOpenPalette,
  onDeselect,
  onOpenSelectedInTerminal,
  onStopSelected,
  onRestartSelected,
  onRemoveSelected
}: BottomBarProps): JSX.Element {
  if (selectedWorker) {
    const stopped = selectedWorker.status === "stopped";

    return (
      <div className="bottom-bar">
        <button className="bar-btn subtle" onClick={onDeselect}>
          Back
        </button>
        <div className="selected-worker-meta">
          <div className="selected-worker-name">{selectedWorker.name}</div>
          <div className="selected-worker-subline">
            {selectedWorker.projectId} · {selectedWorker.runtimeId} · {selectedWorker.status}
          </div>
        </div>

        <button className="bar-btn danger" onClick={onStopSelected} disabled={stopped}>
          Stop
        </button>
        <button className="bar-btn" onClick={onRestartSelected}>
          Restart
        </button>
        <button className="bar-btn" onClick={onOpenSelectedInTerminal} disabled={stopped}>
          Open in Terminal
        </button>
        <button className="bar-btn subtle" onClick={onRemoveSelected}>
          Remove
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
