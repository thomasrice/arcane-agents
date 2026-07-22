import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadResolvedConfig } from "./loadConfig";
import { createDefaultConfig, partialConfigSchema } from "./schema";

describe("keybinding config", () => {
  it("defaults terminal focus escape to Ctrl+Alt+]", () => {
    expect(createDefaultConfig().keybindings.leaveTerminalFocus).toEqual(["Ctrl+Alt+]"]);
  });

  it("loads one or more custom terminal focus escape chords", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcane-agents-config-"));
    const paths = {
      configDir,
      configPath: path.join(configDir, "config.yaml"),
      localOverridePath: path.join(configDir, "config.local.yaml"),
      stateDir: path.join(configDir, "state"),
      dbPath: path.join(configDir, "state", "arcane-agents.db"),
      cacheDir: path.join(configDir, "cache")
    };

    try {
      fs.writeFileSync(paths.configPath, "keybindings:\n  leaveTerminalFocus: [F2, \"Ctrl+;\"]\n");
      expect(loadResolvedConfig(paths).keybindings.leaveTerminalFocus).toEqual(["F2", "Ctrl+;"]);
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("rejects an empty terminal focus escape binding list", () => {
    expect(() =>
      partialConfigSchema.parse({
        keybindings: {
          leaveTerminalFocus: []
        }
      })
    ).toThrow();
  });
});

describe("custom status rule config", () => {
  it("defaults to no custom rules", () => {
    expect(createDefaultConfig().status.rules).toEqual([]);
  });

  it("loads a name-agnostic current-screen rule", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcane-agents-config-"));
    const paths = {
      configDir,
      configPath: path.join(configDir, "config.yaml"),
      localOverridePath: path.join(configDir, "config.local.yaml"),
      stateDir: path.join(configDir, "state"),
      dbPath: path.join(configDir, "state", "arcane-agents.db"),
      cacheDir: path.join(configDir, "cache")
    };

    try {
      fs.writeFileSync(
        paths.configPath,
        [
          "status:",
          "  rules:",
          "    - id: polling-workers-waiting",
          "      match:",
          "        runtimeId: shell",
          "        command: '^python3$'",
          "        lastLine: '^No work for [^;]+; checking again in [0-9]+s\\.$'",
          "      set:",
          "        status: idle",
          ""
        ].join("\n")
      );

      expect(loadResolvedConfig(paths).status.rules).toEqual([
        {
          id: "polling-workers-waiting",
          match: {
            runtimeId: "shell",
            command: "^python3$",
            lastLine: "^No work for [^;]+; checking again in [0-9]+s\\.$"
          },
          set: { status: "idle" }
        }
      ]);
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("rejects empty match criteria", () => {
    expect(() =>
      partialConfigSchema.parse({
        status: {
          rules: [{ id: "matches-everything", match: {}, set: { status: "idle" } }]
        }
      })
    ).toThrow(/at least one match field/i);
  });

  it("rejects invalid regexes with the rule id and field", () => {
    expect(() =>
      partialConfigSchema.parse({
        status: {
          rules: [{ id: "broken-pattern", match: { lastLine: "[" }, set: { status: "idle" } }]
        }
      })
    ).toThrow(/broken-pattern.*lastLine/i);
  });

  it("rejects duplicate rule ids", () => {
    expect(() =>
      partialConfigSchema.parse({
        status: {
          rules: [
            { id: "same-id", match: { command: "python" }, set: { status: "idle" } },
            { id: "same-id", match: { command: "node" }, set: { status: "idle" } }
          ]
        }
      })
    ).toThrow(/same-id.*duplicates/i);
  });

  it("rejects display activity on idle outcomes", () => {
    expect(() =>
      partialConfigSchema.parse({
        status: {
          rules: [
            {
              id: "invalid-idle-activity",
              match: { command: "python" },
              set: { status: "idle", activityText: "Waiting" }
            }
          ]
        }
      })
    ).toThrow();
  });
});
