import http from "node:http";
import { createHttpApp } from "./bootstrap/httpApp";
import { isNonDefaultSession } from "./config/loadConfig";
import { createServerContext } from "./bootstrap/serverContext";
import { registerShutdownHandlers } from "./bootstrap/shutdown";
import { attachUpgradeHandler, createWsServers } from "./bootstrap/websocketUpgrade";

const startupBannerLines = [
  "   ▄████████    ▄████████  ▄████████    ▄████████ ███▄▄▄▄      ▄████████      ",
  "  ███    ███   ███    ███ ███    ███   ███    ███ ███▀▀▀██▄   ███    ███      ",
  "  ███    ███   ███    ███ ███    █▀    ███    ███ ███   ███   ███    █▀       ",
  "  ███    ███  ▄███▄▄▄▄██▀ ███          ███    ███ ███   ███  ▄███▄▄▄          ",
  "▀███████████ ▀▀███▀▀▀▀▀   ███        ▀███████████ ███   ███ ▀▀███▀▀▀          ",
  "  ███    ███ ▀███████████ ███    █▄    ███    ███ ███   ███   ███    █▄       ",
  "  ███    ███   ███    ███ ███    ███   ███    ███ ███   ███   ███    ███      ",
  "  ███    █▀    ███    ███ ████████▀    ███    █▀   ▀█   █▀    ██████████      ",
  "               ███    ███                                                      ",
  "",
  "   ▄████████    ▄██████▄     ▄████████ ███▄▄▄▄       ███        ▄████████     ",
  "  ███    ███   ███    ███   ███    ███ ███▀▀▀██▄ ▀█████████▄   ███    ███     ",
  "  ███    ███   ███    █▀    ███    █▀  ███   ███    ▀███▀▀██   ███    █▀      ",
  "  ███    ███  ▄███         ▄███▄▄▄     ███   ███     ███   ▀   ███            ",
  "▀███████████ ▀▀███ ████▄  ▀▀███▀▀▀     ███   ███     ███     ▀███████████     ",
  "  ███    ███   ███    ███   ███    █▄  ███   ███     ███              ███     ",
  "  ███    ███   ███    ███   ███    ███ ███   ███     ███        ▄█    ███     ",
  "  ███    █▀    ████████▀    ██████████  ▀█   █▀     ▄████▀    ▄████████▀      ",
  "                                                                              "
];

const startupBannerColorScale = ["\u001b[38;5;159m", "\u001b[38;5;123m", "\u001b[38;5;87m", "\u001b[38;5;51m"];
const ansiReset = "\u001b[0m";

function supportsBannerColor(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  const forceColor = process.env.FORCE_COLOR;
  if (forceColor !== undefined) {
    return forceColor !== "0";
  }

  if (!process.stdout.isTTY) {
    return false;
  }

  return process.env.TERM !== "dumb";
}

function renderStartupBanner(): string {
  if (!supportsBannerColor()) {
    return startupBannerLines.join("\n");
  }

  const maxIndex = startupBannerColorScale.length - 1;
  const lineCount = Math.max(1, startupBannerLines.length - 1);

  return startupBannerLines
    .map((line, lineIndex) => {
      if (line.trim().length === 0) {
        return line;
      }

      const paletteIndex = Math.max(0, Math.min(maxIndex, Math.round((lineIndex / lineCount) * maxIndex)));
      return `${startupBannerColorScale[paletteIndex]}${line}${ansiReset}`;
    })
    .join("\n");
}

export async function bootstrap(sessionName?: string): Promise<void> {
  console.log(renderStartupBanner());

  if (isNonDefaultSession(sessionName)) {
    console.log(`[arcane-agents] launching Arcane Agents (session: ${sessionName})...`);
  } else {
    console.log("[arcane-agents] launching Arcane Agents...");
  }

  const context = await createServerContext(sessionName);
  context.statusMonitor.start();

  const app = createHttpApp(context);
  const server = http.createServer(app);
  const wsServers = createWsServers(context);
  attachUpgradeHandler(server, wsServers);

  const host = process.env.ARCANE_AGENTS_API_HOST ?? context.config.server.host;
  const port = Number(process.env.ARCANE_AGENTS_API_PORT ?? context.config.server.port);
  const appUrl = `http://${host}:${port}`;

  server.listen(port, host, () => {
    console.log("[arcane-agents] Arcane Agents is ready.");
    console.log(`[arcane-agents] app: ${appUrl}`);
    console.log("[arcane-agents] github: https://github.com/thomasrice/arcane-agents");
    console.log(`[arcane-agents] config: ${context.paths.configPath}`);
    console.log("[arcane-agents] press Ctrl-C to stop.");
  });

  registerShutdownHandlers({
    statusMonitor: context.statusMonitor,
    server,
    wsServers,
    workers: context.workers
  });
}
