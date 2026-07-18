import type { PointerEvent as ReactPointerEvent } from "react";

interface SplitDividerHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

interface SplitDividerProps {
  dragging: boolean;
  handlers: SplitDividerHandlers;
}

// The draggable separator between the map and terminal columns. Pointer/drag state
// is owned by useSplitDivider (which also holds the app-shell ref App needs).
export function SplitDivider({ dragging, handlers }: SplitDividerProps): JSX.Element {
  return (
    <div
      className={`layout-divider${dragging ? " layout-divider-active" : ""}`}
      role="separator"
      aria-label="Resize map and terminal columns"
      aria-orientation="vertical"
      {...handlers}
    />
  );
}
