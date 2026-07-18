import type { ShortcutConfig, Worker, WorkerSpawnInput } from "../../shared/types";

export type ControlGroupMap = Partial<Record<number, string[]>>;

export interface FadingWorker {
  worker: Worker;
  startedAtMs: number;
}

export type RosterEntry =
  | { kind: "worker"; worker: Worker }
  | { kind: "shortcut"; shortcut: ShortcutConfig; shortcutIndex: number };

export interface BatchSpawnItem {
  input: WorkerSpawnInput;
  displayName: string;
}

/** Which one modal is open. The five are mutually exclusive by construction. */
export type OpenDialog = "spawn" | "palette" | "batchSpawn" | "shortcuts" | "rename" | null;

export type ConfirmKind = "kill" | "restart";

export interface PendingConfirm {
  kind: ConfirmKind;
  workerIds: string[];
}
