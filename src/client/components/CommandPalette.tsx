import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedConfig } from "../../shared/types";

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

export function CommandPalette({
  open,
  config,
  onSpawnShortcut,
  onSpawnProjectRuntime,
  onOpenBatchSpawn,
  onClose
}: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const nextItems: PaletteItem[] = [];

    nextItems.push({
      id: "meta-batch-spawn",
      label: "Batch Spawn...",
      subLabel: "Spawn many agents from a name list",
      searchText: "batch spawn names list multiple",
      run: () => onOpenBatchSpawn()
    });

    config.shortcuts.forEach((shortcut, index) => {
      nextItems.push({
        id: `shortcut-${index}`,
        label: `Spawn ${shortcut.label}`,
        subLabel: `${shortcut.project} · ${shortcut.runtime}`,
        searchText: `${shortcut.label} ${shortcut.project} ${shortcut.runtime}`.toLowerCase(),
        run: () => onSpawnShortcut(index)
      });
    });

    for (const [projectId, project] of Object.entries(config.projects)) {
      for (const [runtimeId, runtime] of Object.entries(config.runtimes)) {
        nextItems.push({
          id: `combo-${projectId}-${runtimeId}`,
          label: `${projectId} + ${runtime.label}`,
          subLabel: `${project.shortName} · ${runtime.command.join(" ")}`,
          searchText: `${projectId} ${project.shortName} ${runtimeId} ${runtime.label}`.toLowerCase(),
          run: () => onSpawnProjectRuntime(projectId, runtimeId)
        });
      }
    }

    return nextItems;
  }, [config, onOpenBatchSpawn, onSpawnProjectRuntime, onSpawnShortcut]);

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return items;
    }

    const pieces = term.split(/\s+/g).filter(Boolean);
    return items.filter((item) => pieces.every((piece) => item.searchText.includes(piece)));
  }, [items, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    setActiveIndex(0);
    queueMicrotask(() => {
      inputRef.current?.focus();
    });
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filteredItems.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, filteredItems.length]);

  if (!open) {
    return null;
  }

  const runSelection = (index: number) => {
    const item = filteredItems[index];
    if (!item) {
      return;
    }
    item.run();
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type project/runtime or shortcut"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(filteredItems.length - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              runSelection(activeIndex);
            }
          }}
        />

        <div className="palette-list">
          {filteredItems.length === 0 ? <div className="palette-empty">No matching command</div> : null}

          {filteredItems.map((item, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={item.id}
                className={`palette-item ${active ? "active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runSelection(index)}
              >
                <span>{item.label}</span>
                <small>{item.subLabel}</small>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
