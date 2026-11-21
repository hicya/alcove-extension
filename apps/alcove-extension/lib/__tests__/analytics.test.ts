import { describe, expect, it } from "vitest";

import {
  createExtensionAnalytics,
  DEFAULT_MEASUREMENT_ID,
  INSTALL_ID_KEY,
  resolveAnalyticsConfig,
  trackSaveOutcome,
} from "../analytics";

const MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";

import type { AnalyticsConfig, KeyValueStore } from "../analytics";

function memoryStore(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (key) => Promise.resolve(values.get(key)),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

function fixture(config: AnalyticsConfig | null, accountId: string | null = null) {
  const requests: { url: string; init: RequestInit }[] = [];
  const local = memoryStore();
  let ids = 0;
  const analytics = createExtensionAnalytics(config, {
    local,
    session: memoryStore(),
    accountId: () => Promise.resolve(accountId),
    fetch: (input, init) => {
      requests.push({
        url: input instanceof Request ? input.url : input.toString(),
        init: init ?? {},
      });
      return Promise.resolve(new Response(null));
    },
    randomId: () => `install-${String(++ids)}`,
    now: () => 1_700_000_000_000,
  });
  return { analytics, requests, local };
}

function body(init: RequestInit): unknown {
  return typeof init.body === "string" ? JSON.parse(init.body) : null;
}

describe("resolveAnalyticsConfig", () => {
  it("is off without an API secret and always off on Firefox", () => {
    expect(resolveAnalyticsConfig({ browser: "chrome", measurementId: "", apiSecret: "" })).toBe(
      null,
    );
    expect(
      resolveAnalyticsConfig({ browser: "chrome", measurementId: undefined, apiSecret: undefined }),
    ).toBe(null);
    expect(
      resolveAnalyticsConfig({ browser: "firefox", measurementId: "", apiSecret: "secret" }),
    ).toBe(null);
    expect(
      resolveAnalyticsConfig({ browser: "chrome", measurementId: "UA-1", apiSecret: "secret" }),
    ).toBe(null);
  });

  it("uses the web stream by default", () => {
    expect(resolveAnalyticsConfig({ browser: "edge", measurementId: "", apiSecret: "s" })).toEqual({
      measurementId: DEFAULT_MEASUREMENT_ID,
      apiSecret: "s",
    });
  });
});

describe("createExtensionAnalytics", () => {
  it("sends nothing and stores nothing when off", async () => {
    const { analytics, requests, local } = fixture(null);
    await analytics.track("sign_in", { provider: "google" });
    expect(requests).toEqual([]);
    expect(local.values.size).toBe(0);
  });

  it("posts validated events with a stable random install ID and no user ID when signed out", async () => {
    const { analytics, requests, local } = fixture({ measurementId: "G-TEST123", apiSecret: "s" });
    await analytics.track("sign_in", { provider: "apple" });
    await trackSaveOutcome(analytics, {
      status: "saved",
      title: "Private title",
      withContent: true,
    });

    expect(requests).toHaveLength(2);
    const url = new URL(requests[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(MP_ENDPOINT);
    expect(url.searchParams.get("measurement_id")).toBe("G-TEST123");
    expect(requests[0].init).toMatchObject({
      method: "POST",
      mode: "no-cors",
      credentials: "omit",
    });
    expect(body(requests[0].init)).toEqual({
      client_id: "install-1",
      non_personalized_ads: true,
      events: [
        {
          name: "sign_in",
          params: { provider: "apple", engagement_time_msec: 1, session_id: 1700000000 },
        },
      ],
    });
    expect(body(requests[1].init)).toMatchObject({
      client_id: "install-1",
      events: [{ name: "article_saved", params: { source: "extension", with_content: true } }],
    });
    expect(local.values.get(INSTALL_ID_KEY)).toBe("install-1");
    expect(JSON.stringify(requests)).not.toContain("Private title");
    expect(JSON.stringify(requests)).not.toMatch(/user_id/);
  });

  it("sends the Hicya account id as user_id when signed in, never an email", async () => {
    const signedIn = fixture({ measurementId: "G-TEST123", apiSecret: "s" }, "acct_123");
    await signedIn.analytics.track("article_opened");
    expect(body(signedIn.requests[0].init)).toMatchObject({
      client_id: "install-1",
      user_id: "acct_123",
    });

    const malformed = fixture({ measurementId: "G-TEST123", apiSecret: "s" }, "a@example.com");
    await malformed.analytics.track("article_opened");
    expect(JSON.stringify(malformed.requests)).not.toMatch(/user_id|example\.com/);
  });

  it("maps every save outcome to an enum reason", async () => {
    const { analytics, requests } = fixture({ measurementId: "G-TEST123", apiSecret: "s" });
    await trackSaveOutcome(analytics, { status: "unsupported" });
    await trackSaveOutcome(analytics, { status: "signed-out" });
    await trackSaveOutcome(analytics, {
      status: "paused",
      reason: "storage_quota_exceeded",
      retryAfterSeconds: null,
    });
    await trackSaveOutcome(analytics, { status: "insecure-only" });
    await trackSaveOutcome(analytics, { status: "failed" });
    const reasons = requests.map((request) => {
      const parsed = body(request.init);
      return JSON.stringify(parsed).match(/"reason":"([a-z_]+)"/)?.[1];
    });
    expect(reasons).toEqual([
      "unsupported_page",
      "signed_out",
      "library_full",
      "insecure_only",
      "failed",
    ]);
  });

  it("swallows network errors", async () => {
    const analytics = createExtensionAnalytics(
      { measurementId: "G-TEST123", apiSecret: "s" },
      {
        local: memoryStore(),
        session: memoryStore(),
        accountId: () => Promise.resolve(null),
        fetch: () => Promise.reject(new TypeError("offline")),
        randomId: () => "id",
        now: () => 0,
      },
    );
    await expect(analytics.track("article_opened")).resolves.toBeUndefined();
  });

  it("rejects text in place of an enum before anything is sent", async () => {
    const { analytics, requests } = fixture({ measurementId: "G-TEST123", apiSecret: "s" });
    await expect(
      Reflect.apply(analytics.track, undefined, [
        "save_failed",
        { source: "extension", reason: "example.com" },
      ]),
    ).rejects.toThrow(/must be one of/);
    expect(requests).toEqual([]);
  });
});
