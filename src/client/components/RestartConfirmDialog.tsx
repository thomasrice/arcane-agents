import type { Worker } from "../../shared/types";

interface RestartConfirmDialogProps {
  workerIds: string[];
  workers: Worker[];
  onClose: () => void;
  onConfirm: () => void;
}

export function RestartConfirmDialog({
  workerIds,
  workers,
  onClose,
  onConfirm
}: RestartConfirmDialogProps): JSX.Element | null {
  if (workerIds.length === 0) {
    return null;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">{workerIds.length > 1 ? "Respawn Agents?" : "Respawn Agent?"}</div>
        <div className="rename-subtitle">
          {workerIds.length > 1
            ? `${workerIds.length} selected agents`
            : workers[0]?.displayName ?? workers[0]?.name ?? "Selected agent"}
        </div>
        <div className="confirm-copy">
          {workerIds.length > 1
            ? "This will terminate the current sessions and respawn those agents in place with the same settings."
            : "This will terminate the current session and respawn this agent in place with the same settings."}
        </div>
        <div className="dialog-actions">
          <button className="bar-btn subtle" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="bar-btn danger" type="button" onClick={onConfirm}>
            Respawn (Enter)
          </button>
        </div>
        <div className="confirm-hint">Press any other key to dismiss.</div>
      </div>
    </div>
  );
}
