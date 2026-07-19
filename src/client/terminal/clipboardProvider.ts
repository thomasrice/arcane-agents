import type { ClipboardSelectionType, IClipboardProvider } from "@xterm/addon-clipboard";

/**
 * Routes terminal-originated copies (OSC 52) into the clipboard of the machine
 * actually VIEWING the terminal.
 *
 * tmux (set-clipboard external) emits an OSC 52 escape carrying the selected
 * text to its attached client on every copy. That escape rides the pty ->
 * WebSocket stream into xterm.js in the browser; without a handler xterm drops
 * it, so a selection made from a remote browser (e.g. a laptop hitting the
 * desktop over Tailscale) only ever reached the *server's* clipboard. This
 * provider is the missing handler.
 *
 * Security invariant: `readText` ALWAYS returns "". A program running inside a
 * pane must never be able to exfiltrate the viewer's clipboard via an OSC 52
 * read request ("\e]52;c;?\a") — only writes flow, and only browser-ward.
 */
export class ViewerClipboardProvider implements IClipboardProvider {
  async writeText(_selection: ClipboardSelectionType, text: string): Promise<void> {
    // Note: the selection field is intentionally ignored. tmux emits copies
    // with an EMPTY selection field ("\e]52;;<base64>"), so gating on "c" (as
    // the addon's default provider does) would silently drop every tmux copy.
    if (!text) {
      return;
    }

    await writeToClipboard(text);
  }

  readText(_selection: ClipboardSelectionType): string {
    return "";
  }
}

export type ClipboardWriteStrategy = "async-api" | "exec-command";

interface ClipboardContext {
  isSecureContext: boolean;
  hasAsyncClipboard: boolean;
}

function liveClipboardContext(): ClipboardContext {
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext === true,
    hasAsyncClipboard: typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function"
  };
}

/**
 * `navigator.clipboard` only exists in a secure context (https, or localhost /
 * 127.0.0.1). Reaching the app over plain http to a hostname — the Tailscale
 * case, `http://asterion:7600` — leaves it undefined, so we fall back to the
 * legacy execCommand path, which still works within the transient user
 * activation from the mouse-drag that produced the selection.
 */
export function chooseClipboardWriteStrategy(context: ClipboardContext = liveClipboardContext()): ClipboardWriteStrategy {
  return context.isSecureContext && context.hasAsyncClipboard ? "async-api" : "exec-command";
}

async function writeToClipboard(text: string): Promise<void> {
  if (chooseClipboardWriteStrategy() === "async-api") {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // A permission or focus failure on the async API falls through to the
      // execCommand path rather than dropping the copy.
    }
  }

  writeViaExecCommand(text);
}

function writeViaExecCommand(text: string): void {
  if (typeof document === "undefined") {
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } catch {
    // Best effort — some browsers block execCommand entirely; nothing else to try.
  } finally {
    document.body.removeChild(textarea);
    // Return focus to whatever held it (the terminal), so the copy does not
    // steal keyboard focus from the pane.
    activeElement?.focus();
  }
}
