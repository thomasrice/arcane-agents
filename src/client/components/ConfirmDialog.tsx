import type { Worker } from "../../shared/types";
import type { ConfirmKind, PendingConfirm } from "../app/types";

interface ConfirmCopy {
  titleOne: string;
  titleMany: string;
  bodyOne: string;
  bodyMany: string;
  confirmLabel: string;
}

const confirmCopyByKind: Record<ConfirmKind, ConfirmCopy> = {
  kill: {
    titleOne: "Kill Agent?",
    titleMany: "Kill Agents?",
    bodyOne: "This will terminate the session and remove this agent from the map.",
    bodyMany: "This will terminate all selected sessions and remove those agents from the map.",
    confirmLabel: "Kill (Enter)"
  },
  restart: {
    titleOne: "Respawn Agent?",
    titleMany: "Respawn Agents?",
    bodyOne: "This will terminate the current session and respawn this agent in place with the same settings.",
    bodyMany: "This will terminate the current sessions and respawn those agents in place with the same settings.",
    confirmLabel: "Respawn (Enter)"
  }
};

interface ConfirmDialogProps {
  pendingConfirm: PendingConfirm | null;
  workers: Worker[];
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ pendingConfirm, workers, onConfirm, onClose }: ConfirmDialogProps): JSX.Element | null {
  if (!pendingConfirm || pendingConfirm.workerIds.length === 0) {
    return null;
  }

  const count = pendingConfirm.workerIds.length;
  const many = count > 1;
  const copy = confirmCopyByKind[pendingConfirm.kind];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">{many ? copy.titleMany : copy.titleOne}</div>
        <div className="rename-subtitle">
          {many ? `${count} selected agents` : workers[0]?.displayName ?? workers[0]?.name ?? "Selected agent"}
        </div>
        <div className="confirm-copy">{many ? copy.bodyMany : copy.bodyOne}</div>
        <div className="dialog-actions">
          <button className="bar-btn subtle" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="bar-btn danger" type="button" onClick={onConfirm}>
            {copy.confirmLabel}
          </button>
        </div>
        <div className="confirm-hint">Press any other key to dismiss.</div>
      </div>
    </div>
  );
}
