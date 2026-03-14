import { spawn, spawnSync } from "node:child_process";

const DEFAULT_HOST = "127.0.0.1";
const CLIENT_PORT = "7600";
const API_PORT = "7601";

function printHelp() {
  console.log(`Usage: npm run dev -- [--host [bind-host]] [--allow-host hostname]

Examples:
  npm run dev
  npm run dev -- --host
  npm run dev -- --host 192.168.1.42
  npm run dev -- --host --allow-host waystone

Flags:
  --host        Bind both the Vite dev server and the API to a host.
                When passed without a value, uses 0.0.0.0 so other
                computers on the LAN can connect.
  --allow-host  Allow Vite to answer requests for a hostname such as
                a Tailscale MagicDNS name.
  -h, --help    Show this help output.`);
}

function parseArgs(argv) {
  let host = DEFAULT_HOST;
  const allowedHosts = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--host") {
      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        host = next;
        index += 1;
      } else {
        host = "0.0.0.0";
      }
      continue;
    }

    if (arg === "--allow-host") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) {
        console.error("[arcane-agents] missing value for --allow-host.");
        process.exit(1);
      }
      allowedHosts.push(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--host=")) {
      const value = arg.slice("--host=".length).trim();
      if (!value) {
        console.error("[arcane-agents] missing value for --host.");
        process.exit(1);
      }
      host = value;
      continue;
    }

    if (arg.startsWith("--allow-host=")) {
      const value = arg.slice("--allow-host=".length).trim();
      if (!value) {
        console.error("[arcane-agents] missing value for --allow-host.");
        process.exit(1);
      }
      allowedHosts.push(value);
      continue;
    }

    console.error(`[arcane-agents] unknown dev flag: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return { host, allowedHosts };
}

function isIpLiteral(host) {
  return /^[\d.]+$/.test(host) || host.includes(":");
}

function isDefaultAllowedHost(host) {
  return host === "localhost" || host.endsWith(".localhost") || isIpLiteral(host);
}

function shouldAutoAllowHost(host) {
  return host.length > 0 && host !== "0.0.0.0" && host !== "::" && !isDefaultAllowedHost(host);
}

function resolveProxyHost(host) {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }

  if (host === "::") {
    return "::1";
  }

  return host;
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runChecked(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const { host, allowedHosts: cliAllowedHosts } = parseArgs(process.argv.slice(2));
const allowedHosts = new Set(cliAllowedHosts);

if (shouldAutoAllowHost(host)) {
  allowedHosts.add(host);
}

const env = {
  ...process.env,
  ARCANE_AGENTS_API_HOST: host,
  ARCANE_AGENTS_API_PORT: API_PORT,
  ARCANE_AGENTS_DEV_CLIENT_HOST: host,
  ARCANE_AGENTS_DEV_CLIENT_PORT: CLIENT_PORT,
  ARCANE_AGENTS_DEV_API_HOST: resolveProxyHost(host),
  ARCANE_AGENTS_DEV_API_PORT: API_PORT,
  ARCANE_AGENTS_DEV_ALLOWED_HOSTS: Array.from(allowedHosts).join(",")
};

if (host === DEFAULT_HOST) {
  console.log("[arcane-agents] starting dev mode on localhost only.");
} else if (host === "0.0.0.0") {
  console.log("[arcane-agents] starting dev mode on all network interfaces.");
  console.log("[arcane-agents] open http://<this-machine-ip>:7600 from another computer on your LAN.");
} else {
  console.log(`[arcane-agents] starting dev mode on ${host}.`);
}

if (allowedHosts.size > 0) {
  console.log(`[arcane-agents] allowing dev requests for: ${Array.from(allowedHosts).join(", ")}`);
}

const npmCommand = getNpmCommand();

runChecked(npmCommand, ["run", "dev:clean"], env);

const child = spawn(npmCommand, ["run", "dev:stack"], {
  stdio: "inherit",
  env
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
