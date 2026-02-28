import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import type { DiscoveryRule, ProjectConfig, ResolvedConfig } from "../../shared/types";

const execFileAsync = promisify(execFile);

export interface DiscoveryResult {
  projects: Record<string, ProjectConfig>;
  warnings: string[];
}

export class DiscoveryService {
  async discover(config: ResolvedConfig): Promise<DiscoveryResult> {
    const discovered: Record<string, ProjectConfig> = {};
    const warnings: string[] = [];
    const knownProjectIds = new Set(Object.keys(config.projects));
    const knownPaths = new Set(Object.values(config.projects).map((project) => path.resolve(project.path)));

    for (const rule of config.discovery) {
      let candidatePaths: string[] = [];

      try {
        if (rule.type === "worktrees") {
          candidatePaths = await discoverWorktrees(rule);
        } else if (rule.type === "directories") {
          candidatePaths = await discoverDirectories(rule);
        } else if (rule.type === "glob") {
          candidatePaths = await discoverGlobs(rule);
        }
      } catch (error) {
        warnings.push(`Discovery rule '${rule.name}' failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      for (const candidatePath of candidatePaths) {
        const normalizedPath = path.resolve(candidatePath);
        if (knownPaths.has(normalizedPath)) {
          continue;
        }

        const basename = path.basename(normalizedPath);
        const projectId = nextProjectId(knownProjectIds, basename);
        const shortName = toShortName(basename, projectId);

        discovered[projectId] = {
          path: normalizedPath,
          shortName,
          label: basename,
          source: "discovered"
        };

        knownProjectIds.add(projectId);
        knownPaths.add(normalizedPath);
      }
    }

    return {
      projects: discovered,
      warnings
    };
  }
}

async function discoverWorktrees(rule: DiscoveryRule): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["-C", rule.path, "worktree", "list", "--porcelain"], {
    maxBuffer: 1024 * 1024
  });

  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("worktree ")) {
      continue;
    }
    const worktreePath = line.slice("worktree ".length).trim();
    if (worktreePath.length > 0) {
      paths.push(worktreePath);
    }
  }

  return uniqueSortedPaths(paths);
}

async function discoverDirectories(rule: DiscoveryRule): Promise<string[]> {
  const rootEntries = await fs.readdir(rule.path, { withFileTypes: true });
  const maxDepth = rule.maxDepth ?? 1;
  const exclude = new Set((rule.exclude ?? []).map((entry) => entry.toLowerCase()));
  const matchValue = rule.match;

  const queue: Array<{ dirPath: string; depth: number }> = [];
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (exclude.has(entry.name.toLowerCase())) {
      continue;
    }

    queue.push({
      dirPath: path.join(rule.path, entry.name),
      depth: 1
    });
  }

  const matches: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }

    if (!matchValue || (await pathExists(path.join(next.dirPath, matchValue)))) {
      matches.push(next.dirPath);
    }

    if (next.depth >= maxDepth) {
      continue;
    }

    const childEntries = await fs.readdir(next.dirPath, { withFileTypes: true }).catch(() => []);
    for (const child of childEntries) {
      if (!child.isDirectory()) {
        continue;
      }

      if (exclude.has(child.name.toLowerCase())) {
        continue;
      }

      queue.push({
        dirPath: path.join(next.dirPath, child.name),
        depth: next.depth + 1
      });
    }
  }

  return uniqueSortedPaths(matches);
}

async function discoverGlobs(rule: DiscoveryRule): Promise<string[]> {
  const matches = await fg(rule.path, {
    onlyDirectories: true,
    absolute: true,
    unique: true,
    suppressErrors: true
  });

  return uniqueSortedPaths(matches);
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

function uniqueSortedPaths(paths: string[]): string[] {
  return [...new Set(paths.map((value) => path.resolve(value)))].sort();
}

function nextProjectId(knownProjectIds: Set<string>, sourceName: string): string {
  const base = slugify(sourceName);

  if (!knownProjectIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (knownProjectIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

function toShortName(sourceName: string, fallback: string): string {
  const slug = slugify(sourceName || fallback);
  return slug.slice(0, 8) || "proj";
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "project";
}
