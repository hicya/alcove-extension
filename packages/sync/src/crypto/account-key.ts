/**
 * The account's sync key, issued by the auth service.
 *
 * `POST <authUrl>/me/sync-key {app}` returns `{keyId, key}`: a random 256-bit key (base64) that
 * the auth service creates on the first call for this account and app and keeps for the life of
 * the account. Every device of the account gets the same key, so nobody types a passphrase and
 * signing in on a new device is enough to read the synced data.
 *
 * This module has no database or React dependency, so keyless clients can import it alone.
 */
import { SyncAuthError } from "../client";

import { fromBase64 } from "./encoding";
import { SyncCryptoError } from "./errors";

export interface AccountKey {
  /** Stable id of the key; the keyring records it. */
  keyId: string;
  /** The 32-byte key, base64. */
  key: string;
}

/** Fetches the account key for an access token. */
export type AccountKeySource = (accessToken: string) => Promise<AccountKey>;

function isAccountKey(value: unknown): value is AccountKey {
  if (typeof value !== "object" || value === null) return false;
  if (!("keyId" in value) || !("key" in value)) return false;
  if (typeof value.keyId !== "string" || typeof value.key !== "string") return false;
  return fromBase64(value.key)?.length === 32;
}

/**
 * The default key source: the auth service's `POST /me/sync-key`. Throws SyncAuthError on 401
 * (sign in again) and SyncCryptoError("key_unavailable") when the key cannot be fetched now.
 */
export function authServiceKeySource(options: {
  authUrl: string;
  app: string;
  fetch?: typeof fetch;
}): AccountKeySource {
  const fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  return async (accessToken) => {
    let response: Response;
    try {
      response = await fetchImpl(`${options.authUrl}/me/sync-key`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ app: options.app }),
      });
    } catch {
      throw new SyncCryptoError("key_unavailable", "The sync key could not be fetched");
    }
    if (response.status === 401) throw new SyncAuthError();
    if (!response.ok) {
      throw new SyncCryptoError(
        "key_unavailable",
        `The sync key could not be fetched (${String(response.status)})`,
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!isAccountKey(body)) throw new SyncCryptoError("damaged", "The sync key is damaged");
    return { keyId: body.keyId, key: body.key };
  };
}
