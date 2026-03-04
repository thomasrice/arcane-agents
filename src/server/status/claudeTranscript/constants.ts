import os from "node:os";
import path from "node:path";

export const claudeProjectRoot = path.join(os.homedir(), ".claude", "projects");
export const bootstrapTailBytes = 196_608;
export const textIdleDelayMs = 5_000;
export const permissionIdleDelayMs = 12_000;
export const activeToolStaleAfterMs = 45_000;
export const maxRecentTranscriptAgeMs = 3 * 24 * 60 * 60 * 1000;
export const transcriptLookupRetryMs = 2_000;

export const bashCommandDisplayMaxLength = 72;
export const taskDescriptionDisplayMaxLength = 56;

export const permissionExemptTools = new Set(["task", "askuserquestion"]);
