import { useEffect } from "react";
import type { WsServerEvent } from "../../shared/types";
import { fetchConfig, fetchWorkers } from "../api";
import { useAppStore } from "../state/appStore";

const workerReconcileIntervalMs = 30_000;

// Owns the connection to the server: an initial REST hydration, a realtime
// WebSocket with automatic reconnect, and a polling fallback that also fires on
// tab focus / visibility. Writes everything into the app store; components read
// via selectors. Reconnect/poll semantics are preserved from the original
// useArcaneAgentsData exactly.
export function useServerSync(): void {
  useEffect(() => {
    const { setConfig, setWorkers, setErrorText } = useAppStore.getState();

    void Promise.all([fetchConfig(), fetchWorkers()])
      .then(([nextConfig, nextWorkers]) => {
        setConfig(nextConfig);
        setWorkers(nextWorkers);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to load Arcane Agents data";
        setErrorText(message);
      });
  }, []);

  useEffect(() => {
    const { setConfig, setWorkers, upsertWorker, removeWorker, setErrorText } = useAppStore.getState();

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let reconcileTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let reconcileInFlight = false;

    const reconcileWorkers = async (): Promise<void> => {
      if (cancelled || reconcileInFlight) {
        return;
      }

      reconcileInFlight = true;
      try {
        const nextWorkers = await fetchWorkers();
        if (cancelled) {
          return;
        }

        setWorkers(nextWorkers);
      } catch {
      } finally {
        reconcileInFlight = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void reconcileWorkers();
    };

    const handleWindowFocus = () => {
      void reconcileWorkers();
    };

    function connect() {
      if (cancelled) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/ws`);

      socket.addEventListener("open", () => {
        setErrorText(undefined);
        void reconcileWorkers();
      });

      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(String(event.data)) as WsServerEvent;

        if (payload.type === "init") {
          setConfig(payload.config);
          setWorkers(payload.workers);
          return;
        }

        if (payload.type === "worker-created" || payload.type === "worker-updated") {
          upsertWorker(payload.worker);
          return;
        }

        if (payload.type === "worker-removed") {
          removeWorker(payload.workerId);
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

    reconcileTimer = setInterval(() => {
      void reconcileWorkers();
    }, workerReconcileIntervalMs);

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    connect();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (reconcileTimer) {
        clearInterval(reconcileTimer);
      }
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      socket?.close();
    };
  }, []);
}
