import { useEffect, useRef, useState } from "react";
import type { Worker, WorkerStatus } from "../../shared/types";

const completionNotificationSettleMs = 1800;

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
  const pendingTimerByWorkerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const latestWorkersByIdRef = useRef<Map<string, Worker>>(new Map());
  const reviewedWorkerIdRef = useRef<string | undefined>(reviewedWorkerId);

  useEffect(() => {
    reviewedWorkerIdRef.current = reviewedWorkerId;
  }, [reviewedWorkerId]);

  useEffect(() => {
    latestWorkersByIdRef.current = new Map(workers.map((worker) => [worker.id, worker]));
  }, [workers]);

  useEffect(() => {
    const timers = pendingTimerByWorkerRef.current;
    const currentWorkerIds = new Set(workers.map((worker) => worker.id));
    const removePendingNow = new Set<string>();

    for (const [workerId, timer] of timers.entries()) {
      if (!currentWorkerIds.has(workerId)) {
        clearTimeout(timer);
        timers.delete(workerId);
      }
    }

    for (const worker of workers) {
      const previousStatus = previousStatusByWorkerRef.current.get(worker.id);

      if (previousStatus === "working" && worker.status === "idle") {
        if (worker.id === reviewedWorkerIdRef.current) {
          continue;
        }

        if (!timers.has(worker.id)) {
          const timer = setTimeout(() => {
            timers.delete(worker.id);

            const latestWorker = latestWorkersByIdRef.current.get(worker.id);
            if (!latestWorker || latestWorker.status !== "idle") {
              return;
            }

            if (reviewedWorkerIdRef.current === worker.id) {
              return;
            }

            setPendingCompletionWorkerIds((current) => {
              if (current.includes(worker.id)) {
                return current;
              }

              return [...current, worker.id];
            });
          }, completionNotificationSettleMs);

          timers.set(worker.id, timer);
        }
      } else {
        const pendingTimer = timers.get(worker.id);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          timers.delete(worker.id);
        }

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
      return filtered.length === current.length ? current : filtered;
    });
  }, [workers]);

  useEffect(() => {
    if (!reviewedWorkerId) {
      return;
    }

    const pendingTimer = pendingTimerByWorkerRef.current.get(reviewedWorkerId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimerByWorkerRef.current.delete(reviewedWorkerId);
    }

    setPendingCompletionWorkerIds((current) => current.filter((workerId) => workerId !== reviewedWorkerId));
  }, [reviewedWorkerId]);

  useEffect(() => {
    const timers = pendingTimerByWorkerRef.current;

    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return {
    pendingCompletionWorkerIds
  };
}
