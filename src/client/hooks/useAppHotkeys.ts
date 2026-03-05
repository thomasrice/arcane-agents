import { useEffect, useRef } from "react";
import type { AppHotkeyContext } from "../hotkeys/hotkeyContext";
import { handleActionHotkeys, handleNavigationHotkeys, handleSystemHotkeys } from "../hotkeys/hotkeyHandlers";

export function useAppHotkeys(context: AppHotkeyContext): void {
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = contextRef.current;

      if (shouldBypassHotkeyRoutingForTerminalInput(event, current)) {
        return;
      }

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

function shouldBypassHotkeyRoutingForTerminalInput(event: KeyboardEvent, context: AppHotkeyContext): boolean {
  if (!context.isTerminalTarget(event.target)) {
    return false;
  }

  if (
    context.killConfirmWorkerIds.length > 0 ||
    context.renameModalOpen ||
    context.batchSpawnDialogOpen ||
    context.shortcutsOverlayOpen ||
    context.paletteOpen ||
    context.spawnDialogOpen
  ) {
    return false;
  }

  if (event.key === "Escape" || context.isTerminalEscapeShortcut(event)) {
    return false;
  }

  return true;
}
