import fs from "node:fs";
import { getArcaneAgentsPaths } from "../config/loadConfig";
import { resolveAppPath } from "../utils/appRoot";

interface WriteStarterConfigOptions {
  force: boolean;
}

/**
 * Outcome of a starter-config write attempt.
 *
 * - `written`: the config was created (no file existed).
 * - `overwritten`: an existing config was replaced because `force` was set.
 * - `exists`: an existing config was left untouched because `force` was not set.
 *
 * This replaces the previous `throw new Error("config_exists")` string protocol; the
 * "already exists" case is now a value callers branch on rather than a message they match.
 */
export type WriteStarterConfigResult =
  | { outcome: "written" }
  | { outcome: "overwritten" }
  | { outcome: "exists" };

export function writeStarterConfig(
  paths: ReturnType<typeof getArcaneAgentsPaths>,
  options: WriteStarterConfigOptions
): WriteStarterConfigResult {
  const templatePath = resolveAppPath("config.example.yaml");
  if (!fs.existsSync(templatePath)) {
    throw new Error(`missing template config at ${templatePath}`);
  }

  fs.mkdirSync(paths.configDir, { recursive: true });

  const hasExistingConfig = fs.existsSync(paths.configPath);
  if (hasExistingConfig && !options.force) {
    return { outcome: "exists" };
  }

  fs.copyFileSync(templatePath, paths.configPath);

  return { outcome: hasExistingConfig ? "overwritten" : "written" };
}

export function ensureStarterConfig(paths: ReturnType<typeof getArcaneAgentsPaths>): WriteStarterConfigResult {
  return writeStarterConfig(paths, { force: false });
}
