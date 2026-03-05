import fs from "node:fs";
import path from "node:path";
import { resolveAppPath } from "../utils/appRoot";

const voiceLineExtension = ".mp3";

export function listAvatarVoiceLineFiles(
  avatarType: string,
  assetsRoot = resolveAppPath("assets", "characters")
): string[] {
  const voiceLinesDir = resolveVoiceLinesDir(assetsRoot, avatarType);
  if (!voiceLinesDir) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(voiceLinesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.trim())
    .filter((name) => name.length > 0)
    .filter((name) => name.toLowerCase().endsWith(voiceLineExtension))
    .sort((a, b) => a.localeCompare(b));
}

function resolveVoiceLinesDir(assetsRoot: string, avatarType: string): string | null {
  const trimmedAvatarType = avatarType.trim();
  if (trimmedAvatarType.length === 0) {
    return null;
  }

  const absoluteAssetsRoot = path.resolve(assetsRoot);
  const absoluteVoiceLinesDir = path.resolve(absoluteAssetsRoot, trimmedAvatarType, "voice-lines");
  const expectedPrefix = `${absoluteAssetsRoot}${path.sep}`;

  if (!absoluteVoiceLinesDir.startsWith(expectedPrefix)) {
    return null;
  }

  return absoluteVoiceLinesDir;
}
