/**
 * The account's sealed inbox (packages/sync/ENCRYPTION.md, "The sealed inbox").
 *
 * The extension keeps no sync key. Each save is sealed to the inbox public key from the account's
 * keyring, and the Alcove apps open it on their next sync. When the account has no keyring yet,
 * `ensureInboxKey` fetches the account key once, makes the keyring and drops the key again;
 * nothing secret is stored here. Only the inbox *public* key is pinned (trust on first use), so a
 * different key handed out later is refused instead of trusted.
 */

import { authServiceKeySource, checkPinnedInboxKey, ensureInboxKey } from "@hicya/sync/inbox";

import { AUTH_HOST, SYNC_HOST } from "./manifest";

import type { InboxKey } from "@hicya/sync/inbox";

/** Bound into every seal; the same app name the Alcove apps use. */
export const ALCOVE_APP = "alcove";

const PIN_KEY = "alcove_inbox_pin";

/** The pinned inbox public key, per account. Public, so storing it reveals nothing. */
export interface InboxPinStore {
  get(accountId: string): Promise<string | null>;
  set(accountId: string, publicKey: string): Promise<void>;
  clear(): Promise<void>;
}

function toPins(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const pins: Record<string, string> = {};
  for (const [account, key] of Object.entries(value)) {
    if (typeof key === "string") pins[account] = key;
  }
  return pins;
}

export const chromeInboxPins: InboxPinStore = {
  async get(accountId) {
    const stored = await chrome.storage.local.get(PIN_KEY);
    return toPins(stored[PIN_KEY])[accountId] ?? null;
  },
  async set(accountId, publicKey) {
    const stored = await chrome.storage.local.get(PIN_KEY);
    await chrome.storage.local.set({
      [PIN_KEY]: { ...toPins(stored[PIN_KEY]), [accountId]: publicKey },
    });
  },
  async clear() {
    await chrome.storage.local.remove(PIN_KEY);
  },
};

/** The server handed out a different inbox key than the one pinned for this account. */
export class InboxKeyChangedError extends Error {
  constructor() {
    super("The account's inbox key changed");
    this.name = "InboxKeyChangedError";
  }
}

export interface InboxDeps {
  pins: InboxPinStore;
  /** Defaults to ensureInboxKey against sync.hicya.org and auth.hicya.org. */
  ensure?: (accessToken: string) => Promise<InboxKey>;
}

function ensureFromServices(accessToken: string): Promise<InboxKey> {
  return ensureInboxKey({
    app: ALCOVE_APP,
    syncUrl: SYNC_HOST,
    accessToken,
    keySource: authServiceKeySource({ authUrl: AUTH_HOST, app: ALCOVE_APP }),
  });
}

/**
 * The inbox key to seal a save to, checked against the pin for `accountId`. Throws
 * InboxKeyChangedError when it differs (do not push), SyncAuthError on 401 and
 * SyncCryptoError("key_unavailable") when the services cannot be reached now.
 */
export async function inboxKeyFor(
  accessToken: string,
  accountId: string,
  deps: InboxDeps,
): Promise<InboxKey> {
  const current = await (deps.ensure ?? ensureFromServices)(accessToken);
  const pinned = await deps.pins.get(accountId);
  switch (checkPinnedInboxKey(pinned, current)) {
    case "first_use":
      await deps.pins.set(accountId, current.publicKey);
      return current;
    case "match":
      return current;
    case "changed":
      throw new InboxKeyChangedError();
  }
}
