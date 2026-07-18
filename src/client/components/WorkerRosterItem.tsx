import type { Worker } from "../../shared/types";
import { characterRotationUrl } from "../assetUrls";

interface WorkerRosterItemProps {
  worker: Worker;
  active: boolean;
  completionPending: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}

// The avatar + name/READY/meta/activity row, rendered identically in the selected-group
// list and the roster list. Extracted so the two call sites can't drift.
export function WorkerRosterItem({
  worker,
  active,
  completionPending,
  onMouseEnter,
  onClick
}: WorkerRosterItemProps): JSX.Element {
  return (
    <button
      className={`worker-roster-item ${active ? "active" : ""}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      type="button"
    >
      <div className="worker-roster-main">
        <img
          className="worker-roster-avatar"
          src={characterRotationUrl(worker.avatarType, "south")}
          alt=""
          loading="lazy"
          aria-hidden="true"
        />
        <div className="worker-roster-text">
          <div className="worker-roster-name-row">
            <div className="worker-roster-name">{worker.displayName ?? worker.name}</div>
            {completionPending ? (
              <span className="worker-complete-badge" title="Finished and waiting for review">
                READY
              </span>
            ) : null}
          </div>
          <div className="worker-roster-meta">
            {worker.projectId} · {worker.runtimeId} · {worker.status}
          </div>
          {worker.activityText ? <div className="worker-roster-activity">{worker.activityText}</div> : null}
        </div>
      </div>
    </button>
  );
}
