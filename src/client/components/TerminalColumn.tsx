import { useMemo, type Ref } from "react";
import type { Worker } from "../../shared/types";
import { characterRotationUrl } from "../assetUrls";
import type { RosterEntry } from "../app/types";
import { formatShortcutSummonActivityText } from "../app/utils";
import { RallyCommandCard, type RallyCommandHandle } from "./RallyCommandCard";
import { TerminalPanel, type TerminalPanelHandle } from "./TerminalPanel";
import { WorkerRosterItem } from "./WorkerRosterItem";

interface TerminalColumnProps {
  activeWorkers: Worker[];
  selectedWorkers: Worker[];
  terminalWorker: Worker | undefined;
  terminalFocused: boolean;
  selectedGroupActiveIndex: number;
  setSelectedGroupActiveIndex: (index: number) => void;
  setFocusedSelectedWorkerId: (workerId: string | undefined) => void;
  rallyCardRef: Ref<RallyCommandHandle>;
  rosterEntries: RosterEntry[];
  completionPendingWorkerIds: string[];
  rosterActiveIndex: number;
  setRosterActiveIndex: (index: number) => void;
  onActivateRosterIndex: (index: number) => void;
  onOpenSelectedInTerminal: () => void | Promise<void>;
  terminalPanelRef: Ref<TerminalPanelHandle>;
}

export function TerminalColumn({
  activeWorkers,
  selectedWorkers,
  terminalWorker,
  terminalFocused,
  selectedGroupActiveIndex,
  setSelectedGroupActiveIndex,
  setFocusedSelectedWorkerId,
  rallyCardRef,
  rosterEntries,
  completionPendingWorkerIds,
  rosterActiveIndex,
  setRosterActiveIndex,
  onActivateRosterIndex,
  onOpenSelectedInTerminal,
  terminalPanelRef
}: TerminalColumnProps): JSX.Element {
  const completionPendingWorkerIdSet = useMemo(
    () => new Set(completionPendingWorkerIds),
    [completionPendingWorkerIds]
  );

  const completionPendingCount = completionPendingWorkerIds.length;

  return (
    <div
      className={`terminal-column${terminalWorker ? " terminal-column-selected" : ""}${
        terminalWorker && terminalFocused ? " terminal-column-focused" : ""
      }`}
    >
      <div className="terminal-header">
        <div className="terminal-header-title">
          {selectedWorkers.length > 1 && !terminalWorker
            ? `${selectedWorkers.length} selected agents`
            : terminalWorker
            ? `${terminalWorker.displayName ?? terminalWorker.name} (${terminalWorker.status})`
            : `Agents (${activeWorkers.length})`}
        </div>

        {!terminalWorker && completionPendingCount > 0 ? (
          <div className="terminal-ready-chip" title="Agents finished but not yet reviewed in terminal">
            ✦ {completionPendingCount} ready
          </div>
        ) : null}

        {terminalWorker ? (
          <button
            className="terminal-open-external"
            onClick={() => {
              void onOpenSelectedInTerminal();
            }}
            disabled={terminalWorker.status === "stopped"}
            title="Open in external terminal"
            type="button"
          >
            ↗
          </button>
        ) : null}
      </div>

      {selectedWorkers.length > 1 && !terminalWorker ? (
        <div className="worker-roster">
          <div className="worker-roster-section-label">Selected Group</div>
          {selectedWorkers.map((worker, index) => (
            <WorkerRosterItem
              key={worker.id}
              worker={worker}
              active={index === selectedGroupActiveIndex}
              completionPending={completionPendingWorkerIdSet.has(worker.id)}
              onMouseEnter={() => setSelectedGroupActiveIndex(index)}
              onClick={() => {
                setSelectedGroupActiveIndex(index);
                setFocusedSelectedWorkerId(worker.id);
              }}
            />
          ))}

          <RallyCommandCard ref={rallyCardRef} selectedWorkers={selectedWorkers} />
        </div>
      ) : terminalWorker ? (
        <TerminalPanel
          ref={terminalPanelRef}
          workerId={terminalWorker.id}
          workerName={terminalWorker.displayName ?? terminalWorker.name}
          connectionKey={terminalWorker.tmuxRef.pane}
        />
      ) : (
        <div className="worker-roster">
          {rosterEntries.length === 0 ? (
            <div className="worker-roster-empty">No active agents yet. Summon one from the bottom bar.</div>
          ) : (
            rosterEntries.map((entry, index) => (
              <div key={entry.kind === "worker" ? entry.worker.id : `shortcut-${entry.shortcutIndex}-${entry.shortcut.label}`}>
                {entry.kind === "shortcut" && (index === 0 || rosterEntries[index - 1]?.kind !== "shortcut") ? (
                  <div className="worker-roster-section-label">Summon</div>
                ) : null}

                {entry.kind === "worker" ? (
                  <WorkerRosterItem
                    worker={entry.worker}
                    active={index === rosterActiveIndex}
                    completionPending={completionPendingWorkerIdSet.has(entry.worker.id)}
                    onMouseEnter={() => setRosterActiveIndex(index)}
                    onClick={() => onActivateRosterIndex(index)}
                  />
                ) : (
                  <button
                    className={`worker-roster-item worker-roster-item-summon ${index === rosterActiveIndex ? "active" : ""}`}
                    onMouseEnter={() => setRosterActiveIndex(index)}
                    onClick={() => onActivateRosterIndex(index)}
                    type="button"
                  >
                    <div className="worker-roster-main">
                      {entry.shortcut.avatar ? (
                        <img
                          className="worker-roster-avatar worker-roster-summon-avatar"
                          src={characterRotationUrl(entry.shortcut.avatar, "south")}
                          alt=""
                          loading="lazy"
                          aria-hidden="true"
                        />
                      ) : (
                        <div className="worker-roster-summon-glyph" aria-hidden="true">
                          +
                        </div>
                      )}
                      <div className="worker-roster-text">
                        <div className="worker-roster-name">{entry.shortcut.label}</div>
                        <div className="worker-roster-meta">
                          {entry.shortcut.project} · {entry.shortcut.runtime}
                        </div>
                        <div className="worker-roster-activity">
                          {formatShortcutSummonActivityText(entry.shortcut.hotkeys)}
                        </div>
                      </div>
                    </div>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
