import { useCallback, useEffect, useRef } from "react";
import type { ResolvedConfig, Worker, WorkerStatus } from "../../shared/types";
import { fetchVoiceLineCatalog } from "../api";
import { voiceLineFileUrl } from "../assetUrls";

export type VoiceLineEvent = "arrive" | "move" | "selected" | "attention" | "complete" | "death";
const arrivalSelectionSuppressMs = 1600;
export const voiceLineEvents: VoiceLineEvent[] = ["arrive", "move", "selected", "attention", "complete", "death"];
const voiceLineExtension = ".mp3";
const defaultVariantCount = 3;

/**
 * Every event supports random variants: any `<event>*.mp3` in the character's
 * voice-lines directory is a candidate (`arrive.mp3`, `arrive_variant_2.mp3`, ...).
 * Before the catalog is fetched, the conventional file names are assumed.
 */
export function defaultVoiceLineFileNames(event: VoiceLineEvent): string[] {
  const names = [`${event}${voiceLineExtension}`];
  for (let index = 1; index <= defaultVariantCount; index += 1) {
    names.push(`${event}_variant_${index}${voiceLineExtension}`);
  }
  return names;
}

export function resolveVoiceLineFileNames(catalogFiles: string[], event: VoiceLineEvent): string[] {
  return catalogFiles
    .filter((file) => file.toLowerCase().endsWith(voiceLineExtension))
    .filter((file) => file.toLowerCase().startsWith(event))
    .sort((a, b) => a.localeCompare(b));
}

interface UseWorkerVoiceLinesInput {
  config: ResolvedConfig | null;
  audioVolume: number;
  workers: Worker[];
  workersHydrated: boolean;
  selectedWorkerIds: string[];
}

interface UseWorkerVoiceLinesResult {
  playArrivalVoiceLine: (worker: Worker) => void;
  playMoveVoiceLine: (workerId: string) => void;
}

