import { describe, expect, it } from "vitest";
import {
  buildFriendlyTmuxDefaults,
  buildTmuxArgs,
  buildTmuxCommandPrefix
} from "./tmuxAdapter";

describe("tmux argv builders", () => {
  it("prefixes tmux commands with the managed socket name", () => {
    expect(buildTmuxArgs(["list-sessions"], { socketName: "arcane-agents" })).toEqual([
      "-L",
      "arcane-agents",
      "list-sessions"
    ]);
  });

  it("builds a shell-safe tmux command prefix", () => {
    expect(buildTmuxCommandPrefix({ socketName: "arcane-agents-demo" })).toBe("tmux -L 'arcane-agents-demo'");
  });
});

describe("buildFriendlyTmuxDefaults", () => {
  it("pipes copies to the system clipboard tool and switches the copy action when one is available", () => {
    const commands = buildFriendlyTmuxDefaults({ copyCommand: "wl-copy" });

    expect(commands).toContainEqual(["set-option", "-s", "copy-command", "wl-copy"]);
    expect(commands).toContainEqual(["bind-key", "-T", "copy-mode", "MouseDragEnd1Pane", "send-keys", "-X", "copy-pipe-and-cancel"]);
  });

  it("always emits OSC 52 to the viewer so the browser clipboard is set regardless of a copy command", () => {
    // set-clipboard external is the load-bearing part of the remote-clipboard
    // fix: it must be present whether or not a server-side clipboard tool
    // exists, so the OSC 52 escape reaches the browser's ClipboardAddon.
    const withTool = buildFriendlyTmuxDefaults({ copyCommand: "wl-copy" });
    const withoutTool = buildFriendlyTmuxDefaults();

    expect(withTool).toContainEqual(["set-option", "-s", "set-clipboard", "external"]);
    expect(withoutTool).toContainEqual(["set-option", "-s", "set-clipboard", "external"]);
  });

  it("falls back to buffer copies and pipes nothing when no copy command is available", () => {
    const commands = buildFriendlyTmuxDefaults();

    expect(commands.some((command) => command.includes("copy-command"))).toBe(false);
    expect(commands).toContainEqual(["bind-key", "-T", "copy-mode", "MouseDragEnd1Pane", "send-keys", "-X", "copy-selection-and-cancel"]);
  });
});
