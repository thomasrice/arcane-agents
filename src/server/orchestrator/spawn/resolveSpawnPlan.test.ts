import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../../../shared/types";
import { resolveSpawnPlan } from "./resolveSpawnPlan";

function createConfig(): ResolvedConfig {
  return {
    projects: {
      pa: { path: "/tmp/pa", shortName: "pa" },
      lab: { path: "/tmp/lab", shortName: "lab" }
    },
    runtimes: {
      claude: { label: "Claude", command: ["claude"] },
      shell: { label: "Shell", command: ["bash"] }
    },
    shortcuts: [
      {
        label: "PA",
        project: "pa",
        runtime: "claude",
        command: ["claude", "--dangerously-skip-permissions"],
        avatar: "wizard"
      }
    ],
    discovery: [],
    avatars: {
      disabled: []
    },
    audio: {
      enableSound: true
    },
    backend: {
      tmux: {
        socketName: "arcane-agents",
        sessionName: "arcane-agents",
        pollIntervalMs: 2500
      }
    },
    status: {
      interactiveCommands: []
    },
    server: {
      host: "127.0.0.1",
      port: 7600
    }
  };
}

describe("resolveSpawnPlan", () => {
  it("resolves shortcut spawn with override command and avatar", () => {
    const config = createConfig();
    const plan = resolveSpawnPlan(config, { shortcutIndex: 0 });

    expect(plan).toMatchObject({
      projectId: "pa",
      runtimeId: "claude",
      command: ["claude", "--dangerously-skip-permissions"],
      displayName: "PA",
      avatar: "wizard"
    });
  });

  it("uses runtime command for direct spawn when command is empty", () => {
    const config = createConfig();
    const plan = resolveSpawnPlan(config, {
      projectId: "lab",
      runtimeId: "shell",
      command: []
    });

    expect(plan.command).toEqual(["bash"]);
  });

  it("uses provided command for direct spawn when non-empty", () => {
    const config = createConfig();
    const plan = resolveSpawnPlan(config, {
      projectId: "lab",
      runtimeId: "shell",
      command: ["npm", "test"]
    });

    expect(plan.command).toEqual(["npm", "test"]);
  });

  it("throws helpful errors for unknown shortcut/project/runtime references", () => {
    const config = createConfig();

    expect(() => resolveSpawnPlan(config, { shortcutIndex: 99 })).toThrow("Shortcut index '99' is out of range.");
    expect(() => resolveSpawnPlan(config, { projectId: "missing", runtimeId: "shell" })).toThrow("Unknown project 'missing'.");
    expect(() => resolveSpawnPlan(config, { projectId: "pa", runtimeId: "missing" })).toThrow("Unknown runtime 'missing'.");
  });
});
