import type { ParsedTranscriptRecord } from "./types";

export function extractTranscriptRecords(lines: string[]): ParsedTranscriptRecord[] {
  const records: ParsedTranscriptRecord[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const record = parseRecord(trimmed);
    if (!record) {
      continue;
    }

    const recordType = readString(record.type);
    if (recordType !== "assistant" && recordType !== "user" && recordType !== "system" && recordType !== "progress") {
      continue;
    }

    records.push({
      type: recordType,
      record
    });
  }

  return records;
}

export function parseRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return readRecord(parsed) ?? undefined;
  } catch {
    return undefined;
  }
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

export function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
