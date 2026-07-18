import os from "node:os";
import path from "node:path";

export const claudeProjectRoot = path.join(os.homedir(), ".claude", "projects");
export const bootstrapTailBytes = 196_608;
export const textIdleDelayMs = 5_000;
export const permissionIdleDelayMs = 12_000;
export const activeToolStaleAfterMs = 45_000;
export const maxRecentTranscriptAgeMs = 3 * 24 * 60 * 60 * 1000;
export const transcriptLookupRetryMs = 2_000;

/**
 * Bounds on the mtime fallback that attaches a transcript when the Claude
 * session start time is not yet known (see io.ts `findMatchingTranscriptFile`).
 * The fallback exists only to let a freshly spawned worker adopt its brand-new
 * transcript before the pgrep/ps start-time lookup resolves; both bounds keep it
 * from grabbing an unrelated (e.g. hot foreign) transcript in a shared project
 * directory.
 *
 * - createdAt slack: a session cannot meaningfully predate the worker process
 *   that hosts it, so a fallback candidate's first record must be no earlier
 *   than `worker.createdAt` minus this slack.
 * - freshness: the candidate's first record must also be recent relative to now.
 *   This guards the adoption case, where `worker.createdAt` marks when Arcane
 *   adopted an already-running pane (not when Claude actually started) and is an
 *   unreliable lower bound.
 */
export const transcriptFallbackCreatedAtSlackMs = 2 * 60 * 1000;
export const transcriptFallbackFreshnessMs = 10 * 60 * 1000;

export const bashCommandDisplayMaxLength = 72;
export const taskDescriptionDisplayMaxLength = 56;

export const permissionExemptTools = new Set(["task", "askuserquestion"]);
