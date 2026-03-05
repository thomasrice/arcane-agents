import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { TmuxRef } from "../../shared/types";

const execFileAsync = promisify(execFile);

interface SpawnTmuxInput {
  workerId: string;
  windowName: string;
  projectPath: string;
  command: string[];
  projectId: string;
  runtimeId: string;
  runtimeLabel: string;
}

interface PaneState {
  currentCommand: string;
  isDead: boolean;
  currentPath?: string;
  panePid?: number;
}

interface StopOptions {
  background?: boolean;
}

interface SendInputOptions {
  submit?: boolean;
}

interface ClipboardCommandCandidate {
  binary: string;
  command: string;
}

export interface ManagedWindow {
  window: string;
  pane: string;
  workerId?: string;
  projectId?: string;
  runtimeId?: string;
  runtimeLabel?: string;
  projectPath?: string;
}

export class TmuxAdapter {
  private sessionClipboardConfigured = false;

  constructor(private readonly sessionName: string) {}

  async spawnWorker(input: SpawnTmuxInput): Promise<TmuxRef> {
    const target = `${this.sessionName}:${input.windowName}`;
    const commandLine = input.command.map(shellQuote).join(" ");
    const env = `ARCANE_AGENTS_WORKER_ID=${input.workerId}`;

    if (await this.hasSession()) {
      await this.runTmux([
        "new-window",
        "-d",
        "-t",
        this.sessionName,
        "-n",
        input.windowName,
        "-c",
        input.projectPath,
        "-e",
        env,
        commandLine
      ]);
    } else {
      await this.runTmux([
        "new-session",
        "-d",
        "-s",
        this.sessionName,
        "-n",
        input.windowName,
        "-c",
        input.projectPath,
        "-e",
        env,
        commandLine
      ]);
    }

    await this.ensureSessionClipboardDefaults();

    await this.setWindowMetadata(target, {
      "@arcane_agents_managed": "1",
      "@arcane_agents_worker_id": input.workerId,
      "@arcane_agents_project_id": input.projectId,
      "@arcane_agents_runtime_id": input.runtimeId,
      "@arcane_agents_runtime_label": input.runtimeLabel,
      "@arcane_agents_project_path": input.projectPath
    });

    const [,, paneOutput] = await Promise.all([
      this.runTmux(["set-option", "-w", "-t", target, "automatic-rename", "off"]),
      this.runTmux(["set-option", "-w", "-t", target, "allow-rename", "off"]),
      this.runTmux(["list-panes", "-t", target, "-F", "#{pane_id}"])
    ]);
    const pane = firstLine(paneOutput);
    if (!pane) {
      throw new Error(`Unable to resolve tmux pane for ${target}.`);
    }

    return {
      session: this.sessionName,
      window: input.windowName,
      pane
    };
  }

  async stop(ref: TmuxRef, options?: StopOptions): Promise<void> {
    if (options?.background) {
      void this.stopGracefully(ref).catch(() => undefined);
      return;
    }

    await this.stopGracefully(ref);
  }

  async ensureSessionClipboardDefaults(): Promise<void> {
    if (this.sessionClipboardConfigured) {
      return;
    }

    if (!(await this.hasSession())) {
      return;
    }

    const copyCommand = await detectClipboardCopyCommand();
    if (!copyCommand) {
      this.sessionClipboardConfigured = true;
      return;
    }

    await Promise.all([
      this.runTmux(["set-option", "-t", this.sessionName, "set-clipboard", "external"]),
      this.runTmux(["set-option", "-t", this.sessionName, "copy-command", copyCommand])
    ]).catch(() => undefined);

    this.sessionClipboardConfigured = true;
  }

  async windowExists(ref: TmuxRef): Promise<boolean> {
    try {
      await this.runTmux(["has-session", "-t", this.target(ref)]);
      return true;
    } catch {
      return false;
    }
  }

