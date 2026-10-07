import { useEffect, useMemo, useRef } from "react";
import type { Worker } from "../../shared/types";
import { markWorkerCompletionReviewed } from "../api";

interface UseWorkerCompletionNotificationsInput {
  workers: Worker[];
  reviewedWorkerId: string | undefined;
}

interface UseWorkerCompletionNotificationsResult {
  pendingCompletionWorkerIds: string[];
}

export function hasUnreviewedCompletion(worker: Worker): boolean {
  if (!worker.completedAt) {
    return false;
  }

  return !worker.completionReviewedAt || worker.completedAt > worker.completionReviewedAt;
}

// The server records when each worker finishes and when its completion was last
// reviewed, so pending completions survive reloads, sleep, and other browsers.
export function selectPendingCompletionWorkerIds(
  workers: readonly Worker[],
  reviewedWorkerId: string | undefined
): string[] {
  return workers
    .filter(
      (worker) =>
        !worker.silenced && worker.status === "idle" && worker.id !== reviewedWorkerId && hasUnreviewedCompletion(worker)
    )
    .sort((left, right) => (left.completedAt ?? "").localeCompare(right.completedAt ?? ""))
    .map((worker) => worker.id);
}

export function useWorkerCompletionNotifications({
  workers,
  reviewedWorkerId
}: UseWorkerCompletionNotificationsInput): UseWorkerCompletionNotificationsResult {
  const pendingCompletionWorkerIds = useMemo(
    () => selectPendingCompletionWorkerIds(workers, reviewedWorkerId),
    [workers, reviewedWorkerId]
  );

  const reviewedWorker = reviewedWorkerId ? workers.find((worker) => worker.id === reviewedWorkerId) : undefined;
  const reviewedCompletionKey =
    reviewedWorker && hasUnreviewedCompletion(reviewedWorker) ? `${reviewedWorker.id}@${reviewedWorker.completedAt}` : undefined;
  const lastReviewRequestRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!reviewedWorkerId || !reviewedCompletionKey || lastReviewRequestRef.current === reviewedCompletionKey) {
      return;
    }

    lastReviewRequestRef.current = reviewedCompletionKey;
    // The returned worker arrives via the realtime worker-updated broadcast.
    void markWorkerCompletionReviewed(reviewedWorkerId).catch(() => {
      lastReviewRequestRef.current = undefined;
    });
  }, [reviewedWorkerId, reviewedCompletionKey]);

  return {
    pendingCompletionWorkerIds
  };
}
