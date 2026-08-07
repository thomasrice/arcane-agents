import type { Worker } from "../../../shared/types";

export const terminalUnavailableStatus = {
  status: "error",
  activityText: "Terminal unavailable",
  activityTool: "unknown",
  activityPath: undefined
} as const;

export function withTerminalUnavailable(worker: Worker, updatedAt: string): Worker {
  if (
    worker.status === terminalUnavailableStatus.status &&
    worker.activityText === terminalUnavailableStatus.activityText &&
    worker.activityTool === terminalUnavailableStatus.activityTool &&
    worker.activityPath === terminalUnavailableStatus.activityPath
  ) {
    return worker;
  }

  return {
    ...worker,
    ...terminalUnavailableStatus,
    updatedAt
  };
}
