/**
 * The sync vault: the account's sync key, issued by the auth service, that seals synced records
 * on the device.
 *
 * Same sealing format as the Rust vaults in `packages/forage-core/src/vault.rs` and
 * `packages/reach-core/src/sync.rs`:
 *
 * - The key is a random 256-bit key per account and app, held by the auth service
 *   (`POST /me/sync-key`) and cached in the device's secure storage. Nobody types it.
 * - The keyring record (JSON, snake_case) syncs so every device can check it has the right key:
 *   `{version: 1, kdf: "account", key_id, memory_kib: 0, passes: 0, lanes: 0, salt: "", check}`.
 *   `check` is the constant `<app>-keyring-v1` sealed with associated data `<app>-keyring`. The
 *   zeroed Argon2id fields keep the record readable by the Rust parsers, whose `restore(key,
 *   keyring)` opens it unchanged; their passphrase `unlock` refuses it because of `kdf`.
 * - Each record is sealed with XChaCha20-Poly1305 under associated data `<app>-<entityType>:<id>`,
 *   so a sealed record cannot be moved to another type or id. Sealed data is
 *   base64(24-byte nonce ‖ ciphertext ‖ 16-byte tag).
 *
 * The keyring may carry an inbox key pair for keyless clients (see `inbox.ts`):
 * `inbox_public_key` (base64 X25519 public key) and `inbox_secret_key` (its secret half sealed
 * under the vault key with associated data `<app>-inbox-key`). Rust parsers ignore unknown fields.
 *
 * Keyrings with `kdf: "argon2id"` (passphrase keyrings from the Rust apps' earlier design) open
 * with `restore` when the key is known, but this package never derives one from a passphrase.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";

import { bytesEqual, fromBase64, fromUtf8, toBase64, utf8 } from "./encoding";
import { SyncCryptoError } from "./errors";
import { openSealedBox } from "./sealed-box";

const NONCE_BYTES = 24;
const TAG_BYTES = 16;
export const ACCOUNT_KDF = "account";

/** The keyring record's JSON (snake_case, as the Rust vaults write it). */
export interface Keyring {
  version: number;
  kdf: string;
  /** Which account key sealed `check` ("account" keyrings). */
  key_id?: string;
  memory_kib: number;
  passes: number;
  lanes: number;
  salt: string;
  check: string;
  inbox_public_key?: string;
  inbox_secret_key?: string;
}

function isKeyring(value: unknown): value is Keyring {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    typeof v.kdf === "string" &&
    (v.key_id === undefined || typeof v.key_id === "string") &&
    typeof v.memory_kib === "number" &&
    typeof v.passes === "number" &&
    typeof v.lanes === "number" &&
    typeof v.salt === "string" &&
    typeof v.check === "string" &&
    (v.inbox_public_key === undefined || typeof v.inbox_public_key === "string") &&
    (v.inbox_secret_key === undefined || typeof v.inbox_secret_key === "string")
  );
}

export function parseKeyring(json: string): Keyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SyncCryptoError("damaged", "The sync keyring is damaged");
  }
  // A newer format may change the shape, so its version is checked before anything else.
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof parsed.version === "number" &&
    parsed.version > 1
  ) {
    throw new SyncCryptoError(
      "newer_version",
      "This sync keyring was made by a newer version of the app",
    );
  }
  if (!isKeyring(parsed) || parsed.version !== 1) {
    throw new SyncCryptoError("damaged", "The sync keyring is damaged");
  }
  return parsed;
}

function decodeKey(base64: string): Uint8Array {
  const key = fromBase64(base64);
  if (!key || key.length !== 32) throw new SyncCryptoError("damaged", "The sync key is damaged");
  return key;
}

function sealBytes(key: Uint8Array, plaintext: Uint8Array, associated: Uint8Array): string {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(key, nonce, associated).encrypt(plaintext);
  const out = new Uint8Array(NONCE_BYTES + ciphertext.length);
  out.set(nonce);
  out.set(ciphertext, NONCE_BYTES);
  return toBase64(out);
}

function openBytes(key: Uint8Array, sealed: string, associated: Uint8Array): Uint8Array {
  const bytes = fromBase64(sealed);
  if (!bytes || bytes.length < NONCE_BYTES + TAG_BYTES) {
    throw new SyncCryptoError("damaged", "The synced data is damaged");
  }
  try {
    return xchacha20poly1305(key, bytes.subarray(0, NONCE_BYTES), associated).decrypt(
      bytes.subarray(NONCE_BYTES),
    );
  } catch {
    throw new SyncCryptoError("wrong_key", "The sync key does not open this data");
  }
}

