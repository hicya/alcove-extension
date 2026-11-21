/**
 * Device-side encryption for a SyncEngine, with the account's sync key.
 *
 * `SyncEncryption` fetches the account key from the auth service (once, then from secure storage),
 * makes or opens the account's keyring on the sync service, and wraps the sync transport so record
 * data is sealed before push and opened after pull. Apps create one per signed-in account and pass
 * it as `encryption` in their SyncEngineConfig. There is nothing for the person to do: no
 * passphrase, no recovery key. See ENCRYPTION.md.
 */
import { SyncAuthError, SyncClient } from "../client";

import { isSealedData, toBase64 } from "./encoding";
import { SyncCryptoError } from "./errors";
import { INBOX_ENTITY, inboxFingerprint, openInboxRecord } from "./inbox";
import { Vault } from "./vault";

import type {
  SyncPullRecord,
  SyncPullResult,
  SyncPushPayload,
  SyncPushRecord,
  SyncPushResult,
} from "../types";
import type { AccountKeySource } from "./account-key";
import type { SyncCryptoErrorCode } from "./errors";

export const KEYRING_ENTITY = "keyring";
export const KEYRING_ID = "default";
export const REVIEW_LOG_ENTITY = "reviewLog";

/** What this device keeps between launches, in secure storage. */
export interface StoredVault {
  /** The account key's id. */
  keyId: string;
  /** The 32-byte account key, base64. */
  key: string;
  /** The keyring last opened with it, exactly as synced; empty before the first. */
  keyring: string;
}

/**
 * Secure storage for the account key: the Keychain or Keystore on mobile (expo-secure-store),
 * IndexedDB on the web. Clear it on sign-out; when it is empty the key is fetched again.
 */
export interface VaultStore {
  load(): Promise<StoredVault | null>;
  save(value: StoredVault): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryVaultStore implements VaultStore {
  private value: StoredVault | null = null;
  load(): Promise<StoredVault | null> {
    return Promise.resolve(this.value);
  }
  save(value: StoredVault): Promise<void> {
    this.value = value;
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.value = null;
    return Promise.resolve();
  }
}

export type EncryptionStatus =
  /** Not checked with the server yet. */
  | { state: "unknown" }
  /**
   * The key or keyring could not be read now (offline, a service down, or a keyring this key
   * does not open). Sync pauses and retries by itself; local data is untouched.
   */
  | { state: "unavailable"; error: SyncCryptoErrorCode | "network" }
  /** The keyring was made by a newer version of the format: update the app to keep syncing. */
  | { state: "update_required" }
  /** Syncing sealed. `sealing`: this device is still sealing data synced before encryption. */
  | { state: "ready"; sealing: boolean; inboxFingerprint: string | null };

/** The result of `refresh`: the new status and, on failure, a stable error code. */
export interface EncryptionResult {
  status: EncryptionStatus;
  error?: SyncCryptoErrorCode | "network";
}

/** A pulled record (or review log, as entityType "reviewLog") that could not be opened. */
export interface SkippedRecord {
  entityType: string;
  entityId: string;
  updatedAt: string;
  code: SyncCryptoErrorCode;
}

/** A pull result after opening: what could not be opened is left out and listed in `skipped`. */
export interface OpenedPullResult extends SyncPullResult {
  skipped?: SkippedRecord[];
}

/** What the engine needs from a transport (SyncClient, or this layer wrapping one). */
export interface SyncTransport {
  push(token: string, payload: SyncPushPayload): Promise<SyncPushResult>;
  pull(token: string, cursor: string | null, limit?: number): Promise<OpenedPullResult>;
}

/** Read-only surface for the UI (a "Sync encryption: on" row); safe to expose through Comlink. */
export interface EncryptionController {
  getStatus(): EncryptionStatus | Promise<EncryptionStatus>;
  refresh(token: string): Promise<EncryptionResult>;
  /** Forgets the cached key on this device (sign-out). */
  forget(): Promise<EncryptionResult>;
}

export interface SyncEncryptionOptions {
  /** App prefix bound into every seal ("habits", "flashcards", "alcove", "plants", "forage"). */
  app: string;
  syncUrl: string;
  /** Where the account key comes from; usually `authServiceKeySource({authUrl, app})`. */
  keySource: AccountKeySource;
  /** Caches the key so each sync does not fetch it again. */
  store: VaultStore;
  fetch?: typeof fetch;
  /** Records skipped because they could not be opened (damaged, or sealed with another key). */
  onSkippedRecord?: (entityType: string, entityId: string, code: SyncCryptoErrorCode) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Now, or just after `iso` when that is not in the past. */
function laterThan(iso: string): string {
  const now = Date.now();
  const after = Date.parse(iso) + 1;
  return new Date(Number.isFinite(after) && after > now ? after : now).toISOString();
}

function errorCode(error: unknown): SyncCryptoErrorCode | "network" {
  return error instanceof SyncCryptoError ? error.code : "network";
}

/** The account's keyring on the sync service, or null when it has none yet. */
export interface ServerKeyring {
  /** The keyring, or null when the account has none yet. */
  keyring: string | null;
  /** Readable rows still on the server (from before encryption): any device with the key seals them. */
  hasReadableData: boolean;
}

/** The account's keyring on the sync service, and whether readable data is left to seal. */
export async function fetchServerKeyring(
  syncUrl: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<ServerKeyring> {
  const response = await fetchImpl(`${syncUrl}/sync/keyring`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) throw new SyncAuthError();
  if (!response.ok) throw new Error(`Sync keyring request failed: ${String(response.status)}`);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) throw new Error("Bad keyring response");
  const keyring = "keyring" in body ? body.keyring : null;
  return {
    keyring: typeof keyring === "string" ? keyring : null,
    hasReadableData: "hasReadableData" in body && body.hasReadableData === true,
  };
}

export class SyncEncryption implements EncryptionController {
  private readonly client: SyncClient;
  private readonly fetchImpl: typeof fetch;
  private vault: Vault | null = null;
  private stored: StoredVault | null = null;
  /** The server's keyring: undefined until fetched, null when there is none. */
  private serverKeyring: string | null | undefined = undefined;
  /**
   * Whether the server still holds readable rows for this account and client. The server is the
   * source of truth, so sealing resumes on any device with the key (after a sign-out, a lost key
   * cache or on another device) until nothing readable is left.
   */
  private serverHasReadable = false;
  private current: EncryptionStatus = { state: "unknown" };
  private readonly listeners = new Set<(status: EncryptionStatus) => void>();
  /** Re-sealed inbox content and inbox deletions to push after a pull. */
  private pendingInbox: SyncPushRecord[] = [];

