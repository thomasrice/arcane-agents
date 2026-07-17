const parsedStrongEvidenceWindowMs = 8_000;
const recentErrorSignalWindowMs = 15_000;
const commandWarmupWindowMs = 2_250;
const stickyWorkingWindowMs = 3_500;
const cachedActivityWindowMs = 12_000;
const claudeSpawnGraceMs = 5_000;
const openCodeSpawnGraceMs = 5_000;
const codexSpawnGraceMs = 5_000;
const genericWorkingFreshWindowMs = 20_000;
const claudeWorkingFreshWindowMs = 10_000;
const openCodeWorkingFreshWindowMs = 12_000;
const codexWorkingFreshWindowMs = 10_000;

const fatalRuntimeErrorMatchers: RegExp[] = [
  /^traceback\b/i,
  /^unhandled(?:\s+\w+)?\s+exception\b/i,
  /^panic\b/i,
  /^fatal\b/i,
  /\b(out of memory|oom)\b/i,
  /\bsig(?:segv|kill|term)\b/i
];

export {
  parsedStrongEvidenceWindowMs,
  recentErrorSignalWindowMs,
  commandWarmupWindowMs,
  stickyWorkingWindowMs,
  cachedActivityWindowMs,
  claudeSpawnGraceMs,
  openCodeSpawnGraceMs,
  codexSpawnGraceMs,
  genericWorkingFreshWindowMs,
  claudeWorkingFreshWindowMs,
  openCodeWorkingFreshWindowMs,
  codexWorkingFreshWindowMs,
  fatalRuntimeErrorMatchers
};
