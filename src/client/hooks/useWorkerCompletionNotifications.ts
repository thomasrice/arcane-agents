import { useEffect, useRef, useState } from "react";
import type { Worker, WorkerStatus } from "../../shared/types";

interface UseWorkerCompletionNotificationsInput {
  workers: Worker[];
  reviewedWorkerId: string | undefined;
}

interface UseWorkerCompletionNotificationsResult {
  pendingCompletionWorkerIds: string[];
}

export function useWorkerCompletionNotifications({
  workers,
  reviewedWorkerId
}: UseWorkerCompletionNotificationsInput): UseWorkerCompletionNotificationsResult {
  const [pendingCompletionWorkerIds, setPendingCompletionWorkerIds] = useState<string[]>([]);
  const previousStatusByWorkerRef = useRef<Map<string, WorkerStatus>>(new Map());
  const reviewedWorkerIdRef = useRef<string | undefined>(reviewedWorkerId);

  useEffect(() => {
    reviewedWorkerIdRef.current = reviewedWorkerId;
  }, [reviewedWorkerId]);

  useEffect(() => {
    const currentWorkerIds = new Set(workers.map((worker) => worker.id));
    const removePendingNow = new Set<string>();
    const addPendingNow = new Set<string>();

    for (const worker of workers) {
      const previousStatus = previousStatusByWorkerRef.current.get(worker.id);

      if (previousStatus === "working" && worker.status === "idle") {
        if (worker.id === reviewedWorkerIdRef.current) {
          continue;
        }

        addPendingNow.add(worker.id);
      } else {
        if (worker.status !== "idle") {
          removePendingNow.add(worker.id);
        }
      }
    }

    const nextStatuses = new Map<string, WorkerStatus>();
    for (const worker of workers) {
      nextStatuses.set(worker.id, worker.status);
    }
    previousStatusByWorkerRef.current = nextStatuses;

    setPendingCompletionWorkerIds((current) => {
      const filtered = current.filter((workerId) => currentWorkerIds.has(workerId) && !removePendingNow.has(workerId));
      const next = [...filtered];

      for (const workerId of addPendingNow) {
        if (!next.includes(workerId)) {
          next.push(workerId);
        }
      }

      if (next.length === current.length && next.every((workerId, index) => workerId === current[index])) {
        return current;
      }

      return next;
    });
  }, [workers]);

  useEffect(() => {
    if (!reviewedWorkerId) {
      return;
    }

    setPendingCompletionWorkerIds((current) => current.filter((workerId) => workerId !== reviewedWorkerId));
  }, [reviewedWorkerId]);

  return {
    pendingCompletionWorkerIds
  };
}
