import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

interface TerminalPanelProps {
  workerId?: string;
  workerName?: string;
}

export function TerminalPanel({ workerId, workerName }: TerminalPanelProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
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
    fitAddon.fit();
    terminal.writeln("Select a worker to connect its terminal.");

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows
          })
        );
      }
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      socketRef.current?.close();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    socketRef.current?.close();
    socketRef.current = null;
    terminal.clear();

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
      fitAddon.fit();
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows
        })
      );
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
  }, [workerId, workerName]);

  return <div className="terminal-panel" ref={containerRef} />;
}
