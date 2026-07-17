import { findExecutable } from "./shell";

interface ClipboardCommandCandidate {
  binary: string;
  command: string;
}

/**
 * Resolve the tmux `copy-command` to use for the current environment, or
 * undefined when no clipboard helper is installed. Probes the real PATH via
 * findExecutable, so this must run on the host it configures.
 */
export async function detectClipboardCopyCommand(): Promise<string | undefined> {
  const candidates = clipboardCandidatesForEnvironment(process.platform, process.env);
  for (const candidate of candidates) {
    if (await commandExists(candidate.binary)) {
      return candidate.command;
    }
  }

  return undefined;
}

export function clipboardCandidatesForEnvironment(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env
): ClipboardCommandCandidate[] {
  if (platform === "darwin") {
    return [{ binary: "pbcopy", command: "pbcopy" }];
  }

  if (platform === "win32") {
    return [{ binary: "clip.exe", command: "clip.exe" }];
  }

  const linuxCandidates = [
    { binary: "wl-copy", command: "wl-copy" },
    { binary: "xclip", command: "xclip -selection clipboard -in" },
    { binary: "xsel", command: "xsel --clipboard --input" }
  ];

  if (platform === "linux" && isWslEnvironment(env)) {
    return [{ binary: "clip.exe", command: "clip.exe" }, ...linuxCandidates];
  }

  return linuxCandidates;
}

async function commandExists(binary: string): Promise<boolean> {
  return findExecutable(binary) !== undefined;
}

function isWslEnvironment(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WSLENV);
}
