import { useCallback, useEffect, useState } from "react";
import type { Worker } from "../../shared/types";
import type { FadingWorker } from "../app/types";

interface UseWorkerFadeResult {
  fadingWorkers: FadingWorker[];
  queueWorkerFade: (worker: Worker) => void;
  removeWorkerFade: (workerId: string) => void;
}

export function useWorkerFade(killFadeDurationMs: number): UseWorkerFadeResult {
  const [fadingWorkers, setFadingWorkers] = useState<FadingWorker[]>([]);

  const queueWorkerFade = useCallback((worker: Worker) => {
    setFadingWorkers((current) => [
      {
        worker,
        startedAtMs: Date.now()
      },
      ...current.filter((item) => item.worker.id !== worker.id)
    ]);
  }, []);

  const removeWorkerFade = useCallback((workerId: string) => {
    setFadingWorkers((current) => current.filter((item) => item.worker.id !== workerId));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setFadingWorkers((current) =>
        current.filter((item) => now - item.startedAtMs < killFadeDurationMs)
      );
    }, 80);

    return () => {
      clearInterval(timer);
    };
  }, [killFadeDurationMs]);

  return {
    fadingWorkers,
    queueWorkerFade,
    removeWorkerFade
  };
}
