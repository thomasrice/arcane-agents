#!/usr/bin/env node

import fs from "node:fs";
import { getArcaneAgentsPaths } from "./config/loadConfig";
import { runConfig } from "./cli/commands/config";
import { runDoctor } from "./cli/commands/doctor";
import { runInit } from "./cli/commands/init";
import { runSessions } from "./cli/commands/sessions";
import { runSetup } from "./cli/commands/setup";
import { runStart } from "./cli/commands/start";
import { resolveAppPath, resolveAppRoot, setAppRoot } from "./utils/appRoot";

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
