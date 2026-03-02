import { randomUUID } from "node:crypto";
import path from "node:path";

export function withClaudeSessionId(runtimeId: string, command: string[]): string[] {
  const commandCopy = [...command];
  if (!looksLikeClaudeRuntime(runtimeId, commandCopy)) {
    return commandCopy;
  }

  if (hasSessionIdArg(commandCopy)) {
    return commandCopy;
  }

  return [...commandCopy, "--session-id", randomUUID()];
}

export function looksLikeClaudeRuntime(runtimeId: string, command: string[]): boolean {
  if (runtimeId.toLowerCase().includes("claude")) {
    return true;
  }

  const binary = path.basename(command[0] ?? "").toLowerCase();
  return binary.includes("claude");
}

export function hasSessionIdArg(command: string[]): boolean {
  for (let index = 0; index < command.length; index += 1) {
    const token = command[index] ?? "";
    if (token === "--session-id") {
      const nextValue = command[index + 1];
      return typeof nextValue === "string" && nextValue.trim().length > 0;
    }

    if (token.startsWith("--session-id=")) {
      const value = token.slice("--session-id=".length).trim();
      return value.length > 0;
    }
  }

  return false;
}
