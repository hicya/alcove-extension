// The hicya signature block that closes every hicya app's Settings screen (root DESIGN.md,
// "Signature block"). This module is the single source of truth for its copy, row order and
// hicya.org links. Each app renders the block in its own skin; native apps (Swift, Kotlin) mirror
// these strings by hand and must be updated when they change.

/** The wordmark shown at the top of the block. Always lowercase. */
export const HICYA_WORDMARK = "hicya";

/** The promise line under the wordmark. */
export const HICYA_SIGNATURE_LINE = "Free, always. No ads. Made by a non-profit.";

/** hicya.org's About page; its funding section is the canonical "How hicya is funded" answer. */
export const HICYA_FUNDING_URL = "https://www.hicya.org/about";

/** hicya.org's list of every hicya product. */
export const HICYA_APPS_URL = "https://www.hicya.org/projects";

export const HICYA_EXPORT_LABEL = "Export my data";
export const HICYA_FUNDING_LABEL = "How hicya is funded";
export const HICYA_APPS_LABEL = "More hicya apps";

export type HicyaSignatureRowId = "export" | "funding" | "apps";

export interface HicyaSignatureRow {
  readonly id: HicyaSignatureRowId;
  readonly label: string;
  /**
   * The hicya.org page the row opens. Absent for "Export my data", which runs the app's own
   * export of everything the person has created.
   */
  readonly url?: string;
}

/**
 * The three rows, in the required order. "Export my data" is optional: an app shows it only when it
 * already has an export, and otherwise leaves it out (root DESIGN.md, "Shared product rules").
 */
export const HICYA_SIGNATURE_ROWS: readonly [
  HicyaSignatureRow,
  HicyaSignatureRow,
  HicyaSignatureRow,
] = [
  { id: "export", label: HICYA_EXPORT_LABEL },
  { id: "funding", label: HICYA_FUNDING_LABEL, url: HICYA_FUNDING_URL },
  { id: "apps", label: HICYA_APPS_LABEL, url: HICYA_APPS_URL },
];
