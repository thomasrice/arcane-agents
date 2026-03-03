import type { Worker } from "../../../../shared/types";
import type { StatusReason } from "../types";

export type ParserErrorClassification = "none" | "recoverable" | "fatal";

export interface WorkingEvidence {
  strongReasons: StatusReason[];
  weakReasons: StatusReason[];
  activityTextCandidates: string[];
  activityToolCandidates: Array<Worker["activityTool"] | undefined>;
  activityPathCandidates: string[];
  parsedStrongSignal: boolean;
}

export interface IdleBlocker {
  reason: StatusReason;
}
