import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { getArcaneAgentsPaths } from "../../config/loadConfig";
import { shellQuote } from "../../platform/shell";
import { hasFlag } from "../args";
import { ensureStarterConfig, type WriteStarterConfigResult } from "../starterConfig";

export function runConfig(args: string[]): number {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printConfigHelp();
    return 0;
  }

  const [subcommand = "path", ...subcommandArgs] = args;

  switch (subcommand) {
    case "path":
      return runConfigPath(subcommandArgs);
    case "show":
      return runConfigShow(subcommandArgs);
    case "edit":
      return runConfigEdit(subcommandArgs);
    case "help":
      printConfigHelp();
      return 0;
    default:
      console.error(`[arcane-agents] unknown config command '${subcommand}'.`);
      printConfigHelp();
      return 1;
  }
}

function runConfigPath(args: string[]): number {
  if (args.length > 0) {
    console.error(`[arcane-agents] unknown config path options: ${args.join(", ")}`);
    return 1;
  }

  const paths = getArcaneAgentsPaths();
  console.log(`[arcane-agents] config: ${paths.configPath}`);
  console.log(`[arcane-agents] local override: ${paths.localOverridePath}`);
  return 0;
}

function runConfigShow(args: string[]): number {
  if (args.length > 0) {
    console.error(`[arcane-agents] unknown config show options: ${args.join(", ")}`);
    return 1;
  }

  const paths = getArcaneAgentsPaths();
  if (!fs.existsSync(paths.configPath)) {
    console.error(`[arcane-agents] config file not found: ${paths.configPath}`);
    console.error("[arcane-agents] run 'arcane-agents start' to auto-create it or 'arcane-agents init'.");
    return 1;
  }

  const raw = fs.readFileSync(paths.configPath, "utf8");
  process.stdout.write(raw);
  if (!raw.endsWith("\n")) {
    process.stdout.write("\n");
  }
  return 0;
}

function runConfigEdit(args: string[]): number {
  if (args.length > 0) {
    console.error(`[arcane-agents] unknown config edit options: ${args.join(", ")}`);
    return 1;
  }

  const paths = getArcaneAgentsPaths();
  let configResult: WriteStarterConfigResult;
  try {
    configResult = ensureStarterConfig(paths);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[arcane-agents] failed to prepare config: ${detail}`);
    return 1;
  }

  if (configResult.outcome === "written") {
    console.log(`[arcane-agents] wrote starter config: ${paths.configPath}`);
  }

  const editor = (process.env.VISUAL ?? process.env.EDITOR ?? "").trim();
  if (editor.length === 0) {
    console.error("[arcane-agents] no editor configured.");
    console.error("[arcane-agents] set $VISUAL or $EDITOR, then rerun 'arcane-agents config edit'.");
    console.error(`[arcane-agents] config file: ${paths.configPath}`);
    return 1;
  }

  const editCommand = `${editor} ${shellQuote(paths.configPath)}`;
  const result = spawnSync("sh", ["-lc", editCommand], {
    stdio: "inherit"
  });

  if (result.error) {
    const detail = result.error.message;
    console.error(`[arcane-agents] failed to launch editor '${editor}': ${detail}`);
    return 1;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    return result.status;
  }

  return 0;
}

function printConfigHelp(): void {
  const paths = getArcaneAgentsPaths();

  console.log(`Arcane Agents config commands

Usage:
  arcane-agents config [path]
  arcane-agents config show
  arcane-agents config edit
  arcane-agents config help

Commands:
  path      Print config file locations
  show      Print ${paths.configPath}
  edit      Open ${paths.configPath} in $VISUAL or $EDITOR
  help      Show this config help message
`);
}
