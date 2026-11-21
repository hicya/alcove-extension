export interface SyncPushPayload {
  records: SyncPushRecord[];
  reviewLogs: SyncPushReviewLog[];
}

export interface SyncPushRecord {
  entityType: string;
  entityId: string;
  data: string;
  updatedAt: string;
  deleted: boolean;
}

export interface SyncPushReviewLog {
  id: string;
  data: string;
  reviewedAt: string;
}

export interface SyncPushResult {
  accepted: number;
}

export interface SyncPullPayload {
  cursor: string | null;
  limit?: number;
}

export interface SyncPullRecord {
  entityType: string;
  entityId: string;
  data: string;
  updatedAt: string;
  deleted: boolean;
}

export interface SyncPullReviewLog {
  id: string;
  data: string;
  reviewedAt: string;
}

export interface SyncPullResult {
  records: SyncPullRecord[];
  reviewLogs: SyncPullReviewLog[];
  cursor: string;
  hasMore: boolean;
  cursorExpired?: boolean;
}

export interface SyncResult {
  recordsPushed: number;
  recordsPulled: number;
  errors: string[];
  /** Set when sync paused instead of failing; local data is untouched. See SyncPauseReason. */
  paused?: SyncPauseReason;
  /** For limit pauses with a Retry-After: when syncing may resume (ISO). */
  pausedUntil?: string | null;
}

/**
 * Why sync is paused. Not errors: nothing is lost, and retrying sooner does not help.
 * - "encryption_unavailable": the account's sync key or keyring could not be read now (offline, a
 *   service down). Resumes by itself at `pausedUntil`; nothing to show beyond "will sync later".
 * - "update_required": the account's data was encrypted by a newer app version; show "Update the
 *   app to keep syncing". Retried when the app comes back.
 * - "storage_quota_exceeded" (507): this account's synced data is at its storage limit; resume
 *   after the person deletes something (next foreground or a manual sync).
 * - "write_budget_exceeded" (429): the account synced as much as it can today; resume at
 *   `pausedUntil` (the server's Retry-After).
 * - "rate_limited" (429): too many requests in a short time; resume at `pausedUntil`.
 */
export type SyncPauseReason =
  | "encryption_unavailable"
  | "update_required"
  | "storage_quota_exceeded"
  | "write_budget_exceeded"
  | "rate_limited";

export type SyncState = "idle" | "syncing" | "error" | "paused";
