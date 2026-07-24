import type { ShortcutConfig, Worker } from "../../shared/types";

interface BottomBarProps {
  shortcuts: ShortcutConfig[];
  selectedWorkers: Worker[];
  onSpawnShortcut: (shortcutIndex: number) => void;
  onOpenSpawnDialog: () => void;
  onOpenPalette: () => void;
  onDeselect: () => void;
  onRestartSelected: () => void;
  onKillSelected: () => void;
  onRenameSelected: () => void;
  onToggleMovementMode: () => void;
  onToggleSilenced: () => void;
  onScatterSelected: () => void;
}

function SilenceIcon({ crossedOut }: { crossedOut: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 10v4h3l4 3V7l-4 3H4Z" />
      <path d="M14 9.5c1 .75 1.5 1.6 1.5 2.5s-.5 1.75-1.5 2.5" />
      <path className="silence-icon-wave" d="M16.5 7c1.7 1.35 2.5 3.05 2.5 5s-.8 3.65-2.5 5" />
      {crossedOut ? <path className="silence-icon-slash" d="M5 5l14 14" /> : null}
    </svg>
  );
}

export function BottomBar({
  shortcuts,
  selectedWorkers,
  onSpawnShortcut,
  onOpenSpawnDialog,
  onOpenPalette,
  onDeselect,
  onRestartSelected,
  onKillSelected,
  onRenameSelected,
  onToggleMovementMode,
  onToggleSilenced,
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
    const allSilenced = selectedWorkers.every((worker) => worker.silenced);
    const anySilenced = selectedWorkers.some((worker) => worker.silenced);
    const silenceState = allSilenced ? "on" : anySilenced ? "mixed" : "off";
    const silenceLabel = allSilenced ? "Unsilence selected characters" : "Silence selected characters";
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
        <button
          className={`bar-btn icon-btn silence-toggle ${silenceState}`}
          onClick={onToggleSilenced}
          title={silenceLabel}
          aria-label={silenceLabel}
          aria-pressed={allSilenced ? true : anySilenced ? "mixed" : false}
        >
          <SilenceIcon crossedOut={anySilenced} />
        </button>
        {selectedWorkers.length > 1 ? (
          <button className="bar-btn" onClick={onScatterSelected}>
            Scatter
          </button>
        ) : null}
        <button className="bar-btn" onClick={onRenameSelected}>
          Rename
        </button>
        <button className="bar-btn" onClick={onRestartSelected} disabled={stopped}>
          Respawn
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
