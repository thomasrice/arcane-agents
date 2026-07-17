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
