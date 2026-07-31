import type { CSSProperties } from "react";
import type { ShortcutConfig, Worker } from "../../shared/types";

interface BottomBarProps {
  shortcuts: ShortcutConfig[];
  selectedWorkers: Worker[];
  soundEnabled: boolean;
  audioVolume: number;
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
  onAudioVolumeChange: (value: number) => void;
  onToggleAudioMuted: () => void;
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

function VolumeIcon({ muted }: { muted: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 10v4h3l4 3V7l-4 3H4Z" />
      <path d="M14 9.5c1 .75 1.5 1.6 1.5 2.5s-.5 1.75-1.5 2.5" />
      <path d="M16.5 7c1.7 1.35 2.5 3.05 2.5 5s-.8 3.65-2.5 5" />
      {muted ? <path className="volume-icon-slash" d="M5 5l14 14" /> : null}
    </svg>
  );
}

interface VolumeControlProps {
  soundEnabled: boolean;
  audioVolume: number;
  onAudioVolumeChange: (value: number) => void;
  onToggleAudioMuted: () => void;
}

function VolumeControl({
  soundEnabled,
  audioVolume,
  onAudioVolumeChange,
  onToggleAudioMuted
}: VolumeControlProps): JSX.Element {
  const volumePercent = Math.round(audioVolume * 100);
  const muted = audioVolume === 0;
  const disabledTitle = "Voice lines are disabled in Arcane's configuration";
  const muteLabel = muted ? "Unmute voice lines" : "Mute voice lines";
  const sliderStyle = { "--volume-progress": `${volumePercent}%` } as CSSProperties;

  return (
    <div className={`volume-control${soundEnabled ? "" : " disabled"}`} title={soundEnabled ? `${volumePercent}%` : disabledTitle}>
      <button
        type="button"
        className={`volume-mute-btn${muted ? " muted" : ""}`}
        onClick={onToggleAudioMuted}
        disabled={!soundEnabled}
        aria-label={muteLabel}
        aria-pressed={muted}
        title={soundEnabled ? muteLabel : disabledTitle}
      >
        <VolumeIcon muted={muted} />
      </button>
      <input
        className="volume-slider"
        type="range"
        min="0"
        max="100"
        step="1"
        value={volumePercent}
        onChange={(event) => onAudioVolumeChange(Number(event.currentTarget.value) / 100)}
        disabled={!soundEnabled}
        aria-label="Voice line volume"
        aria-valuetext={`${volumePercent}%`}
        style={sliderStyle}
      />
    </div>
  );
}

export function BottomBar({
  shortcuts,
  selectedWorkers,
  soundEnabled,
  audioVolume,
  onSpawnShortcut,
  onOpenSpawnDialog,
  onOpenPalette,
  onDeselect,
  onRestartSelected,
  onKillSelected,
  onRenameSelected,
  onToggleMovementMode,
  onToggleSilenced,
  onScatterSelected,
  onAudioVolumeChange,
  onToggleAudioMuted
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
        <VolumeControl
          soundEnabled={soundEnabled}
          audioVolume={audioVolume}
          onAudioVolumeChange={onAudioVolumeChange}
          onToggleAudioMuted={onToggleAudioMuted}
        />
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
      <VolumeControl
        soundEnabled={soundEnabled}
        audioVolume={audioVolume}
        onAudioVolumeChange={onAudioVolumeChange}
        onToggleAudioMuted={onToggleAudioMuted}
      />
    </div>
  );
}
