#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ResolvedConfig } from "../shared/types";
import { bootstrap } from "./bootstrapApp";
import { getArcaneAgentsPaths, loadResolvedConfig } from "./config/loadConfig";
import { recommendTmuxInstall } from "./setup/prerequisites";
import { resolveAppPath, resolveAppRoot, setAppRoot } from "./utils/appRoot";
import { resolveUserPath } from "./utils/path";

type CheckStatus = "ok" | "warn" | "fail";

interface CheckResult {
  status: CheckStatus;
  label: string;
  detail: string;
}

function extractSessionFlag(args: string[]): { sessionName: string | undefined; remainingArgs: string[] } {
  const remaining = [...args];
  let sessionName: string | undefined;

  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i] === "--session" || remaining[i] === "-s") {
      const value = remaining[i + 1];
      if (!value || value.startsWith("-")) {
        console.error("[arcane-agents] --session requires a name argument.");
        process.exit(1);
      }
      sessionName = value;
      remaining.splice(i, 2);
      break;
    }

    const eqMatch = remaining[i].match(/^(?:--session|-s)=(.+)$/);
    if (eqMatch) {
      sessionName = eqMatch[1];
      remaining.splice(i, 1);
      break;
    }
  }

  if (sessionName !== undefined && !/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
    console.error("[arcane-agents] session name must only contain letters, digits, hyphens, and underscores.");
    process.exit(1);
  }

  return { sessionName, remainingArgs: remaining };
}

async function runCli(): Promise<number> {
  setAppRoot(resolveAppRoot());

  const { sessionName, remainingArgs: args } = extractSessionFlag(process.argv.slice(2));
  const firstArg = args[0];

  if (firstArg === "--help" || firstArg === "-h") {
    printHelp();
    return 0;
  }

  if (firstArg === "--version" || firstArg === "-v") {
    printVersion();
    return 0;
  }

  const [command = "start", ...commandArgs] = args;
  switch (command) {
    case "start":
      return runStart(sessionName);
    case "init":
      return runInit(commandArgs);
    case "setup":
      return runSetup(commandArgs);
    case "config":
      return runConfig(commandArgs);
    case "doctor":
      return runDoctor();
    case "sessions":
      return runSessions(commandArgs);
    case "help":
      printHelp();
      return 0;
    case "version":
      printVersion();
      return 0;
    default:
      console.error(`[arcane-agents] unknown command '${command}'.`);
      printHelp();
      return 1;
  }
}

async function runStart(sessionName?: string): Promise<number> {
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

  if (configResult.created) {
    console.log(`[arcane-agents] no config found; wrote starter config to ${paths.configPath}`);
    console.log("[arcane-agents] next: edit it with 'arcane-agents config edit'.");
  }

  await bootstrap(sessionName);
  return 0;
}

