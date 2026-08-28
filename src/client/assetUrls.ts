import type { AvatarType } from "../shared/types";

const charactersRoot = "/api/assets/characters";

/** URL for a character's static directional rotation sprite (e.g. the roster avatar). */
export function characterRotationUrl(avatarType: AvatarType, direction: string): string {
  return `${charactersRoot}/${encodeURIComponent(avatarType)}/rotations/${direction}.png`;
}

/** URL for a specific voice line file discovered in a character's voice-lines directory. */
export function voiceLineFileUrl(avatarType: AvatarType, fileName: string): string {
  return `${charactersRoot}/${encodeURIComponent(avatarType)}/voice-lines/${encodeURIComponent(fileName)}`;
}
