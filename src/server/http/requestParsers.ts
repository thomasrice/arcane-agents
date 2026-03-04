import type { WorkerSpawnInput } from "../../shared/types";

export interface BroadcastInputBody {
  workerIds: string[];
  text: string;
  submit: boolean;
}

export function parseSpawnInput(body: unknown): WorkerSpawnInput {
  if (!body || typeof body !== "object") {
    throw new Error("Spawn body must be an object.");
  }

  const record = body as Record<string, unknown>;
  const spawnNearWorkerIds = parseSpawnNearWorkerIds(record);

  if (typeof record.shortcutIndex === "number" && Number.isInteger(record.shortcutIndex)) {
    return {
      shortcutIndex: record.shortcutIndex,
      spawnNearWorkerIds
    };
  }

  if (typeof record.projectId === "string" && typeof record.runtimeId === "string") {
    const command = Array.isArray(record.command)
      ? record.command.filter((value): value is string => typeof value === "string")
      : undefined;
    return {
      projectId: record.projectId,
      runtimeId: record.runtimeId,
      command,
      spawnNearWorkerIds
    };
  }

  throw new Error("Invalid spawn request: expected shortcutIndex or projectId+runtimeId.");
}

function parseSpawnNearWorkerIds(record: Record<string, unknown>): string[] | undefined {
  if (typeof record.spawnNearWorkerIds === "undefined") {
    return undefined;
  }

  if (!Array.isArray(record.spawnNearWorkerIds)) {
    throw new Error("spawnNearWorkerIds must be an array when provided.");
  }

  const ids = record.spawnNearWorkerIds
    .filter((value): value is string => typeof value === "string")
    .map((workerId) => workerId.trim())
    .filter((workerId, index, array) => workerId.length > 0 && array.indexOf(workerId) === index)
    .slice(0, 32);

  return ids.length > 0 ? ids : undefined;
}

export function parseBroadcastInput(body: unknown): BroadcastInputBody {
  if (!body || typeof body !== "object") {
    throw new Error("Broadcast input body must be an object.");
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.workerIds)) {
    throw new Error("Broadcast input requires workerIds array.");
  }

  const workerIds = record.workerIds
    .filter((value): value is string => typeof value === "string")
    .map((workerId) => workerId.trim())
    .filter((workerId, index, array) => workerId.length > 0 && array.indexOf(workerId) === index);

  if (workerIds.length === 0) {
    throw new Error("Broadcast input requires at least one worker ID.");
  }

  if (typeof record.text !== "string") {
    throw new Error("Broadcast input requires text.");
  }

  const text = record.text;
  if (text.length > 4096) {
    throw new Error("Broadcast input text is too long.");
  }

  if (typeof record.submit !== "undefined" && typeof record.submit !== "boolean") {
    throw new Error("Broadcast input submit must be boolean when provided.");
  }

  const submit = record.submit ?? true;
  if (!text.length && !submit) {
    throw new Error("Broadcast input requires text or submit=true.");
  }

  return {
    workerIds,
    text,
    submit
  };
}