function runInit(args: string[]): number {
  const force = hasFlag(args, "--force") || hasFlag(args, "-f");
  const unknownArgs = args.filter((arg) => arg !== "--force" && arg !== "-f");

  if (unknownArgs.length > 0) {
    console.error(`[arcane-agents] unknown init options: ${unknownArgs.join(", ")}`);
    return 1;
  }

  const paths = getArcaneAgentsPaths();
  try {
    const result = writeStarterConfig(paths, { force });
    if (result.overwritten) {
      console.log(`[arcane-agents] overwrote ${paths.configPath}`);
    } else {
      console.log(`[arcane-agents] wrote ${paths.configPath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "config_exists") {
      console.error(`[arcane-agents] config already exists: ${paths.configPath}`);
      console.error("[arcane-agents] rerun with --force to overwrite it.");
      return 1;
    }

    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[arcane-agents] failed to initialize config: ${detail}`);
    return 1;
  }

  console.log("[arcane-agents] next: edit it with 'arcane-agents config edit'.");
  return 0;
}

async function runSetup(args: string[]): Promise<number> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printSetupHelp();
    return 0;
  }

  if (args.length > 0) {
    console.error(`[arcane-agents] unknown setup options: ${args.join(", ")}`);
    printSetupHelp();
    return 1;
  }

  console.log("[arcane-agents] setup");

  const tmuxPath = findExecutable("tmux");
  if (tmuxPath) {
    console.log(`[arcane-agents] tmux: ${tmuxPath}`);
  } else {
    const installRecommendation = recommendTmuxInstall({
      platform: process.platform,
      lookupCommand: findExecutable,
      isRootUser: process.getuid?.() === 0
    });

    console.log("[arcane-agents] tmux is required but was not found on PATH.");

    if (installRecommendation) {
      console.log(`[arcane-agents] suggested install (${installRecommendation.packageManager}): ${installRecommendation.command}`);
      if (installRecommendation.note) {
        console.log(`[arcane-agents] note: ${installRecommendation.note}`);
      }

      if (process.stdin.isTTY && process.stdout.isTTY) {
        const approved = await promptConfirm(`[arcane-agents] run that command now? [y/N] `);
        if (approved) {
          const exitCode = runShellCommand(installRecommendation.command);
          if (exitCode !== 0) {
            console.error(`[arcane-agents] install command failed with exit code ${exitCode}.`);
          }
        } else {
          console.log("[arcane-agents] skipped tmux install.");
        }
      } else {
        console.log("[arcane-agents] non-interactive terminal detected; not running install command automatically.");
      }
    } else {
      console.log("[arcane-agents] could not determine a package-manager command for tmux on this system.");
      if (process.platform === "win32") {
        console.log("[arcane-agents] run Arcane Agents inside WSL2 or another Unix-like environment, then install tmux there.");
      } else {
        console.log("[arcane-agents] install tmux manually, then rerun 'arcane-agents setup' or 'arcane-agents doctor'.");
      }
    }
  }

  const paths = getArcaneAgentsPaths();
  try {
    const configResult = ensureStarterConfig(paths);
    if (configResult.created) {
      console.log(`[arcane-agents] wrote starter config: ${paths.configPath}`);
    } else {
      console.log(`[arcane-agents] config: ${paths.configPath}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[arcane-agents] failed to prepare config: ${detail}`);
    return 1;
  }

  const doctorExitCode = runDoctor();
  if (doctorExitCode === 0) {
    console.log("[arcane-agents] next: edit your config if needed with 'arcane-agents config edit', then run 'arcane-agents'.");
  } else {
    console.log("[arcane-agents] fix the issues above, then rerun 'arcane-agents setup' or 'arcane-agents doctor'.");
  }

  return doctorExitCode;
}

