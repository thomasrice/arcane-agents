import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Worker } from "../../../shared/types";
import { broadcastWorkerInput } from "../../api";
import { formatRallyCommandResult, mergeBroadcastInputResults } from "../../app/utils";

interface UseWorkerRallyActionsParams {
  selectedWorkers: Worker[];
  rallyCommandDraft: string;
  setRallyCommandDraft: Dispatch<SetStateAction<string>>;
  rallyCommandSending: boolean;
  setRallyCommandSending: Dispatch<SetStateAction<boolean>>;
  rallyCommandResultText: string | undefined;
  setRallyCommandResultText: Dispatch<SetStateAction<string | undefined>>;
  showError: (error: unknown) => void;
}

interface UseWorkerRallyActionsResult {
  onSendRallyCommand: () => Promise<void>;
  onRallyCommandDraftChange: (value: string) => void;
}

export function useWorkerRallyActions({
  selectedWorkers,
  rallyCommandDraft,
  setRallyCommandDraft,
  rallyCommandSending,
  setRallyCommandSending,
  rallyCommandResultText,
  setRallyCommandResultText,
  showError
}: UseWorkerRallyActionsParams): UseWorkerRallyActionsResult {
  const onSendRallyCommand = useCallback(async () => {
    if (rallyCommandSending) {
      return;
    }

    const workerIds = selectedWorkers.map((worker) => worker.id);
    if (workerIds.length <= 1) {
      return;
    }

    if (rallyCommandDraft.length === 0) {
      setRallyCommandResultText("Enter a command to broadcast.");
      return;
    }

    setRallyCommandSending(true);
    setRallyCommandResultText(undefined);

    try {
      const hasNameTemplate = rallyCommandDraft.includes("$NAME");
      const result = hasNameTemplate
        ? mergeBroadcastInputResults(
            await Promise.all(
              selectedWorkers.map(async (worker) => {
                const command = rallyCommandDraft.replace(/\$NAME/g, worker.displayName ?? worker.name);
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
        : await broadcastWorkerInput(workerIds, rallyCommandDraft, true);

      setRallyCommandDraft("");
      setRallyCommandResultText(formatRallyCommandResult(result));
    } catch (error) {
      showError(error);
    } finally {
      setRallyCommandSending(false);
    }
  }, [rallyCommandDraft, rallyCommandSending, selectedWorkers, setRallyCommandDraft, setRallyCommandResultText, setRallyCommandSending, showError]);

  const onRallyCommandDraftChange = useCallback(
    (value: string) => {
      setRallyCommandDraft(value);
      if (rallyCommandResultText) {
        setRallyCommandResultText(undefined);
      }
    },
    [rallyCommandResultText, setRallyCommandDraft, setRallyCommandResultText]
  );

  return {
    onSendRallyCommand,
    onRallyCommandDraftChange
  };
}
