import { z } from "zod";
import type { ResolvedConfig } from "../../shared/types";

const avatarSchema = z.string().trim().min(1);

const projectSchema = z.object({
  path: z.string().min(1),
  shortName: z.string().min(1),
  label: z.string().min(1).optional(),
  source: z.enum(["config", "discovered"]).optional()
});

const runtimeSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  label: z.string().min(1)
});

const shortcutSchema = z.object({
  label: z.string().min(1),
  project: z.string().min(1),
  runtime: z.string().min(1),
  command: z.array(z.string().min(1)).min(1).optional(),
  avatar: avatarSchema.optional(),
  hotkeys: z.array(z.string().min(1)).optional()
});

const discoveryRuleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["worktrees", "directories", "glob"]),
  path: z.string().min(1),
  match: z.string().optional(),
  exclude: z.array(z.string()).optional(),
  maxDepth: z.number().int().min(0).optional()
});

const backendSchema = z.object({
  tmux: z.object({
    sessionName: z.string().min(1),
    pollIntervalMs: z.number().int().min(250)
  })
});

const serverSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535)
});

export const partialConfigSchema = z
  .object({
    projects: z.record(projectSchema).optional(),
    runtimes: z.record(runtimeSchema).optional(),
    shortcuts: z.array(shortcutSchema).optional(),
    discovery: z.array(discoveryRuleSchema).optional(),
    backend: z
      .object({
        tmux: z
          .object({
            sessionName: z.string().min(1).optional(),
            pollIntervalMs: z.number().int().min(250).optional()
          })
          .optional()
      })
      .optional(),
    server: serverSchema.partial().optional()
  })
  .passthrough();

export const resolvedConfigSchema = z.object({
  projects: z.record(projectSchema),
  runtimes: z.record(runtimeSchema),
  shortcuts: z.array(shortcutSchema),
  discovery: z.array(discoveryRuleSchema),
  backend: backendSchema,
  server: serverSchema
});

export function createDefaultConfig(): ResolvedConfig {
  return {
    projects: {
      overworld: {
        path: process.cwd(),
        shortName: "ow",
        label: "Overworld",
        source: "config"
      }
    },
    runtimes: {
      shell: {
        command: ["bash"],
        label: "Shell"
      }
    },
    shortcuts: [
      {
        label: "OW",
        project: "overworld",
        runtime: "shell"
      }
    ],
    discovery: [],
    backend: {
      tmux: {
        sessionName: "overworld",
        pollIntervalMs: 2500
      }
    },
    server: {
      host: "127.0.0.1",
      port: 7600
    }
  };
}
