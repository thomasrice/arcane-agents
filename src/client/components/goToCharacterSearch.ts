import type { Worker } from "../../shared/types";

export const GO_TO_CHARACTER_NO_HIGHLIGHT = -1;

type HighlightDirection = "next" | "previous";

export function getCharacterName(worker: Worker): string {
  return worker.displayName ?? worker.name;
}

export function filterGoToCharacters(workers: Worker[], query: string): Worker[] {
  const term = query.trim().toLowerCase();
  if (!term) {
    return [];
  }

  return workers.filter((worker) => getCharacterName(worker).toLowerCase().includes(term));
}

export function moveGoToCharacterHighlight(
  currentIndex: number,
  direction: HighlightDirection,
  matchCount: number
): number {
  if (matchCount <= 0) {
    return GO_TO_CHARACTER_NO_HIGHLIGHT;
  }
  if (currentIndex < 0 || currentIndex >= matchCount) {
    return 0;
  }

  return direction === "next" ? Math.min(matchCount - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
}

export function resolveGoToCharacterSelection(matches: Worker[], highlightedIndex: number): Worker | undefined {
  return matches[highlightedIndex] ?? matches[0];
}

export function activateGoToCharacter(
  worker: Worker | undefined,
  onActivate: (workerId: string) => void,
  onClose: () => void
): boolean {
  if (!worker) {
    return false;
  }

  onActivate(worker.id);
  onClose();
  return true;
}
