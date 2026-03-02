import type { AvatarType, ResolvedConfig, Worker } from "../../../shared/types";

interface SelectNextAvatarInput {
  preferred?: AvatarType;
  config: ResolvedConfig;
  workers: Worker[];
  availableAvatars: AvatarType[];
}

export function selectNextAvatar({ preferred, config, workers, availableAvatars }: SelectNextAvatarInput): AvatarType {
  if (preferred && availableAvatars.includes(preferred)) {
    return preferred;
  }

  const pool = availableAvatars.length > 0 ? availableAvatars : ["knight"];
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
