import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Worker } from "../../shared/types";
import {
  activateGoToCharacter,
  filterGoToCharacters,
  getCharacterName,
  moveGoToCharacterHighlight,
  resolveGoToCharacterSelection
} from "./goToCharacterSearch";

interface GoToCharacterDialogProps {
  open: boolean;
  workers: Worker[];
  onClose: () => void;
  onActivate: (workerId: string) => void;
}

export function GoToCharacterDialog({
  open,
  workers,
  onClose,
  onActivate
}: GoToCharacterDialogProps): JSX.Element | null {
  const [query, setQuery] = useState("");
  const [highlightedWorkerId, setHighlightedWorkerId] = useState<string>();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const inputId = useId();
  const listboxId = useId();

  const matches = useMemo(() => filterGoToCharacters(workers, query), [query, workers]);
  const highlightedIndex = matches.findIndex((worker) => worker.id === highlightedWorkerId);
  const highlightedMatch = matches[highlightedIndex];
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    setQuery("");
    setHighlightedWorkerId(undefined);

    if (open) {
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const unmodified = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const key = event.key.toLowerCase();

    if (event.key === "Tab") {
      event.preventDefault();
      inputRef.current?.focus();
      return;
    }

    if (ctrlOnly && (key === "j" || key === "k")) {
      event.preventDefault();
      setHighlightedWorkerId((currentWorkerId) => {
        const currentIndex = matches.findIndex((worker) => worker.id === currentWorkerId);
        const nextIndex = moveGoToCharacterHighlight(
          currentIndex,
          key === "j" ? "next" : "previous",
          matches.length
        );
        return matches[nextIndex]?.id;
      });
      return;
    }

    if (unmodified && event.key === "Enter") {
      event.preventDefault();
      activateGoToCharacter(resolveGoToCharacterSelection(matches, highlightedIndex), onActivate, onClose);
      return;
    }

    if (unmodified && event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="palette go-to-character-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="dialog-title go-to-character-title" id={titleId}>
          Go to Character
        </h2>
        <label className="dialog-section-label go-to-character-label" htmlFor={inputId}>
          Search Characters
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="palette-input"
          type="search"
          autoComplete="off"
          autoFocus
          value={query}
          placeholder="Type a Character name"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={hasQuery ? listboxId : undefined}
          aria-expanded={hasQuery}
          aria-activedescendant={highlightedMatch ? `${listboxId}-option-${highlightedIndex}` : undefined}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setHighlightedWorkerId(undefined);
          }}
          onKeyDown={handleKeyDown}
        />

        {hasQuery ? (
          <div
            id={listboxId}
            className="palette-list go-to-character-list"
            role="listbox"
            aria-label="Matching Characters"
          >
            {matches.length === 0 ? (
              <div className="palette-empty" role="status">
                No matching Characters
              </div>
            ) : null}
            {matches.map((worker, index) => {
              const highlighted = worker.id === highlightedWorkerId;
              return (
                <button
                  key={worker.id}
                  id={`${listboxId}-option-${index}`}
                  className={`palette-item go-to-character-option${highlighted ? " active" : ""}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={highlighted}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => activateGoToCharacter(worker, onActivate, onClose)}
                >
                  <span>{getCharacterName(worker)}</span>
                  <small>
                    {worker.runtimeLabel} · {worker.projectId}
                  </small>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
