import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ResolvedConfig } from "../../shared/types";
import { partialConfigSchema, resolvedConfigSchema, createDefaultConfig } from "./schema";
import { resolveUserPath } from "../utils/path";

interface ArcaneAgentsPaths {
  configDir: string;
  configPath: string;
  localOverridePath: string;
  stateDir: string;
  dbPath: string;
  cacheDir: string;
}

type JsonObject = Record<string, unknown>;

export function getArcaneAgentsPaths(): ArcaneAgentsPaths {
  const configDir = resolveUserPath("~/.config/arcane-agents");
  const stateDir = resolveUserPath("~/.local/state/arcane-agents");

  return {
    configDir,
    configPath: path.join(configDir, "config.yaml"),
    localOverridePath: path.join(configDir, "config.local.yaml"),
    stateDir,
    dbPath: path.join(stateDir, "arcane-agents.db"),
    cacheDir: resolveUserPath("~/.cache/arcane-agents")
  };
}

export function loadResolvedConfig(paths = getArcaneAgentsPaths()): ResolvedConfig {
  const defaults = createDefaultConfig();
  const userConfig = readConfigFile(paths.configPath);
  const localOverride = readConfigFile(paths.localOverridePath);

  const merged = deepMerge(deepMerge(defaults as unknown as JsonObject, userConfig), localOverride);
  applyExtraInteractiveCommands(merged as JsonObject);
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

  const normalizedShortcutConfig = normalizeShortcutProjectReferences(finalConfig);
  validateReferences(normalizedShortcutConfig);

  return normalizedShortcutConfig;
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

function normalizeShortcutProjectReferences(config: ResolvedConfig): ResolvedConfig {
  const projectIdsByShortName = new Map<string, string[]>();
  for (const [projectId, project] of Object.entries(config.projects)) {
    const existing = projectIdsByShortName.get(project.shortName);
    if (existing) {
      existing.push(projectId);
    } else {
      projectIdsByShortName.set(project.shortName, [projectId]);
    }
  }

  const normalizedShortcuts = config.shortcuts.map((shortcut) => {
    if (config.projects[shortcut.project]) {
      return shortcut;
    }

    const projectIdMatches = projectIdsByShortName.get(shortcut.project);
    if (!projectIdMatches || projectIdMatches.length === 0) {
      return shortcut;
    }

    if (projectIdMatches.length > 1) {
      throw new Error(
        `Shortcut '${shortcut.label}' references project '${shortcut.project}', but that shortName is ambiguous (${projectIdMatches.join(", ")}). Use an explicit project id.`
      );
    }

    return {
      ...shortcut,
      project: projectIdMatches[0]
    };
  });

  return {
    ...config,
    shortcuts: normalizedShortcuts
  };
}

function applyExtraInteractiveCommands(merged: JsonObject): void {
  const status = merged.status;
  if (!isRecord(status)) {
    return;
  }

  const extra = status.extraInteractiveCommands;
  if (!Array.isArray(extra) || extra.length === 0) {
    return;
  }

  const base = Array.isArray(status.interactiveCommands) ? status.interactiveCommands : [];
  status.interactiveCommands = [...new Set([...base, ...extra])];
  delete status.extraInteractiveCommands;
}