export function useWorkerVoiceLines({
  config,
  audioVolume,
  workers,
  workersHydrated,
  selectedWorkerIds
}: UseWorkerVoiceLinesInput): UseWorkerVoiceLinesResult {
  const soundEnabled = config?.audio.enableSound ?? true;
  const previousWorkersByIdRef = useRef<Map<string, Worker>>(new Map());
  const previousSelectedWorkerIdSetRef = useRef<Set<string>>(new Set());
  const workersByIdRef = useRef<Map<string, Worker>>(new Map());
  const workerTransitionInitializedRef = useRef(false);
  const selectionInitializedRef = useRef(false);
  const voiceLineVariantUrlsByAvatarTypeRef = useRef<Map<string, Record<VoiceLineEvent, string[]>>>(new Map());
  const voiceLineCatalogRequestedAvatarTypeSetRef = useRef<Set<string>>(new Set());
  const suppressSelectionUntilByWorkerIdRef = useRef<Map<string, number>>(new Map());
  const availabilityByUrlRef = useRef<Map<string, boolean>>(new Map());
  const preloadedUrlSetRef = useRef<Set<string>>(new Set());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioVolumeRef = useRef(audioVolume);

  useEffect(() => {
    workersByIdRef.current = new Map(workers.map((worker) => [worker.id, worker]));
  }, [workers]);

  useEffect(() => {
    audioVolumeRef.current = audioVolume;
    const activeAudio = activeAudioRef.current;
    if (activeAudio) {
      activeAudio.volume = audioVolume;
    }
  }, [audioVolume]);

  const resolveVoiceLineFileUrl = useCallback((avatarType: string, fileName: string): string => {
    return voiceLineFileUrl(avatarType, fileName);
  }, []);

  const resolveVoiceLineVariantUrls = useCallback(
    (avatarType: string, event: VoiceLineEvent): string[] => {
      const discoveredUrls = voiceLineVariantUrlsByAvatarTypeRef.current.get(avatarType)?.[event] ?? [];
      if (discoveredUrls.length > 0) {
        return discoveredUrls;
      }

      return defaultVoiceLineFileNames(event).map((fileName) => resolveVoiceLineFileUrl(avatarType, fileName));
    },
    [resolveVoiceLineFileUrl]
  );

  const preloadVoiceLine = useCallback((url: string) => {
    if (preloadedUrlSetRef.current.has(url)) {
      return;
    }

    preloadedUrlSetRef.current.add(url);
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.addEventListener(
      "canplay",
      () => {
        availabilityByUrlRef.current.set(url, true);
      },
      { once: true }
    );
    audio.addEventListener(
      "error",
      () => {
        availabilityByUrlRef.current.set(url, false);
      },
      { once: true }
    );
    audio.load();
  }, []);

  const playVoiceLineUrl = useCallback(
    (url: string): void => {
      if (!soundEnabled) {
        return;
      }

      if (availabilityByUrlRef.current.get(url) === false) {
        return;
      }

      const previousAudio = activeAudioRef.current;
      if (previousAudio) {
        previousAudio.pause();
        previousAudio.currentTime = 0;
      }

      const audio = new Audio(url);
      audio.preload = "auto";
      audio.volume = audioVolumeRef.current;
      audio.addEventListener(
        "canplay",
        () => {
          availabilityByUrlRef.current.set(url, true);
        },
        { once: true }
      );
      audio.addEventListener(
        "error",
        () => {
          availabilityByUrlRef.current.set(url, false);
        },
        { once: true }
      );
      activeAudioRef.current = audio;
      void audio.play().catch(() => undefined);
    },
    [soundEnabled]
  );

  const playRandomVoiceLine = useCallback(
    (candidateUrls: string[]): void => {
      if (!soundEnabled) {
        return;
      }

      const knownAvailableCandidateUrls = candidateUrls.filter((url) => availabilityByUrlRef.current.get(url) === true);
      const maybeAvailableCandidateUrls = candidateUrls.filter((url) => availabilityByUrlRef.current.get(url) !== false);
      const candidatePool = knownAvailableCandidateUrls.length > 0 ? knownAvailableCandidateUrls : maybeAvailableCandidateUrls;
      const selectedUrl = chooseRandomItem(candidatePool);
      if (!selectedUrl) {
        return;
      }

      playVoiceLineUrl(selectedUrl);
    },
    [playVoiceLineUrl, soundEnabled]
  );

  const playVoiceLine = useCallback(
    (worker: Worker, event: VoiceLineEvent): void => {
      playRandomVoiceLine(resolveVoiceLineVariantUrls(worker.avatarType, event));
    },
    [playRandomVoiceLine, resolveVoiceLineVariantUrls]
  );

  const fetchAvatarVoiceLineCatalog = useCallback(
    async (avatarType: string): Promise<void> => {
      try {
        const { files: catalogFiles } = await fetchVoiceLineCatalog(avatarType);
        const catalog = {} as Record<VoiceLineEvent, string[]>;
        for (const event of voiceLineEvents) {
          catalog[event] = resolveVoiceLineFileNames(catalogFiles, event).map((fileName) =>
            resolveVoiceLineFileUrl(avatarType, fileName)
          );
        }

        voiceLineVariantUrlsByAvatarTypeRef.current.set(avatarType, catalog);

        for (const event of voiceLineEvents) {
          for (const url of catalog[event]) {
            preloadVoiceLine(url);
          }
        }
      } catch {
        voiceLineCatalogRequestedAvatarTypeSetRef.current.delete(avatarType);
      }
    },
    [preloadVoiceLine, resolveVoiceLineFileUrl]
  );

  useEffect(() => {
    const avatarTypes = Array.from(new Set(workers.map((worker) => worker.avatarType)));

    for (const avatarType of avatarTypes) {
      if (voiceLineCatalogRequestedAvatarTypeSetRef.current.has(avatarType)) {
        continue;
      }

      voiceLineCatalogRequestedAvatarTypeSetRef.current.add(avatarType);
      void fetchAvatarVoiceLineCatalog(avatarType);
    }
  }, [fetchAvatarVoiceLineCatalog, workers]);

  useEffect(() => {
    if (!soundEnabled) {
      return;
    }

    const avatarTypes = Array.from(new Set(workers.map((worker) => worker.avatarType)));

    for (const avatarType of avatarTypes) {
      for (const event of voiceLineEvents) {
        for (const url of resolveVoiceLineVariantUrls(avatarType, event)) {
          preloadVoiceLine(url);
        }
      }
    }
  }, [preloadVoiceLine, resolveVoiceLineVariantUrls, soundEnabled, workers]);

  useEffect(() => {
    if (!workersHydrated) {
      return;
    }

    const currentWorkersById = new Map(workers.map((worker) => [worker.id, worker]));
    const previousWorkersById = previousWorkersByIdRef.current;
    const suppressSelectionUntilByWorkerId = suppressSelectionUntilByWorkerIdRef.current;
    const now = performance.now();

    if (!workerTransitionInitializedRef.current) {
      workerTransitionInitializedRef.current = true;
      previousWorkersByIdRef.current = currentWorkersById;
      return;
    }

    for (const worker of workers) {
      const previousWorker = previousWorkersById.get(worker.id);
      if (!previousWorker) {
        playVoiceLine(worker, "arrive");
        suppressSelectionUntilByWorkerId.set(worker.id, now + arrivalSelectionSuppressMs);
        continue;
      }

      for (const event of getAutomaticWorkVoiceLineEvents(previousWorker, worker)) {
        playVoiceLine(worker, event);
      }
    }

    for (const [workerId, previousWorker] of previousWorkersById.entries()) {
      if (!currentWorkersById.has(workerId)) {
        playVoiceLine(previousWorker, "death");
        suppressSelectionUntilByWorkerId.delete(workerId);
      }
    }

    previousWorkersByIdRef.current = currentWorkersById;
  }, [playVoiceLine, workers, workersHydrated]);

  useEffect(() => {
    if (!workersHydrated) {
      return;
    }

    const currentSelectedWorkerIdSet = new Set(selectedWorkerIds);
    const previousSelectedWorkerIdSet = previousSelectedWorkerIdSetRef.current;

    if (!selectionInitializedRef.current) {
      selectionInitializedRef.current = true;
      previousSelectedWorkerIdSetRef.current = currentSelectedWorkerIdSet;
      return;
    }

    const newlySelectedWorkerIds = selectedWorkerIds.filter((workerId) => !previousSelectedWorkerIdSet.has(workerId));
    const suppressSelectionUntilByWorkerId = suppressSelectionUntilByWorkerIdRef.current;
    const now = performance.now();
    const newlySelectableWorkerIds = newlySelectedWorkerIds.filter((workerId) => {
      const suppressUntil = suppressSelectionUntilByWorkerId.get(workerId);
      if (suppressUntil === undefined) {
        return true;
      }

      if (suppressUntil <= now) {
        suppressSelectionUntilByWorkerId.delete(workerId);
        return true;
      }

      return false;
    });
    const selectedWorkerId = chooseRandomItem(newlySelectableWorkerIds);
    if (selectedWorkerId) {
      const worker = workersByIdRef.current.get(selectedWorkerId);
      if (worker) {
        playVoiceLine(worker, "selected");
      }
    }

    previousSelectedWorkerIdSetRef.current = currentSelectedWorkerIdSet;
  }, [playVoiceLine, selectedWorkerIds, workersHydrated]);

  const playMoveVoiceLine = useCallback(
    (workerId: string) => {
      const worker = workersByIdRef.current.get(workerId);
      if (!worker) {
        return;
      }

      playVoiceLine(worker, "move");
    },
    [playVoiceLine]
  );

  const playArrivalVoiceLine = useCallback(
    (worker: Worker) => {
      playVoiceLine(worker, "arrive");
      suppressSelectionUntilByWorkerIdRef.current.set(worker.id, performance.now() + arrivalSelectionSuppressMs);
    },
    [playVoiceLine]
  );

  useEffect(() => {
    return () => {
      const activeAudio = activeAudioRef.current;
      if (!activeAudio) {
        return;
      }

      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudioRef.current = null;
    };
  }, []);

  return {
    playArrivalVoiceLine,
    playMoveVoiceLine
  };
}

function transitionedToAttention(previous: WorkerStatus, next: WorkerStatus): boolean {
  return previous !== "attention" && next === "attention";
}

function transitionedToComplete(previous: WorkerStatus, next: WorkerStatus): boolean {
  return previous === "working" && next === "idle";
}

export function getAutomaticWorkVoiceLineEvents(
  previousWorker: Pick<Worker, "status">,
  worker: Pick<Worker, "createdAt" | "silenced" | "status">,
  nowMs = Date.now()
): VoiceLineEvent[] {
  if (worker.silenced) {
    return [];
  }

  const events: VoiceLineEvent[] = [];
  if (transitionedToAttention(previousWorker.status, worker.status)) {
    events.push("attention");
  }
  if (transitionedToComplete(previousWorker.status, worker.status) && !isRecentlySpawned(worker, nowMs)) {
    events.push("complete");
  }
  return events;
}

const spawnGraceMs = 10_000;

function isRecentlySpawned(worker: Pick<Worker, "createdAt">, nowMs = Date.now()): boolean {
  return nowMs - new Date(worker.createdAt).getTime() < spawnGraceMs;
}

function chooseRandomItem<T>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const index = Math.floor(Math.random() * items.length);
  return items[index];
}
