import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

interface KeyboardHandlers<T> {
  onEnter: (item: T, index: number) => void;
  onEscape?: () => void;
}

export interface FilterableList<T> {
  query: string;
  setQuery: (query: string) => void;
  filtered: T[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  reset: () => void;
  /** Arrow-key cursor movement + Enter/Escape dispatch for a single-column list input. */
  handleKeyDown: (event: KeyboardEvent, handlers: KeyboardHandlers<T>) => void;
}

// Space-separated substring filtering plus an active-index cursor for a keyboard-navigable
// option list. Previously hand-rolled in CommandPalette and BatchSpawnDialog.
export function useFilterableList<T>(items: T[], getSearchText: (item: T) => string): FilterableList<T> {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return items;
    }

    const pieces = term.split(/\s+/g).filter(Boolean);
    return items.filter((item) => {
      const searchText = getSearchText(item);
      return pieces.every((piece) => searchText.includes(piece));
    });
  }, [getSearchText, items, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, filtered.length]);

  const reset = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent, handlers: KeyboardHandlers<T>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(filtered.length - 1, current + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = filtered[activeIndex];
        if (item) {
          handlers.onEnter(item, activeIndex);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        handlers.onEscape?.();
      }
    },
    [activeIndex, filtered]
  );

  return { query, setQuery, filtered, activeIndex, setActiveIndex, reset, handleKeyDown };
}
