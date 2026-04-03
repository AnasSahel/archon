export type HitlStatus =
  | "IDLE"
  | "RUNNING"
  | "RESULT_READY"
  | "AWAITING_HUMAN"
  | "ESCALATED"
  | "DONE";

export type HitlEvent =
  | { type: "START" }
  | { type: "RESULT_READY"; requiresReview: boolean }
  | { type: "APPROVE" }
  | { type: "REJECT"; feedback?: string }
  | { type: "COMMENT"; content: string }
  | { type: "TIMEOUT" }
  | { type: "COMPLETE" };

export interface HitlContext {
  taskId: string;
  agentId: string;
  reviewRequired: boolean;
  humanFeedback?: string;
  escalatedAt?: string;
}

export interface HitlSnapshot {
  value: HitlStatus;
  context: HitlContext;
}