  async listManagedWindows(): Promise<ManagedWindow[]> {
    if (!(await this.hasSession())) {
      return [];
    }

    const output = await this.runTmux([
      "list-panes",
      "-a",
      "-F",
      "#{window_name}\t#{pane_id}\t#{@arcane_agents_managed}\t#{@arcane_agents_worker_id}\t#{@arcane_agents_project_id}\t#{@arcane_agents_runtime_id}\t#{@arcane_agents_runtime_label}\t#{@arcane_agents_project_path}"
    ]);

    const seenWindows = new Set<string>();
    const windows: ManagedWindow[] = [];

    for (const line of output.split("\n")) {
      if (!line.trim()) {
        continue;
      }

      const [window, pane, managedFlag, workerId, projectId, runtimeId, runtimeLabel, projectPath] = line.split("\t");
      if (managedFlag !== "1") {
        continue;
      }

      if (seenWindows.has(window)) {
        continue;
      }

      seenWindows.add(window);
      windows.push({
        window,
        pane,
        workerId: normalizeOption(workerId),
        projectId: normalizeOption(projectId),
        runtimeId: normalizeOption(runtimeId),
        runtimeLabel: normalizeOption(runtimeLabel),
        projectPath: normalizeOption(projectPath)
      });
    }

    return windows;
  }

