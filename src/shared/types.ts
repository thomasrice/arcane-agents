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
  icon?: string;
  avatar?: AvatarType;
}

export interface ProfileConfig {
  project: string;
  runtime: string;
  label: string;
  command?: string[];
  avatar?: AvatarType;
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
  profiles: Record<string, ProfileConfig>;
  discovery: DiscoveryRule[];
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
  profileId?: string;
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

export type WorkerSpawnInput =
  | { shortcutIndex: number }
  | { profileId: string }
  | { projectId: string; runtimeId: string; command?: string[] };

export type WsServerEvent =
  | { type: "init"; workers: Worker[]; config: ResolvedConfig }
  | { type: "worker-created"; worker: Worker }
  | { type: "worker-updated"; worker: Worker }
  | { type: "worker-removed"; workerId: string };
