import { useEffect, useRef } from "react";
import type { AppHotkeyContext } from "../hotkeys/hotkeyContext";
import { handleActionHotkeys, handleNavigationHotkeys, handleSystemHotkeys } from "../hotkeys/hotkeyHandlers";

export function useAppHotkeys(context: AppHotkeyContext): void {
  const contextRef = useRef(context);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = contextRef.current;
      if (handleSystemHotkeys(event, current)) {
        return;
      }

      if (handleNavigationHotkeys(event, current)) {
        return;
      }

      void handleActionHotkeys(event, current);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
