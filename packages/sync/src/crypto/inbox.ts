/**
 * The sealed inbox: how a client that keeps no sync key (Alcove's browser extension and its iOS
 * share extension) adds records to an encrypted account.
 *
 * The account's keyring carries an X25519 public key. A keyless client fetches it once
 * (`fetchInboxKey`), pins it, and pushes each new record as an `inbox` record whose data is a
 * libsodium-style sealed box of the record (`sealInboxRecord`). Only a device holding the account's
 * sync key can open it; that device re-seals the content as an ordinary record and deletes the
 * inbox row (the SyncEngine does this when encryption is on).
 *
 * Trust: the sync server hands out the public key, so a malicious server could swap it for its
 * own and read later inbox items. A keyless client therefore pins the first key it sees
 * (`checkPinnedInboxKey`) and refuses a different one, and both it and the full app show the key's
 * fingerprint so the person can compare them. Full clients additionally check that the public key
 * matches the secret half sealed under their vault key.
 *
 * This module has no database or React dependency, so a push-only module can import it alone.
 */
import { blake2b } from "@noble/hashes/blake2.js";

import { SyncAuthError, SyncClient } from "../client";

import { fromBase64, fromUtf8, utf8 } from "./encoding";
import { SyncCryptoError } from "./errors";
import { sealToPublicKey } from "./sealed-box";
import { Vault } from "./vault";

import type { SyncPushRecord } from "../types";
import type { AccountKeySource } from "./account-key";

export { authServiceKeySource } from "./account-key";
export type { AccountKey, AccountKeySource } from "./account-key";

export const INBOX_ENTITY = "inbox";

export interface InboxKey {
  /** Base64 X25519 public key from the keyring. */
  publicKey: string;
  /** Human-comparable fingerprint of the key, e.g. "3f2a 91c0 …". */
  fingerprint: string;
}

/** A short fingerprint of an inbox public key: BLAKE2b-128, hex in groups of four. */
export function inboxFingerprint(publicKey: string): string {
  const bytes = fromBase64(publicKey);
  if (!bytes || bytes.length !== 32) {
    throw new SyncCryptoError("damaged", "The inbox public key is not valid");
  }
  const hex = [...blake2b(bytes, { dkLen: 16 })]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.match(/.{4}/g)?.join(" ") ?? hex;
}

/** The inbox key from a keyring's JSON, or null when the keyring has none. */
export function inboxKeyFromKeyring(keyringJson: string): InboxKey | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(keyringJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("inbox_public_key" in parsed)) return null;
  const publicKey = parsed.inbox_public_key;
  if (typeof publicKey !== "string") return null;
  return { publicKey, fingerprint: inboxFingerprint(publicKey) };
}

/**
 * Reads the account's inbox key from the sync service. Null when the account has no keyring yet or
 * a keyring without an inbox key. Keyless clients should call `ensureInboxKey` instead, which
 * makes the keyring when it is missing: never push readable records.
 */
