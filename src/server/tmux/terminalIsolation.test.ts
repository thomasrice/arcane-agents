import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { expect, it } from "vitest";
import { buildTmuxAttachArgs } from "./tmuxAdapter";

it("isolates views and preserves running panes when a view closes", async () => {
  const socketName = `arcane-test-${randomUUID()}`;
  const tmux = (...args: string[]) => execFileSync("tmux", ["-L", socketName, ...args], { encoding: "utf8" }).trim();
  const clients: pty.IPty[] = [];
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("tmux condition timed out");
  };
  try {
    tmux("-f", "/dev/null", "new-session", "-d", "-s", "managed", "-n", "one", "sleep 120");
    tmux("new-window", "-d", "-t", "managed", "-n", "two", "sleep 120");
    const before = tmux("list-panes", "-s", "-t", "managed", "-F", "#{pane_id}:#{pane_pid}");
    for (const [window, view] of [["one", "view-one"], ["two", "view-two"]]) {
      const client = pty.spawn("tmux", buildTmuxAttachArgs(`managed:${window}`, { socketName }, view), {
        name: "xterm-256color", cols: 80, rows: 24, env: { ...process.env, TERM: "xterm-256color" }
      });
      client.onData(() => {});
      clients.push(client);
      await waitFor(() => tmux("list-clients", "-F", "#{session_name}").includes(view));
      expect(tmux("list-windows", "-t", view, "-F", "#{window_name}")).toBe(window);
      expect(tmux("show-options", "-v", "-t", view, "status")).toBe("off");
    }
    tmux("select-window", "-t", "managed:two");
    expect(tmux("display-message", "-p", "-t", "view-one:", "#{window_name}")).toBe("one");
    expect(tmux("list-panes", "-s", "-t", "managed", "-F", "#{pane_id}:#{pane_pid}")).toBe(before);
    clients[0]!.kill();
    await waitFor(() => !tmux("list-sessions", "-F", "#{session_name}").includes("view-one"));
    expect(tmux("list-panes", "-s", "-t", "managed", "-F", "#{pane_id}:#{pane_pid}")).toBe(before);
  } finally {
    for (const client of clients) { try { client.kill(); } catch { /* already closed */ } }
    tmux("kill-server");
  }
}, 10000);
