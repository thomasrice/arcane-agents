import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { maxMapColumnRatio, minMapColumnRatio, splitPaneDividerWidthPx } from "../app/constants";
import { clampNumber } from "../app/utils";
import { useAppStore } from "../state/appStore";

interface SplitDividerHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

interface UseSplitDividerResult {
  appShellRef: RefObject<HTMLDivElement>;
  dragging: boolean;
  dividerHandlers: SplitDividerHandlers;
}

// Owns the map/terminal split-divider drag interaction (pointer capture +
// dragging flag), driving the store's map column ratio. Genuinely App-shell
// local UI, extracted here to keep App a composition root.
export function useSplitDivider(): UseSplitDividerResult {
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const setMapColumnRatio = useAppStore((state) => state.setMapColumnRatio);

  const updateRatioFromPointer = useCallback(
    (clientX: number) => {
      const shell = appShellRef.current;
      if (!shell) {
        return;
      }

      const bounds = shell.getBoundingClientRect();
      const availableWidth = Math.max(1, bounds.width - splitPaneDividerWidthPx);
      const pointerOffsetX = clientX - bounds.left - splitPaneDividerWidthPx / 2;
      setMapColumnRatio(clampNumber(pointerOffsetX / availableWidth, minMapColumnRatio, maxMapColumnRatio));
    },
    [setMapColumnRatio]
  );

  useEffect(() => {
    if (!dragging) {
      return;
    }

    document.body.classList.add("split-pane-dragging");
    return () => {
      document.body.classList.remove("split-pane-dragging");
    };
  }, [dragging]);

  const dividerHandlers: SplitDividerHandlers = {
    onPointerDown: (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      pointerIdRef.current = event.pointerId;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      updateRatioFromPointer(event.clientX);
    },
    onPointerMove: (event) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }

      event.preventDefault();
      updateRatioFromPointer(event.clientX);
    },
    onPointerUp: (event) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }

      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      pointerIdRef.current = undefined;
      setDragging(false);
    },
    onPointerCancel: (event) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      pointerIdRef.current = undefined;
      setDragging(false);
    }
  };

  return {
    appShellRef,
    dragging,
    dividerHandlers
  };
}
