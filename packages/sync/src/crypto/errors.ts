export type SyncCryptoErrorCode =
  /** The account key does not open this keyring or record. */
  | "wrong_key"
  /** A keyring or record that is not in the expected format, or fails to open. */
  | "damaged"
  /** A keyring made by a newer version of the format: the app needs an update to keep syncing. */
  | "newer_version"
  /** The account key could not be fetched (offline, or the auth service is unavailable). */
  | "key_unavailable";

/** A typed failure of the encryption layer; `code` is stable for UI decisions. */
export class SyncCryptoError extends Error {
  constructor(
    public readonly code: SyncCryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SyncCryptoError";
  }
}
