import fs from "node:fs";
import type { ResolvedConfig } from "../../../shared/types";
import { getArcaneAgentsPaths, loadResolvedConfig } from "../../config/loadConfig";
import { findExecutable } from "../../platform/shell";
import { recommendTmuxInstall } from "../../setup/prerequisites";

type CheckStatus = "ok" | "warn" | "fail";

interface CheckResult {
  status: CheckStatus;
  label: string;
  detail: string;
}

export function runDoctor(): number {
  const checks: CheckResult[] = [];

  const nodeVersion = process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "0", 10);
  if (nodeMajor >= 20) {
    checks.push({ status: "ok", label: "Node.js", detail: `v${nodeVersion}` });
  } else {
    checks.push({ status: "fail", label: "Node.js", detail: `v${nodeVersion} (requires >= 20)` });
  }

  const tmuxPath = findExecutable("tmux");
  if (tmuxPath) {
    checks.push({ status: "ok", label: "tmux", detail: tmuxPath });
  } else {
    const installRecommendation = recommendTmuxInstall({
      platform: process.platform,
      lookupCommand: findExecutable,
      isRootUser: process.getuid?.() === 0
    });
    checks.push({
      status: "fail",
      label: "tmux",
      detail: installRecommendation
        ? `not found on PATH (install with: ${installRecommendation.command})`
        : "not found on PATH"
    });
  }

  const paths = getArcaneAgentsPaths();
  if (fs.existsSync(paths.configPath)) {
    checks.push({ status: "ok", label: "Config", detail: paths.configPath });
  } else {
    checks.push({
      status: "warn",
      label: "Config",
      detail: `missing at ${paths.configPath} (auto-created on 'arcane-agents start' or 'arcane-agents setup')`
    });
  }

  const configResult = safeLoadConfig(paths);
  checks.push(...configResult.checks);

  if (process.platform === "linux") {
    const xdgTerminalExecPath = findExecutable("xdg-terminal-exec");
    if (xdgTerminalExecPath) {
      checks.push({ status: "ok", label: "xdg-terminal-exec", detail: xdgTerminalExecPath });
    } else {
      checks.push({
        status: "warn",
        label: "xdg-terminal-exec",
        detail: "optional dependency for external terminal button"
      });
    }
  }

  printDoctorReport(checks);
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

function safeLoadConfig(paths: ReturnType<typeof getArcaneAgentsPaths>): { checks: CheckResult[] } {
  const checks: CheckResult[] = [];
  let config: ResolvedConfig;

  try {
    config = loadResolvedConfig(paths);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown config load error";
    checks.push({ status: "fail", label: "Config parse", detail: `${paths.configPath}: ${detail}` });
    return { checks };
  }

  checks.push({
    status: "ok",
    label: "Config parse",
    detail: `${Object.keys(config.projects).length} projects, ${Object.keys(config.runtimes).length} runtimes`
  });

  const runtimeCommandResults = checkRuntimeCommands(config);
  checks.push(...runtimeCommandResults.checks);
  return { checks };
}

function checkRuntimeCommands(config: ResolvedConfig): { checks: CheckResult[] } {
  const checks: CheckResult[] = [];
  let availableRuntimeCount = 0;

  for (const [runtimeId, runtime] of Object.entries(config.runtimes)) {
    const executable = runtime.command[0];
    const executablePath = findExecutable(executable);

    if (executablePath) {
      availableRuntimeCount += 1;
      checks.push({
        status: "ok",
        label: `Runtime ${runtimeId}`,
        detail: `${executable} -> ${executablePath}`
      });
    } else {
      checks.push({
        status: "warn",
        label: `Runtime ${runtimeId}`,
        detail: `${executable} not found on PATH`
      });
    }
  }

  if (availableRuntimeCount > 0) {
    checks.push({
      status: "ok",
      label: "Runtime availability",
      detail: `${availableRuntimeCount} runtime command(s) available`
    });
  } else {
    checks.push({
      status: "fail",
      label: "Runtime availability",
      detail: "no configured runtime commands found on PATH"
    });
  }

  return { checks };
}

function printDoctorReport(checks: CheckResult[]): void {
  console.log("[arcane-agents] doctor report");
  for (const check of checks) {
    console.log(`[${check.status}] ${check.label}: ${check.detail}`);
  }

  const hasFailure = checks.some((check) => check.status === "fail");
  if (hasFailure) {
    console.log("[arcane-agents] doctor found blocking issues.");
  } else {
    console.log("[arcane-agents] doctor passed.");
  }
}
