export interface InstallCommandRecommendation {
  dependency: string;
  packageManager: string;
  command: string;
  note?: string;
}

interface RecommendInstallOptions {
  platform: NodeJS.Platform;
  lookupCommand: (command: string) => string | undefined;
  isRootUser?: boolean;
}

export function recommendTmuxInstall(options: RecommendInstallOptions): InstallCommandRecommendation | undefined {
  const sudoPrefix = options.isRootUser ? "" : "sudo ";

  if (options.platform === "darwin" && options.lookupCommand("brew")) {
    return {
      dependency: "tmux",
      packageManager: "Homebrew",
      command: "brew install tmux",
      note: "This installs tmux only."
    };
  }

  if (options.platform !== "linux") {
    return undefined;
  }

  if (options.lookupCommand("brew")) {
    return {
      dependency: "tmux",
      packageManager: "Homebrew",
      command: "brew install tmux",
      note: "This installs tmux only."
    };
  }

  if (options.lookupCommand("apt")) {
    return {
      dependency: "tmux",
      packageManager: "apt",
      command: `${sudoPrefix}apt install -y tmux`,
      note: "This installs tmux only and does not run a full system upgrade."
    };
  }

  if (options.lookupCommand("apt-get")) {
    return {
      dependency: "tmux",
      packageManager: "apt-get",
      command: `${sudoPrefix}apt-get install -y tmux`,
      note: "This installs tmux only and does not run a full system upgrade."
    };
  }

  if (options.lookupCommand("dnf")) {
    return {
      dependency: "tmux",
      packageManager: "dnf",
      command: `${sudoPrefix}dnf install -y tmux`,
      note: "This installs tmux only."
    };
  }

  if (options.lookupCommand("pacman")) {
    return {
      dependency: "tmux",
      packageManager: "pacman",
      command: `${sudoPrefix}pacman -S --needed tmux`,
      note: "This installs tmux only and skips reinstalling it if already present."
    };
  }

  if (options.lookupCommand("zypper")) {
    return {
      dependency: "tmux",
      packageManager: "zypper",
      command: `${sudoPrefix}zypper install -y tmux`,
      note: "This installs tmux only."
    };
  }

  if (options.lookupCommand("apk")) {
    return {
      dependency: "tmux",
      packageManager: "apk",
      command: `${sudoPrefix}apk add tmux`,
      note: "This installs tmux only."
    };
  }

  return undefined;
}
