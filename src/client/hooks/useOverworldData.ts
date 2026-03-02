import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ResolvedConfig, Worker, WsServerEvent } from "../../shared/types";
import { fetchConfig, fetchWorkers } from "../api";
import { upsertWorker } from "../app/utils";

interface UseOverworldDataResult {
  config: ResolvedConfig | null;
  workers: Worker[];
  setWorkers: Dispatch<SetStateAction<Worker[]>>;
  workersHydrated: boolean;
}

export function useOverworldData(
  setErrorText: Dispatch<SetStateAction<string | undefined>>
): UseOverworldDataResult {
  const [config, setConfig] = useState<ResolvedConfig | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workersHydrated, setWorkersHydrated] = useState(false);

  useEffect(() => {
    void Promise.all([fetchConfig(), fetchWorkers()])
      .then(([nextConfig, nextWorkers]) => {
        setConfig(nextConfig);
        setWorkers(nextWorkers);
        setWorkersHydrated(true);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to load Overworld data";
        setErrorText(message);
      });
  }, [setErrorText]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/ws`);

      socket.addEventListener("open", () => {
        setErrorText(undefined);
      });

      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(String(event.data)) as WsServerEvent;

        if (payload.type === "init") {
          setConfig(payload.config);
          setWorkers(payload.workers);
          setWorkersHydrated(true);
          return;
        }

        if (payload.type === "worker-created" || payload.type === "worker-updated") {
          setWorkers((currentWorkers) => upsertWorker(currentWorkers, payload.worker));
          return;
        }

        if (payload.type === "worker-removed") {
          setWorkers((currentWorkers) => currentWorkers.filter((worker) => worker.id !== payload.workerId));
        }
      });

      socket.addEventListener("error", () => {
        setErrorText("Realtime connection failed. Retrying...");
      });

      socket.addEventListener("close", () => {
        if (!cancelled) {
          retryTimer = setTimeout(connect, 2000);
        }
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      socket?.close();
    };
  }, [setErrorText]);

  return {
    config,
    workers,
    setWorkers,
    workersHydrated
  };
}
