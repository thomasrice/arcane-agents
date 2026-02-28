import type { ActivityTool, WorkerStatus } from "../../shared/types";

export interface ParsedActivity {
  text?: string;
  tool?: ActivityTool;
  filePath?: string;
  needsInput: boolean;
  hasError: boolean;
}

interface ToolMatch {
  tool: ActivityTool;
  label: string;
  regex: RegExp;
}

const toolMatchers: ToolMatch[] = [
  { tool: "read", label: "Reading", regex: /\b(Read|Reading)\b/i },
  { tool: "edit", label: "Editing", regex: /\b(Edit|Patch|apply_patch|Update File)\b/i },
  { tool: "write", label: "Writing", regex: /\b(Write|Add File|Created file|Creating file)\b/i },
  { tool: "grep", label: "Searching", regex: /\b(Grep|ripgrep|\brg\b|searching)\b/i },
  { tool: "glob", label: "Scanning", regex: /\b(Glob|scan files|file pattern)\b/i },
  { tool: "bash", label: "Running", regex: /\b(Bash|npm\b|pnpm\b|yarn\b|pytest\b|cargo\b|go\s+test|git\b)\b/i },
  { tool: "task", label: "Subtask", regex: /\b(Task|subagent|agent)\b/i },
  { tool: "todo", label: "Planning", regex: /\b(TodoWrite|todo\b)\b/i },
  { tool: "web", label: "Fetching", regex: /\b(WebFetch|http|https)\b/i },
  { tool: "terminal", label: "Terminal", regex: /\b(claude|opencode|terminal|tmux)\b/i }
];

const inputPromptRegex =
  /(\[Y\/n\]|\[y\/N\]|allow\?|permission|continue\?|approve|press enter|confirm|select option|waiting for input)/i;
const errorRegex = /(traceback|exception|\berror\b|fatal|sigterm|command not found|panic|failed)/i;

const filePathRegex =
  /(?:^|\s|"|')((?:~|\.|\.\.|\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.[A-Za-z][A-Za-z0-9_-]{0,7})(?=$|\s|"|'|:|,|\))/;

export function parseActivity(currentCommand: string, output: string): {
  status: WorkerStatus;
  activity: ParsedActivity;
} {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-80);

  const newestFirst = [...lines].reverse();
  const recentForStatus = newestFirst.slice(0, 14).join("\n");
  const needsInput = inputPromptRegex.test(recentForStatus);
  const hasError = errorRegex.test(recentForStatus);

  const toolResult = findTool(newestFirst);
  const filePath = findFilePath(newestFirst);
  const fallbackLine = newestFirst.find((line) => line.length > 3 && !line.startsWith("["));

  const activityText =
    toolResult && filePath
      ? `${toolResult.label} ${filePath}`
      : toolResult
        ? `${toolResult.label}`
        : filePath
          ? `Working on ${filePath}`
          : fallbackLine;

  const latestLine = newestFirst[0] ?? "";
  const hasPrompt = /[$#>]\s*$/.test(latestLine);
  const status = deriveStatus(currentCommand, needsInput, hasError, Boolean(toolResult || filePath), hasPrompt);

  return {
    status,
    activity: {
      text: activityText,
      tool: toolResult?.tool,
      filePath,
      needsInput,
      hasError
    }
  };
}

function findTool(linesNewestFirst: string[]): ToolMatch | undefined {
  for (const line of linesNewestFirst) {
    for (const matcher of toolMatchers) {
      if (matcher.regex.test(line)) {
        return matcher;
      }
    }
  }
  return undefined;
}

function findFilePath(linesNewestFirst: string[]): string | undefined {
  for (const line of linesNewestFirst) {
    const match = line.match(filePathRegex);
    if (!match) {
      continue;
    }

    const candidate = match[1];
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function deriveStatus(
  currentCommand: string,
  needsInput: boolean,
  hasError: boolean,
  hasActivitySignal: boolean,
  hasPrompt: boolean
): WorkerStatus {
  if (needsInput) {
    return "attention";
  }

  if (hasError) {
    return "error";
  }

  const shellCommands = new Set(["bash", "zsh", "fish", "sh"]);
  if (shellCommands.has(currentCommand.toLowerCase()) && (hasPrompt || !hasActivitySignal)) {
    return "idle";
  }

  return "working";
}
