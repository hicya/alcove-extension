/**
 * Alcove's analytics event catalog, shared by the web app, the mobile apps and the browser
 * extension, declared with the shared `@hicya/analytics` catalog helpers.
 *
 * Privacy rule: events carry only enums, booleans and counts. Never user-typed or
 * user-content text (article titles, URLs or domains, highlight or note text, tag names,
 * search queries, Kindle addresses, emails) and never record IDs. Every parameter below is a
 * fixed enum, a boolean or a non-negative whole number, and every sender passes its events
 * through `toAnalyticsEvent`, which rejects anything else at runtime. The signed-in Hicya
 * account id is set by each transport as GA `user_id`, never as an event parameter.
 */
import { COUNT_BUCKETS, defineAnalyticsEvents, param } from "@hicya/analytics";

import type { AnalyticsEvent as CatalogEvent, EventArgs, EventParams } from "@hicya/analytics";

export { AnalyticsEventError, COUNT_BUCKETS, countBucket } from "@hicya/analytics";
export type { AnalyticsParamValue, CountBucket } from "@hicya/analytics";

/** Where a save started. */
export const SAVE_SOURCES = [
  /** The web app's save form. */
  "web",
  /** The web app's /save?url= entry (bookmarklet, macOS Safari extension). */
  "save_link",
  /** A link pasted or typed in the mobile app. */
  "link",
  /** The iOS share sheet or an Android share intent. */
  "share",
  /** The iOS Safari web extension. */
  "safari",
  /** The Chrome, Edge or Firefox extension. */
  "extension",
] as const;

/** Why a save did not produce a new article. */
export const SAVE_FAILURE_REASONS = [
  "duplicate",
  "key_changed",
  "invalid_url",
  "offline",
  "insecure_only",
  "unsupported_page",
  "signed_out",
  "paused",
  "library_full",
  "failed",
] as const;

export const IMPORT_FORMATS = ["pocket", "instapaper", "omnivore"] as const;

export const KINDLE_MODES = ["single", "batch", "digest"] as const;

export const SIGN_IN_PROVIDERS = ["apple", "google"] as const;

export type SaveSource = (typeof SAVE_SOURCES)[number];
export type SaveFailureReason = (typeof SAVE_FAILURE_REASONS)[number];
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
export type KindleMode = (typeof KINDLE_MODES)[number];
export type SignInProviderName = (typeof SIGN_IN_PROVIDERS)[number];

/** Alcove's catalog. Every parameter is required; none is an id or free text. */
export const ANALYTICS_CATALOG = defineAnalyticsEvents({
  article_saved: {
    source: param.enum(SAVE_SOURCES),
    with_content: param.boolean,
  },
  save_failed: {
    source: param.enum(SAVE_SOURCES),
    reason: param.enum(SAVE_FAILURE_REASONS),
  },
  article_opened: {},
  article_archived: {},
  article_favorited: {},
  highlight_added: {
    with_note: param.boolean,
  },
  note_added: {},
  tag_added: {
    new_tag: param.boolean,
  },
  import_completed: {
    format: param.enum(IMPORT_FORMATS),
    count_bucket: param.enum(COUNT_BUCKETS),
  },
  kindle_sent: {
    mode: param.enum(KINDLE_MODES),
    count_bucket: param.enum(COUNT_BUCKETS),
  },
  listen_started: {},
  sign_in: {
    provider: param.enum(SIGN_IN_PROVIDERS),
  },
});

/** Every event Alcove sends, with the type of each parameter. */
export const ANALYTICS_EVENTS = ANALYTICS_CATALOG.specs;

type Specs = typeof ANALYTICS_EVENTS;

export type AnalyticsEventName = Extract<keyof Specs, string>;

/** The parameters of one event: enum members, booleans or counts only. */
export type AnalyticsEventParams<N extends AnalyticsEventName> = EventParams<Specs, N>;

/** Events without parameters may omit the params argument. */
export type AnalyticsEventArgs<N extends AnalyticsEventName> = EventArgs<Specs, N>;

/** A validated event, ready for a transport (gtag, Firebase or the Measurement Protocol). */
export type AnalyticsEvent = CatalogEvent<AnalyticsEventName>;

export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return ANALYTICS_CATALOG.isEventName(name);
}

/**
 * Runtime check for an event from any source: the name must be in `ANALYTICS_EVENTS`, every
 * declared parameter must be present with an allowed value, and no other parameter may be
 * present. Throws `AnalyticsEventError` otherwise.
 */
export function validateAnalyticsEvent(name: string, params: unknown = {}): AnalyticsEvent {
  return ANALYTICS_CATALOG.validate(name, params);
}

/** Typed entry point for senders. The runtime check still runs, so casts can't sneak text in. */
export function toAnalyticsEvent<N extends AnalyticsEventName>(
  name: N,
  ...args: AnalyticsEventArgs<N>
): AnalyticsEvent {
  return ANALYTICS_CATALOG.event(name, ...args);
}
