import type { AvatarType, ProjectConfig, RuntimeConfig } from "../../../shared/types";
import type { OutpostSpawnArea } from "../../../shared/mapSpec";

export interface SpawnPlan {
  projectId: string;
  project: ProjectConfig;
  runtimeId: string;
  runtime: RuntimeConfig;
  command: string[];
  displayName?: string;
  avatar?: AvatarType;
}

/**
 * Normalised view of the outpost map used by the spawn planner. Derived from
 * {@link RawOutpostMap} by `loadOutpostSpawnSpec`, which leaves `width`/`height`
 * undefined when the file omits or malforms them.
 */
export interface OutpostMapSpec {
  width?: number;
  height?: number;
  tileSize: number;
  spawnArea?: OutpostSpawnArea;
}
