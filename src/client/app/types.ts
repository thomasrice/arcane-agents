import type { ShortcutConfig, Worker } from "../../shared/types";

export type ControlGroupMap = Partial<Record<number, string[]>>;

export interface FadingWorker {
  worker: Worker;
  startedAtMs: number;
}

export type RosterEntry =
  | { kind: "worker"; worker: Worker }
  | { kind: "shortcut"; shortcut: ShortcutConfig; shortcutIndex: number };
