import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Worker } from "../../shared/types";
import { defaultMapColumnRatio, maxMapColumnRatio, minMapColumnRatio } from "../app/constants";
import type { ControlGroupMap } from "../app/types";
import {
  clampNumber,
  loadControlGroupsFromStorage,
  loadMapColumnRatioFromStorage,
  persistControlGroups,
  persistMapColumnRatio
} from "../app/utils";

interface UseLayoutAndControlGroupsResult {
  controlGroups: ControlGroupMap;
  setControlGroups: Dispatch<SetStateAction<ControlGroupMap>>;
  controlGroupByDigitRef: MutableRefObject<ControlGroupMap>;
  mapColumnRatio: number;
  nudgeMapColumnRatio: (delta: number) => void;
  resetMapColumnRatio: () => void;
}

export function useLayoutAndControlGroups(
  activeWorkers: Worker[],
  workersHydrated: boolean
): UseLayoutAndControlGroupsResult {
  const [controlGroups, setControlGroups] = useState<ControlGroupMap>(() => loadControlGroupsFromStorage());
  const controlGroupByDigitRef = useRef<ControlGroupMap>(controlGroups);
  const [mapColumnRatio, setMapColumnRatio] = useState<number>(() => loadMapColumnRatioFromStorage());

  useEffect(() => {
    controlGroupByDigitRef.current = controlGroups;
    persistControlGroups(controlGroups);
  }, [controlGroups]);

  useEffect(() => {
    persistMapColumnRatio(mapColumnRatio);
  }, [mapColumnRatio]);

  useEffect(() => {
    if (!workersHydrated) {
      return;
    }

    const activeIds = new Set(activeWorkers.map((worker) => worker.id));
    setControlGroups((current) => {
      let changed = false;
      const next: ControlGroupMap = { ...current };

      for (const [digitText, workerIds] of Object.entries(next)) {
        if (!Array.isArray(workerIds) || workerIds.length === 0) {
          delete next[Number(digitText)];
          changed = true;
          continue;
        }

        const filtered = workerIds.filter((workerId) => activeIds.has(workerId));
        if (filtered.length === workerIds.length) {
          continue;
        }

        if (filtered.length === 0) {
          delete next[Number(digitText)];
        } else {
          next[Number(digitText)] = filtered;
        }
        changed = true;
      }

      return changed ? next : current;
    });
  }, [activeWorkers, workersHydrated]);

  return {
    controlGroups,
    setControlGroups,
    controlGroupByDigitRef,
    mapColumnRatio,
    nudgeMapColumnRatio: (delta) => {
      setMapColumnRatio((current) => clampNumber(current + delta, minMapColumnRatio, maxMapColumnRatio));
    },
    resetMapColumnRatio: () => {
      setMapColumnRatio(defaultMapColumnRatio);
    }
  };
}
