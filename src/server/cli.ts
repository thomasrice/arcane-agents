#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../shared/types";
import { bootstrap } from "./bootstrapApp";
import { getArcaneAgentsPaths, loadResolvedConfig } from "./config/loadConfig";
import { resolveAppPath, resolveAppRoot, setAppRoot } from "./utils/appRoot";
import { resolveUserPath } from "./utils/path";

type CheckStatus = "ok" | "warn" | "fail";

interface CheckResult {
  status: CheckStatus;
  label: string;
  detail: string;
}

async function runCli(): Promise<number> {
  setAppRoot(resolveAppRoot());

  const args = process.argv.slice(2);
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printHelp();
    return 0;
  }

  if (hasFlag(args, "--version") || hasFlag(args, "-v")) {
    printVersion();
    return 0;
  }

  const [command = "start", ...commandArgs] = args;
  switch (command) {
    case "start":
      return runStart();
    case "init":
      return runInit(commandArgs);
    case "doctor":
      return runDoctor();
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

async function runStart(): Promise<number> {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "production";
  }

  await bootstrap();
  return 0;
}

function runInit(args: string[]): number {
  const force = hasFlag(args, "--force") || hasFlag(args, "-f");
  const unknownArgs = args.filter((arg) => arg !== "--force" && arg !== "-f");

  if (unknownArgs.length > 0) {
    console.error(`[arcane-agents] unknown init options: ${unknownArgs.join(", ")}`);
    return 1;
  }

  const templatePath = resolveAppPath("config.example.yaml");
  if (!fs.existsSync(templatePath)) {
    console.error(`[arcane-agents] missing template config at ${templatePath}`);
    return 1;
  }

  const paths = getArcaneAgentsPaths();
  fs.mkdirSync(paths.configDir, { recursive: true });

  const hasExistingConfig = fs.existsSync(paths.configPath);
  if (hasExistingConfig && !force) {
    console.error(`[arcane-agents] config already exists: ${paths.configPath}`);
    console.error("[arcane-agents] rerun with --force to overwrite it.");
    return 1;
  }

  fs.copyFileSync(templatePath, paths.configPath);

  if (hasExistingConfig) {
    console.log(`[arcane-agents] overwrote ${paths.configPath}`);
  } else {
    console.log(`[arcane-agents] wrote ${paths.configPath}`);
  }

  console.log("[arcane-agents] next: edit project paths and runtime commands in your config.");
  return 0;
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
    checks.push({ status: "fail", label: "tmux", detail: "not found on PATH" });
  }

  const paths = getArcaneAgentsPaths();
  if (fs.existsSync(paths.configPath)) {
    checks.push({ status: "ok", label: "Config", detail: paths.configPath });
  } else {
    checks.push({
      status: "warn",
      label: "Config",
      detail: `missing at ${paths.configPath} (run 'arcane-agents init')`
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
  console.log(`Arcane Agents CLI

Usage:
  arcane-agents [start]
  arcane-agents init [--force]
  arcane-agents doctor
  arcane-agents --help
  arcane-agents --version

Commands:
  start      Start the Arcane Agents server
  init       Write ~/.config/arcane-agents/config.yaml from config.example.yaml
  doctor     Check dependencies and runtime command availability
  help       Show this help message
  version    Print CLI version
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
