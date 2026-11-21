/**
 * Google Analytics Measurement Protocol sender for places gtag.js and Firebase cannot run:
 * browser extensions (Manifest V3 forbids remote scripts) and servers. Sends the same validated
 * catalog events to a product's web stream.
 *
 * The client id is a random id the caller keeps (for an extension, in `chrome.storage.local`).
 * It identifies the install, not the person; `user_id` is the Hicya account id when signed in.
 */
import { type AnalyticsEvent } from "./catalog";
import { analyticsUserId } from "./identity";

const ENDPOINT = "https://www.google-analytics.com/mp/collect";
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,16}$/;
const MAX_EVENTS_PER_REQUEST = 25;

export interface MeasurementProtocolOptions {
  readonly measurementId: string | undefined;
  /** Stream API secret from GA Admin → Data streams → Measurement Protocol API secrets. */
  readonly apiSecret: string | undefined;
  /** Returns the install's stable random client id, creating it on first use. */
  readonly clientId: () => Promise<string>;
  /** Session id (seconds since epoch of session start) so events join GA sessions. */
  readonly sessionId?: () => Promise<number | undefined>;
  readonly fetch?: typeof fetch;
}

export interface MeasurementProtocolClient {
  readonly enabled: boolean;
  send(
    events: readonly AnalyticsEvent[],
    options?: { readonly accountId?: string | null },
  ): Promise<void>;
}

/** A random client id in GA's `<random>.<seconds>` shape. */
export function newClientId(now: Date = new Date()): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return `${String(random)}.${String(Math.floor(now.getTime() / 1000))}`;
}

export function createMeasurementProtocolClient(
  options: MeasurementProtocolOptions,
): MeasurementProtocolClient {
  const measurementId = options.measurementId ?? "";
  const apiSecret = options.apiSecret ?? "";
  const enabled = MEASUREMENT_ID.test(measurementId) && apiSecret !== "";
  const post = options.fetch ?? fetch;

  return {
    enabled,
    async send(events, sendOptions = {}) {
      if (!enabled || events.length === 0) return;
      const [clientId, sessionId] = await Promise.all([
        options.clientId(),
        options.sessionId?.() ?? Promise.resolve(undefined),
      ]);
      const userId = analyticsUserId(sendOptions.accountId);
      const url = `${ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
      for (let start = 0; start < events.length; start += MAX_EVENTS_PER_REQUEST) {
        const batch = events.slice(start, start + MAX_EVENTS_PER_REQUEST).map((event) => ({
          name: event.name,
          params: {
            ...event.params,
            engagement_time_msec: 1,
            ...(sessionId === undefined ? {} : { session_id: sessionId }),
          },
        }));
        await post(url, {
          method: "POST",
          body: JSON.stringify({
            client_id: clientId,
            ...(userId === null ? {} : { user_id: userId }),
            non_personalized_ads: true,
            events: batch,
          }),
        });
      }
    },
  };
}
