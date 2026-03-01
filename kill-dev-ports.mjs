#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const requestedPorts = process.argv
  .slice(2)
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value > 0);

const ports = requestedPorts.length > 0 ? requestedPorts : [7600, 7601];
const waitMs = 1200;
const pollMs = 100;

if (!hasLsof()) {
  process.exit(0);
}

const initial = collectPids(ports);
if (initial.length === 0) {
  process.exit(0);
}

for (const pid of initial) {
  killPid(pid, "SIGTERM");
}

const deadline = Date.now() + waitMs;
while (Date.now() < deadline) {
  if (collectPids(ports).length === 0) {
    process.exit(0);
  }
  await delay(pollMs);
}

for (const pid of collectPids(ports)) {
  killPid(pid, "SIGKILL");
}

function hasLsof() {
  try {
    execFileSync("lsof", ["-v"], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

function collectPids(targetPorts) {
  const pids = new Set();

  for (const port of targetPorts) {
    for (const pid of listPortPids(port)) {
      if (pid !== process.pid) {
        pids.add(pid);
      }
    }
  }

  return [...pids];
}

function listPortPids(port) {
  try {
    const output = execFileSync("lsof", ["-ti", `TCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    return output
      .split(/\s+/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // Ignore races and permission errors.
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
