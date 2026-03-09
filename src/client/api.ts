import type { ResolvedConfig, Worker, WorkerSpawnInput } from "../shared/types";

export interface BroadcastInputResult {
  requestedCount: number;
  deliveredWorkerIds: string[];
  skippedWorkerIds: string[];
  failed: Array<{
    workerId: string;
    error: string;
  }>;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function fetchConfig(): Promise<ResolvedConfig> {
  return requestJson<ResolvedConfig>("/api/config");
}

export async function fetchWorkers(): Promise<Worker[]> {
  const response = await requestJson<{ workers: Worker[] }>("/api/workers");
  return response.workers;
}

export function spawnWorker(input: WorkerSpawnInput): Promise<Worker> {
  return requestJson<Worker>("/api/workers/spawn", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function stopWorker(workerId: string): Promise<{ ok: true; workerId: string }> {
  return requestJson<{ ok: true; workerId: string }>(`/api/workers/${workerId}/stop`, {
    method: "POST"
  });
}

export function restartWorker(workerId: string): Promise<Worker> {
  return requestJson<Worker>(`/api/workers/${workerId}/restart`, {
    method: "POST"
  });
}

export function updateWorkerPosition(workerId: string, x: number, y: number): Promise<Worker> {
  return requestJson<Worker>(`/api/workers/${workerId}/position`, {
    method: "PATCH",
    body: JSON.stringify({ x, y })
  });
}

export function renameWorker(workerId: string, displayName: string): Promise<Worker> {
  return requestJson<Worker>(`/api/workers/${workerId}/rename`, {
    method: "PATCH",
    body: JSON.stringify({ displayName })
  });
}

export function setWorkerMovementMode(workerId: string, movementMode: "hold" | "wander"): Promise<Worker> {
  return requestJson<Worker>(`/api/workers/${workerId}/movement-mode`, {
    method: "PATCH",
    body: JSON.stringify({ movementMode })
  });
}

export function openWorkerInTerminal(workerId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(`/api/workers/${workerId}/open-terminal`, {
    method: "POST"
  });
}

export function broadcastWorkerInput(workerIds: string[], text: string, submit = true): Promise<BroadcastInputResult> {
  return requestJson<BroadcastInputResult>("/api/workers/broadcast-input", {
    method: "POST",
    body: JSON.stringify({
      workerIds,
      text,
      submit
    })
  });
}
