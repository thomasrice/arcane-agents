import type { ResolvedConfig, Worker, WorkerSpawnInput } from "../shared/types";

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

export function removeWorker(workerId: string): Promise<void> {
  return requestJson<void>(`/api/workers/${workerId}`, {
    method: "DELETE"
  });
}

export function openWorkerInTerminal(workerId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(`/api/workers/${workerId}/open-terminal`, {
    method: "POST"
  });
}

export function rediscoverProjects(): Promise<{
  discovered: Array<{
    id: string;
    path: string;
    shortName: string;
    source?: "config" | "discovered";
    label?: string;
  }>;
  warnings: string[];
}> {
  return requestJson("/api/config/rediscover", {
    method: "POST"
  });
}
