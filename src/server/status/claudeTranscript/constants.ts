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

/**
 * Activity-correlation attachment (see io.ts `resolveByActivityCorrelation`).
 *
 * When start-time matching fails — a known Claude process start with no candidate
 * transcript whose first record lands in the session-start window — a long-lived
 * pane (process alive for days while the user runs /clear or starts new
 * conversations) can never re-attach: each new session file's first record is
 * recent, so it never matches the days-old start. Rather than attach blindly, the
 * tracker builds evidence over consecutive polls that exactly ONE candidate
 * transcript is moving in lockstep with this pane, then attaches it weakly (a
 * genuine session-start match from another worker can still evict it).
 *
 * - mtime window: on a poll where the pane output changed, a candidate CORRELATES
 *   when its mtime is within this window of now — i.e. it was just written, in
 *   step with the pane. Sized to cover one ~2.5s poll interval plus scheduling
 *   slack.
 * - required streak: the SAME single candidate must correlate on this many
 *   consecutive qualifying (pane-changed) polls, with no other candidate
 *   correlating on any of them, before it attaches.
 * - reset-after-quiet: a partial streak survives short quiet gaps but is dropped
 *   once the pane has produced no qualifying poll for this long (the lockstep
 *   evidence has gone stale). Checked lazily on the next qualifying poll.
 */
export const correlationMtimeWindowMs = 5_000;
export const correlationRequiredStreak = 3;
export const correlationStreakResetAfterQuietMs = 15_000;

export const bashCommandDisplayMaxLength = 72;
export const taskDescriptionDisplayMaxLength = 56;

export const permissionExemptTools = new Set(["task", "askuserquestion"]);
