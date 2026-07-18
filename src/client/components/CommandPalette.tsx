import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ResolvedConfig } from "../../shared/types";
import { buildSpawnOptions } from "../app/spawnOptions";
import { useFilterableList } from "../hooks/useFilterableList";
import { FilterableOptionList } from "./FilterableOptionList";

interface CommandPaletteProps {
  open: boolean;
  config: ResolvedConfig;
  onSpawnShortcut: (shortcutIndex: number) => void;
  onSpawnProjectRuntime: (projectId: string, runtimeId: string) => void;
  onOpenBatchSpawn: () => void;
  onClose: () => void;
}

interface PaletteItem {
  id: string;
  label: string;
  subLabel: string;
  searchText: string;
  run: () => void;
}

const getItemSearchText = (item: PaletteItem): string => item.searchText;

export function CommandPalette({
  open,
  config,
  onSpawnShortcut,
  onSpawnProjectRuntime,
  onOpenBatchSpawn,
  onClose
}: CommandPaletteProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const nextItems: PaletteItem[] = [
      {
        id: "meta-batch-spawn",
        label: "Batch Spawn...",
        subLabel: "Spawn many agents from a name list",
        searchText: "batch spawn names list multiple",
        run: () => onOpenBatchSpawn()
      }
    ];

    for (const option of buildSpawnOptions(config)) {
      nextItems.push({
        id: option.id,
        label: option.kind === "shortcut" ? `Spawn ${option.label}` : option.label,
        subLabel: option.subLabel,
        searchText: option.searchText,
        run: () =>
          "shortcutIndex" in option.input
            ? onSpawnShortcut(option.input.shortcutIndex)
            : onSpawnProjectRuntime(option.input.projectId, option.input.runtimeId)
      });
    }

    return nextItems;
  }, [config, onOpenBatchSpawn, onSpawnProjectRuntime, onSpawnShortcut]);

  const { query, setQuery, filtered, activeIndex, setActiveIndex, reset, handleKeyDown } = useFilterableList(
    items,
    getItemSearchText
  );

  const runSelection = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) {
        return;
      }
      item.run();
      onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    reset();
    queueMicrotask(() => {
      inputRef.current?.focus();
    });
  }, [open, reset]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type project/runtime or shortcut"
          onKeyDown={(event) => handleKeyDown(event, { onEnter: runSelection, onEscape: onClose })}
        />

        <FilterableOptionList
          className="palette-list"
          itemClassName="palette-item"
          emptyText="No matching command"
          options={filtered}
          activeIndex={activeIndex}
          onHoverIndex={setActiveIndex}
          onSelectIndex={(index) => runSelection(filtered[index])}
        />
      </div>
    </div>
  );
}
