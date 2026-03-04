import fs from "node:fs";
import path from "node:path";
import express from "express";
import { handleRequestError } from "../http/errorResponse";
import { registerApiRoutes } from "../http/routes/registerApiRoutes";
import type { ServerContext } from "./serverContext";

export function createHttpApp(context: ServerContext): express.Express {
  const app = express();
  app.use(express.json());

  const assetsDir = path.resolve(process.cwd(), "assets");
  if (fs.existsSync(assetsDir)) {
    app.use("/api/assets", express.static(assetsDir));
  }

  registerApiRoutes(app, {
    orchestrator: context.orchestrator,
    hub: context.hub,
    statusMonitor: context.statusMonitor
  });

  const clientDistPath = path.resolve(process.cwd(), "dist/client");
  if (process.env.NODE_ENV === "production" && fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDistPath, "index.html"));
    });
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) {
      return;
    }
    handleRequestError(res, error);
  });

  return app;
}
