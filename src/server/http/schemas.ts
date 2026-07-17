import { z } from "zod";
import type { WorkerSpawnInput } from "../../shared/types";
import { validationError } from "./appError";

// Zod request schemas for every mutating route. These replace the hand-rolled
// requestParsers: the invariants (32-id cap, trim/dedupe, command normalisation,
// 4096-char broadcast limit, position coercion, movement-mode enum) live here as
// declarative schema + transform code rather than bespoke imperative parsers.
//
// Error-code policy: the old parsers minted ~20 per-field codes that no consumer
// reads (the client renders only `error`). We keep a single coarse code per route
// (passed to parseOrThrow) plus the existing route-level codes elsewhere.

const spawnNearWorkerIdsLimit = 32;
const broadcastTextMaxLength = 4096;

const displayNameSchema = z
  .string()
  .transform((value): string | undefined => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  })
  .optional();

const spawnNearWorkerIdsSchema = z
  .array(z.string())
  .transform((values, ctx): string[] | undefined => {
    const ids: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const trimmed = value.trim();
      if (!trimmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "spawnNearWorkerIds must not contain empty IDs."
        });
        return z.NEVER;
      }

      if (seen.has(trimmed)) {
        continue;
      }

      seen.add(trimmed);
      ids.push(trimmed);
      if (ids.length >= spawnNearWorkerIdsLimit) {
        break;
      }
    }

    return ids.length > 0 ? ids : undefined;
  })
  .optional();

const spawnCommandSchema = z
  .array(z.string())
  .min(1)
  .transform((tokens, ctx): string[] => {
    const command: string[] = [];
    for (const token of tokens) {
      const normalized = token.trim();
      if (!normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "command must not include empty tokens."
        });
        return z.NEVER;
      }

      command.push(normalized);
    }

    return command;
  })
  .optional();

// shortcutIndex takes priority over projectId/runtimeId, matching the original
// discriminated parser: a shortcut spawn ignores any command field.
const shortcutSpawnSchema = z
  .object({
    shortcutIndex: z.number().int().min(0),
    displayName: displayNameSchema,
    spawnNearWorkerIds: spawnNearWorkerIdsSchema
  })
  .transform(({ shortcutIndex, displayName, spawnNearWorkerIds }): WorkerSpawnInput => ({
    shortcutIndex,
    displayName,
    spawnNearWorkerIds
  }));

const projectSpawnSchema = z
  .object({
    projectId: z.string(),
    runtimeId: z.string(),
    command: spawnCommandSchema,
    displayName: displayNameSchema,
    spawnNearWorkerIds: spawnNearWorkerIdsSchema
  })
  .transform(({ projectId, runtimeId, command, displayName, spawnNearWorkerIds }): WorkerSpawnInput => ({
    projectId,
    runtimeId,
    command,
    displayName,
    spawnNearWorkerIds
  }));

export const spawnSchema = z.union([shortcutSpawnSchema, projectSpawnSchema]);

const broadcastWorkerIdsSchema = z.array(z.string()).transform((values, ctx): string[] => {
  const workerIds: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Broadcast workerIds must not contain empty IDs."
      });
      return z.NEVER;
    }

    if (seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    workerIds.push(trimmed);
  }

  return workerIds;
});

export const broadcastInputSchema = z
  .object({
    workerIds: broadcastWorkerIdsSchema,
    text: z.string().max(broadcastTextMaxLength),
    submit: z.boolean().optional()
  })
  .transform((data) => ({
    workerIds: data.workerIds,
    text: data.text,
    submit: data.submit ?? true
  }))
  .superRefine((data, ctx) => {
    if (data.workerIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workerIds"],
        message: "Broadcast input requires at least one worker ID."
      });
    }

    if (!data.text.length && !data.submit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Broadcast input requires text or submit=true."
      });
    }
  });

export const renameSchema = z.object({
  displayName: z.string()
});

export const positionSchema = z.object({
  x: z.coerce.number().finite(),
  y: z.coerce.number().finite()
});

export const movementModeSchema = z.object({
  movementMode: z.enum(["hold", "wander"])
});

// Parse `body` with `schema`, converting any ZodError into the existing AppError
// machinery: a 400 carrying the coarse per-route `code`.
export function parseOrThrow<Schema extends z.ZodTypeAny>(
  schema: Schema,
  body: unknown,
  code: string
): z.infer<Schema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw validationError(formatFirstIssue(result.error), code);
  }

  return result.data;
}

function formatFirstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid request payload.";
  }

  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
