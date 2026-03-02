import type { Worker } from "../../shared/types";

interface KillConfirmDialogProps {
  workerIds: string[];
  workers: Worker[];
  onClose: () => void;
  onConfirm: () => void;
}

export function KillConfirmDialog({ workerIds, workers, onClose, onConfirm }: KillConfirmDialogProps): JSX.Element | null {
  if (workerIds.length === 0) {
    return null;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog kill-confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">{workerIds.length > 1 ? "Kill Agents?" : "Kill Agent?"}</div>
        <div className="rename-subtitle">
          {workerIds.length > 1
            ? `${workerIds.length} selected agents`
            : workers[0]?.displayName ?? workers[0]?.name ?? "Selected agent"}
        </div>
        <div className="kill-confirm-copy">
          {workerIds.length > 1
            ? "This will terminate all selected sessions and remove those agents from the map."
            : "This will terminate the session and remove this agent from the map."}
        </div>
        <div className="dialog-actions">
          <button className="bar-btn subtle" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="bar-btn danger" type="button" onClick={onConfirm}>
            Kill (Enter)
          </button>
        </div>
        <div className="kill-confirm-hint">Press any other key to dismiss.</div>
      </div>
    </div>
  );
}
