import type { BroadcastInputResult } from "../api";
import type { Worker } from "../../shared/types";
import {
  controlGroupStorageKey,
  defaultMapColumnRatio,
  layoutSplitStorageKey,
  maxMapColumnRatio,
  minMapColumnRatio
} from "./constants";
import type { ControlGroupMap } from "./types";

export function upsertWorker(currentWorkers: Worker[], worker: Worker): Worker[] {
  const existingIndex = currentWorkers.findIndex((item) => item.id === worker.id);
  if (existingIndex < 0) {
    return [...currentWorkers, worker];
  }

  const nextWorkers = [...currentWorkers];
  nextWorkers[existingIndex] = worker;
  return nextWorkers;
}

export function loadControlGroupsFromStorage(): ControlGroupMap {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(controlGroupStorageKey);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const next: ControlGroupMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const digit = Number(key);
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
        continue;
      }

      if (typeof value === "string" && value.trim().length > 0) {
        next[digit] = [value];
        continue;
      }

      if (!Array.isArray(value)) {
        continue;
      }

      const workerIds = value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .filter((entry, index, array) => array.indexOf(entry) === index);
      if (workerIds.length > 0) {
        next[digit] = workerIds;
      }
    }

    return next;
  } catch {
    return {};
  }
}

export function persistControlGroups(groups: ControlGroupMap): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const serializable: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(groups)) {
      const digit = Number(key);
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
        continue;
      }

      if (!Array.isArray(value) || value.length === 0) {
        continue;
      }

      const workerIds = value
        .filter((workerId) => typeof workerId === "string" && workerId.trim().length > 0)
        .filter((workerId, index, array) => array.indexOf(workerId) === index);
      if (workerIds.length > 0) {
        serializable[String(digit)] = workerIds;
      }
    }

    window.localStorage.setItem(controlGroupStorageKey, JSON.stringify(serializable));
  } catch {
    // ignore storage errors
  }
}

export function loadMapColumnRatioFromStorage(): number {
  if (typeof window === "undefined") {
    return defaultMapColumnRatio;
  }

  try {
    const raw = window.localStorage.getItem(layoutSplitStorageKey);
    if (!raw) {
      return defaultMapColumnRatio;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return defaultMapColumnRatio;
    }

    return clampNumber(parsed, minMapColumnRatio, maxMapColumnRatio);
  } catch {
    return defaultMapColumnRatio;
  }
}

export function persistMapColumnRatio(value: number): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(layoutSplitStorageKey, String(clampNumber(value, minMapColumnRatio, maxMapColumnRatio)));
  } catch {
    // ignore storage errors
  }
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea";
}

export function isTerminalTarget(target: EventTarget | null): boolean {
  return isElementInTerminalPanel(target);
}

export function isElementInTerminalPanel(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".terminal-panel"));
}

function toDisplayHotkeys(hotkeys: string[] | undefined): string[] {
  if (!hotkeys || hotkeys.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const displayHotkeys: string[] = [];

  for (const hotkey of hotkeys) {
    const trimmed = hotkey.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    displayHotkeys.push(trimmed);
  }

  return displayHotkeys;
}

export function formatShortcutSummonActivityText(hotkeys: string[] | undefined): string {
  const displayHotkeys = toDisplayHotkeys(hotkeys);
  if (displayHotkeys.length === 0) {
    return "Summon agent";
  }

  return `Summon agent · ${displayHotkeys.join(" / ")}`;
}

export function formatRallyCommandResult(result: BroadcastInputResult): string {
  const sentCount = result.deliveredWorkerIds.length;
  const skippedCount = result.skippedWorkerIds.length;
  const failedCount = result.failed.length;

  if (sentCount === result.requestedCount && skippedCount === 0 && failedCount === 0) {
    return `Sent to ${sentCount} ${sentCount === 1 ? "agent" : "agents"}.`;
  }

  const segments = [`Sent ${sentCount}/${result.requestedCount}.`];
  if (skippedCount > 0) {
    segments.push(`Skipped ${skippedCount}.`);
  }
  if (failedCount > 0) {
    segments.push(`Failed ${failedCount}.`);
  }

  return segments.join(" ");
}

export function mergeBroadcastInputResults(results: BroadcastInputResult[]): BroadcastInputResult {
  return results.reduce<BroadcastInputResult>(
    (merged, result) => {
      merged.requestedCount += result.requestedCount;
      merged.deliveredWorkerIds.push(...result.deliveredWorkerIds);
      merged.skippedWorkerIds.push(...result.skippedWorkerIds);
      merged.failed.push(...result.failed);
      return merged;
    },
    {
      requestedCount: 0,
      deliveredWorkerIds: [],
      skippedWorkerIds: [],
      failed: []
    }
  );
}

export function parseControlGroupDigit(event: KeyboardEvent): number | undefined {
  if (/^[0-9]$/.test(event.key)) {
    return Number(event.key);
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return Number(event.code.slice("Digit".length));
  }

  if (/^Numpad[0-9]$/.test(event.code)) {
    return Number(event.code.slice("Numpad".length));
  }

  return undefined;
}

export function isTerminalEscapeShortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false;
  }

  return event.key === "]" || event.code === "BracketRight" || event.key.toLowerCase() === "d" || event.code === "KeyD";
}
