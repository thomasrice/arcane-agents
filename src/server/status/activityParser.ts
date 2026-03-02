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
  { tool: "terminal", label: "Terminal", regex: /\b(claude|terminal|tmux)\b/i }
];

const inputPromptLineMatchers: RegExp[] = [
  /\[(?:Y\/n|y\/N|y\/n|N\/y)\]\s*$/i,
  /\b(?:press enter|press any key)\b/i,
  /\b(?:waiting for input|awaiting input|awaiting confirmation)\b/i,
  /\b(?:select (?:an )?option|enter choice|choose (?:an )?option)\b[:?]?\s*$/i,
  /\b(?:allow|approve|confirm|continue|proceed)\b[^\n]{0,40}\?\s*$/i
];
const errorLineMatchers: RegExp[] = [
  /\btraceback\b/i,
  /\bexception\b/i,
  /\berror:\b/i,
  /^\s*(?:error|err)\b/i,
  /\bnpm err!\b/i,
  /\bcommand not found\b/i,
  /\bno such file or directory\b/i,
  /\bpermission denied\b/i,
  /\bsigterm\b/i,
  /\bpanic\b/i,
  /\bfatal\b/i,
  /\bfailed\b(?:\s+with|\s+to|:)/i
];

const filePathRegex =
  /(?:^|\s|"|')((?:~|\.|\.\.|\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.[A-Za-z][A-Za-z0-9_-]{0,7})(?=$|\s|"|'|:|,|\))/;
const shellCommands = new Set(["bash", "zsh", "fish", "sh", "nu", "pwsh"]);

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
  const needsInput = hasInputPromptSignal(newestFirst);
  const hasError = hasErrorSignal(newestFirst);

  const toolResult = findTool(newestFirst);
  const filePath = findFilePath(newestFirst);
  const fallbackLine = newestFirst.find(
    (line) => line.length > 3 && !line.startsWith("[") && !isRuntimeHintLine(line)
  );

  const activityText =
    toolResult && filePath
      ? `${toolResult.label} ${filePath}`
      : toolResult
        ? `${toolResult.label}`
        : filePath
          ? `Working on ${filePath}`
          : fallbackLine;

  const status = deriveStatus(currentCommand, needsInput, hasError);

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

function hasInputPromptSignal(linesNewestFirst: string[]): boolean {
  const latest = linesNewestFirst[0] ?? "";
  const secondLatest = linesNewestFirst[1] ?? "";

  if (isInputPromptLine(latest)) {
    return true;
  }

  return isShellPromptLine(latest) && isInputPromptLine(secondLatest);
}

function isInputPromptLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 220) {
    return false;
  }

  return inputPromptLineMatchers.some((matcher) => matcher.test(trimmed));
}

function isShellPromptLine(line: string): boolean {
  return /[$#>]\s*$/.test(line.trimEnd());
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

function isRuntimeHintLine(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  return normalized.includes("ctrl+t variants") || normalized.includes("ctrl+p commands") || normalized.includes("tab agents");
}

function hasErrorSignal(linesNewestFirst: string[]): boolean {
  for (const line of linesNewestFirst.slice(0, 20)) {
    const normalized = normalizeStatusLine(line);
    if (!normalized || isRuntimeHintLine(normalized)) {
      continue;
    }

    if (errorLineMatchers.some((matcher) => matcher.test(normalized))) {
      return true;
    }
  }

  return false;
}

function normalizeStatusLine(line: string): string {
  return line.replace(/^[\s│┃╹▀▣⬝■]+/, "").trim();
}

function deriveStatus(currentCommand: string, needsInput: boolean, hasError: boolean): WorkerStatus {
  if (needsInput) {
    return "attention";
  }

  if (hasError) {
    return "error";
  }

  if (shellCommands.has(currentCommand.toLowerCase())) {
    return "idle";
  }

  return "working";
}
