import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

const shiftEnterSequence = "\n";
const tokyoNightTheme = {
  background: "#1a1b26",
  foreground: "#c0caf5",
  cursor: "#c0caf5",
  cursorAccent: "#1a1b26",
  selectionBackground: "rgba(122, 162, 247, 0.28)",
  selectionInactiveBackground: "rgba(122, 162, 247, 0.2)",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5"
};

interface TerminalPanelProps {
  workerId?: string;
  workerName?: string;
  focusRequestKey?: number;
}

export function TerminalPanel({ workerId, workerName, focusRequestKey }: TerminalPanelProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fitRafRef = useRef<number | null>(null);
  const transientSelectionRef = useRef<string>("");
  const transientSelectionAtMsRef = useRef<number>(0);
  const lastCopiedSelectionRef = useRef<string>("");
  const lastFocusRequestRef = useRef<number | undefined>(undefined);

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const sendResizeMessage = useCallback(() => {
    const socket = socketRef.current;
    const terminal = terminalRef.current;
    if (!socket || !terminal) {
      return;
    }

    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "resize",
        cols: terminal.cols,
        rows: terminal.rows
      })
    );
  }, []);

  const fitIfVisible = useCallback((): boolean => {
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!container || !fitAddon || !terminal) {
      return false;
    }

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 8 || height < 8 || container.getClientRects().length === 0) {
      return false;
    }

    try {
      fitAddon.fit();
    } catch {
      return false;
    }

    return terminal.cols > 0 && terminal.rows > 0;
  }, []);

  const scheduleFit = useCallback(
    (attempts = 16) => {
      if (fitRafRef.current) {
        cancelAnimationFrame(fitRafRef.current);
      }

      const run = (remaining: number) => {
        const fitted = fitIfVisible();
        if (fitted) {
          sendResizeMessage();
          return;
        }

        if (remaining <= 0) {
          return;
        }

        fitRafRef.current = requestAnimationFrame(() => {
          run(remaining - 1);
        });
      };

      fitRafRef.current = requestAnimationFrame(() => {
        run(attempts);
      });
    },
    [fitIfVisible, sendResizeMessage]
  );

  const copyTerminalSelection = useCallback((selection: string) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const normalizedSelection = selection;
    if (!normalizedSelection || normalizedSelection.length === 0) {
      lastCopiedSelectionRef.current = "";
      return;
    }

    if (normalizedSelection === lastCopiedSelectionRef.current) {
      return;
    }

    void copyTextToClipboard(normalizedSelection).then((copied) => {
      if (copied) {
        lastCopiedSelectionRef.current = normalizedSelection;
      }
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: false,
      cursorStyle: "block",
      cursorInactiveStyle: "block",
      fontSize: 13,
      lineHeight: 1,
      theme: tokyoNightTheme
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.attachCustomKeyEventHandler((event) => {
      if (!isShiftEnterEvent(event)) {
        return true;
      }

      event.preventDefault();
      event.stopPropagation();

      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(shiftEnterSequence);
      }

      return false;
    });
    terminal.open(containerRef.current);

    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (!selection || selection.length === 0) {
        return;
      }

      transientSelectionRef.current = selection;
      transientSelectionAtMsRef.current = Date.now();
      copyTerminalSelection(selection);
    });

    const copyCurrentSelection = () => {
      const directSelection = terminal.getSelection();
      if (directSelection && directSelection.length > 0) {
        copyTerminalSelection(directSelection);
        return;
      }

      const ageMs = Date.now() - transientSelectionAtMsRef.current;
      if (transientSelectionRef.current && ageMs >= 0 && ageMs <= 1400) {
        copyTerminalSelection(transientSelectionRef.current);
      }
    };

    const terminalContainer = containerRef.current;
    terminalContainer.addEventListener("mouseup", copyCurrentSelection, true);
    terminalContainer.addEventListener("touchend", copyCurrentSelection, true);
    terminalContainer.addEventListener("pointerup", copyCurrentSelection, true);

    const onWindowBlur = () => {
      transientSelectionRef.current = "";
      transientSelectionAtMsRef.current = 0;
      lastCopiedSelectionRef.current = "";
    };
    window.addEventListener("blur", onWindowBlur);

    terminal.writeln("Select a worker to connect its terminal.");

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    scheduleFit();

    const observer = new ResizeObserver(() => {
      scheduleFit();
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      if (fitRafRef.current) {
        cancelAnimationFrame(fitRafRef.current);
        fitRafRef.current = null;
      }
      window.removeEventListener("blur", onWindowBlur);
      terminalContainer.removeEventListener("mouseup", copyCurrentSelection, true);
      terminalContainer.removeEventListener("touchend", copyCurrentSelection, true);
      terminalContainer.removeEventListener("pointerup", copyCurrentSelection, true);
      selectionDisposable.dispose();
      socketRef.current?.close();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [copyTerminalSelection, scheduleFit]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    socketRef.current?.close();
    socketRef.current = null;
    terminal.clear();
    terminal.clearSelection();
    transientSelectionRef.current = "";
    transientSelectionAtMsRef.current = 0;
    lastCopiedSelectionRef.current = "";
    scheduleFit();

    if (!workerId) {
      terminal.writeln("Select a worker to connect its terminal.");
      return;
    }

    terminal.writeln(`Connecting to ${workerName ?? workerId}...`);

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/terminal/${workerId}`);
    socketRef.current = socket;

    const dataDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });

    socket.addEventListener("open", () => {
      scheduleFit(24);
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        terminal.write(event.data);
      } else if (event.data instanceof Blob) {
        void event.data.text().then((text) => {
          terminal.write(text);
        });
      }
    });

    socket.addEventListener("close", () => {
      terminal.writeln("\r\n[terminal disconnected]");
    });

    socket.addEventListener("error", () => {
      terminal.writeln("\r\n[terminal connection error]");
    });

    return () => {
      dataDisposable.dispose();
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [scheduleFit, workerId, workerName]);

  useEffect(() => {
    if (!workerId) {
      return;
    }

    if (focusRequestKey === undefined) {
      return;
    }

    if (lastFocusRequestRef.current === focusRequestKey) {
      return;
    }
    lastFocusRequestRef.current = focusRequestKey;

    focusTerminal();
    const timer = setTimeout(() => {
      focusTerminal();
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [focusRequestKey, focusTerminal, workerId]);

  return <div className="terminal-panel" ref={containerRef} />;
}

function isShiftEnterEvent(event: KeyboardEvent): boolean {
  return (
    event.type === "keydown" &&
    event.key === "Enter" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to execCommand fallback
    }
  }

  return copyTextWithExecCommand(text);
}

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
  };

  document.addEventListener("copy", onCopy, { once: true });

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.removeEventListener("copy", onCopy);

  return copied;
}
