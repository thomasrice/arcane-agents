import { useEffect, useState } from "react";
import type { Worker } from "../../shared/types";

interface RenameDialogProps {
  open: boolean;
  targetWorkerIds: string[];
  targetWorkers: Worker[];
  initialDraft: string;
  onClose: () => void;
  onSubmit: (draft: string) => void | Promise<void>;
}

export function RenameDialog({
  open,
  targetWorkerIds,
  targetWorkers,
  initialDraft,
  onClose,
  onSubmit
}: RenameDialogProps): JSX.Element | null {
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(initialDraft);
  }, [initialDraft, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay overlay-no-blur" onClick={onClose}>
      <div className="dialog rename-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">{targetWorkerIds.length > 1 ? "Rename Selected Agents" : "Rename Worker"}</div>
        <div className="rename-subtitle">
          {targetWorkerIds.length > 1
            ? `${targetWorkerIds.length} selected agents`
            : targetWorkers[0]?.name ?? "Selected worker"}
        </div>
        <form
          className="rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(draft);
          }}
        >
          <input
            className="input"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={targetWorkerIds.length > 1 ? "Base name (e.g. Builder)" : "Display name"}
          />
          <div className="dialog-actions">
            <button className="bar-btn subtle" type="button" onClick={onClose}>
              Cancel (Esc)
            </button>
            <button className="bar-btn" type="submit">
              Save (Enter)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
