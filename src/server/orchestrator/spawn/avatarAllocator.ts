import type { AvatarType, ResolvedConfig, Worker } from "../../../shared/types";

interface SelectNextAvatarInput {
  preferred?: AvatarType;
  config: ResolvedConfig;
  workers: Worker[];
  availableAvatars: AvatarType[];
}

export function selectNextAvatar({ preferred, config, workers, availableAvatars }: SelectNextAvatarInput): AvatarType {
  const disabledAvatarTypes = new Set(config.avatars.disabled);
  const enabledAvailableAvatars = availableAvatars.filter((avatarType) => !disabledAvatarTypes.has(avatarType));

  if (preferred && enabledAvailableAvatars.includes(preferred)) {
    return preferred;
  }

  const pool = enabledAvailableAvatars.length > 0 ? enabledAvailableAvatars : availableAvatars.length > 0 ? availableAvatars : ["knight"];
  const reservedConfiguredAvatars = new Set(
    config.shortcuts
      .map((shortcut) => shortcut.avatar)
      .filter((avatarType): avatarType is AvatarType => Boolean(avatarType && pool.includes(avatarType)))
  );
  const randomPool = pool.filter((avatarType) => !reservedConfiguredAvatars.has(avatarType));
  const eligiblePool = randomPool.length > 0 ? randomPool : pool;
  const activeAvatars = new Set(
    workers.filter((worker) => worker.status !== "stopped").map((worker) => worker.avatarType)
  );

  const unusedAvatars = eligiblePool.filter((avatarType) => !activeAvatars.has(avatarType));
  const selectionPool = unusedAvatars.length > 0 ? unusedAvatars : eligiblePool;

  return selectionPool[Math.floor(Math.random() * selectionPool.length)] ?? eligiblePool[0] ?? pool[0] ?? "knight";
}
