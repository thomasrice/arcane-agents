import { describe, expect, it } from "vitest";
import { recommendTmuxInstall } from "./prerequisites";

function lookupFor(commands: string[]): (command: string) => string | undefined {
  const available = new Set(commands);
  return (command: string) => (available.has(command) ? `/usr/bin/${command}` : undefined);
}

describe("recommendTmuxInstall", () => {
  it("prefers Homebrew on macOS", () => {
    expect(recommendTmuxInstall({
      platform: "darwin",
      lookupCommand: lookupFor(["brew"])
    })).toEqual({
      dependency: "tmux",
      packageManager: "Homebrew",
      command: "brew install tmux",
      note: "This installs tmux only."
    });
  });

  it("returns an apt install command on Debian-like systems", () => {
    expect(recommendTmuxInstall({
      platform: "linux",
      lookupCommand: lookupFor(["apt"])
    })).toEqual({
      dependency: "tmux",
      packageManager: "apt",
      command: "sudo apt install -y tmux",
      note: "This installs tmux only and does not run a full system upgrade."
    });
  });

  it("omits sudo when already running as root", () => {
    expect(recommendTmuxInstall({
      platform: "linux",
      lookupCommand: lookupFor(["pacman"]),
      isRootUser: true
    })).toEqual({
      dependency: "tmux",
      packageManager: "pacman",
      command: "pacman -S --needed tmux",
      note: "This installs tmux only and skips reinstalling it if already present."
    });
  });

  it("returns undefined when no supported package manager is available", () => {
    expect(recommendTmuxInstall({
      platform: "linux",
      lookupCommand: lookupFor([])
    })).toBeUndefined();
  });
});
