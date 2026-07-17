import { bootstrap } from "../../bootstrapApp";
import { getArcaneAgentsPaths } from "../../config/loadConfig";
import { ensureStarterConfig, type WriteStarterConfigResult } from "../starterConfig";

export async function runStart(sessionName?: string): Promise<number> {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "production";
  }

  const paths = getArcaneAgentsPaths(sessionName);
  let configResult: WriteStarterConfigResult;
  try {
    configResult = ensureStarterConfig(paths);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[arcane-agents] failed to prepare config: ${detail}`);
    return 1;
  }

  if (configResult.outcome === "written") {
    console.log(`[arcane-agents] no config found; wrote starter config to ${paths.configPath}`);
    console.log("[arcane-agents] next: edit it with 'arcane-agents config edit'.");
  }

  await bootstrap(sessionName);
  return 0;
}
