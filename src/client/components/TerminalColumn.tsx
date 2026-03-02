import type { MutableRefObject } from "react";
import type { Worker } from "../../shared/types";
import type { RosterEntry } from "../app/types";
import { formatShortcutSummonActivityText } from "../app/utils";
import { resolveSpriteAssetType } from "../sprites/spriteLoader";
import { TerminalPanel } from "./TerminalPanel";

interface TerminalColumnProps {
  activeWorkers: Worker[];
  selectedWorkers: Worker[];
  terminalWorker: Worker | undefined;
  terminalFocused: boolean;
  selectedGroupActiveIndex: number;
  setSelectedGroupActiveIndex: (index: number) => void;
  setFocusedSelectedWorkerId: (workerId: string | undefined) => void;
  rallyCommandInputRef: MutableRefObject<HTMLTextAreaElement | null>;
  rallyCommandDraft: string;
  rallyCommandSending: boolean;
  rallyCommandResultText: string | undefined;
  onRallyCommandDraftChange: (value: string) => void;
  onSendRallyCommand: () => void | Promise<void>;
  rosterEntries: RosterEntry[];
  rosterActiveIndex: number;
  setRosterActiveIndex: (index: number) => void;
  onActivateRosterIndex: (index: number) => void;
  onOpenSelectedInTerminal: () => void | Promise<void>;
  terminalFocusToken: number | undefined;
}

export function TerminalColumn({
  activeWorkers,
  selectedWorkers,
  terminalWorker,
  terminalFocused,
  selectedGroupActiveIndex,
  setSelectedGroupActiveIndex,
  setFocusedSelectedWorkerId,
  rallyCommandInputRef,
  rallyCommandDraft,
  rallyCommandSending,
  rallyCommandResultText,
  onRallyCommandDraftChange,
  onSendRallyCommand,
  rosterEntries,
  rosterActiveIndex,
  setRosterActiveIndex,
  onActivateRosterIndex,
  onOpenSelectedInTerminal,
  terminalFocusToken
}: TerminalColumnProps): JSX.Element {
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
            <button
              key={worker.id}
              className={`worker-roster-item ${index === selectedGroupActiveIndex ? "active" : ""}`}
              onMouseEnter={() => setSelectedGroupActiveIndex(index)}
              onClick={() => {
                setSelectedGroupActiveIndex(index);
                setFocusedSelectedWorkerId(worker.id);
              }}
              type="button"
            >
              <div className="worker-roster-main">
                <img
                  className="worker-roster-avatar"
                  src={`/api/assets/characters/${encodeURIComponent(resolveSpriteAssetType(worker.avatarType))}/rotations/south.png`}
                  alt=""
                  loading="lazy"
                  aria-hidden="true"
                />
                <div className="worker-roster-text">
                  <div className="worker-roster-name">{worker.displayName ?? worker.name}</div>
                  <div className="worker-roster-meta">
                    {worker.projectId} · {worker.runtimeId} · {worker.status}
                  </div>
                  {worker.activityText ? <div className="worker-roster-activity">{worker.activityText}</div> : null}
                </div>
              </div>
            </button>
          ))}

          <form
            className="rally-command-card"
            onSubmit={(event) => {
              event.preventDefault();
              void onSendRallyCommand();
            }}
          >
            <div className="rally-command-header">
              <div className="rally-command-title">Rally Command</div>
              <div className="rally-command-count">{selectedWorkers.length} agents</div>
            </div>
            <textarea
              ref={rallyCommandInputRef}
              className="input rally-command-input"
              value={rallyCommandDraft}
              onChange={(event) => {
                onRallyCommandDraftChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  void onSendRallyCommand();
                }
              }}
              placeholder="Type once, send to all selected agents (use $NAME for per-agent names)..."
              disabled={rallyCommandSending}
              rows={3}
            />
            <div className="rally-command-actions">
              <div className="rally-command-hint">Enter sends, Shift+Enter adds a new line, $NAME inserts each agent's name</div>
              <button
                className="bar-btn"
                type="submit"
                disabled={rallyCommandSending || rallyCommandDraft.length === 0}
              >
                {rallyCommandSending ? "Sending..." : `Send to ${selectedWorkers.length}`}
              </button>
            </div>
            {rallyCommandResultText ? <div className="rally-command-result">{rallyCommandResultText}</div> : null}
          </form>
        </div>
      ) : terminalWorker ? (
        <TerminalPanel
          workerId={terminalWorker.id}
          workerName={terminalWorker.displayName ?? terminalWorker.name}
          focusRequestKey={terminalFocusToken}
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
                  <button
                    className={`worker-roster-item ${index === rosterActiveIndex ? "active" : ""}`}
                    onMouseEnter={() => setRosterActiveIndex(index)}
                    onClick={() => onActivateRosterIndex(index)}
                    type="button"
                  >
                    <div className="worker-roster-main">
                      <img
                        className="worker-roster-avatar"
                        src={`/api/assets/characters/${encodeURIComponent(resolveSpriteAssetType(entry.worker.avatarType))}/rotations/south.png`}
                        alt=""
                        loading="lazy"
                        aria-hidden="true"
                      />
                      <div className="worker-roster-text">
                        <div className="worker-roster-name">{entry.worker.displayName ?? entry.worker.name}</div>
                        <div className="worker-roster-meta">
                          {entry.worker.projectId} · {entry.worker.runtimeId} · {entry.worker.status}
                        </div>
                        {entry.worker.activityText ? <div className="worker-roster-activity">{entry.worker.activityText}</div> : null}
                      </div>
                    </div>
                  </button>
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
                          src={`/api/assets/characters/${encodeURIComponent(resolveSpriteAssetType(entry.shortcut.avatar))}/rotations/south.png`}
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
