const parsedStrongEvidenceWindowMs = 8_000;
const recentErrorSignalWindowMs = 15_000;
const commandWarmupWindowMs = 2_250;
const stickyWorkingWindowMs = 3_500;
const cachedActivityWindowMs = 12_000;
const claudeSpawnGraceMs = 5_000;
const genericWorkingFreshWindowMs = 12_000;
const claudeWorkingFreshWindowMs = 10_000;
const openCodeWorkingFreshWindowMs = 12_000;

const fatalRuntimeErrorMatchers: RegExp[] = [
  /^traceback\b/i,
  /^unhandled(?:\s+\w+)?\s+exception\b/i,
  /^panic\b/i,
  /^fatal\b/i,
  /\b(out of memory|oom)\b/i,
  /\bsig(?:segv|kill|term)\b/i
];

const recoverableToolErrorMatchers: RegExp[] = [
  /request failed with status code\s*:?\s*\d{3}/i,
  /\b(?:unauthorized|forbidden|rate limit|too many requests)\b/i,
  /\b(?:timed?\s*out|timeout)\b/i,
  /\b(?:network error|connection reset|connection refused|econnreset|econnrefused|enotfound)\b/i,
  /\bhttp(?:\s+status)?\s*(?:code)?\s*:?\s*(?:401|403|404|408|409|410|422|429|500|502|503|504)\b/i
];

const shellPromptTailMatchers: RegExp[] = [
  /[$#%]\s*$/,
  /(?:❯|›|»|λ|➜|❱)\s*$/,
  /^ps\s+[^>]*>\s*$/i,
  /^[A-Za-z]:\\[^>]*>\s*$/
];

export {
  parsedStrongEvidenceWindowMs,
  recentErrorSignalWindowMs,
  commandWarmupWindowMs,
  stickyWorkingWindowMs,
  cachedActivityWindowMs,
  claudeSpawnGraceMs,
  genericWorkingFreshWindowMs,
  claudeWorkingFreshWindowMs,
  openCodeWorkingFreshWindowMs,
  fatalRuntimeErrorMatchers,
  recoverableToolErrorMatchers,
  shellPromptTailMatchers
};
