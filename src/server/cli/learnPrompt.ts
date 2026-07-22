import YAML from "yaml";
import type { PromptSignature, ResolvedConfig, Worker } from "../../shared/types";
import { applySessionOverrides, getArcaneAgentsPaths, loadResolvedConfig } from "../config/loadConfig";
import { parseActivity } from "../status/activityParser";
import {
  claudeAdapter,
  codexAdapter,
  ompAdapter,
  openCodeAdapter,
  resolveRuntimeAdapter,
  type RuntimeAdapter
} from "../status/runtimes/adapter";
import { TmuxAdapter } from "../tmux/tmuxAdapter";
import { appendPromptSignature } from "./learnPromptConfig";
import { generatePromptPatterns } from "./learnPromptGenerator";
import { promptConfirm } from "./prompts";

type LearnPromptRuntime = "claude" | "codex" | "opencode" | "omp";

export interface LearnPromptOptions {
  worker: string;
  runtime?: LearnPromptRuntime;
  id?: string;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
}

interface LearnPromptResult {
  workerId: string;
  runtime: LearnPromptRuntime;
  signature: PromptSignature;
  localOverridePath: string;
  written: boolean;
  restartRequired: boolean;
  declined?: boolean;
}

export interface LearnPromptDependencies {
  getPaths: typeof getArcaneAgentsPaths;
  loadConfig: typeof loadResolvedConfig;
  applyOverrides: typeof applySessionOverrides;
  fetchWorkers: (config: ResolvedConfig) => Promise<Worker[]>;
  createTmux: (config: ResolvedConfig) => Pick<TmuxAdapter, "getPaneState" | "captureVisiblePane">;
  confirm: (question: string) => Promise<boolean>;
  appendSignature: typeof appendPromptSignature;
  isInteractive: () => boolean;
  output: (message: string) => void;
  error: (message: string) => void;
}

const defaultDependencies: LearnPromptDependencies = {
  getPaths: getArcaneAgentsPaths,
  loadConfig: loadResolvedConfig,
  applyOverrides: applySessionOverrides,
  fetchWorkers: fetchCurrentWorkers,
  createTmux: (config) => new TmuxAdapter(config.backend.tmux),
  confirm: promptConfirm,
  appendSignature: appendPromptSignature,
  isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  output: (message) => console.log(message),
  error: (message) => console.error(message)
};

export async function runLearnPrompt(
  args: string[],
  sessionName: string | undefined,
  overrides: Partial<LearnPromptDependencies> = {}
): Promise<number> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const wantsJson = args.includes("--json");
  let options: LearnPromptOptions;
  try {
    options = parseLearnPromptOptions(args);
  } catch (error) {
    return reportFailure(error, wantsJson, dependencies);
  }

  try {
    const paths = dependencies.getPaths(sessionName);
    const config = dependencies.applyOverrides(dependencies.loadConfig(paths), sessionName);
    const worker = resolveWorker(await dependencies.fetchWorkers(config), options.worker);
    const tmux = dependencies.createTmux(config);
    const [paneState, visiblePane] = await Promise.all([
      tmux.getPaneState(worker.tmuxRef),
      tmux.captureVisiblePane(worker.tmuxRef)
    ]);
    if (paneState.isDead) {
      throw new Error("Refusing calibration because the worker pane has stopped.");
    }
    const runtimeId = resolveRuntimeId(options.runtime, worker, paneState.currentCommand, visiblePane);
    const runtimeSignals = adapterForRuntime(runtimeId).detect(visiblePane);
    const parsedActivity = parseActivity(paneState.currentCommand, visiblePane).activity;

    if (runtimeSignals.active) {
      throw new Error("Refusing calibration while the runtime reports active work. Wait for its prompt, then try again.");
    }
    if (runtimeSignals.awaitingInput || runtimeSignals.awaitingApproval || parsedActivity.needsInput) {
      throw new Error("Refusing calibration while the pane is waiting for input or approval. Resolve it, then try again.");
    }
    if (parsedActivity.hasError && !runtimeSignals.prompt) {
      throw new Error("Refusing calibration while the pane contains a current parsed error screen. Resolve it, then try again.");
    }

    const all = generatePromptPatterns(runtimeId, visiblePane);
    if (!all) {
      throw new Error("Could not derive two independent structural prompt patterns. Configure status.extraPromptSignatures manually.");
    }

    const id = options.id ?? `${runtimeId}-${workerSlug(worker)}-prompt`;
    ensureUniqueId(id, config.status.promptSignatures);
    const signature: PromptSignature = { id, runtime: runtimeId, all };
    const preview = { workerId: worker.id, runtime: runtimeId, signature, localOverridePath: paths.localOverridePath };

    if (!options.json) {
      dependencies.output(formatPreview(preview));
    }
    if (options.dryRun) {
      reportSuccess({ ...preview, written: false, restartRequired: false }, options.json, dependencies);
      return 0;
    }

    if (!options.yes) {
      if (!dependencies.isInteractive()) {
        throw new Error("Refusing to write without an interactive TTY. Re-run with --yes after reviewing a --dry-run preview.");
      }
      const confirmed = await dependencies.confirm("Write this prompt signature? [y/N] ");
      if (!confirmed) {
        reportSuccess({ ...preview, written: false, restartRequired: false, declined: true }, options.json, dependencies);
        return 0;
      }
    }

    await dependencies.appendSignature(paths.localOverridePath, signature);
    reportSuccess({ ...preview, written: true, restartRequired: true }, options.json, dependencies);
    return 0;
  } catch (error) {
    return reportFailure(error, options.json, dependencies);
  }
}

