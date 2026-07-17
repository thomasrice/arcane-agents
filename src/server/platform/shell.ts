import fs from "node:fs";
import path from "node:path";
import { resolveUserPath } from "../utils/path";

export function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function findExecutable(commandToken: string): string | undefined {
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
