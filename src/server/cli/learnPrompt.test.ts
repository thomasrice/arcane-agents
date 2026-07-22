import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "../config/schema";
import type { Worker } from "../../shared/types";
import { generatePromptPatterns } from "./learnPromptGenerator";
import { compilePromptSignatures, matchPromptSignature } from "../status/promptSignatures";
import { parseLearnPromptOptions, runLearnPrompt } from "./learnPrompt";

const safePane = [
  "❯ fix THE_SECRET production task",
  "? for help",
  "Context left: 76%",
  "Claude Opus 4.5 · ~/private/project · feature/secret-branch"
].join("\n");

function worker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: "worker-1",
    name: "Worker One",
    displayName: "Worker One",
    projectId: "project",
    projectPath: "/private/project",
    runtimeId: "claude",
    runtimeLabel: "Claude",
    command: ["claude"],
    status: "working",
    avatarType: "wizard",
    movementMode: "hold",
    position: { x: 0, y: 0 },
    tmuxRef: { session: "arcane", window: "worker-1", pane: "%1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function dependencies(writes: { count: number }, confirmed = true, pane = safePane) {
  const config = createDefaultConfig();
  const output = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  return {
    getPaths: () => ({
      configDir: "/config",
      configPath: "/config/config.yaml",
      localOverridePath: "/config/config.local.yaml",
      stateDir: "/state",
      dbPath: "/state/arcane-agents.db",
      cacheDir: "/cache"
    }),
    loadConfig: () => config,
    applyOverrides: (value: typeof config) => value,
    fetchWorkers: async () => [worker()],
    createTmux: () => ({
      getPaneState: async () => ({ currentCommand: "claude", isDead: false }),
      captureVisiblePane: async () => pane
    }),
    confirm: async () => confirmed,
    appendSignature: async () => {
      writes.count += 1;
    },
    isInteractive: () => true,
    output,
    error
  };
}

describe("parseLearnPromptOptions", () => {
  it("accepts only the supported strict flags", () => {
    expect(parseLearnPromptOptions(["Worker", "--runtime", "codex", "--id", "custom", "--dry-run"]))
      .toEqual({ worker: "Worker", runtime: "codex", id: "custom", dryRun: true, yes: false, json: false });
    expect(() => parseLearnPromptOptions(["Worker", "--wat"])).toThrow("Unknown option");
    expect(() => parseLearnPromptOptions(["Worker", "--runtime"])).toThrow("Missing value");
    expect(() => parseLearnPromptOptions(["Worker", "--yes", "--dry-run"])).toThrow("cannot be used together");
    expect(() => parseLearnPromptOptions(["Worker", "--json"])).toThrow("requires --dry-run or --yes");
    expect(parseLearnPromptOptions(["Worker", "--id", "  custom-id  ", "--dry-run"]).id).toBe("custom-id");
  });
});

describe("generatePromptPatterns", () => {
  it("uses only structural patterns and omits captured values", () => {
    const patterns = generatePromptPatterns("claude", safePane);
    expect(patterns?.length).toBeGreaterThanOrEqual(2);
    const serialized = patterns?.join("\n") ?? "";
    expect(serialized).not.toContain("THE_SECRET");
    expect(serialized).not.toContain("Opus");
    expect(serialized).not.toContain("4.5");
    expect(serialized).not.toContain("private/project");
    expect(serialized).not.toContain("secret-branch");
    expect(serialized).not.toContain("76");
    expect(
      matchPromptSignature(
        compilePromptSignatures([{ id: "learned", runtime: "claude", all: patterns ?? [] }]),
        safePane
      )
    ).toEqual({ id: "learned", runtime: "claude" });
  });

  it("learns value-free structure from the current OMP prompt shape", () => {
    const ompPane = "+ stale diff output\n╭────────╮\n27.5%/1M";
    const patterns = generatePromptPatterns("omp", ompPane);

    expect(patterns).toHaveLength(2);
    expect(patterns?.join("\n")).not.toContain("27.5");
    expect(patterns?.join("\n")).not.toContain("1M");
    expect(patterns?.join("\n")).not.toContain("^\\+");
    expect(
      matchPromptSignature(
        compilePromptSignatures([{ id: "learned-omp", runtime: "omp", all: patterns ?? [] }]),
        ompPane
      )
    ).toEqual({ id: "learned-omp", runtime: "omp" });
  });

  it("fails safely when the pane has insufficient structure", () => {
    expect(generatePromptPatterns("claude", "❯ fix the deployment")).toBeUndefined();
  });
});

