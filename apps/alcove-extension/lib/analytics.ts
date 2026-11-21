/**
 * Usage events for Chrome and Edge through the shared GA4 Measurement Protocol client
 * (`@hicya/analytics/measurement-protocol`), to Alcove's web stream. Off unless a release build
 * is given the API secret (see `scripts/with-analytics-env.sh`), and always off on Firefox,
 * whose manifest declares no technical or interaction data.
 *
 * What is sent: a random install ID kept in `chrome.storage.local` (GA `client_id`), a
 * per-browser-session ID, the signed-in Hicya account id as GA `user_id` (none when signed
 * out; never the email), and the shared Alcove events validated by
 * `@hicya/alcove-shared/analytics` (enums and booleans only: never page titles, URLs, domains
 * or text). Requests are fire-and-forget `no-cors` POSTs, so no host permission is needed and
 * the response is never read.
 */

import {
  createMeasurementProtocolClient,
  type MeasurementProtocolClient,
} from "@hicya/analytics/measurement-protocol";
import { toAnalyticsEvent } from "@hicya/alcove-shared/analytics";

import type { AnalyticsEventArgs, AnalyticsEventName } from "@hicya/alcove-shared/analytics";
import type { SaveOutcome } from "./save";

export const DEFAULT_MEASUREMENT_ID = "G-KQ760B99WM";
export const INSTALL_ID_KEY = "alcove_analytics_install_id";
export const SESSION_ID_KEY = "alcove_analytics_session_id";

const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,}$/;

export interface AnalyticsConfig {
  measurementId: string;
  apiSecret: string;
}

/** Null (analytics off) on Firefox, without an API secret, or with a malformed stream ID. */
export function resolveAnalyticsConfig(input: {
  browser: unknown;
  measurementId: unknown;
  apiSecret: unknown;
}): AnalyticsConfig | null {
  if (input.browser === "firefox") return null;
  const apiSecret = typeof input.apiSecret === "string" ? input.apiSecret.trim() : "";
  if (apiSecret === "") return null;
  const configured = typeof input.measurementId === "string" ? input.measurementId.trim() : "";
  const measurementId = configured === "" ? DEFAULT_MEASUREMENT_ID : configured;
  if (!MEASUREMENT_ID_PATTERN.test(measurementId)) return null;
  return { measurementId, apiSecret };
}

export interface KeyValueStore {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: string) => Promise<void>;
}

export interface AnalyticsDeps {
  /** Persistent storage for the install ID (chrome.storage.local). */
  local: KeyValueStore;
  /** Per-browser-session storage for the session ID (chrome.storage.session). */
  session: KeyValueStore;
  /** The signed-in Hicya account id, or null when signed out. */
  accountId: () => Promise<string | null>;
  fetch: typeof fetch;
  randomId: () => string;
  now: () => number;
}

async function storedOrNew(store: KeyValueStore, key: string, create: () => string) {
  const existing = await store.get(key);
  if (typeof existing === "string" && existing !== "") return existing;
  const value = create();
  await store.set(key, value);
  return value;
}

/** The Measurement Protocol needs no response, so requests go out `no-cors` without cookies. */
function fireAndForget(post: typeof fetch): typeof fetch {
  return (input, init) =>
    post(input, { ...init, mode: "no-cors", credentials: "omit", keepalive: true });
}

export interface ExtensionAnalytics {
  track: <N extends AnalyticsEventName>(name: N, ...args: AnalyticsEventArgs<N>) => Promise<void>;
}

/** A sender that does nothing when `config` is null. Events are validated either way. */
export function createExtensionAnalytics(
  config: AnalyticsConfig | null,
  deps: AnalyticsDeps,
): ExtensionAnalytics {
  const client: MeasurementProtocolClient | null = config
    ? createMeasurementProtocolClient({
        measurementId: config.measurementId,
        apiSecret: config.apiSecret,
        clientId: () => storedOrNew(deps.local, INSTALL_ID_KEY, deps.randomId),
        sessionId: async () => {
          const stored = await storedOrNew(deps.session, SESSION_ID_KEY, () =>
            String(Math.floor(deps.now() / 1000)),
          );
          const seconds = Number(stored);
          return Number.isSafeInteger(seconds) ? seconds : undefined;
        },
        fetch: fireAndForget(deps.fetch),
      })
    : null;

  return {
    async track(name, ...args) {
      const event = toAnalyticsEvent(name, ...args);
      if (!client) return;
      try {
        await client.send([event], { accountId: await deps.accountId() });
      } catch {
        // Analytics never gets in the way of saving.
      }
    },
  };
}

/** The analytics event for a finished save. */
export function trackSaveOutcome(analytics: ExtensionAnalytics, outcome: SaveOutcome) {
  switch (outcome.status) {
    case "saved":
      return analytics.track("article_saved", {
        source: "extension",
        with_content: outcome.withContent,
      });
    case "unsupported":
      return analytics.track("save_failed", { source: "extension", reason: "unsupported_page" });
    case "signed-out":
      return analytics.track("save_failed", { source: "extension", reason: "signed_out" });
    case "paused":
      return analytics.track("save_failed", {
        source: "extension",
        reason: outcome.reason === "storage_quota_exceeded" ? "library_full" : "paused",
      });
    case "key-changed":
      return analytics.track("save_failed", { source: "extension", reason: "key_changed" });
    case "insecure-only":
      return analytics.track("save_failed", { source: "extension", reason: "insecure_only" });
    case "failed":
      return analytics.track("save_failed", { source: "extension", reason: "failed" });
  }
}
