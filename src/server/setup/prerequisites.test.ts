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
    })).toMatchObject({
      packageManager: "Homebrew",
      command: "brew install tmux"
    });
  });

  it("returns an apt install command on Debian-like systems", () => {
    expect(recommendTmuxInstall({
      platform: "linux",
      lookupCommand: lookupFor(["apt"])
    })).toMatchObject({
      packageManager: "apt",
      command: "sudo apt install -y tmux"
    });
  });

  it("omits sudo when already running as root", () => {
    expect(recommendTmuxInstall({
      platform: "linux",
      lookupCommand: lookupFor(["pacman"]),
      isRootUser: true
    })).toMatchObject({
      packageManager: "pacman",
      command: "pacman -S --needed tmux"
    });
  });

  it("returns undefined when no supported package manager is available", () => {
    expect(recommendTmuxInstall({
      platform: "linux",
      lookupCommand: lookupFor([])
    })).toBeUndefined();
  });
});
