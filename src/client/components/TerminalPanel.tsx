import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

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

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: false,
      cursorStyle: "block",
      cursorInactiveStyle: "block",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: "#111a17",
        foreground: "#eaf3de",
        cursor: "#f5f2d0"
      }
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

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
      socketRef.current?.close();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [scheduleFit]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    socketRef.current?.close();
    socketRef.current = null;
    terminal.clear();
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
