import type { SyncPushPayload, SyncPushResult, SyncPullPayload, SyncPullResult } from "./types";

export class SyncAuthError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "SyncAuthError";
  }
}

/**
 * The sync service refused a push because of an account limit: the storage quota
 * (`storage_quota_exceeded`, 507) or the daily write budget (`write_budget_exceeded`, 429 with
 * Retry-After). Sync is paused; local data is untouched and the user stays signed in.
 */
export class SyncLimitError extends Error {
  constructor(
    public readonly code: "storage_quota_exceeded" | "write_budget_exceeded" | "rate_limited",
    /** Seconds until a retry can succeed, when the server said so. */
    public readonly retryAfterSeconds: number | null,
  ) {
    super(`Sync paused: ${code}`);
    this.name = "SyncLimitError";
  }
}

const LIMIT_CODES = new Set(["storage_quota_exceeded", "write_budget_exceeded", "rate_limited"]);

function isLimitCode(value: unknown): value is SyncLimitError["code"] {
  return typeof value === "string" && LIMIT_CODES.has(value);
}

async function errorCode(response: Response): Promise<{ code: unknown; text: string }> {
  const text = await response.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return { code: parsed.error, text };
    }
  } catch {
    // Not JSON.
  }
  return { code: null, text };
}

const REQUEST_TIMEOUT_MS = 30_000;

export class SyncClient {
  constructor(private syncUrl: string) {}

  async push(token: string, payload: SyncPushPayload): Promise<SyncPushResult> {
    const response = await this.request("POST", "/sync/push", token, payload);
    return response as SyncPushResult;
  }

  async pull(token: string, cursor: string | null, limit?: number): Promise<SyncPullResult> {
    const payload: SyncPullPayload = { cursor, limit };
    const response = await this.request("POST", "/sync/pull", token, payload);
    return response as SyncPullResult;
  }

  private async request(
    method: string,
    path: string,
    token: string,
    body: unknown,
  ): Promise<unknown> {
    const url = `${this.syncUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new SyncAuthError();
      }

      if (!response.ok) {
        const { code, text } = await errorCode(response);
        if (isLimitCode(code)) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          throw new SyncLimitError(
            code,
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
          );
        }
        throw new Error(`Sync request failed: ${response.status} ${text}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}