export function parseLearnPromptOptions(args: string[]): LearnPromptOptions {
  let worker: string | undefined;
  let runtime: LearnPromptRuntime | undefined;
  let id: string | undefined;
  let dryRun = false;
  let yes = false;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--runtime" || arg === "--id") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      if (arg === "--runtime") {
        if (runtime !== undefined) throw new Error("--runtime may only be supplied once.");
        if (!isRuntime(value)) throw new Error("--runtime must be one of: claude, codex, opencode, omp.");
        runtime = value;
      } else {
        if (id !== undefined) throw new Error("--id may only be supplied once.");
        if (value.trim().length === 0) throw new Error("--id must not be empty.");
        id = value.trim();
      }
      index += 1;
      continue;
    }
    if (arg === "--dry-run" || arg === "--yes" || arg === "--json") {
      if (arg === "--dry-run") {
        if (dryRun) throw new Error("--dry-run may only be supplied once.");
        dryRun = true;
      } else if (arg === "--yes") {
        if (yes) throw new Error("--yes may only be supplied once.");
        yes = true;
      } else {
        if (json) throw new Error("--json may only be supplied once.");
        json = true;
      }
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option '${arg}'.`);
    if (worker !== undefined) throw new Error("Provide exactly one worker ID or name.");
    worker = arg;
  }

  if (!worker) throw new Error("Missing worker. Usage: arcane-agents status learn-prompt <worker> [options]");
  if (dryRun && yes) throw new Error("--dry-run and --yes cannot be used together.");
  if (json && !dryRun && !yes) throw new Error("--json requires --dry-run or --yes.");
  return { worker, runtime, id, dryRun, yes, json };
}

export function resolveWorker(workers: Worker[], query: string): Worker {
  const exactId = workers.find((worker) => worker.id === query);
  if (exactId) return exactId;
  const normalized = query.toLocaleLowerCase();
  const matches = workers.filter((worker) => worker.displayName?.toLocaleLowerCase() === normalized || worker.name.toLocaleLowerCase() === normalized);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Worker '${query}' is ambiguous. Candidates: ${matches.map((worker) => `${worker.id} (${worker.displayName ?? worker.name})`).join(", ")}.`);
  }
  throw new Error(`No live worker matches '${query}'.`);
}

async function fetchCurrentWorkers(config: ResolvedConfig): Promise<Worker[]> {
  const host = loopbackHost(process.env.ARCANE_AGENTS_API_HOST ?? config.server.host);
  const portRaw = process.env.ARCANE_AGENTS_API_PORT ?? String(config.server.port);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid Arcane Agents API port '${portRaw}'.`);
  }
  const response = await fetch(`http://${host}:${port}/api/workers`);
  if (!response.ok) throw new Error(`Could not load live workers (HTTP ${response.status}). Is Arcane Agents running?`);
  const payload: unknown = await response.json();
  if (!isWorkersPayload(payload)) throw new Error("The live workers API returned an invalid response.");
  return payload.workers;
}

function resolveRuntimeId(
  requestedRuntime: LearnPromptRuntime | undefined,
  worker: Worker,
  currentCommand: string,
  capturedPane: string
): LearnPromptRuntime {
  if (requestedRuntime) {
    return requestedRuntime;
  }
  const adapter = resolveRuntimeAdapter(worker, currentCommand.toLowerCase(), undefined, capturedPane);
  if (adapter.id === "generic") {
    throw new Error("Could not determine the runtime for this worker. Re-run with --runtime claude|codex|opencode|omp.");
  }
  return adapter.id;
}

function adapterForRuntime(runtime: LearnPromptRuntime): RuntimeAdapter {
  switch (runtime) {
    case "claude":
      return claudeAdapter;
    case "codex":
      return codexAdapter;
    case "opencode":
      return openCodeAdapter;
    case "omp":
      return ompAdapter;
  }
}

function ensureUniqueId(id: string, signatures: readonly PromptSignature[]): void {
  if (signatures.some((signature) => signature.id === id)) {
    throw new Error(`Prompt signature id '${id}' already exists in the effective configuration.`);
  }
}

function workerSlug(worker: Worker): string {
  const source = worker.displayName ?? worker.name;
  const slug = source.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || worker.id.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "worker";
}

function reportSuccess(
  value: LearnPromptResult,
  json: boolean,
  dependencies: LearnPromptDependencies
): void {
  if (json) {
    dependencies.output(JSON.stringify({ ok: true, ...value }));
    return;
  }
  if (value.declined) dependencies.output("[arcane-agents] declined; config was not changed.");
  if (value.written) dependencies.output(`[arcane-agents] wrote ${value.localOverridePath}. Restart Arcane Agents to load the new prompt signature.`);
}

function reportFailure(error: unknown, json: boolean, dependencies: LearnPromptDependencies): number {
  const message = error instanceof Error ? error.message : String(error);
  if (json) dependencies.output(JSON.stringify({ ok: false, error: message }));
  else dependencies.error(`[arcane-agents] ${message}`);
  return 1;
}

function formatPreview(value: { signature: PromptSignature; localOverridePath: string }): string {
  const addition = YAML.stringify({ status: { extraPromptSignatures: [value.signature] } }).trimEnd();
  return `[arcane-agents] proposed config.local.yaml addition:\n${addition}\ntarget: ${value.localOverridePath}`;
}

function isRuntime(value: string): value is LearnPromptRuntime {
  return value === "claude" || value === "codex" || value === "opencode" || value === "omp";
}

function loopbackHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed === "0.0.0.0" || trimmed === "::" || trimmed === "[::]" || trimmed === "*") {
    return "127.0.0.1";
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed;
  }
  return trimmed.includes(":") ? `[${trimmed}]` : trimmed;
}

function isWorkersPayload(value: unknown): value is { workers: Worker[] } {
  return typeof value === "object" && value !== null && "workers" in value && Array.isArray(value.workers);
}
