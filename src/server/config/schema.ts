import { z } from "zod";
import type { ResolvedConfig } from "../../shared/types";

export const defaultInteractiveCommands = [
  "nvim", "vim", "vi", "nano", "helix", "hx",
  "emacs", "emacsclient",
  "less", "more", "man",
  "htop", "btop", "top",
  "watch", "lazygit", "lazydocker",
  "ranger", "nnn", "lf", "yazi",
  "tmux"
];

const avatarSchema = z.string().trim().min(1);
const activityToolSchema = z.enum([
  "read",
  "edit",
  "write",
  "bash",
  "grep",
  "glob",
  "task",
  "todo",
  "web",
  "terminal",
  "unknown"
]);

const regexMatchFields = ["displayName", "command", "lastLine"] as const;

const statusRuleMatchSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    runtimeId: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    lastLine: z.string().min(1).optional()
  })
  .refine((match) => Object.values(match).some((value) => value !== undefined), {
    message: "A status rule must define at least one match field."
  });

const statusRuleOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("idle")
  }).strict(),
  z.object({
    status: z.enum(["working", "attention", "error"]),
    activityText: z.string().min(1).optional(),
    activityTool: activityToolSchema.optional()
  }).strict()
]);

const statusRuleSchema = z
  .object({
    id: z.string().trim().min(1),
    match: statusRuleMatchSchema,
    set: statusRuleOutcomeSchema
  })
  .superRefine((rule, context) => {
    for (const field of regexMatchFields) {
      const pattern = rule.match[field];
      if (pattern === undefined) {
        continue;
      }

      try {
        new RegExp(pattern);
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["match", field],
          message: `Status rule '${rule.id}' has invalid ${field} regex: ${
            error instanceof Error ? error.message : String(error)
          }`
        });
      }
    }
  });

const statusRulesSchema = z.array(statusRuleSchema).superRefine((rules, context) => {
  const firstIndexById = new Map<string, number>();
  rules.forEach((rule, index) => {
    const firstIndex = firstIndexById.get(rule.id);
    if (firstIndex !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "id"],
        message: `Status rule id '${rule.id}' duplicates rule at index ${firstIndex}.`
      });
      return;
    }
    firstIndexById.set(rule.id, index);
  });
});

const projectSchema = z.object({
  path: z.string().min(1),
  shortName: z.string().min(1),
  label: z.string().min(1).optional(),
  source: z.enum(["config", "discovered"]).optional()
});

const runtimeSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  label: z.string().min(1),
  freshnessWindowMs: z.number().int().min(1_000).optional()
});

const shortcutSchema = z.object({
  label: z.string().min(1),
  project: z.string().min(1),
  runtime: z.string().min(1),
  command: z.array(z.string().min(1)).min(1).optional(),
  avatar: avatarSchema.optional(),
  hotkeys: z.array(z.string().min(1)).optional()
});

const keybindingsSchema = z.object({
  leaveTerminalFocus: z.array(z.string().min(1)).min(1)
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
    socketName: z.string().min(1),
    sessionName: z.string().min(1),
    pollIntervalMs: z.number().int().min(250)
  })
});

const serverSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535)
});

const statusSchema = z.object({
  interactiveCommands: z.array(z.string().min(1)),
  rules: statusRulesSchema
});

const audioSchema = z.object({
  enableSound: z.boolean()
});

const avatarsSchema = z.object({
  disabled: z.array(avatarSchema)
});

export const partialConfigSchema = z
  .object({
    projects: z.record(projectSchema).optional(),
    runtimes: z.record(runtimeSchema).optional(),
    shortcuts: z.array(shortcutSchema).optional(),
    keybindings: keybindingsSchema.partial().optional(),
    discovery: z.array(discoveryRuleSchema).optional(),
    avatars: avatarsSchema.partial().optional(),
    status: statusSchema.partial().extend({
      extraInteractiveCommands: z.array(z.string().min(1)).optional()
    }).optional(),
    audio: audioSchema.partial().optional(),
    backend: z
      .object({
        tmux: z
          .object({
            socketName: z.string().min(1).optional(),
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
  keybindings: keybindingsSchema,
  avatars: avatarsSchema,
  status: statusSchema,
  audio: audioSchema,
  backend: backendSchema,
  server: serverSchema
});

export function createDefaultConfig(): ResolvedConfig {
  return {
    projects: {
      "arcane-agents": {
        path: process.cwd(),
        shortName: "aa",
        label: "Arcane Agents",
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
        label: "AA",
        project: "arcane-agents",
        runtime: "shell"
      }
    ],
    discovery: [],
    keybindings: {
      leaveTerminalFocus: ["Ctrl+Alt+]"]
    },
    avatars: {
      disabled: []
    },
    status: {
      interactiveCommands: defaultInteractiveCommands,
      rules: []
    },
    audio: {
      enableSound: true
    },
    backend: {
      tmux: {
        socketName: "arcane-agents",
        sessionName: "arcane-agents",
        pollIntervalMs: 2500
      }
    },
    server: {
      host: "127.0.0.1",
      port: 7600
    }
  };
}
