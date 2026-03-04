import { describe, expect, it } from "vitest";
import type { ShortcutConfig } from "../../shared/types";
import { buildShortcutHotkeyBindings, findMatchingShortcutIndexes } from "./shortcutHotkeys";

function keyboardEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: init.key ?? "",
    code: init.code ?? "",
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false
  } as KeyboardEvent;
}

function createShortcut(overrides: Partial<ShortcutConfig>): ShortcutConfig {
  return {
    label: "Shortcut",
    project: "project-a",
    runtime: "opencode",
    ...overrides
  };
}

describe("shortcut hotkey parsing and matching", () => {
  it("builds bindings from valid hotkeys and skips invalid ones", () => {
    const shortcuts = [
      createShortcut({
        hotkeys: ["Ctrl+K", "Ctrl+K+L", "   ", "Shift-ArrowUp"]
      })
    ];

    const bindings = buildShortcutHotkeyBindings(shortcuts);
    expect(bindings).toHaveLength(2);
    expect(bindings[0]).toMatchObject({
      shortcutIndex: 0,
      hotkey: {
        key: "k",
        code: "KeyK",
        ctrl: true,
        meta: false,
        alt: false,
        shift: false
      }
    });
    expect(bindings[1]).toMatchObject({
      shortcutIndex: 0,
      hotkey: {
        key: "arrowup",
        code: undefined,
        ctrl: false,
        meta: false,
        alt: false,
        shift: true
      }
    });
  });

  it("deduplicates matches per shortcut index", () => {
    const shortcuts = [
      createShortcut({ hotkeys: ["Ctrl+K", "Ctrl+KeyK"] }),
      createShortcut({ label: "Second", hotkeys: ["Ctrl+K"] })
    ];

    const bindings = buildShortcutHotkeyBindings(shortcuts);
    const matched = findMatchingShortcutIndexes(
      bindings,
      keyboardEvent({ key: "k", code: "KeyK", ctrlKey: true })
    );

    expect(matched).toEqual([0, 1]);
  });

  it("matches by keyboard code when event.key differs", () => {
    const shortcuts = [createShortcut({ hotkeys: ["Ctrl+KeyQ"] })];
    const bindings = buildShortcutHotkeyBindings(shortcuts);

    const matched = findMatchingShortcutIndexes(
      bindings,
      keyboardEvent({ key: "å", code: "KeyQ", ctrlKey: true })
    );

    expect(matched).toEqual([0]);
  });

  it("does not match when modifiers differ", () => {
    const shortcuts = [createShortcut({ hotkeys: ["Alt+1"] })];
    const bindings = buildShortcutHotkeyBindings(shortcuts);

    const matched = findMatchingShortcutIndexes(
      bindings,
      keyboardEvent({ key: "1", code: "Digit1", ctrlKey: true })
    );

    expect(matched).toEqual([]);
  });
});
