import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "./appError";
import { parseBroadcastInput, parseSpawnInput } from "./requestParsers";

function expectValidationError(run: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(isAppError(thrown)).toBe(true);
  const appError = thrown as AppError;
  expect(appError.status).toBe(400);
  expect(appError.code).toBe(code);
}

describe("parseSpawnInput", () => {
  it("parses shortcut spawn input and sanitizes nearby worker IDs", () => {
    const nearby = Array.from({ length: 40 }, (_, index) => `worker-${index}`);

    const parsed = parseSpawnInput({
      shortcutIndex: 2,
      spawnNearWorkerIds: [...nearby, " worker-1 "]
    });

    expect(parsed).toEqual({
      shortcutIndex: 2,
      spawnNearWorkerIds: nearby.slice(0, 32)
    });
  });

  it("parses project/runtime spawn input with normalized command tokens", () => {
    const parsed = parseSpawnInput({
      projectId: "project-a",
      runtimeId: "shell",
      command: [" npm ", "run", "test"]
    });

    expect(parsed).toMatchObject({
      projectId: "project-a",
      runtimeId: "shell",
      command: ["npm", "run", "test"]
    });
    expect(parsed.spawnNearWorkerIds).toBeUndefined();
  });

  it("rejects malformed spawn payloads", () => {
    expectValidationError(() => parseSpawnInput(null), "spawn_invalid_body");
    expectValidationError(() => parseSpawnInput({ projectId: "project-a" }), "spawn_invalid_payload");
    expectValidationError(
      () => parseSpawnInput({ shortcutIndex: 0, spawnNearWorkerIds: "worker-1" }),
      "spawn_invalid_nearby_worker_ids"
    );
    expectValidationError(
      () => parseSpawnInput({ projectId: "project-a", runtimeId: "shell", command: ["", "test"] }),
      "spawn_invalid_command"
    );
    expectValidationError(
      () => parseSpawnInput({ projectId: "project-a", runtimeId: "shell", command: ["npm", 7] }),
      "spawn_invalid_command"
    );
  });
});

describe("parseBroadcastInput", () => {
  it("parses and sanitizes broadcast payload", () => {
    const parsed = parseBroadcastInput({
      workerIds: [" w1 ", "w1", "w2"],
      text: "hello"
    });

    expect(parsed).toEqual({
      workerIds: ["w1", "w2"],
      text: "hello",
      submit: true
    });
  });

  it("rejects invalid broadcast payloads", () => {
    expectValidationError(
      () => parseBroadcastInput({ workerIds: "w1", text: "hello" }),
      "broadcast_invalid_worker_ids"
    );

    expectValidationError(
      () => parseBroadcastInput({ workerIds: ["   "], text: "hello" }),
      "broadcast_invalid_worker_ids"
    );

    expectValidationError(
      () => parseBroadcastInput({ workerIds: ["w1", 9], text: "hello" }),
      "broadcast_invalid_worker_ids"
    );

    expectValidationError(
      () => parseBroadcastInput({ workerIds: ["w1"], text: "", submit: false }),
      "broadcast_invalid_payload"
    );

    // 4096-char limit boundary: 4097 chars must be rejected.
    expectValidationError(
      () => parseBroadcastInput({ workerIds: ["w1"], text: "x".repeat(4097) }),
      "broadcast_invalid_text"
    );
  });
});