export async function fetchInboxKey(
  syncUrl: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InboxKey | null> {
  const response = await fetchImpl(`${syncUrl}/sync/keyring`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Sync keyring request failed: ${String(response.status)}`);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("keyring" in body)) return null;
  return typeof body.keyring === "string" ? inboxKeyFromKeyring(body.keyring) : null;
}

/**
 * The account's inbox key, making the account's keyring first when it has none (a keyless client
 * that runs before any full app). Fetches the account key from `keySource`, makes the keyring,
 * pushes it, and adopts whichever keyring the server kept if a full app made one at the same
 * moment. The account key is used only inside this call and never stored, so a keyless client
 * needs no secure storage. Throws SyncAuthError on 401 and SyncCryptoError("key_unavailable")
 * when the key cannot be fetched now (try again later; do not push readable data).
 */
export async function ensureInboxKey(options: {
  app: string;
  syncUrl: string;
  accessToken: string;
  keySource: AccountKeySource;
  fetch?: typeof fetch;
}): Promise<InboxKey> {
  const fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  const read = async (): Promise<string | null> => {
    const response = await fetchImpl(`${options.syncUrl}/sync/keyring`, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
    });
    if (response.status === 401) throw new SyncAuthError();
    if (!response.ok) throw new Error(`Sync keyring request failed: ${String(response.status)}`);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("keyring" in body)) return null;
    return typeof body.keyring === "string" ? body.keyring : null;
  };

  let keyring = await read();
  if (keyring === null) {
    const accountKey = await options.keySource(options.accessToken);
    const vault = Vault.create(options.app, accountKey.key, accountKey.keyId);
    let refused: Error | null = null;
    try {
      await new SyncClient(options.syncUrl).push(options.accessToken, {
        records: [
          {
            entityType: "keyring",
            entityId: "default",
            data: vault.keyringJson,
            updatedAt: new Date().toISOString(),
            deleted: false,
          },
        ],
        reviewLogs: [],
      });
    } catch (error) {
      if (error instanceof SyncAuthError) throw error;
      // A full app made the keyring first (409 keyring_exists).
      refused = error instanceof Error ? error : new Error(String(error));
    }
    keyring = await read();
    if (keyring === null) {
      if (refused !== null) throw refused;
      keyring = vault.keyringJson;
    }
  }
  const inboxKey = inboxKeyFromKeyring(keyring);
  if (!inboxKey) throw new SyncCryptoError("damaged", "The account's keyring has no inbox key");
  return inboxKey;
}

/**
 * Trust on first use: "first_use" when nothing is pinned yet (pin `current.publicKey`), "match"
 * when it is the pinned key, "changed" when the server now hands out a different key. On
 * "changed", do not push; ask the person to compare fingerprints in the app (the inbox key never
 * changes for an account, so a change means a deleted and recreated account or a misbehaving
 * server).
 */
export function checkPinnedInboxKey(
  pinnedPublicKey: string | null,
  current: InboxKey,
): "first_use" | "match" | "changed" {
  if (pinnedPublicKey === null) return "first_use";
  return pinnedPublicKey === current.publicKey ? "match" : "changed";
}

interface InboxPayload {
  v: 1;
  app: string;
  inbox: string;
  entityType: string;
  entityId: string;
  data: string;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Seals one readable record (its JSON in `data`) into an inbox record ready for `/sync/push`.
 */
export function sealInboxRecord(
  inboxKey: InboxKey,
  app: string,
  record: { entityType: string; entityId: string; data: string },
  now: Date = new Date(),
): SyncPushRecord {
  const publicKey = fromBase64(inboxKey.publicKey);
  if (!publicKey) throw new SyncCryptoError("damaged", "The inbox public key is not valid");
  const inbox = newId();
  const payload: InboxPayload = {
    v: 1,
    app,
    inbox,
    entityType: record.entityType,
    entityId: record.entityId,
    data: record.data,
  };
  return {
    entityType: INBOX_ENTITY,
    entityId: inbox,
    data: sealToPublicKey(utf8(JSON.stringify(payload)), publicKey),
    updatedAt: now.toISOString(),
    deleted: false,
  };
}

/** Opens an inbox record with the account's vault; checks it was addressed to this inbox row. */
export function openInboxRecord(
  vault: Vault,
  inboxId: string,
  sealed: string,
): { entityType: string; entityId: string; data: string } {
  const text = fromUtf8(vault.openInbox(sealed));
  let payload: unknown;
  try {
    payload = text === null ? null : JSON.parse(text);
  } catch {
    payload = null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("v" in payload) ||
    payload.v !== 1 ||
    !("app" in payload) ||
    payload.app !== vault.app ||
    !("inbox" in payload) ||
    payload.inbox !== inboxId ||
    !("entityType" in payload) ||
    typeof payload.entityType !== "string" ||
    payload.entityType === INBOX_ENTITY ||
    payload.entityType === "keyring" ||
    !("entityId" in payload) ||
    typeof payload.entityId !== "string" ||
    !("data" in payload) ||
    typeof payload.data !== "string"
  ) {
    throw new SyncCryptoError("damaged", "The inbox record is damaged");
  }
  return { entityType: payload.entityType, entityId: payload.entityId, data: payload.data };
}