  constructor(private readonly options: SyncEncryptionOptions) {
    this.client = new SyncClient(options.syncUrl);
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  getStatus(): EncryptionStatus {
    return this.current;
  }

  subscribe(listener: (status: EncryptionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: EncryptionStatus): EncryptionStatus {
    this.current = status;
    for (const listener of this.listeners) listener(status);
    return status;
  }

  private readyStatus(): EncryptionStatus {
    const publicKey = this.vault?.inboxKeyPair()?.publicKey;
    return {
      state: "ready",
      sealing: this.serverHasReadable,
      inboxFingerprint: publicKey ? inboxFingerprint(toBase64(publicKey)) : null,
    };
  }

  private async fetchKeyring(token: string): Promise<void> {
    const server = await fetchServerKeyring(this.options.syncUrl, token, this.fetchImpl);
    this.serverKeyring = server.keyring;
    this.serverHasReadable = server.hasReadableData;
  }

  /** The cached account key, or a fresh one from the key source (cached for next time). */
  private async accountKey(token: string, fresh: boolean): Promise<StoredVault> {
    this.stored ??= await this.options.store.load();
    if (this.stored && !fresh) return this.stored;
    const key = await this.options.keySource(token);
    const sameKey = this.stored?.key === key.key;
    const stored: StoredVault = {
      keyId: key.keyId,
      key: key.key,
      keyring: sameKey ? (this.stored?.keyring ?? "") : "",
    };
    await this.options.store.save(stored);
    this.stored = stored;
    return stored;
  }

  private async remember(vault: Vault): Promise<void> {
    if (!this.stored) return;
    this.stored = { ...this.stored, keyring: vault.keyringJson };
    await this.options.store.save(this.stored);
    this.vault = vault;
    this.serverKeyring = vault.keyringJson;
  }

  /** Opens the server's keyring with the account key, fetching the key again if the cached one fails. */
  private async open(token: string, keyring: string): Promise<Vault> {
    const stored = await this.accountKey(token, false);
    try {
      return Vault.restore(this.options.app, stored.key, keyring);
    } catch (error) {
      if (!(error instanceof SyncCryptoError) || error.code !== "wrong_key") throw error;
      const fresh = await this.accountKey(token, true);
      if (fresh.key === stored.key) throw error;
      return Vault.restore(this.options.app, fresh.key, keyring);
    }
  }

  /** First device of the account and app: makes the keyring and pushes it. */
  private async create(token: string): Promise<void> {
    const stored = await this.accountKey(token, false);
    const vault = Vault.create(this.options.app, stored.key, stored.keyId);
    let refused: Error | null = null;
    try {
      await this.client.push(token, {
        records: [
          {
            entityType: KEYRING_ENTITY,
            entityId: KEYRING_ID,
            data: vault.keyringJson,
            updatedAt: nowIso(),
            deleted: false,
          },
        ],
        reviewLogs: [],
      });
    } catch (error) {
      if (error instanceof SyncAuthError) throw error;
      // Most likely another device made the keyring first (409 keyring_exists).
      refused = error instanceof Error ? error : new Error(String(error));
    }
    // Account keyrings are created once on the server; adopt whichever it kept. It opens with
    // the same account key.
    await this.fetchKeyring(token);
    if (this.serverKeyring == null && refused !== null) throw refused;
    const kept = this.serverKeyring ?? vault.keyringJson;
    const opened = kept === vault.keyringJson ? vault : await this.open(token, kept);
    // Anything already on the server readable is sealed next (fetchKeyring read hasReadableData).
    await this.remember(opened);
  }

  /**
   * Works out the state with the server: fetches the account key when it is not cached, makes the
   * keyring on the account's first encrypted sync, or opens the existing one. Never asks anything.
   */
  async refresh(token: string): Promise<EncryptionResult> {
    try {
      await this.fetchKeyring(token);
      const server = this.serverKeyring ?? null;
      if (server === null) {
        await this.create(token);
      } else if (!this.vault || this.vault.keyringJson !== server) {
        const vault = await this.open(token, server);
        await this.remember(vault);
      }
      return { status: this.setStatus(this.readyStatus()) };
    } catch (error) {
      if (error instanceof SyncAuthError) throw error;
      const code = errorCode(error);
      this.vault = null;
      if (code === "newer_version")
        return { status: this.setStatus({ state: "update_required" }), error: code };
      return { status: this.setStatus({ state: "unavailable", error: code }), error: code };
    }
  }

  async forget(): Promise<EncryptionResult> {
    await this.options.store.clear();
    this.stored = null;
    this.vault = null;
    this.serverKeyring = undefined;
    this.serverHasReadable = false;
    this.pendingInbox = [];
    return { status: this.setStatus({ state: "unknown" }) };
  }

  // -- Engine hooks --

  /** Before each sync: true when sync may run. Throws SyncAuthError on 401. */
  async beforeSync(token: string): Promise<boolean> {
    const result = await this.refresh(token);
    return result.status.state === "ready";
  }

  /** Whether the server still holds readable data, which this device re-seals from what it has. */
  needsReseal(): boolean {
    return this.vault !== null && this.serverHasReadable;
  }

  /** After the re-seal pushes: removes the readable rows the server still has, then records it. */
  async completeReseal(token: string, through: string | null): Promise<void> {
    if (!this.vault) return;
    if (through) {
      const response = await this.fetchImpl(`${this.options.syncUrl}/sync/seal-complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ through }),
      });
      if (response.status === 401) throw new SyncAuthError();
      if (!response.ok) throw new Error(`Seal-complete failed: ${String(response.status)}`);
    }
    // The next refresh asks the server again; until then this device considers itself done.
    this.serverHasReadable = false;
    this.setStatus(this.readyStatus());
  }

  /** Pushes re-sealed inbox content and deletes the opened inbox rows. */
  async flushInbox(token: string): Promise<void> {
    if (this.pendingInbox.length === 0 || !this.vault) return;
    const records = this.pendingInbox;
    for (let i = 0; i < records.length; i += 500) {
      await this.client.push(token, { records: records.slice(i, i + 500), reviewLogs: [] });
    }
    this.pendingInbox = this.pendingInbox.slice(records.length);
  }

  private requireVault(): Vault {
    if (!this.vault) throw new SyncCryptoError("key_unavailable", "The sync key is not ready");
    return this.vault;
  }

  private sealPayload(payload: SyncPushPayload): SyncPushPayload {
    const vault = this.requireVault();
    return {
      records: payload.records.map((r) => {
        if (r.entityType === KEYRING_ENTITY || r.entityType === INBOX_ENTITY) return r;
        if (r.deleted) return { ...r, data: "" };
        return { ...r, data: vault.seal(r.entityType, r.entityId, r.data) };
      }),
      reviewLogs: payload.reviewLogs.map((l) => ({
        ...l,
        data: vault.seal(REVIEW_LOG_ENTITY, l.id, l.data),
      })),
    };
  }

  private skip(
    skipped: SkippedRecord[],
    entityType: string,
    entityId: string,
    updatedAt: string,
    error: unknown,
  ): void {
    const code = error instanceof SyncCryptoError ? error.code : "damaged";
    skipped.push({ entityType, entityId, updatedAt, code });
    this.options.onSkippedRecord?.(entityType, entityId, code);
  }

  private openPull(result: SyncPullResult): OpenedPullResult {
    const vault = this.requireVault();
    const records: SyncPullRecord[] = [];
    const skipped: SkippedRecord[] = [];
    for (const record of result.records) {
      if (record.entityType === KEYRING_ENTITY) {
        if (!record.deleted && record.data === vault.keyringJson) continue;
        if (!record.deleted) {
          // Another device's keyring won a creation race: same account key, so adopt it.
          try {
            const adopted = Vault.restore(this.options.app, vault.exportKey(), record.data);
            this.vault = adopted;
            this.serverKeyring = record.data;
            if (this.stored) {
              this.stored = { ...this.stored, keyring: record.data };
              void this.options.store.save(this.stored);
            }
            continue;
          } catch {
            // Falls through: stop before applying anything, and work it out on the next sync.
          }
        }
        this.vault = null;
        this.serverKeyring = record.deleted ? null : record.data;
        this.setStatus({ state: "unavailable", error: "wrong_key" });
        throw new SyncCryptoError("wrong_key", "The sync keyring changed on the server");
      }
      if (record.deleted) {
        if (record.entityType !== INBOX_ENTITY) records.push({ ...record, data: "" });
        continue;
      }
      if (record.entityType === INBOX_ENTITY) {
        try {
          const inner = openInboxRecord(vault, record.entityId, record.data);
          records.push({ ...inner, updatedAt: record.updatedAt, deleted: false });
          this.pendingInbox.push(
            {
              entityType: inner.entityType,
              entityId: inner.entityId,
              data: vault.seal(inner.entityType, inner.entityId, inner.data),
              updatedAt: record.updatedAt,
              deleted: false,
            },
            {
              entityType: INBOX_ENTITY,
              entityId: record.entityId,
              data: "",
              // Later than the row it deletes even when the sender's clock runs ahead (LWW).
              updatedAt: laterThan(record.updatedAt),
              deleted: true,
            },
          );
        } catch (error) {
          this.skip(skipped, record.entityType, record.entityId, record.updatedAt, error);
        }
        continue;
      }
      if (!isSealedData(record.data)) {
        // Readable data from before this account was encrypted; seal-complete removes it.
        records.push(record);
        continue;
      }
      try {
        records.push({
          ...record,
          data: vault.open(record.entityType, record.entityId, record.data),
        });
      } catch (error) {
        this.skip(skipped, record.entityType, record.entityId, record.updatedAt, error);
      }
    }
    const reviewLogs = result.reviewLogs.flatMap((log) => {
      if (!isSealedData(log.data)) return [log];
      try {
        return [{ ...log, data: vault.open(REVIEW_LOG_ENTITY, log.id, log.data) }];
      } catch (error) {
        this.skip(skipped, REVIEW_LOG_ENTITY, log.id, log.reviewedAt, error);
        return [];
      }
    });
    return { ...result, records, reviewLogs, skipped };
  }

  /** Wraps a transport so pushes are sealed and pulls are opened. */
  wrap(transport: SyncTransport): SyncTransport {
    return {
      push: (token, payload) => transport.push(token, this.sealPayload(payload)),
      pull: async (token, cursor, limit) =>
        this.openPull(await transport.pull(token, cursor, limit)),
    };
  }
}
