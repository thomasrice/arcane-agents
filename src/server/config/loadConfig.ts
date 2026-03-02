import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ResolvedConfig } from "../../shared/types";
import { partialConfigSchema, resolvedConfigSchema, createDefaultConfig } from "./schema";
import { resolveUserPath } from "../utils/path";

interface OverworldPaths {
  configDir: string;
  configPath: string;
  localOverridePath: string;
  stateDir: string;
  dbPath: string;
  cacheDir: string;
}

type JsonObject = Record<string, unknown>;

export function getOverworldPaths(): OverworldPaths {
  const configDir = resolveUserPath("~/.config/overworld");
  const stateDir = resolveUserPath("~/.local/state/overworld");

  return {
    configDir,
    configPath: path.join(configDir, "config.yaml"),
    localOverridePath: path.join(configDir, "config.local.yaml"),
    stateDir,
    dbPath: path.join(stateDir, "overworld.db"),
    cacheDir: resolveUserPath("~/.cache/overworld")
  };
}

export function loadResolvedConfig(paths = getOverworldPaths()): ResolvedConfig {
  const defaults = createDefaultConfig();
  const userConfig = readConfigFile(paths.configPath);
  const localOverride = readConfigFile(paths.localOverridePath);

  const merged = deepMerge(deepMerge(defaults as unknown as JsonObject, userConfig), localOverride);
  const parsed = resolvedConfigSchema.parse(merged) as ResolvedConfig;

  const normalizedProjects = Object.fromEntries(
    Object.entries(parsed.projects).map(([projectId, project]) => [
      projectId,
      {
        ...project,
        path: resolveUserPath(project.path),
        source: project.source ?? "config"
      }
    ])
  );

  const normalizedDiscovery = parsed.discovery.map((rule) => ({
    ...rule,
    path: resolveUserPath(rule.path)
  }));

  const finalConfig: ResolvedConfig = {
    ...parsed,
    projects: normalizedProjects,
    discovery: normalizedDiscovery
  };

  validateReferences(finalConfig);

  return finalConfig;
}

function readConfigFile(filePath: string): JsonObject {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return {};
  }

  const parsedYaml = YAML.parse(raw);
  const validated = partialConfigSchema.parse(parsedYaml);
  return validated as JsonObject;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(baseValue: unknown, overrideValue: unknown): unknown {
  if (Array.isArray(baseValue) && Array.isArray(overrideValue)) {
    return [...overrideValue];
  }

  if (isRecord(baseValue) && isRecord(overrideValue)) {
    const result: JsonObject = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      result[key] = key in result ? deepMerge(result[key], value) : value;
    }
    return result;
  }

  return overrideValue === undefined ? baseValue : overrideValue;
}

function validateReferences(config: ResolvedConfig): void {
  for (const shortcut of config.shortcuts) {
    if (!config.projects[shortcut.project]) {
      throw new Error(`Shortcut '${shortcut.label}' references unknown project '${shortcut.project}'.`);
    }

    if (!config.runtimes[shortcut.runtime]) {
      throw new Error(`Shortcut '${shortcut.label}' references unknown runtime '${shortcut.runtime}'.`);
    }
  }
}
