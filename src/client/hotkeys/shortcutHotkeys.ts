import type { ShortcutConfig } from "../../shared/types";

export interface ParsedShortcutHotkey {
  key: string;
  code?: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface ShortcutHotkeyBinding {
  shortcutIndex: number;
  hotkey: ParsedShortcutHotkey;
}

export function buildShortcutHotkeyBindings(shortcuts: ShortcutConfig[]): ShortcutHotkeyBinding[] {
  const bindings: ShortcutHotkeyBinding[] = [];

  shortcuts.forEach((shortcut, shortcutIndex) => {
    for (const hotkeyText of shortcut.hotkeys ?? []) {
      const parsed = parseShortcutHotkey(hotkeyText);
      if (!parsed) {
        continue;
      }

      bindings.push({
        shortcutIndex,
        hotkey: parsed
      });
    }
  });

  return bindings;
}

export function findMatchingShortcutIndexes(bindings: ShortcutHotkeyBinding[], event: KeyboardEvent): number[] {
  const matchedShortcutIndexes: number[] = [];
  const seenShortcutIndexes = new Set<number>();

  for (const binding of bindings) {
    if (!matchesShortcutHotkey(binding.hotkey, event)) {
      continue;
    }

    if (seenShortcutIndexes.has(binding.shortcutIndex)) {
      continue;
    }

    seenShortcutIndexes.add(binding.shortcutIndex);
    matchedShortcutIndexes.push(binding.shortcutIndex);
  }

  return matchedShortcutIndexes;
}

function matchesShortcutHotkey(hotkey: ParsedShortcutHotkey, event: KeyboardEvent): boolean {
  if (event.ctrlKey !== hotkey.ctrl || event.metaKey !== hotkey.meta || event.altKey !== hotkey.alt || event.shiftKey !== hotkey.shift) {
    return false;
  }

  const normalizedEventKey = normalizeKeyboardEventKey(event.key);
  if (normalizedEventKey === hotkey.key) {
    return true;
  }

  if (!hotkey.code) {
    return false;
  }

  return event.code === hotkey.code;
}

function parseShortcutHotkey(hotkeyText: string): ParsedShortcutHotkey | undefined {
  const tokens = splitShortcutHotkeyTokens(hotkeyText);
  if (tokens.length === 0) {
    return undefined;
  }

  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let keyToken: string | undefined;

  for (const token of tokens) {
    const normalizedToken = token.trim().toLowerCase();
    if (!normalizedToken) {
      continue;
    }

    if (normalizedToken === "ctrl" || normalizedToken === "control") {
      ctrl = true;
      continue;
    }

    if (normalizedToken === "cmd" || normalizedToken === "meta" || normalizedToken === "super") {
      meta = true;
      continue;
    }

    if (normalizedToken === "alt" || normalizedToken === "option") {
      alt = true;
      continue;
    }

    if (normalizedToken === "shift") {
      shift = true;
      continue;
    }

    if (keyToken) {
      return undefined;
    }

    keyToken = token;
  }

  if (!keyToken) {
    return undefined;
  }

  const normalizedKey = normalizeShortcutKeyToken(keyToken);
  if (!normalizedKey) {
    return undefined;
  }

  return {
    key: normalizedKey.key,
    code: normalizedKey.code,
    ctrl,
    meta,
    alt,
    shift
  };
}

function splitShortcutHotkeyTokens(hotkeyText: string): string[] {
  const compactHotkey = hotkeyText.trim().replace(/\s+/g, "");
  if (!compactHotkey) {
    return [];
  }

  if (compactHotkey.includes("+")) {
    return compactHotkey.split("+").filter((token) => token.length > 0);
  }

  const lower = compactHotkey.toLowerCase();
  const hasDashModifierPrefix =
    lower.includes("ctrl-") ||
    lower.includes("control-") ||
    lower.includes("cmd-") ||
    lower.includes("meta-") ||
    lower.includes("super-") ||
    lower.includes("alt-") ||
    lower.includes("option-") ||
    lower.includes("shift-");

  if (hasDashModifierPrefix) {
    return compactHotkey.split("-").filter((token) => token.length > 0);
  }

  return [compactHotkey];
}

function normalizeShortcutKeyToken(token: string): { key: string; code?: string } | undefined {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return undefined;
  }

  const lower = trimmedToken.toLowerCase();
  if (lower === "space" || lower === "spacebar") {
    return { key: " ", code: "Space" };
  }

  if (lower === "esc") {
    return { key: "escape", code: "Escape" };
  }

  if (lower === "return") {
    return { key: "enter", code: "Enter" };
  }

  if (lower === "up") {
    return { key: "arrowup", code: "ArrowUp" };
  }

  if (lower === "down") {
    return { key: "arrowdown", code: "ArrowDown" };
  }

  if (lower === "left") {
    return { key: "arrowleft", code: "ArrowLeft" };
  }

  if (lower === "right") {
    return { key: "arrowright", code: "ArrowRight" };
  }

  if (/^key[a-z]$/.test(lower)) {
    const letter = lower.slice(3);
    return { key: letter, code: `Key${letter.toUpperCase()}` };
  }

  if (/^digit[0-9]$/.test(lower)) {
    const digit = lower.slice(5);
    return { key: digit, code: `Digit${digit}` };
  }

  if (/^numpad[0-9]$/.test(lower)) {
    const digit = lower.slice(6);
    return { key: digit, code: `Numpad${digit}` };
  }

  if (/^f[0-9]{1,2}$/.test(lower)) {
    return { key: lower, code: lower.toUpperCase() };
  }

  if (trimmedToken.length === 1) {
    if (/^[a-z]$/i.test(trimmedToken)) {
      const letter = trimmedToken.toLowerCase();
      return { key: letter, code: `Key${letter.toUpperCase()}` };
    }

    if (/^[0-9]$/.test(trimmedToken)) {
      return { key: trimmedToken };
    }

    return { key: trimmedToken };
  }

  return {
    key: lower
  };
}

function normalizeKeyboardEventKey(eventKey: string): string {
  const lower = eventKey.toLowerCase();
  if (lower === "spacebar") {
    return " ";
  }

  return lower;
}
