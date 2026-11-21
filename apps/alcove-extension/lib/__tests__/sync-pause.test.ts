import { describe, expect, it } from "vitest";

import { badgeForOutcome, retryWhen, toastForOutcome } from "../save";
import { readPause } from "../sync-push";

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("sync pause responses", () => {
  it("reads the storage quota response", async () => {
    const pause = await readPause(response(507, { error: "storage_quota_exceeded" }));
    expect(pause?.reason).toBe("storage_quota_exceeded");
    expect(pause?.retryAfterSeconds).toBeNull();
  });

  it("reads the write budget response with Retry-After", async () => {
    const pause = await readPause(
      response(429, { error: "write_budget_exceeded" }, { "Retry-After": "7200" }),
    );
    expect(pause?.reason).toBe("write_budget_exceeded");
    expect(pause?.retryAfterSeconds).toBe(7200);
  });

  it("leaves ordinary failures alone", async () => {
    expect(await readPause(response(429, { error: "rate_limited" }))).toBeNull();
    expect(await readPause(response(500, {}))).toBeNull();
  });

  it("explains the pause calmly, without an error tone", () => {
    const toast = toastForOutcome({
      status: "paused",
      reason: "write_budget_exceeded",
      retryAfterSeconds: 7200,
    });
    expect(toast?.tone).toBe("progress");
    expect(toast?.detail).toContain("in about 2 hours");
    expect(
      badgeForOutcome({
        status: "paused",
        reason: "storage_quota_exceeded",
        retryAfterSeconds: null,
      }).text,
    ).toBe("…");
  });

  it("rounds the wait", () => {
    expect(retryWhen(null)).toBe("later");
    expect(retryWhen(30)).toBe("in a minute");
    expect(retryWhen(1200)).toBe("in about 20 minutes");
    expect(retryWhen(3600)).toBe("in about an hour");
  });
});
