import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 7600,
    proxy: {
      "/api/ws": {
        target: "ws://127.0.0.1:7601",
        ws: true,
      },
      "/api/terminal": {
        target: "ws://127.0.0.1:7601",
        ws: true,
      },
      "/api": {
        target: "http://127.0.0.1:7601",
        changeOrigin: false,
      },
    }
  },
  build: {
    outDir: "dist/client",
    target: "es2021"
  }
});