  async openInExternalTerminal(ref: TmuxRef, workerId: string): Promise<void> {
    const target = this.target(ref);
    const live = await this.windowExists(ref);
    if (!live) {
      throw new Error(`Cannot open terminal: tmux target '${target}' is not available.`);
    }

    const externalSession = createExternalSessionName(workerId);
    const externalWindowTarget = `${externalSession}:${ref.window}`;

    await this.runTmux(["has-session", "-t", externalSession])
      .then(async () => {
        await this.runTmux(["kill-session", "-t", externalSession]);
      })
      .catch(() => undefined);

    try {
      await this.runTmux(["new-session", "-d", "-t", ref.session, "-s", externalSession]);
      await this.runTmux(["select-window", "-t", externalWindowTarget]);
    } catch (error) {
      await this.runTmux(["kill-session", "-t", externalSession]).catch(() => undefined);
      throw error;
    }

    await new Promise<void>((resolve, reject) => {
      const guardCommand = `tmux has-session -t ${shellQuote(externalSession)} >/dev/null 2>&1 || exit 0; exec tmux attach-session -t ${shellQuote(externalSession)}`;
      const child = spawn(
        "xdg-terminal-exec",
        ["sh", "-lc", guardCommand],
        {
          detached: true,
          stdio: "ignore"
        }
      );

      child.once("error", (error) => {
        const reason = error instanceof Error ? error.message : String(error);
        reject(new Error(`Failed to launch external terminal via xdg-terminal-exec: ${reason}`));
      });

      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }

  async sendInput(ref: TmuxRef, text: string, options?: SendInputOptions): Promise<void> {
    const target = this.target(ref);
    const exists = await this.windowExists(ref);
    if (!exists) {
      throw new Error(`Cannot send input: tmux target '${target}' is not available.`);
    }

    const normalizedText = text.replace(/\r\n?/g, "\n");
    if (normalizedText.length > 0) {
      const lines = normalizedText.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (line.length > 0) {
          await this.runTmux(["send-keys", "-t", target, "-l", line]);
        }

        if (index < lines.length - 1) {
          await this.runTmux(["send-keys", "-t", target, "Enter"]);
        }
      }
    }

    if (options?.submit ?? true) {
      await this.runTmux(["send-keys", "-t", target, "Enter"]);
    }
  }

  async capturePane(ref: TmuxRef, lines = 30): Promise<string> {
    return this.runTmux(["capture-pane", "-t", this.target(ref), "-p", "-S", `-${Math.max(1, lines)}`]);
  }

  async getPaneState(ref: TmuxRef): Promise<PaneState> {
    const output = await this.runTmux([
      "list-panes",
      "-t",
      this.target(ref),
      "-F",
      "#{pane_current_command}\t#{pane_dead}\t#{pane_current_path}\t#{pane_pid}"
    ]);

    const [currentCommand = "", deadFlag = "0", currentPath = "", panePidRaw = ""] = firstLine(output).split("\t");
    const panePid = Number.parseInt(panePidRaw, 10);
    return {
      currentCommand,
      isDead: deadFlag === "1",
      currentPath: currentPath.trim().length > 0 ? currentPath : undefined,
      panePid: Number.isFinite(panePid) && panePid > 0 ? panePid : undefined
    };
  }

  private async hasSession(): Promise<boolean> {
    try {
      await this.runTmux(["has-session", "-t", this.sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  private target(ref: TmuxRef): string {
    return `${ref.session}:${ref.window}`;
  }

  private async runTmux(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("tmux", args, {
      maxBuffer: 1024 * 1024
    });
    return stdout.trimEnd();
  }

  private async setWindowMetadata(target: string, metadata: Record<string, string>): Promise<void> {
    await Promise.all(
      Object.entries(metadata).map(([key, value]) => this.runTmux(["set-option", "-w", "-t", target, key, value]))
    );
  }

  private async stopGracefully(ref: TmuxRef): Promise<void> {
    const target = this.target(ref);
    const exists = await this.windowExists(ref);
    if (!exists) {
      return;
    }

    await this.runTmux(["send-keys", "-t", target, "C-c"]).catch(() => undefined);
    await delay(220);

    const paneInfo = await this.runTmux([
      "list-panes",
      "-t",
      target,
      "-F",
      "#{pane_pid}\t#{pane_current_command}\t#{pane_dead}"
    ]).catch(() => "");
    const [panePidText = "", paneCommand = "", paneDeadFlag = "1"] = firstLine(paneInfo).split("\t");
    const panePid = Number.parseInt(panePidText, 10);
    const currentCommand = paneCommand.trim().toLowerCase();
    const paneDead = paneDeadFlag === "1";

    if (!paneDead && Number.isFinite(panePid) && panePid > 1 && currentCommand !== "bash" && currentCommand !== "zsh") {
      await terminateProcessGroup(panePid).catch(() => undefined);
      await delay(90);
    }

    await this.runTmux(["kill-window", "-t", target]).catch(() => undefined);
  }
}

function firstLine(input: string): string {
  const [line = ""] = input.split("\n");
  return line;
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createExternalSessionName(workerId: string): string {
  const safeId = workerId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "worker";
  const stamp = Date.now().toString(36);
  return `arcane-agents-ext-${safeId}-${stamp}`;
}

function normalizeOption(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

async function detectClipboardCopyCommand(): Promise<string | undefined> {
  const candidates = clipboardCandidatesForPlatform(process.platform);
  for (const candidate of candidates) {
    if (await commandExists(candidate.binary)) {
      return candidate.command;
    }
  }

  return undefined;
}

function clipboardCandidatesForPlatform(platform: NodeJS.Platform): ClipboardCommandCandidate[] {
  if (platform === "darwin") {
    return [{ binary: "pbcopy", command: "pbcopy" }];
  }

  if (platform === "win32") {
    return [{ binary: "clip.exe", command: "clip.exe" }];
  }

  return [
    { binary: "wl-copy", command: "wl-copy" },
    { binary: "xclip", command: "xclip -selection clipboard -in" },
    { binary: "xsel", command: "xsel --clipboard --input" }
  ];
}

async function commandExists(binary: string): Promise<boolean> {
  const locator = process.platform === "win32" ? "where" : "which";

  try {
    await execFileAsync(locator, [binary], {
      maxBuffer: 1024 * 64
    });
    return true;
  } catch {
    return false;
  }
}

async function terminateProcessGroup(panePid: number): Promise<void> {
  const { stdout } = await execFileAsync("ps", ["-o", "pgid=", "-p", String(panePid)], {
    maxBuffer: 1024 * 64
  });
  const pgid = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(pgid) || pgid <= 1) {
    return;
  }

  await execFileAsync("kill", ["-TERM", `-${pgid}`], { maxBuffer: 1024 * 64 }).catch(() => undefined);
  await delay(120);
  await execFileAsync("kill", ["-KILL", `-${pgid}`], { maxBuffer: 1024 * 64 }).catch(() => undefined);
}
