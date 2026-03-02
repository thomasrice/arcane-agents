import type { AvatarType, ProjectConfig, RuntimeConfig } from "../../../shared/types";

export interface SpawnPlan {
  projectId: string;
  project: ProjectConfig;
  runtimeId: string;
  runtime: RuntimeConfig;
  command: string[];
  displayName?: string;
  avatar?: AvatarType;
}

export interface SpawnAreaSpec {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface OutpostMapSpec {
  tileSize: number;
  spawnArea?: SpawnAreaSpec;
}
