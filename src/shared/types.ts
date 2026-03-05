export type WorkerStatus = "idle" | "working" | "attention" | "error" | "stopped";

export type MovementMode = "hold" | "wander";

export type ActivityTool =
  | "read"
  | "edit"
  | "write"
  | "bash"
  | "grep"
  | "glob"
  | "task"
  | "todo"
  | "web"
  | "terminal"
  | "unknown";

export type AvatarType = string;

export interface ProjectConfig {
  path: string;
  shortName: string;
  label?: string;
  source?: "config" | "discovered";
}

export interface RuntimeConfig {
  command: string[];
  label: string;
}

export interface ShortcutConfig {
  label: string;
  project: string;
  runtime: string;
  command?: string[];
  avatar?: AvatarType;
  hotkeys?: string[];
}

export interface DiscoveryRule {
  name: string;
  type: "worktrees" | "directories" | "glob";
  path: string;
  match?: string;
  exclude?: string[];
  maxDepth?: number;
}

export interface ResolvedConfig {
  projects: Record<string, ProjectConfig>;
  runtimes: Record<string, RuntimeConfig>;
  shortcuts: ShortcutConfig[];
  discovery: DiscoveryRule[];
  avatars: {
    disabled: AvatarType[];
  };
  audio: {
    enableSound: boolean;
  };
  backend: {
    tmux: {
      sessionName: string;
      pollIntervalMs: number;
    };
  };
  server: {
    host: string;
    port: number;
  };
}

export interface TmuxRef {
  session: string;
  window: string;
  pane: string;
}

export interface WorkerPosition {
  x: number;
  y: number;
}

export interface Worker {
  id: string;
  name: string;
  displayName?: string;
  projectId: string;
  projectPath: string;
  runtimeId: string;
  runtimeLabel: string;
  command: string[];
  status: WorkerStatus;
  activityText?: string;
  activityTool?: ActivityTool;
  activityPath?: string;
  avatarType: AvatarType;
  movementMode: MovementMode;
  position: WorkerPosition;
  tmuxRef: TmuxRef;
  createdAt: string;
  updatedAt: string;
}

interface WorkerSpawnPlacementInput {
  spawnNearWorkerIds?: string[];
}

export type WorkerSpawnInput =
  | ({ shortcutIndex: number } & WorkerSpawnPlacementInput)
  | ({ projectId: string; runtimeId: string; command?: string[] } & WorkerSpawnPlacementInput);

export type WsServerEvent =
  | { type: "init"; workers: Worker[]; config: ResolvedConfig }
  | { type: "worker-created"; worker: Worker }
  | { type: "worker-updated"; worker: Worker }
  | { type: "worker-removed"; workerId: string };
