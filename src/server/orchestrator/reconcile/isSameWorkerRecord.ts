import type { Worker } from "../../../shared/types";

export function isSameWorkerRecord(a: Worker, b: Worker): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.projectId === b.projectId &&
    a.projectPath === b.projectPath &&
    a.runtimeId === b.runtimeId &&
    a.runtimeLabel === b.runtimeLabel &&
    JSON.stringify(a.command) === JSON.stringify(b.command) &&
    a.status === b.status &&
    a.movementMode === b.movementMode &&
    a.tmuxRef.session === b.tmuxRef.session &&
    a.tmuxRef.window === b.tmuxRef.window &&
    a.tmuxRef.pane === b.tmuxRef.pane
  );
}
