import type { Ref } from "react";
import { useShallow } from "zustand/react/shallow";
import type { FadingWorker } from "../app/types";
import type { UseWorkerActionsResult } from "../hooks/useWorkerActions";
import { useAppStore } from "../state/appStore";
import { selectActiveWorkers, selectSelectedWorkerId, selectSelectedWorkers } from "../state/selectors";
import { BottomBar } from "./BottomBar";
import { MapCanvas, type MapCanvasHandle } from "./MapCanvas";

interface MapColumnProps {
  mapRef: Ref<MapCanvasHandle>;
  workerActions: UseWorkerActionsResult;
  fadingWorkers: FadingWorker[];
  completionPendingWorkerIds: string[];
  terminalFocused: boolean;
  terminalWorkerId: string | undefined;
  onMoveOrderIssued: (workerId: string) => void;
  onScatterSelected: () => void;
}

// The left half of the shell: the map canvas over the selection/summon bottom bar.
// Selection, workers, and control groups come from the store; the imperative map
// handle and the App-level hooks (fade, voice lines, completion) arrive as props.
export function MapColumn({
  mapRef,
  workerActions,
  fadingWorkers,
  completionPendingWorkerIds,
  terminalFocused,
  terminalWorkerId,
  onMoveOrderIssued,
  onScatterSelected
}: MapColumnProps): JSX.Element {
  const config = useAppStore((state) => state.config);
  const activeWorkers = useAppStore(useShallow(selectActiveWorkers));
  const selectedWorkerId = useAppStore(selectSelectedWorkerId);
  const selectedWorkerIds = useAppStore(useShallow((state) => state.selectedWorkerIds));
  const selectedWorkers = useAppStore(useShallow(selectSelectedWorkers));
  const focusedSelectedWorkerId = useAppStore((state) => state.focusedSelectedWorkerId);
  const controlGroups = useAppStore(useShallow((state) => state.controlGroups));
  const audioVolume = useAppStore((state) => state.audioVolume);

  const actions = useAppStore(
    useShallow((state) => ({
      onSelectionChange: state.onSelectionChange,
      onActivateWorker: state.onActivateWorker,
      onSelectWorker: state.onSelectWorker,
      setSpawnDialogOpen: state.setSpawnDialogOpen,
      setPaletteOpen: state.setPaletteOpen,
      setAudioVolume: state.setAudioVolume,
      toggleAudioMuted: state.toggleAudioMuted
    }))
  );

  return (
    <div className="map-column">
      <MapCanvas
        ref={mapRef}
        workers={activeWorkers}
        fadingWorkers={fadingWorkers}
        selectedWorkerId={selectedWorkerId}
        selectedWorkerIds={selectedWorkerIds}
        focusedSelectedWorkerId={focusedSelectedWorkerId}
        terminalFocusedSelected={Boolean(selectedWorkerId && terminalFocused)}
        terminalFocusedWorkerId={terminalFocused ? terminalWorkerId : undefined}
        controlGroups={controlGroups}
        completionPendingWorkerIds={completionPendingWorkerIds}
        onSelectionChange={actions.onSelectionChange}
        onActivateWorker={actions.onActivateWorker}
        onMoveOrderIssued={onMoveOrderIssued}
        onPositionCommit={workerActions.onPositionCommit}
      />
      <BottomBar
        shortcuts={config?.shortcuts ?? []}
        selectedWorkers={selectedWorkers}
        soundEnabled={config?.audio.enableSound ?? false}
        audioVolume={audioVolume}
        onAudioVolumeChange={actions.setAudioVolume}
        onToggleAudioMuted={actions.toggleAudioMuted}
        onSpawnShortcut={(shortcutIndex) => {
          void workerActions.runSpawn({ shortcutIndex });
        }}
        onOpenSpawnDialog={() => actions.setSpawnDialogOpen(true)}
        onOpenPalette={() => actions.setPaletteOpen(true)}
        onDeselect={() => actions.onSelectWorker(undefined)}
        onRestartSelected={workerActions.onRestartSelected}
        onKillSelected={workerActions.onKillSelected}
        onRenameSelected={workerActions.onRenameSelected}
        onToggleMovementMode={() => void workerActions.onToggleMovementModeSelected()}
        onToggleSilenced={() => void workerActions.onToggleSilencedSelected()}
        onScatterSelected={onScatterSelected}
      />
    </div>
  );
}
