import fs from "node:fs";
import path from "node:path";
import { getArcaneAgentsPaths } from "../../config/loadConfig";
import { promptConfirm } from "../prompts";

export async function runSessions(args: string[]): Promise<number> {
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
          const dbPath = getArcaneAgentsPaths(entry.name).dbPath;
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
