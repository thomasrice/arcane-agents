import { spawnSync } from "node:child_process";
import { getArcaneAgentsPaths } from "../../config/loadConfig";
import { findExecutable } from "../../platform/shell";
import { recommendTmuxInstall } from "../../setup/prerequisites";
import { hasFlag } from "../args";
import { promptConfirm } from "../prompts";
import { ensureStarterConfig } from "../starterConfig";
import { runDoctor } from "./doctor";

export async function runSetup(args: string[]): Promise<number> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printSetupHelp();
    return 0;
  }

  if (args.length > 0) {
    console.error(`[arcane-agents] unknown setup options: ${args.join(", ")}`);
    printSetupHelp();
    return 1;
  }

  console.log("[arcane-agents] setup");

  const tmuxPath = findExecutable("tmux");
  if (tmuxPath) {
    console.log(`[arcane-agents] tmux: ${tmuxPath}`);
  } else {
    const installRecommendation = recommendTmuxInstall({
      platform: process.platform,
      lookupCommand: findExecutable,
      isRootUser: process.getuid?.() === 0
    });

    console.log("[arcane-agents] tmux is required but was not found on PATH.");

    if (installRecommendation) {
      console.log(`[arcane-agents] suggested install (${installRecommendation.packageManager}): ${installRecommendation.command}`);
      if (installRecommendation.note) {
        console.log(`[arcane-agents] note: ${installRecommendation.note}`);
      }

      if (process.stdin.isTTY && process.stdout.isTTY) {
        const approved = await promptConfirm(`[arcane-agents] run that command now? [y/N] `);
        if (approved) {
          const exitCode = runShellCommand(installRecommendation.command);
          if (exitCode !== 0) {
            console.error(`[arcane-agents] install command failed with exit code ${exitCode}.`);
          }
        } else {
          console.log("[arcane-agents] skipped tmux install.");
        }
      } else {
        console.log("[arcane-agents] non-interactive terminal detected; not running install command automatically.");
      }
    } else {
      console.log("[arcane-agents] could not determine a package-manager command for tmux on this system.");
      if (process.platform === "win32") {
        console.log("[arcane-agents] run Arcane Agents inside WSL2 or another Unix-like environment, then install tmux there.");
      } else {
        console.log("[arcane-agents] install tmux manually, then rerun 'arcane-agents setup' or 'arcane-agents doctor'.");
      }
    }
  }

  const paths = getArcaneAgentsPaths();
  try {
    const configResult = ensureStarterConfig(paths);
    if (configResult.outcome === "written") {
      console.log(`[arcane-agents] wrote starter config: ${paths.configPath}`);
    } else {
      console.log(`[arcane-agents] config: ${paths.configPath}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[arcane-agents] failed to prepare config: ${detail}`);
    return 1;
  }

  const doctorExitCode = runDoctor();
  if (doctorExitCode === 0) {
    console.log("[arcane-agents] next: edit your config if needed with 'arcane-agents config edit', then run 'arcane-agents'.");
  } else {
    console.log("[arcane-agents] fix the issues above, then rerun 'arcane-agents setup' or 'arcane-agents doctor'.");
  }

  return doctorExitCode;
}

function printSetupHelp(): void {
  console.log(`Arcane Agents setup

Usage:
  arcane-agents setup

What it does:
  - checks whether tmux is installed
  - suggests a platform-specific tmux install command
  - can run that command after confirmation in an interactive terminal
  - ensures ~/.config/arcane-agents/config.yaml exists
  - runs 'arcane-agents doctor'
`);
}

function runShellCommand(command: string): number {
  const result = spawnSync("sh", ["-lc", command], {
    stdio: "inherit"
  });

  if (result.error) {
    const detail = result.error.message;
    console.error(`[arcane-agents] failed to launch shell command '${command}': ${detail}`);
    return 1;
  }

  return result.status ?? 1;
}