/** This device's copy of the sync key, with the keyring it belongs to. */
export class Vault {
  private constructor(
    readonly app: string,
    private readonly key: Uint8Array,
    /** The keyring record exactly as synced. */
    readonly keyringJson: string,
  ) {}

  private static checkAad(app: string): Uint8Array {
    return utf8(`${app}-keyring`);
  }

  private static checkValue(app: string): Uint8Array {
    return utf8(`${app}-keyring-v1`);
  }

  private static build(
    app: string,
    key: Uint8Array,
    keyId: string,
    inboxSecret: Uint8Array,
  ): Vault {
    const keyring: Keyring = {
      version: 1,
      kdf: ACCOUNT_KDF,
      key_id: keyId,
      memory_kib: 0,
      passes: 0,
      lanes: 0,
      salt: "",
      check: sealBytes(key, Vault.checkValue(app), Vault.checkAad(app)),
      inbox_public_key: toBase64(x25519.getPublicKey(inboxSecret)),
      inbox_secret_key: sealBytes(key, inboxSecret, utf8(`${app}-inbox-key`)),
    };
    return new Vault(app, key, JSON.stringify(keyring));
  }

  /** A new keyring for the account key (the first device of this account and app). */
  static create(app: string, accountKey: string, keyId: string): Vault {
    return Vault.build(app, decodeKey(accountKey), keyId, x25519.utils.randomSecretKey());
  }

  /**
   * Opens an existing keyring with the account key. Throws `wrong_key` when the key does not open
   * the keyring's check value.
   */
  static restore(app: string, accountKey: string, keyringJson: string): Vault {
    const key = decodeKey(accountKey);
    const keyring = parseKeyring(keyringJson);
    const check = openBytes(key, keyring.check, Vault.checkAad(app));
    if (!bytesEqual(check, Vault.checkValue(app))) {
      throw new SyncCryptoError("wrong_key", "The sync key does not open this keyring");
    }
    const vault = new Vault(app, key, keyringJson);
    vault.inboxKeyPair(); // Rejects a keyring whose public key does not match its secret half.
    return vault;
  }

  /** The 32-byte key as base64. */
  exportKey(): string {
    return toBase64(this.key);
  }

  /** The account key id the keyring names, or null for a keyring that names none. */
  keyId(): string | null {
    return parseKeyring(this.keyringJson).key_id ?? null;
  }

  private recordAad(entityType: string, entityId: string): Uint8Array {
    return utf8(`${this.app}-${entityType}:${entityId}`);
  }

  /** Seals one record's JSON, bound to its type and id. */
  seal(entityType: string, entityId: string, json: string): string {
    return sealBytes(this.key, utf8(json), this.recordAad(entityType, entityId));
  }

  /** Opens a sealed record; throws SyncCryptoError for a wrong key or damaged data. */
  open(entityType: string, entityId: string, sealed: string): string {
    const bytes = openBytes(this.key, sealed, this.recordAad(entityType, entityId));
    const text = fromUtf8(bytes);
    if (text === null) throw new SyncCryptoError("damaged", "The synced data is damaged");
    return text;
  }

  /** The inbox key pair, or null for a keyring without one (made by Reach or Forage). */
  inboxKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } | null {
    const keyring = parseKeyring(this.keyringJson);
    if (!keyring.inbox_public_key || !keyring.inbox_secret_key) return null;
    const secretKey = openBytes(this.key, keyring.inbox_secret_key, utf8(`${this.app}-inbox-key`));
    const publicKey = fromBase64(keyring.inbox_public_key);
    if (!publicKey || !bytesEqual(x25519.getPublicKey(secretKey), publicKey)) {
      throw new SyncCryptoError("damaged", "The sync keyring's inbox key does not match");
    }
    return { publicKey, secretKey };
  }

  /** Opens a sealed box a keyless client addressed to this account's inbox key. */
  openInbox(sealedBox: string): Uint8Array {
    const pair = this.inboxKeyPair();
    if (!pair) throw new SyncCryptoError("damaged", "This keyring has no inbox key");
    return openSealedBox(sealedBox, pair.publicKey, pair.secretKey);
  }
}
