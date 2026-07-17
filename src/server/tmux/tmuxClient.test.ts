import { describe, expect, it } from "vitest";
import { buildFriendlyTmuxDefaults, buildTmuxArgs, buildTmuxAttachArgs, buildTmuxCommandPrefix } from "./tmuxClient";
import { clipboardCandidatesForEnvironment } from "./tmuxAdapter";

describe("tmuxClient", () => {
  it("prefixes tmux commands with the managed socket name", () => {
    expect(buildTmuxArgs(["list-sessions"], { socketName: "arcane-agents" })).toEqual([
      "-L",
      "arcane-agents",
      "list-sessions"
    ]);
  });

  it("builds attach-session commands on the managed socket", () => {
    expect(buildTmuxAttachArgs("arcane-agents:worker-1", { socketName: "arcane-agents" })).toEqual([
      "-L",
      "arcane-agents",
      "attach-session",
      "-t",
      "arcane-agents:worker-1"
    ]);
  });

  it("builds a shell-safe tmux command prefix", () => {
    expect(buildTmuxCommandPrefix({ socketName: "arcane-agents-demo" })).toBe("tmux -L 'arcane-agents-demo'");
  });

  it("bridges the system clipboard and pipes copies when a copy command is available", () => {
    const commands = buildFriendlyTmuxDefaults({ copyCommand: "wl-copy" });

    // The copy-command branch adds clipboard bridging and switches the copy action.
    expect(commands).toContainEqual(["set-option", "-s", "set-clipboard", "external"]);
    expect(commands).toContainEqual(["set-option", "-s", "copy-command", "wl-copy"]);
    expect(commands).toContainEqual(["bind-key", "-T", "copy-mode", "MouseDragEnd1Pane", "send-keys", "-X", "copy-pipe-and-cancel"]);
  });

  it("omits clipboard bridging and falls back to buffer copies when no copy command is available", () => {
    const commands = buildFriendlyTmuxDefaults();

    expect(commands.some((command) => command.includes("copy-command"))).toBe(false);
    expect(commands.some((command) => command.includes("set-clipboard"))).toBe(false);
    expect(commands).toContainEqual(["bind-key", "-T", "copy-mode", "MouseDragEnd1Pane", "send-keys", "-X", "copy-selection-and-cancel"]);
  });

  it("prefers the Windows clipboard bridge when running inside WSL", () => {
    expect(clipboardCandidatesForEnvironment("linux", { WSL_DISTRO_NAME: "Ubuntu" })[0]).toEqual({
      binary: "clip.exe",
      command: "clip.exe"
    });
  });

  it("keeps native Linux clipboard commands first outside WSL", () => {
    expect(clipboardCandidatesForEnvironment("linux", {})[0]).toEqual({
      binary: "wl-copy",
      command: "wl-copy"
    });
  });
});
