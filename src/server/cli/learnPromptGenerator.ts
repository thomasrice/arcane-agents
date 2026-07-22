import type { AgentRuntimeId } from "../../shared/types";
import { normalizePromptSignatureLines } from "../status/promptSignatures";

/** Builds two conservative, value-free regexes from stable terminal UI structure. */
export function generatePromptPatterns(runtime: AgentRuntimeId, visiblePane: string): string[] | undefined {
  const lines = normalizePromptSignatureLines(visiblePane);
  const candidates: string[] = [];

  if (runtime === "claude" && lines.some((line) => /^❯(?:\s|$)/.test(line))) {
    candidates.push("^❯(?:\\s|$)");
  } else if (runtime === "codex" && lines.some((line) => /^›(?:\s|$)/.test(line))) {
    candidates.push("^›(?:\\s|$)");
  } else if (runtime === "omp" && lines.some((line) => /^╭.*╮$/u.test(line))) {
    candidates.push("^╭.*╮$");
  } else if (runtime === "opencode") {
    if (lines.some((line) => /\bctrl\+t\s+variants\b/i.test(line))) {
      candidates.push("\\b[Cc][Tt][Rr][Ll]\\+[Tt]\\s+[Vv]ariants\\b");
    }
    if (lines.some((line) => /\bctrl\+p\s+commands\b/i.test(line))) {
      candidates.push("\\b[Cc][Tt][Rr][Ll]\\+[Pp]\\s+[Cc]ommands\\b");
    }
  }

  if (lines.some((line) => /\b\d+(?:\.\d+)?%\s*\/\s*(?:\d+(?:\.\d+)?[KMG]?|max)\b/i.test(line))) {
    candidates.push("\\b\\d+(?:\\.\\d+)?%\\s*/\\s*(?:\\d+(?:\\.\\d+)?[KMG]?|[Mm]ax)\\b");
  }

  if (lines.some((line) => /(?:^|\s)[|·•](?:\s|$)/.test(line) && /(?:^|\s)~?\/[^\s]+/.test(line))) {
    candidates.push("(?:^|\\s)[|·•](?:\\s|$).*?~?/\\S+(?:\\s|$)");
  }

  if (lines.some((line) => /\b(?:context|remaining|left)\b[^\n]*\b\d{1,3}(?:\.\d+)?%/i.test(line))) {
    candidates.push("\\b(?:[Cc]ontext|[Rr]emaining|[Ll]eft)\\b[^\\n]*\\b\\d{1,3}(?:\\.\\d+)?%");
  }

  if (lines.some((line) => /(?:\besc(?:ape)?\b|\bctrl\+[a-z]\b|⌃[a-z]|\?\s+(?:for|help)\b)/i.test(line))) {
    candidates.push(
      "(?:\\b[Ee][Ss][Cc](?:ape)?\\b|\\b[Cc][Tt][Rr][Ll]\\+[A-Za-z]\\b|⌃[A-Za-z]|\\?\\s+(?:[Ff]or|[Hh]elp)\\b)"
    );
  }

  const matchingCandidates = candidates.filter((pattern) => {
    const regex = new RegExp(pattern);
    return lines.some((line) => regex.test(line));
  });
  return matchingCandidates.length >= 2 ? matchingCandidates.slice(0, 2) : undefined;
}