function runConfig(args: string[]): number {
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

  if (configResult.created) {
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

interface WriteStarterConfigOptions {
  force: boolean;
}

interface WriteStarterConfigResult {
  created: boolean;
  overwritten: boolean;
}

function writeStarterConfig(
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
    throw new Error("config_exists");
  }

  fs.copyFileSync(templatePath, paths.configPath);

  return {
    created: !hasExistingConfig,
    overwritten: hasExistingConfig
  };
}

function ensureStarterConfig(paths: ReturnType<typeof getArcaneAgentsPaths>): WriteStarterConfigResult {
  try {
    return writeStarterConfig(paths, { force: false });
  } catch (error) {
    if (error instanceof Error && error.message === "config_exists") {
      return {
        created: false,
        overwritten: false
      };
    }

    throw error;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
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

async function runSessions(args: string[]): Promise<number> {
  const [subcommand = "list", ...subcommandArgs] = args;

  switch (subcommand) {
    case "list":
      break;
    case "delete":
      return runSessionsDelete(subcommandArgs);
    default:
      console.error(`[arcane-agents] unknown sessions command '${subcommand}'.`);
      console.log("Usage: arcane-agents sessions [list|delete <name>]");
      return 1;
  }

  const defaultPaths = getArcaneAgentsPaths();
  const sessionsDir = path.join(defaultPaths.stateDir, "sessions");
  const defaultDbPath = defaultPaths.dbPath;

  const sessions: string[] = [];

  if (fs.existsSync(defaultDbPath)) {
    sessions.push("default");
  }

  if (fs.existsSync(sessionsDir)) {
    try {
      const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dbPath = path.join(sessionsDir, entry.name, "arcane-agents.db");
          if (fs.existsSync(dbPath)) {
            sessions.push(entry.name);
          }
        }
      }
    } catch {
      // no-op
    }
  }

  if (sessions.length === 0) {
    console.log("[arcane-agents] no sessions found.");
  } else {
    console.log("[arcane-agents] sessions:");
    for (const session of sessions) {
      console.log(`  ${session}`);
    }
  }

  return 0;
}

async function runSessionsDelete(args: string[]): Promise<number> {
  const name = args[0];
  if (!name) {
    console.error("[arcane-agents] usage: arcane-agents sessions delete <name>");
    return 1;
  }

  if (name === "default") {
    console.error("[arcane-agents] cannot delete the default session.");
    return 1;
  }

  const sessionDir = getArcaneAgentsPaths(name).stateDir;
  if (!fs.existsSync(sessionDir)) {
    console.error(`[arcane-agents] session '${name}' not found.`);
    return 1;
  }

  const answer = await promptConfirm(`Delete session '${name}' and all its data (${sessionDir})? [y/N] `);
  if (!answer) {
    console.log("[arcane-agents] aborted.");
    return 0;
  }

  fs.rmSync(sessionDir, { recursive: true, force: true });
  console.log(`[arcane-agents] deleted session '${name}'.`);
  return 0;
}

function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function runDoctor(): number {
  const checks: CheckResult[] = [];

  const nodeVersion = process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "0", 10);
  if (nodeMajor >= 20) {
    checks.push({ status: "ok", label: "Node.js", detail: `v${nodeVersion}` });
  } else {
    checks.push({ status: "fail", label: "Node.js", detail: `v${nodeVersion} (requires >= 20)` });
  }

  const tmuxPath = findExecutable("tmux");
  if (tmuxPath) {
    checks.push({ status: "ok", label: "tmux", detail: tmuxPath });
  } else {
    const installRecommendation = recommendTmuxInstall({
      platform: process.platform,
      lookupCommand: findExecutable,
      isRootUser: process.getuid?.() === 0
    });
    checks.push({
      status: "fail",
      label: "tmux",
      detail: installRecommendation
        ? `not found on PATH (install with: ${installRecommendation.command})`
        : "not found on PATH"
    });
  }

  const paths = getArcaneAgentsPaths();
  if (fs.existsSync(paths.configPath)) {
    checks.push({ status: "ok", label: "Config", detail: paths.configPath });
  } else {
    checks.push({
      status: "warn",
      label: "Config",
      detail: `missing at ${paths.configPath} (auto-created on 'arcane-agents start' or 'arcane-agents setup')`
    });
  }

  const configResult = safeLoadConfig(paths);
  checks.push(...configResult.checks);

  if (process.platform === "linux") {
    const xdgTerminalExecPath = findExecutable("xdg-terminal-exec");
    if (xdgTerminalExecPath) {
      checks.push({ status: "ok", label: "xdg-terminal-exec", detail: xdgTerminalExecPath });
    } else {
      checks.push({
        status: "warn",
        label: "xdg-terminal-exec",
        detail: "optional dependency for external terminal button"
      });
    }
  }

  printDoctorReport(checks);
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

function safeLoadConfig(paths: ReturnType<typeof getArcaneAgentsPaths>): { checks: CheckResult[] } {
  const checks: CheckResult[] = [];
  let config: ResolvedConfig;

  try {
    config = loadResolvedConfig(paths);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown config load error";
    checks.push({ status: "fail", label: "Config parse", detail: `${paths.configPath}: ${detail}` });
    return { checks };
  }

  checks.push({
    status: "ok",
    label: "Config parse",
    detail: `${Object.keys(config.projects).length} projects, ${Object.keys(config.runtimes).length} runtimes`
  });

  const runtimeCommandResults = checkRuntimeCommands(config);
  checks.push(...runtimeCommandResults.checks);
  return { checks };
}

function checkRuntimeCommands(config: ResolvedConfig): { checks: CheckResult[] } {
  const checks: CheckResult[] = [];
  let availableRuntimeCount = 0;

  for (const [runtimeId, runtime] of Object.entries(config.runtimes)) {
    const executable = runtime.command[0];
    const executablePath = findExecutable(executable);

    if (executablePath) {
      availableRuntimeCount += 1;
      checks.push({
        status: "ok",
        label: `Runtime ${runtimeId}`,
        detail: `${executable} -> ${executablePath}`
      });
    } else {
      checks.push({
        status: "warn",
        label: `Runtime ${runtimeId}`,
        detail: `${executable} not found on PATH`
      });
    }
  }

  if (availableRuntimeCount > 0) {
    checks.push({
      status: "ok",
      label: "Runtime availability",
      detail: `${availableRuntimeCount} runtime command(s) available`
    });
  } else {
    checks.push({
      status: "fail",
      label: "Runtime availability",
      detail: "no configured runtime commands found on PATH"
    });
  }

  return { checks };
}

function printDoctorReport(checks: CheckResult[]): void {
  console.log("[arcane-agents] doctor report");
  for (const check of checks) {
    console.log(`[${check.status}] ${check.label}: ${check.detail}`);
  }

  const hasFailure = checks.some((check) => check.status === "fail");
  if (hasFailure) {
    console.log("[arcane-agents] doctor found blocking issues.");
  } else {
    console.log("[arcane-agents] doctor passed.");
  }
}

function printHelp(): void {
  const paths = getArcaneAgentsPaths();

  console.log(`Arcane Agents CLI

Usage:
  arcane-agents [start] [--session <name>]
  arcane-agents init [--force]
  arcane-agents setup
  arcane-agents config [path|show|edit]
  arcane-agents sessions [list|delete <name>]
  arcane-agents doctor
  arcane-agents --help
  arcane-agents --version

Commands:
  start      Start the Arcane Agents server
  init       Write ~/.config/arcane-agents/config.yaml from config.example.yaml
  setup      Guided first-run setup for tmux, config, and dependency checks
  config     Print, show, or edit config files
  sessions   List or delete named sessions
  doctor     Check dependencies and runtime command availability
  help       Show this help message
  version    Print CLI version

Options:
  --session <name>, -s <name>
             Run with a named session (separate DB and tmux session).
             Default session uses the standard paths for backwards compatibility.

Config paths:
  primary: ${paths.configPath}
  local override: ${paths.localOverridePath}
`);
}

function printSetupHelp(): void {
  console.log(`Arcane Agents setup

Usage:
  arcane-agents setup

What it does:
  - checks whether tmux is installed
  - suggests a platform-specific tmux install command
  - can run that command after confirmation in an interactive terminal
  - ensures ~/.config/arcane-agents/config.yaml exists
  - runs 'arcane-agents doctor'
`);
}

function printVersion(): void {
  console.log(readPackageVersion());
}

function readPackageVersion(): string {
  const packageJsonPath = resolveAppPath("package.json");

  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<{ version: unknown }>;
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version;
    }
  } catch {
    // no-op
  }

  return "0.0.0";
}

function findExecutable(commandToken: string): string | undefined {
  if (!commandToken || commandToken.trim().length === 0) {
    return undefined;
  }

  const token = commandToken.trim();
  if (looksLikePathToken(token)) {
    const resolvedPath = resolvePathToken(token);
    return isExecutableFile(resolvedPath) ? resolvedPath : undefined;
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of pathEntries) {
    const candidate = path.join(entry, token);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }

    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function looksLikePathToken(token: string): boolean {
  return token.includes(path.sep) || token.startsWith(".") || token.startsWith("~");
}

function resolvePathToken(token: string): string {
  if (token.startsWith("~")) {
    return resolveUserPath(token);
  }

  return path.resolve(token);
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function runShellCommand(command: string): number {
  const result = spawnSync("sh", ["-lc", command], {
    stdio: "inherit"
  });

  if (result.error) {
    const detail = result.error.message;
    console.error(`[arcane-agents] failed to launch shell command '${command}': ${detail}`);
    return 1;
  }

  return result.status ?? 1;
}

void runCli()
  .then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  })
  .catch((error: unknown) => {
    console.error("[arcane-agents] fatal startup error", error);
    process.exitCode = 1;
  });
