import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function resolveDevPort(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function resolveAllowedHosts(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const hosts = value
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);

  return hosts.length > 0 ? hosts : undefined;
}

export default defineConfig(() => {
  const clientHost = process.env.ARCANE_AGENTS_DEV_CLIENT_HOST ?? "127.0.0.1";
  const clientPort = resolveDevPort(process.env.ARCANE_AGENTS_DEV_CLIENT_PORT, 7600);
  const apiHost = formatHostForUrl(process.env.ARCANE_AGENTS_DEV_API_HOST ?? "127.0.0.1");
  const apiPort = resolveDevPort(process.env.ARCANE_AGENTS_DEV_API_PORT, 7601);
  const allowedHosts = resolveAllowedHosts(process.env.ARCANE_AGENTS_DEV_ALLOWED_HOSTS);
  const apiHttpTarget = `http://${apiHost}:${apiPort}`;
  const apiWsTarget = `ws://${apiHost}:${apiPort}`;

  return {
    plugins: [react()],
    server: {
      host: clientHost,
      port: clientPort,
      allowedHosts,
      proxy: {
        "/api/ws": {
          target: apiWsTarget,
          ws: true,
        },
        "/api/terminal": {
          target: apiWsTarget,
          ws: true,
        },
        "/api": {
          target: apiHttpTarget,
          changeOrigin: false,
        },
      }
    },
    build: {
      outDir: "dist/client",
      target: "es2021"
    }
  };
});