describe("runLearnPrompt", () => {
  it("does not mutate on dry-run even when a worker falsely reports working", async () => {
    const writes = { count: 0 };
    const deps = dependencies(writes);
    await expect(runLearnPrompt(["worker-1", "--runtime", "claude", "--dry-run"], undefined, deps)).resolves.toBe(0);
    expect(writes.count).toBe(0);
    expect(deps.output).toHaveBeenCalledWith(expect.stringContaining("target: /config/config.local.yaml"));
  });

  it("does not mutate when confirmation is declined", async () => {
    const writes = { count: 0 };
    const deps = dependencies(writes, false);
    await expect(runLearnPrompt(["worker-1", "--runtime", "claude"], undefined, deps)).resolves.toBe(0);
    expect(writes.count).toBe(0);
    expect(deps.output).toHaveBeenCalledWith("[arcane-agents] declined; config was not changed.");
  });


  it("emits one value-safe JSON object for a dry-run", async () => {
    const writes = { count: 0 };
    const deps = dependencies(writes);
    await expect(runLearnPrompt(["worker-1", "--runtime", "claude", "--dry-run", "--json"], undefined, deps)).resolves.toBe(0);
    expect(deps.output).toHaveBeenCalledTimes(1);
    const output = deps.output.mock.calls[0][0];
    expect(JSON.parse(output)).toMatchObject({ ok: true, written: false });
    expect(output).not.toContain("THE_SECRET");
    expect(output).not.toContain("/private/project");
  });

  it("refuses native active work even when enough prompt structure is visible", async () => {
    const writes = { count: 0 };
    const pane = ["❯ task", "✢ Wrangling…", "❯ ", "? for help", "Context left: 76%"].join("\n");
    const deps = dependencies(writes, true, pane);

    await expect(runLearnPrompt(["worker-1", "--runtime", "claude", "--yes"], undefined, deps)).resolves.toBe(1);
    expect(writes.count).toBe(0);
    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("active work"));
  });

  it("requires --yes before a non-interactive mutation", async () => {
    const writes = { count: 0 };
    const deps = dependencies(writes);
    deps.isInteractive = () => false;

    await expect(runLearnPrompt(["worker-1", "--runtime", "claude"], undefined, deps)).resolves.toBe(1);
    expect(writes.count).toBe(0);
    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("--yes"));
  });

  it("brackets an IPv6 API host when loading workers", async () => {
    const writes = { count: 0 };
    const withMockedWorkers = dependencies(writes);
    const config = withMockedWorkers.loadConfig();
    config.server.host = "::1";
    withMockedWorkers.loadConfig = () => config;
    const { fetchWorkers: _fetchWorkers, ...deps } = withMockedWorkers;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ workers: [worker()] })
    }));
    vi.stubGlobal("fetch", fetchMock);
    const previousHost = process.env.ARCANE_AGENTS_API_HOST;
    const previousPort = process.env.ARCANE_AGENTS_API_PORT;
    delete process.env.ARCANE_AGENTS_API_HOST;
    delete process.env.ARCANE_AGENTS_API_PORT;

    try {
      await expect(runLearnPrompt(["worker-1", "--runtime", "claude", "--dry-run"], undefined, deps)).resolves.toBe(0);
      expect(fetchMock).toHaveBeenCalledWith("http://[::1]:7600/api/workers");
    } finally {
      vi.unstubAllGlobals();
      if (previousHost === undefined) delete process.env.ARCANE_AGENTS_API_HOST;
      else process.env.ARCANE_AGENTS_API_HOST = previousHost;
      if (previousPort === undefined) delete process.env.ARCANE_AGENTS_API_PORT;
      else process.env.ARCANE_AGENTS_API_PORT = previousPort;
    }
  });

  it("allows calibration at a native at-rest prompt despite stale parsed error text", async () => {
    const writes = { count: 0 };
    const pane = ["Error: previous command failed", "? for help", "Context left: 76%", "❯"].join("\n");
    const deps = dependencies(writes, true, pane);
    await expect(runLearnPrompt(["worker-1", "--runtime", "claude", "--yes"], undefined, deps)).resolves.toBe(0);
    expect(writes.count).toBe(1);
  });
  it("rejects duplicate effective signature IDs before mutation", async () => {
    const writes = { count: 0 };
    const deps = dependencies(writes);
    deps.loadConfig().status.promptSignatures.push({ id: "claude-worker-one-prompt", runtime: "claude", all: ["a", "b"] });
    await expect(runLearnPrompt(["worker-1", "--runtime", "claude", "--yes"], undefined, deps)).resolves.toBe(1);
    expect(writes.count).toBe(0);
    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });
});
