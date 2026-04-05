import { describe, expect, it } from "vitest";
import { buildFriendlyTmuxDefaults, buildTmuxArgs, buildTmuxAttachArgs, buildTmuxCommandPrefix } from "./tmuxClient";

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

  it("enables friendly defaults with clipboard-aware copy bindings when a copy command is available", () => {
    expect(buildFriendlyTmuxDefaults({ copyCommand: "wl-copy" })).toEqual([
      ["set-option", "-g", "mouse", "on"],
      ["set-option", "-s", "escape-time", "0"],
      ["set-window-option", "-g", "history-limit", "100000"],
      ["set-option", "-s", "set-clipboard", "external"],
      ["set-option", "-s", "copy-command", "wl-copy"],
      ["bind-key", "-T", "copy-mode", "MouseDragEnd1Pane", "send-keys", "-X", "copy-pipe-and-cancel"],
      ["bind-key", "-T", "copy-mode-vi", "MouseDragEnd1Pane", "send-keys", "-X", "copy-pipe-and-cancel"]
    ]);
  });

  it("falls back to tmux buffer copy bindings when no clipboard command is available", () => {
    expect(buildFriendlyTmuxDefaults()).toEqual([
      ["set-option", "-g", "mouse", "on"],
      ["set-option", "-s", "escape-time", "0"],
      ["set-window-option", "-g", "history-limit", "100000"],
      ["bind-key", "-T", "copy-mode", "MouseDragEnd1Pane", "send-keys", "-X", "copy-selection-and-cancel"],
      ["bind-key", "-T", "copy-mode-vi", "MouseDragEnd1Pane", "send-keys", "-X", "copy-selection-and-cancel"]
    ]);
  });
});
