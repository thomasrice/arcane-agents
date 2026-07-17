import { getArcaneAgentsPaths } from "../../config/loadConfig";
import { hasFlag } from "../args";
import { writeStarterConfig, type WriteStarterConfigResult } from "../starterConfig";

export function runInit(args: string[]): number {
  const force = hasFlag(args, "--force") || hasFlag(args, "-f");
  const unknownArgs = args.filter((arg) => arg !== "--force" && arg !== "-f");

  if (unknownArgs.length > 0) {
    console.error(`[arcane-agents] unknown init options: ${unknownArgs.join(", ")}`);
    return 1;
  }

  const paths = getArcaneAgentsPaths();
  let result: WriteStarterConfigResult;
  try {
    result = writeStarterConfig(paths, { force });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[arcane-agents] failed to initialize config: ${detail}`);
    return 1;
  }

  if (result.outcome === "exists") {
    console.error(`[arcane-agents] config already exists: ${paths.configPath}`);
    console.error("[arcane-agents] rerun with --force to overwrite it.");
    return 1;
  }

  if (result.outcome === "overwritten") {
    console.log(`[arcane-agents] overwrote ${paths.configPath}`);
  } else {
    console.log(`[arcane-agents] wrote ${paths.configPath}`);
  }

  console.log("[arcane-agents] next: edit it with 'arcane-agents config edit'.");
  return 0;
}
