import type { SyncPauseReason } from "@hicya/sync/types";

/**
 * What Alcove shows while sync is paused (packages/sync/ENCRYPTION.md, "Paused states"). A pause
 * never touches the library on the device.
 */
export interface SyncPauseCopy {
  /** Short status for a sync row, e.g. "Will sync later". */
  label: string;
  /** One calm sentence under it. */
  detail: string;
  /**
   * Whether the pause waits for the person (an update, room in the library) and deserves a
   * visible notice. Pauses that resume by themselves only change the status row.
   */
  notice: boolean;
}

const SAFE_HERE = "Your library is safe on this device.";

export function syncPauseCopy(
  reason: SyncPauseReason,
  pausedUntil: string | null,
  platform: "web" | "mobile",
  now: Date = new Date(),
): SyncPauseCopy {
  switch (reason) {
    case "encryption_unavailable":
    case "rate_limited":
      return {
        label: "Will sync later",
        detail: `${SAFE_HERE} Alcove syncs again by itself.`,
        notice: false,
      };
    case "update_required":
      return {
        label: "Update the app to keep syncing",
        detail:
          platform === "web"
            ? `Reload this page to get the latest version of Alcove. ${SAFE_HERE}`
            : `Install the latest version of Alcove. ${SAFE_HERE}`,
        notice: true,
      };
    case "storage_quota_exceeded":
      return {
        label: "Sync paused",
        detail:
          "Your account has reached its storage limit. Delete articles you've finished, and sync picks up again.",
        notice: true,
      };
    case "write_budget_exceeded":
      return {
        label: "Will sync later",
        detail: `You've synced a lot today. ${SAFE_HERE} Sync resumes ${resumeWhen(pausedUntil, now)}.`,
        notice: false,
      };
  }
}

function resumeWhen(pausedUntil: string | null, now: Date): string {
  const until = pausedUntil === null ? Number.NaN : Date.parse(pausedUntil);
  if (!Number.isFinite(until)) return "later today";
  const minutes = Math.max(1, Math.ceil((until - now.getTime()) / 60_000));
  if (minutes < 60) return `in about ${String(minutes)} minute${minutes === 1 ? "" : "s"}`;
  return `at ${new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
