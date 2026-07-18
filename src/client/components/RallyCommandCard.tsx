import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import type { Worker } from "../../shared/types";
import { broadcastWorkerInput } from "../api";
import { formatRallyCommandResult, mergeBroadcastInputResults } from "../app/utils";
import { useAppStore } from "../state/appStore";

export interface RallyCommandHandle {
  /** Focus the command textarea and place the cursor at the end. Returns false if unmounted. */
  focus: () => boolean;
}

interface RallyCommandCardProps {
  selectedWorkers: Worker[];
}

// Broadcasts one command to every selected agent. Owns its own draft / sending /
// result state, so it resets by unmounting when the group selection collapses
// (approved Decision #3) — no external reset plumbing. Error surfacing goes straight
// to the store, matching the other action hooks.
export const RallyCommandCard = forwardRef<RallyCommandHandle, RallyCommandCardProps>(function RallyCommandCard(
  { selectedWorkers }: RallyCommandCardProps,
  ref
): JSX.Element {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [resultText, setResultText] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const input = inputRef.current;
        if (!input) {
          return false;
        }
        input.focus();
        const cursor = input.value.length;
        input.setSelectionRange(cursor, cursor);
        return true;
      }
    }),
    []
  );

  const onDraftChange = useCallback((value: string) => {
    setDraft(value);
    setResultText((current) => (current ? undefined : current));
  }, []);

  const onSend = useCallback(async () => {
    if (sending) {
      return;
    }

    const workerIds = selectedWorkers.map((worker) => worker.id);
    if (workerIds.length <= 1) {
      return;
    }

    if (draft.length === 0) {
      setResultText("Enter a command to broadcast.");
      return;
    }

    setSending(true);
    setResultText(undefined);

    try {
      const hasNameTemplate = draft.includes("$NAME");
      const result = hasNameTemplate
        ? mergeBroadcastInputResults(
            await Promise.all(
              selectedWorkers.map(async (worker) => {
                const command = draft.replace(/\$NAME/g, worker.displayName ?? worker.name);
                try {
                  return await broadcastWorkerInput([worker.id], command, true);
                } catch (error) {
                  return {
                    requestedCount: 1,
                    deliveredWorkerIds: [],
                    skippedWorkerIds: [],
                    failed: [
                      {
                        workerId: worker.id,
                        error: error instanceof Error ? error.message : "Failed to send input"
                      }
                    ]
                  };
                }
              })
            )
          )
        : await broadcastWorkerInput(workerIds, draft, true);

      setDraft("");
      setResultText(formatRallyCommandResult(result));
    } catch (error) {
      useAppStore.getState().setErrorText(error instanceof Error ? error.message : "Unknown request failure");
    } finally {
      setSending(false);
    }
  }, [draft, selectedWorkers, sending]);

  return (
    <form
      className="rally-command-card"
      onSubmit={(event) => {
        event.preventDefault();
        void onSend();
      }}
    >
      <div className="rally-command-header">
        <div className="rally-command-title">Rally Command</div>
        <div className="rally-command-count">{selectedWorkers.length} agents</div>
      </div>
      <textarea
        ref={inputRef}
        className="input rally-command-input"
        value={draft}
        onChange={(event) => {
          onDraftChange(event.target.value);
        }}
        onKeyDown={(event) => {
          const bare = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
          const ctrlOnly = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
          if (event.key === "Enter" && (bare || ctrlOnly)) {
            event.preventDefault();
            void onSend();
          }
        }}
        placeholder="Type once, send to all selected agents (use $NAME for per-agent names)..."
        disabled={sending}
        rows={3}
      />
      <div className="rally-command-actions">
        <div className="rally-command-hint">Enter sends, Shift+Enter adds a new line, $NAME inserts each agent's name</div>
        <button className="bar-btn" type="submit" disabled={sending || draft.length === 0}>
          {sending ? "Sending..." : `Send to ${selectedWorkers.length}`}
        </button>
      </div>
      {resultText ? <div className="rally-command-result">{resultText}</div> : null}
    </form>
  );
});
