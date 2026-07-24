import { useEffect, useRef, useState } from "react";
import type { Worker, WorkerStatus } from "../../shared/types";

interface UseWorkerCompletionNotificationsInput {
  workers: Worker[];
  reviewedWorkerId: string | undefined;
}

interface UseWorkerCompletionNotificationsResult {
  pendingCompletionWorkerIds: string[];
}

export function reconcilePendingCompletionWorkerIds(
  current: readonly string[],
  workers: readonly Worker[],
  previousStatusByWorker: ReadonlyMap<string, WorkerStatus>,
  reviewedWorkerId: string | undefined
): string[] {
  const currentWorkersById = new Map(workers.map((worker) => [worker.id, worker]));
  const next = current.filter((workerId) => {
    const worker = currentWorkersById.get(workerId);
    return Boolean(worker && !worker.silenced && worker.status === "idle" && workerId !== reviewedWorkerId);
  });
  const nextSet = new Set(next);

  for (const worker of workers) {
    if (
      worker.silenced ||
      worker.id === reviewedWorkerId ||
      worker.status !== "idle" ||
      previousStatusByWorker.get(worker.id) !== "working" ||
      nextSet.has(worker.id)
    ) {
      continue;
    }

    next.push(worker.id);
    nextSet.add(worker.id);
  }

  return next;
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
    const previousStatusByWorker = previousStatusByWorkerRef.current;
    setPendingCompletionWorkerIds((current) => {
      const next = reconcilePendingCompletionWorkerIds(
        current,
        workers,
        previousStatusByWorker,
        reviewedWorkerIdRef.current
      );
      return next.length === current.length && next.every((workerId, index) => workerId === current[index])
        ? current
        : next;
    });

    previousStatusByWorkerRef.current = new Map(workers.map((worker) => [worker.id, worker.status]));
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
