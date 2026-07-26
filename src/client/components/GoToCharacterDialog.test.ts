import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Worker } from "../../shared/types";
import { GoToCharacterDialog } from "./GoToCharacterDialog";
import {
  activateGoToCharacter,
  filterGoToCharacters,
  GO_TO_CHARACTER_NO_HIGHLIGHT,
  moveGoToCharacterHighlight,
  resolveGoToCharacterSelection
} from "./goToCharacterSearch";

function createWorker(id: string, name: string, displayName?: string): Worker {
  return {
    id,
    name,
    displayName,
    projectId: "arcane",
    projectPath: "/workspace/arcane",
    runtimeId: "claude",
    runtimeLabel: "Claude",
    command: ["claude"],
    status: "idle",
    avatarType: "mage",
    movementMode: "hold",
    silenced: false,
    position: { x: 0, y: 0 },
    tmuxRef: { session: "arcane", window: id, pane: "0" },
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z"
  };
}

const workers = [
  createWorker("oracle", "runtime-oracle", "Oracle"),
  createWorker("trinity", "TRINITY"),
  createWorker("morpheus", "morpheus", "Morpheus")
];

describe("GoToCharacterDialog", () => {
  it("hides results for empty and whitespace-only queries", () => {
    expect(filterGoToCharacters(workers, "")).toEqual([]);
    expect(filterGoToCharacters(workers, "   \t ")).toEqual([]);

    const markup = renderToStaticMarkup(
      createElement(GoToCharacterDialog, {
        open: true,
        workers,
        onClose: vi.fn(),
        onActivate: vi.fn()
      })
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('role="combobox"');
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
  });

  it("filters case-insensitively using displayName with name as the fallback", () => {
    expect(filterGoToCharacters(workers, "oRaClE").map((worker) => worker.id)).toEqual(["oracle"]);
    expect(filterGoToCharacters(workers, "trin").map((worker) => worker.id)).toEqual(["trinity"]);
    expect(filterGoToCharacters(workers, "runtime-oracle")).toEqual([]);
  });

  it("starts without a highlight while Enter resolves the top match", () => {
    expect(GO_TO_CHARACTER_NO_HIGHLIGHT).toBe(-1);
    expect(resolveGoToCharacterSelection(workers, GO_TO_CHARACTER_NO_HIGHLIGHT)).toBe(workers[0]);
  });

  it("keeps Enter inert when there are no matches", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();

    const selected = resolveGoToCharacterSelection([], GO_TO_CHARACTER_NO_HIGHLIGHT);
    expect(activateGoToCharacter(selected, onActivate, onClose)).toBe(false);
    expect(onActivate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves Ctrl-J and Ctrl-K from the top and stops at either edge", () => {
    expect(moveGoToCharacterHighlight(GO_TO_CHARACTER_NO_HIGHLIGHT, "next", 3)).toBe(0);
    expect(moveGoToCharacterHighlight(GO_TO_CHARACTER_NO_HIGHLIGHT, "previous", 3)).toBe(0);

    let index = 0;
    index = moveGoToCharacterHighlight(index, "next", 3);
    expect(index).toBe(1);
    index = moveGoToCharacterHighlight(index, "next", 3);
    expect(index).toBe(2);
    index = moveGoToCharacterHighlight(index, "next", 3);
    expect(index).toBe(2);

    index = moveGoToCharacterHighlight(index, "previous", 3);
    expect(index).toBe(1);
    index = moveGoToCharacterHighlight(index, "previous", 3);
    expect(index).toBe(0);
    index = moveGoToCharacterHighlight(index, "previous", 3);
    expect(index).toBe(0);
  });

  it("activates the Character before closing", () => {
    const calls: string[] = [];

    expect(
      activateGoToCharacter(
        workers[1],
        (workerId) => calls.push(`activate:${workerId}`),
        () => calls.push("close")
      )
    ).toBe(true);
    expect(calls).toEqual(["activate:trinity", "close"]);
  });
});
