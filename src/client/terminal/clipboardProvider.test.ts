import { describe, expect, it } from "vitest";
import type { ClipboardSelectionType } from "@xterm/addon-clipboard";
import { ViewerClipboardProvider, chooseClipboardWriteStrategy } from "./clipboardProvider";

const SYSTEM = "c" as ClipboardSelectionType;
const PRIMARY = "p" as ClipboardSelectionType;

describe("ViewerClipboardProvider", () => {
  it("never exposes the viewer's clipboard to a pane's OSC 52 read request", () => {
    const provider = new ViewerClipboardProvider();

    // The security invariant: an "\e]52;<sel>;?" read must resolve to empty for
    // every selection, so a program in a pane can never exfiltrate the clipboard.
    expect(provider.readText(SYSTEM)).toBe("");
    expect(provider.readText(PRIMARY)).toBe("");
  });

  it("does nothing for an empty copy payload", async () => {
    const provider = new ViewerClipboardProvider();
    await expect(provider.writeText(SYSTEM, "")).resolves.toBeUndefined();
  });
});

describe("chooseClipboardWriteStrategy", () => {
  it("uses the async clipboard API only in a secure context that provides it", () => {
    expect(chooseClipboardWriteStrategy({ isSecureContext: true, hasAsyncClipboard: true })).toBe("async-api");
  });

  it("falls back to execCommand on an insecure origin — the http-over-Tailscale case", () => {
    // navigator.clipboard is present but window.isSecureContext is false, which
    // is exactly http://<host>:7600 reached from another machine.
    expect(chooseClipboardWriteStrategy({ isSecureContext: false, hasAsyncClipboard: true })).toBe("exec-command");
  });

  it("falls back to execCommand when the async clipboard API is missing", () => {
    expect(chooseClipboardWriteStrategy({ isSecureContext: true, hasAsyncClipboard: false })).toBe("exec-command");
  });
});
