import fs from "node:fs";
import path from "node:path";

const requiredAvatarFiles = [
  "rotations/south.png",
  "rotations/east.png",
  "rotations/north.png",
  "rotations/west.png",
  "animations/walk/south/0.png",
  "animations/working/0.png"
] as const;

export function listAvailableAvatarTypes(assetsRoot = path.resolve(process.cwd(), "assets/characters")): string[] {
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(assetsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.trim())
    .filter((avatarType) => avatarType.length > 0)
    .filter((avatarType) => hasRequiredAvatarFiles(assetsRoot, avatarType))
    .sort((a, b) => a.localeCompare(b));
}

export function hasRequiredAvatarFiles(assetsRoot: string, avatarType: string): boolean {
  return requiredAvatarFiles.every((relativeFilePath) => {
    return fs.existsSync(path.join(assetsRoot, avatarType, relativeFilePath));
  });
}
