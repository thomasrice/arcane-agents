import { describe, expect, it } from "vitest";
import { parseBroadcastInput, parseSpawnInput } from "./requestParsers";

describe("parseSpawnInput", () => {
  it("parses shortcut spawn input and sanitizes nearby worker IDs", () => {
    const nearby = Array.from({ length: 40 }, (_, index) => `worker-${index}`);

    const parsed = parseSpawnInput({
      shortcutIndex: 2,
      spawnNearWorkerIds: [...nearby, " worker-1 ", "", 17]
    });

    expect(parsed).toEqual({
      shortcutIndex: 2,
      spawnNearWorkerIds: nearby.slice(0, 32)
    });
  });

  it("parses project/runtime spawn input and keeps only string command tokens", () => {
    const parsed = parseSpawnInput({
      projectId: "project-a",
      runtimeId: "shell",
      command: ["npm", "run", 42, "test", null]
    });

    expect(parsed).toMatchObject({
      projectId: "project-a",
      runtimeId: "shell",
      command: ["npm", "run", "test"]
    });
    expect(parsed.spawnNearWorkerIds).toBeUndefined();
  });

  it("rejects malformed spawn payloads", () => {
    expect(() => parseSpawnInput(null)).toThrow("Spawn body must be an object.");
    expect(() => parseSpawnInput({ projectId: "project-a" })).toThrow(
      "Invalid spawn request: expected shortcutIndex or projectId+runtimeId."
    );
    expect(() => parseSpawnInput({ shortcutIndex: 0, spawnNearWorkerIds: "worker-1" })).toThrow(
      "spawnNearWorkerIds must be an array when provided."
    );
  });
});

describe("parseBroadcastInput", () => {
  it("parses and sanitizes broadcast payload", () => {
    const parsed = parseBroadcastInput({
      workerIds: [" w1 ", "w1", "w2", 9],
      text: "hello"
    });

    expect(parsed).toEqual({
      workerIds: ["w1", "w2"],
      text: "hello",
      submit: true
    });
  });

  it("rejects invalid broadcast payloads", () => {
    expect(() => parseBroadcastInput({ workerIds: "w1", text: "hello" })).toThrow(
      "Broadcast input requires workerIds array."
    );

    expect(() => parseBroadcastInput({ workerIds: ["   "], text: "hello" })).toThrow(
      "Broadcast input requires at least one worker ID."
    );

    expect(() => parseBroadcastInput({ workerIds: ["w1"], text: "", submit: false })).toThrow(
      "Broadcast input requires text or submit=true."
    );

    expect(() => parseBroadcastInput({ workerIds: ["w1"], text: "x".repeat(4097) })).toThrow(
      "Broadcast input text is too long."
    );
  });
});
