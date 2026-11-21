/**
 * Signed-in people are identified to Google Analytics and Sentry by their opaque Hicya account
 * id only: never email, name or username. Signed-out people have no user id.
 */

const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** The account id to send as GA `user_id`, or `null` when there is none or it is malformed. */
export function analyticsUserId(accountId: string | null | undefined): string | null {
  if (accountId == null) return null;
  return ACCOUNT_ID.test(accountId) ? accountId : null;
}
