import type { ResolvedConfig, WorkerSpawnInput } from "../../../shared/types";
import { notFoundError } from "../../http/appError";
import type { SpawnPlan } from "./types";

export function resolveSpawnPlan(config: ResolvedConfig, input: WorkerSpawnInput): SpawnPlan {
  if ("shortcutIndex" in input) {
    const shortcut = config.shortcuts[input.shortcutIndex];
    if (!shortcut) {
      throw notFoundError(`Shortcut index '${input.shortcutIndex}' is out of range.`, "shortcut_not_found");
    }

    const project = config.projects[shortcut.project];
    const runtime = config.runtimes[shortcut.runtime];
    if (!project) {
      throw notFoundError(
        `Shortcut '${shortcut.label}' references unknown project '${shortcut.project}'.`,
        "project_not_found"
      );
    }
    if (!runtime) {
      throw notFoundError(
        `Shortcut '${shortcut.label}' references unknown runtime '${shortcut.runtime}'.`,
        "runtime_not_found"
      );
    }

    return {
      projectId: shortcut.project,
      project,
      runtimeId: shortcut.runtime,
      runtime,
      command: shortcut.command ?? runtime.command,
      displayName: input.displayName ?? shortcut.label,
      avatar: shortcut.avatar
    };
  }

  const project = config.projects[input.projectId];
  const runtime = config.runtimes[input.runtimeId];
  if (!project) {
    throw notFoundError(`Unknown project '${input.projectId}'.`, "project_not_found");
  }
  if (!runtime) {
    throw notFoundError(`Unknown runtime '${input.runtimeId}'.`, "runtime_not_found");
  }

  return {
    projectId: input.projectId,
    project,
    runtimeId: input.runtimeId,
    runtime,
    command: input.command && input.command.length > 0 ? input.command : runtime.command,
    displayName: input.displayName
  };
}
