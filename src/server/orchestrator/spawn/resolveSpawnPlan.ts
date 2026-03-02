import type { ResolvedConfig, WorkerSpawnInput } from "../../../shared/types";
import type { SpawnPlan } from "./types";

export function resolveSpawnPlan(config: ResolvedConfig, input: WorkerSpawnInput): SpawnPlan {
  if ("shortcutIndex" in input) {
    const shortcut = config.shortcuts[input.shortcutIndex];
    if (!shortcut) {
      throw new Error(`Shortcut index '${input.shortcutIndex}' is out of range.`);
    }

    const project = config.projects[shortcut.project];
    const runtime = config.runtimes[shortcut.runtime];
    if (!project) {
      throw new Error(`Shortcut '${shortcut.label}' references unknown project '${shortcut.project}'.`);
    }
    if (!runtime) {
      throw new Error(`Shortcut '${shortcut.label}' references unknown runtime '${shortcut.runtime}'.`);
    }

    return {
      projectId: shortcut.project,
      project,
      runtimeId: shortcut.runtime,
      runtime,
      command: shortcut.command ?? runtime.command,
      displayName: shortcut.label,
      avatar: shortcut.avatar
    };
  }

  const project = config.projects[input.projectId];
  const runtime = config.runtimes[input.runtimeId];
  if (!project) {
    throw new Error(`Unknown project '${input.projectId}'.`);
  }
  if (!runtime) {
    throw new Error(`Unknown runtime '${input.runtimeId}'.`);
  }

  return {
    projectId: input.projectId,
    project,
    runtimeId: input.runtimeId,
    runtime,
    command: input.command && input.command.length > 0 ? input.command : runtime.command
  };
}
