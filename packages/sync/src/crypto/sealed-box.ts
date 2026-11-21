/**
 * libsodium-compatible sealed boxes (`crypto_box_seal`): anonymous public-key encryption.
 *
 * box = ephemeral_pk ‖ XSalsa20-Poly1305(key, nonce, message), where
 * key = HSalsa20(X25519(ephemeral_sk, recipient_pk), 0) and nonce = BLAKE2b-192(ephemeral_pk ‖
 * recipient_pk). Only the recipient's secret key opens it; the sender keeps nothing.
 */
import { hsalsa, secretbox } from "@noble/ciphers/salsa.js";
import { u32, u8 } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";

import { fromBase64, toBase64 } from "./encoding";
import { SyncCryptoError } from "./errors";

const PUBLIC_KEY_BYTES = 32;
const MAC_BYTES = 16;
// "expand 32-byte k" as little-endian words.
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

function boxKey(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(secretKey, publicKey);
  const out = new Uint32Array(8);
  hsalsa(SIGMA, u32(shared), new Uint32Array(4), out);
  return u8(out);
}

function boxNonce(ephemeralPublic: Uint8Array, recipientPublic: Uint8Array): Uint8Array {
  const input = new Uint8Array(PUBLIC_KEY_BYTES * 2);
  input.set(ephemeralPublic);
  input.set(recipientPublic, PUBLIC_KEY_BYTES);
  return blake2b(input, { dkLen: 24 });
}

/** Seals `message` to `recipientPublicKey`; returns base64. */
export function sealToPublicKey(message: Uint8Array, recipientPublicKey: Uint8Array): string {
  if (recipientPublicKey.length !== PUBLIC_KEY_BYTES) {
    throw new SyncCryptoError("damaged", "The inbox public key is not valid");
  }
  const ephemeralSecret = x25519.utils.randomSecretKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const sealed = secretbox(
    boxKey(ephemeralSecret, recipientPublicKey),
    boxNonce(ephemeralPublic, recipientPublicKey),
  ).seal(message);
  ephemeralSecret.fill(0);
  const out = new Uint8Array(PUBLIC_KEY_BYTES + sealed.length);
  out.set(ephemeralPublic);
  out.set(sealed, PUBLIC_KEY_BYTES);
  return toBase64(out);
}

/** Opens a base64 sealed box with the recipient's key pair. */
export function openSealedBox(
  sealedBase64: string,
  recipientPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array {
  const bytes = fromBase64(sealedBase64);
  if (!bytes || bytes.length < PUBLIC_KEY_BYTES + MAC_BYTES) {
    throw new SyncCryptoError("damaged", "The inbox record is damaged");
  }
  const ephemeralPublic = bytes.subarray(0, PUBLIC_KEY_BYTES);
  try {
    return secretbox(
      boxKey(recipientSecretKey, ephemeralPublic),
      boxNonce(ephemeralPublic, recipientPublicKey),
    ).open(bytes.subarray(PUBLIC_KEY_BYTES));
  } catch {
    throw new SyncCryptoError("damaged", "The inbox record could not be opened");
  }
}
