import type { WorkerSpawnInput } from "../../shared/types";
import { validationError } from "./appError";

export interface BroadcastInputBody {
  workerIds: string[];
  text: string;
  submit: boolean;
}

export function parseSpawnInput(body: unknown): WorkerSpawnInput {
  if (!isRecordObject(body)) {
    throw validationError("Spawn body must be an object.", "spawn_invalid_body");
  }

  const record = body;
  const spawnNearWorkerIds = parseSpawnNearWorkerIds(record);
  const displayName = parseDisplayName(record);

  if (typeof record.shortcutIndex !== "undefined") {
    if (typeof record.shortcutIndex !== "number" || !Number.isInteger(record.shortcutIndex) || record.shortcutIndex < 0) {
      throw validationError("shortcutIndex must be a non-negative integer.", "spawn_invalid_shortcut_index");
    }

    return {
      shortcutIndex: record.shortcutIndex,
      displayName,
      spawnNearWorkerIds
    };
  }

  if (typeof record.projectId === "string" && typeof record.runtimeId === "string") {
    const command = parseSpawnCommand(record);
    return {
      projectId: record.projectId,
      runtimeId: record.runtimeId,
      command,
      displayName,
      spawnNearWorkerIds
    };
  }

  throw validationError(
    "Invalid spawn request: expected shortcutIndex or projectId+runtimeId.",
    "spawn_invalid_payload"
  );
}

function parseDisplayName(record: Record<string, unknown>): string | undefined {
  if (typeof record.displayName === "undefined") {
    return undefined;
  }

  if (typeof record.displayName !== "string") {
    throw validationError("displayName must be a string when provided.", "spawn_invalid_display_name");
  }

  const trimmed = record.displayName.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseSpawnNearWorkerIds(record: Record<string, unknown>): string[] | undefined {
  if (typeof record.spawnNearWorkerIds === "undefined") {
    return undefined;
  }

  if (!Array.isArray(record.spawnNearWorkerIds)) {
    throw validationError("spawnNearWorkerIds must be an array when provided.", "spawn_invalid_nearby_worker_ids");
  }

  const ids: string[] = [];
  const seenIds = new Set<string>();

  for (const value of record.spawnNearWorkerIds) {
    if (typeof value !== "string") {
      throw validationError("spawnNearWorkerIds must only contain strings.", "spawn_invalid_nearby_worker_ids");
    }

    const workerId = value.trim();
    if (!workerId) {
      throw validationError("spawnNearWorkerIds must not contain empty IDs.", "spawn_invalid_nearby_worker_ids");
    }

    if (seenIds.has(workerId)) {
      continue;
    }

    seenIds.add(workerId);
    ids.push(workerId);
    if (ids.length >= 32) {
      break;
    }
  }

  return ids.length > 0 ? ids : undefined;
}

function parseSpawnCommand(record: Record<string, unknown>): string[] | undefined {
  if (typeof record.command === "undefined") {
    return undefined;
  }

  if (!Array.isArray(record.command)) {
    throw validationError("command must be an array of command tokens when provided.", "spawn_invalid_command");
  }

  if (record.command.length === 0) {
    throw validationError("command must include at least one token when provided.", "spawn_invalid_command");
  }

  const command: string[] = [];
  for (let index = 0; index < record.command.length; index += 1) {
    const token = record.command[index];
    if (typeof token !== "string") {
      throw validationError("command must only contain strings.", "spawn_invalid_command");
    }

    const normalized = token.trim();
    if (!normalized) {
      throw validationError("command must not include empty tokens.", "spawn_invalid_command");
    }

    command.push(normalized);
  }

  return command;
}

export function parseBroadcastInput(body: unknown): BroadcastInputBody {
  if (!isRecordObject(body)) {
    throw validationError("Broadcast input body must be an object.", "broadcast_invalid_body");
  }

  const record = body;
  if (!Array.isArray(record.workerIds)) {
    throw validationError("Broadcast input requires workerIds array.", "broadcast_invalid_worker_ids");
  }

  const workerIds: string[] = [];
  const seenWorkerIds = new Set<string>();

  for (const value of record.workerIds) {
    if (typeof value !== "string") {
      throw validationError("Broadcast workerIds must only contain strings.", "broadcast_invalid_worker_ids");
    }

    const workerId = value.trim();
    if (!workerId) {
      throw validationError("Broadcast workerIds must not contain empty IDs.", "broadcast_invalid_worker_ids");
    }

    if (seenWorkerIds.has(workerId)) {
      continue;
    }

    seenWorkerIds.add(workerId);
    workerIds.push(workerId);
  }

  if (workerIds.length === 0) {
    throw validationError("Broadcast input requires at least one worker ID.", "broadcast_invalid_worker_ids");
  }

  if (typeof record.text !== "string") {
    throw validationError("Broadcast input requires text.", "broadcast_invalid_text");
  }

  const text = record.text;
  if (text.length > 4096) {
    throw validationError("Broadcast input text is too long.", "broadcast_invalid_text");
  }

  if (typeof record.submit !== "undefined" && typeof record.submit !== "boolean") {
    throw validationError("Broadcast input submit must be boolean when provided.", "broadcast_invalid_submit");
  }

  const submit = record.submit ?? true;
  if (!text.length && !submit) {
    throw validationError("Broadcast input requires text or submit=true.", "broadcast_invalid_payload");
  }

  return {
    workerIds,
    text,
    submit
  };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
