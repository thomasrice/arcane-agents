import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { AppError, isAppError } from "./appError";
import {
  broadcastInputSchema,
  movementModeSchema,
  parseOrThrow,
  positionSchema,
  renameSchema,
  spawnSchema
} from "./schemas";

// These behavioural cases were ported from the old requestParsers tests. They
// assert the coarse per-route AppError codes (the client reads only `error`, so
// finer codes carry no contract) and the invariants the schema layer enforces:
// caps, trim/dedupe, boundaries, and coercion.

function expectParseError(schema: z.ZodTypeAny, body: unknown, code: string): void {
  let thrown: unknown;
  try {
    parseOrThrow(schema, body, code);
  } catch (error) {
    thrown = error;
  }

  expect(isAppError(thrown)).toBe(true);
  const appError = thrown as AppError;
  expect(appError.status).toBe(400);
  expect(appError.code).toBe(code);
}

describe("spawnSchema", () => {
  it("parses shortcut spawn input and sanitizes nearby worker IDs", () => {
    const nearby = Array.from({ length: 40 }, (_, index) => `worker-${index}`);

    const parsed = parseOrThrow(
      spawnSchema,
      {
        shortcutIndex: 2,
        spawnNearWorkerIds: [...nearby, " worker-1 "]
      },
      "spawn_invalid_payload"
    );

    expect(parsed).toEqual({
      shortcutIndex: 2,
      spawnNearWorkerIds: nearby.slice(0, 32)
    });
  });

  it("ignores a command field on shortcut spawns", () => {
    const parsed = parseOrThrow(spawnSchema, { shortcutIndex: 0, command: [] }, "spawn_invalid_payload");
    expect(parsed).toEqual({ shortcutIndex: 0 });
  });

  it("parses project/runtime spawn input with normalized command tokens", () => {
    const parsed = parseOrThrow(
      spawnSchema,
      {
        projectId: "project-a",
        runtimeId: "shell",
        command: [" npm ", "run", "test"]
      },
      "spawn_invalid_payload"
    );

    expect(parsed).toMatchObject({
      projectId: "project-a",
      runtimeId: "shell",
      command: ["npm", "run", "test"]
    });
    expect((parsed as { spawnNearWorkerIds?: string[] }).spawnNearWorkerIds).toBeUndefined();
  });

  it("rejects malformed spawn payloads with the coarse spawn code", () => {
    expectParseError(spawnSchema, null, "spawn_invalid_payload");
    expectParseError(spawnSchema, { projectId: "project-a" }, "spawn_invalid_payload");
    expectParseError(spawnSchema, { shortcutIndex: 0, spawnNearWorkerIds: "worker-1" }, "spawn_invalid_payload");
    expectParseError(spawnSchema, { shortcutIndex: -1 }, "spawn_invalid_payload");
    expectParseError(
      spawnSchema,
      { projectId: "project-a", runtimeId: "shell", command: ["", "test"] },
      "spawn_invalid_payload"
    );
    expectParseError(
      spawnSchema,
      { projectId: "project-a", runtimeId: "shell", command: ["npm", 7] },
      "spawn_invalid_payload"
    );
  });
});

describe("broadcastInputSchema", () => {
  it("parses and sanitizes broadcast payload", () => {
    const parsed = parseOrThrow(
      broadcastInputSchema,
      {
        workerIds: [" w1 ", "w1", "w2"],
        text: "hello"
      },
      "broadcast_invalid_payload"
    );

    expect(parsed).toEqual({
      workerIds: ["w1", "w2"],
      text: "hello",
      submit: true
    });
  });

  it("accepts text at the 4096-char boundary", () => {
    const parsed = parseOrThrow(
      broadcastInputSchema,
      { workerIds: ["w1"], text: "x".repeat(4096) },
      "broadcast_invalid_payload"
    );

    expect(parsed.text.length).toBe(4096);
  });

  it("rejects invalid broadcast payloads with the coarse broadcast code", () => {
    expectParseError(broadcastInputSchema, { workerIds: "w1", text: "hello" }, "broadcast_invalid_payload");
    expectParseError(broadcastInputSchema, { workerIds: ["   "], text: "hello" }, "broadcast_invalid_payload");
    expectParseError(broadcastInputSchema, { workerIds: ["w1", 9], text: "hello" }, "broadcast_invalid_payload");
    expectParseError(broadcastInputSchema, { workerIds: [], text: "hello" }, "broadcast_invalid_payload");
    expectParseError(broadcastInputSchema, { workerIds: ["w1"], text: "", submit: false }, "broadcast_invalid_payload");
    // 4096-char limit boundary: 4097 chars must be rejected.
    expectParseError(broadcastInputSchema, { workerIds: ["w1"], text: "x".repeat(4097) }, "broadcast_invalid_payload");
  });
});

describe("renameSchema", () => {
  it("accepts a string displayName", () => {
    const parsed = parseOrThrow(renameSchema, { displayName: "New Name" }, "rename_invalid_payload");
    expect(parsed).toEqual({ displayName: "New Name" });
  });

  it("rejects a non-string displayName", () => {
    expectParseError(renameSchema, { displayName: 7 }, "rename_invalid_payload");
    expectParseError(renameSchema, {}, "rename_invalid_payload");
  });
});

describe("positionSchema", () => {
  it("coerces numeric-like x/y values", () => {
    const parsed = parseOrThrow(positionSchema, { x: "12", y: 34 }, "position_invalid_payload");
    expect(parsed).toEqual({ x: 12, y: 34 });
  });

  it("rejects non-finite coordinates", () => {
    expectParseError(positionSchema, { x: "abc", y: 1 }, "position_invalid_payload");
    expectParseError(positionSchema, { y: 1 }, "position_invalid_payload");
  });
});

describe("movementModeSchema", () => {
  it("accepts the two supported modes", () => {
    expect(parseOrThrow(movementModeSchema, { movementMode: "hold" }, "movement_mode_invalid_payload")).toEqual({
      movementMode: "hold"
    });
    expect(parseOrThrow(movementModeSchema, { movementMode: "wander" }, "movement_mode_invalid_payload")).toEqual({
      movementMode: "wander"
    });
  });

  it("rejects any other movement mode", () => {
    expectParseError(movementModeSchema, { movementMode: "drift" }, "movement_mode_invalid_payload");
    expectParseError(movementModeSchema, {}, "movement_mode_invalid_payload");
  });
});
