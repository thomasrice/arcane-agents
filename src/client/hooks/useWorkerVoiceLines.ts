import { useCallback, useEffect, useRef } from "react";
import type { ResolvedConfig, Worker, WorkerStatus } from "../../shared/types";

type VoiceLineEvent = "arrive" | "move" | "attention" | "complete" | "death";
type VoiceLineVariantPrefix = "move" | "selected";
const arrivalSelectionSuppressMs = 1600;
const voiceLineVariantPrefixes: VoiceLineVariantPrefix[] = ["move", "selected"];
const defaultVoiceLineVariantFileNames: Record<VoiceLineVariantPrefix, string[]> = {
  move: ["move.mp3", "move_variant_1.mp3", "move_variant_2.mp3", "move_variant_3.mp3"],
  selected: ["selected.mp3", "selected_variant_1.mp3", "selected_variant_2.mp3", "selected_variant_3.mp3"]
};

interface UseWorkerVoiceLinesInput {
  config: ResolvedConfig | null;
  workers: Worker[];
  workersHydrated: boolean;
  selectedWorkerIds: string[];
}

interface UseWorkerVoiceLinesResult {
  playArrivalVoiceLine: (worker: Worker) => void;
  playMoveVoiceLine: (workerId: string) => void;
}

export function useWorkerVoiceLines({ config, workers, workersHydrated, selectedWorkerIds }: UseWorkerVoiceLinesInput): UseWorkerVoiceLinesResult {
  const soundEnabled = config?.audio.enableSound ?? true;
  const previousWorkersByIdRef = useRef<Map<string, Worker>>(new Map());
  const previousSelectedWorkerIdSetRef = useRef<Set<string>>(new Set());
  const workersByIdRef = useRef<Map<string, Worker>>(new Map());
  const workerTransitionInitializedRef = useRef(false);
  const selectionInitializedRef = useRef(false);
  const voiceLineVariantUrlsByAvatarTypeRef = useRef<
    Map<string, Record<VoiceLineVariantPrefix, string[]>>
  >(new Map());
  const voiceLineCatalogRequestedAvatarTypeSetRef = useRef<Set<string>>(new Set());
  const suppressSelectionUntilByWorkerIdRef = useRef<Map<string, number>>(new Map());
  const availabilityByUrlRef = useRef<Map<string, boolean>>(new Map());
  const preloadedUrlSetRef = useRef<Set<string>>(new Set());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    workersByIdRef.current = new Map(workers.map((worker) => [worker.id, worker]));
  }, [workers]);

  const resolveVoiceLineUrl = useCallback((avatarType: string, event: VoiceLineEvent): string => {
    return `/api/assets/characters/${encodeURIComponent(avatarType)}/voice-lines/${event}.mp3`;
  }, []);

  const resolveVoiceLineFileUrl = useCallback((avatarType: string, fileName: string): string => {
    return `/api/assets/characters/${encodeURIComponent(avatarType)}/voice-lines/${encodeURIComponent(fileName)}`;
  }, []);

  const resolveVoiceLineVariantUrls = useCallback(
    (avatarType: string, prefix: VoiceLineVariantPrefix): string[] => {
      const discoveredUrls = voiceLineVariantUrlsByAvatarTypeRef.current.get(avatarType)?.[prefix] ?? [];
      if (discoveredUrls.length > 0) {
        return discoveredUrls;
      }

      return defaultVoiceLineVariantFileNames[prefix].map((fileName) => resolveVoiceLineFileUrl(avatarType, fileName));
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

  const playVoiceLine = useCallback(
    (worker: Worker, event: VoiceLineEvent): void => {
      playVoiceLineUrl(resolveVoiceLineUrl(worker.avatarType, event));
    },
    [playVoiceLineUrl, resolveVoiceLineUrl]
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

  const playSelectedVoiceLine = useCallback(
    (worker: Worker): void => {
      const variantUrls = resolveVoiceLineVariantUrls(worker.avatarType, "selected");
      playRandomVoiceLine(variantUrls);
    },
    [playRandomVoiceLine, resolveVoiceLineVariantUrls]
  );

  const playMoveVoiceLineWithVariants = useCallback(
    (worker: Worker): void => {
      const variantUrls = resolveVoiceLineVariantUrls(worker.avatarType, "move");
      playRandomVoiceLine(variantUrls);
    },
    [playRandomVoiceLine, resolveVoiceLineVariantUrls]
  );

  const fetchAvatarVoiceLineCatalog = useCallback(
    async (avatarType: string): Promise<void> => {
      try {
        const response = await fetch(`/api/avatars/${encodeURIComponent(avatarType)}/voice-lines`);
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { files?: unknown };
        if (!Array.isArray(payload.files)) {
          return;
        }

        const files = payload.files
          .filter((file): file is string => typeof file === "string" && file.toLowerCase().endsWith(".mp3"))
          .sort((a, b) => a.localeCompare(b));

        const catalog: Record<VoiceLineVariantPrefix, string[]> = {
          move: [],
          selected: []
        };

        for (const prefix of voiceLineVariantPrefixes) {
          catalog[prefix] = files
            .filter((fileName) => fileName.toLowerCase().startsWith(prefix))
            .map((fileName) => resolveVoiceLineFileUrl(avatarType, fileName));
        }

        voiceLineVariantUrlsByAvatarTypeRef.current.set(avatarType, catalog);

        for (const prefix of voiceLineVariantPrefixes) {
          for (const url of catalog[prefix]) {
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
    const events: VoiceLineEvent[] = ["arrive", "attention", "complete", "death"];

    for (const avatarType of avatarTypes) {
      for (const event of events) {
        preloadVoiceLine(resolveVoiceLineUrl(avatarType, event));
      }

      for (const prefix of voiceLineVariantPrefixes) {
        for (const url of resolveVoiceLineVariantUrls(avatarType, prefix)) {
          preloadVoiceLine(url);
        }
      }
    }
  }, [preloadVoiceLine, resolveVoiceLineUrl, resolveVoiceLineVariantUrls, soundEnabled, workers]);

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

      if (transitionedToAttention(previousWorker.status, worker.status)) {
        playVoiceLine(worker, "attention");
      }

      if (transitionedToComplete(previousWorker.status, worker.status) && !isRecentlySpawned(worker)) {
        playVoiceLine(worker, "complete");
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
        playSelectedVoiceLine(worker);
      }
    }

    previousSelectedWorkerIdSetRef.current = currentSelectedWorkerIdSet;
  }, [playSelectedVoiceLine, selectedWorkerIds, workersHydrated]);

  const playMoveVoiceLine = useCallback(
    (workerId: string) => {
      const worker = workersByIdRef.current.get(workerId);
      if (!worker) {
        return;
      }

      playMoveVoiceLineWithVariants(worker);
    },
    [playMoveVoiceLineWithVariants]
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

const spawnGraceMs = 10_000;

function isRecentlySpawned(worker: Worker): boolean {
  return Date.now() - new Date(worker.createdAt).getTime() < spawnGraceMs;
}

function chooseRandomItem<T>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const index = Math.floor(Math.random() * items.length);
  return items[index];
}
