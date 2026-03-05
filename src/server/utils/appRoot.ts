import fs from "node:fs";
import path from "node:path";

const appRootEnvKey = "ARCANE_AGENTS_APP_ROOT";

function isLikelyAppRoot(candidateRoot: string): boolean {
  return (
    fs.existsSync(path.join(candidateRoot, "package.json")) &&
    fs.existsSync(path.join(candidateRoot, "assets"))
  );
}

export function resolveAppRoot(): string {
  const envRoot = process.env[appRootEnvKey];
  if (envRoot && envRoot.trim().length > 0) {
    return path.resolve(envRoot);
  }

  const candidates = [
    path.resolve(__dirname, "../../.."),
    path.resolve(__dirname, "../../../.."),
    path.resolve(process.cwd())
  ];

  for (const candidate of candidates) {
    if (isLikelyAppRoot(candidate)) {
      return candidate;
    }
  }

  return path.resolve(process.cwd());
}

export function setAppRoot(appRoot: string): string {
  const resolved = path.resolve(appRoot);
  process.env[appRootEnvKey] = resolved;
  return resolved;
}

export function resolveAppPath(...segments: string[]): string {
  return path.join(resolveAppRoot(), ...segments);
}
