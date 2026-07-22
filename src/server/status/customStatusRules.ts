import type { StatusRule, StatusRuleOutcome, Worker } from "../../shared/types";

interface CompiledStatusRuleMatch {
  displayName?: RegExp;
  projectId?: string;
  runtimeId?: string;
  command?: RegExp;
  lastLine?: RegExp;
}

interface CompiledStatusRule {
  id: string;
  match: CompiledStatusRuleMatch;
  outcome: StatusRuleOutcome;
}

export interface CompiledStatusRules {
  rules: readonly CompiledStatusRule[];
  usesLastLine: boolean;
}

export interface CustomStatusRuleMatch {
  ruleId: string;
  outcome: StatusRuleOutcome;
}

interface MatchStatusRuleInput {
  worker: Worker;
  currentCommand: string;
  output: string;
}

export function compileStatusRules(rules: readonly StatusRule[]): CompiledStatusRules {
  return {
    rules: rules.map((rule) => ({
      id: rule.id,
      match: {
        displayName: compilePattern(rule.match.displayName),
        projectId: rule.match.projectId,
        runtimeId: rule.match.runtimeId,
        command: compilePattern(rule.match.command),
        lastLine: compilePattern(rule.match.lastLine)
      },
      outcome: rule.set
    })),
    usesLastLine: rules.some((rule) => rule.match.lastLine !== undefined)
  };
}

export function matchCustomStatusRule(
  compiled: CompiledStatusRules,
  { worker, currentCommand, output }: MatchStatusRuleInput
): CustomStatusRuleMatch | undefined {
  const displayName = worker.displayName ?? worker.name;
  const lastLine = compiled.usesLastLine ? lastNonEmptyLine(output) : undefined;

  for (const rule of compiled.rules) {
    if (
      matchesPattern(rule.match.displayName, displayName) &&
      matchesExact(rule.match.projectId, worker.projectId) &&
      matchesExact(rule.match.runtimeId, worker.runtimeId) &&
      matchesPattern(rule.match.command, currentCommand) &&
      matchesPattern(rule.match.lastLine, lastLine)
    ) {
      return { ruleId: rule.id, outcome: rule.outcome };
    }
  }

  return undefined;
}

export function lastNonEmptyLine(output: string): string | undefined {
  let lineEnd = output.length;

  while (lineEnd > 0) {
    const lineStart = output.lastIndexOf("\n", lineEnd - 1) + 1;
    const line = output.slice(lineStart, lineEnd).trim();
    if (line.length > 0) {
      return line;
    }
    lineEnd = Math.max(0, lineStart - 1);
  }

  return undefined;
}

function compilePattern(pattern: string | undefined): RegExp | undefined {
  return pattern === undefined ? undefined : new RegExp(pattern);
}

function matchesPattern(pattern: RegExp | undefined, value: string | undefined): boolean {
  return pattern === undefined || (value !== undefined && pattern.test(value));
}

function matchesExact(expected: string | undefined, actual: string): boolean {
  return expected === undefined || expected === actual;
}
