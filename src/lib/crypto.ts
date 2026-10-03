import crypto from "node:crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * AES-256-GCM for OAuth tokens at rest.
 *
 * Stored format: v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 * The version prefix is there so a future key rotation can decrypt old rows.
 */

const VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32;

function getKey(): Buffer {
  const raw = env.tokenEncryptionKey;
  if (!raw) {
    throw AppError.misconfigured(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length < KEY_BYTES * 2) {
    throw AppError.misconfigured(
      "TOKEN_ENCRYPTION_KEY must be at least 32 bytes of hex (64 hex characters).",
    );
  }
  // Longer keys are accepted; we use the first 32 bytes.
  return Buffer.from(raw.slice(0, KEY_BYTES * 2), "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new AppError("Stored token is not in a readable format. Reconnect the account.", {
      status: 500,
      code: "token_decrypt_failed",
    });
  }
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "Could not decrypt the stored token. TOKEN_ENCRYPTION_KEY probably changed - reconnect the account.",
      { status: 500, code: "token_decrypt_failed", cause: error },
    );
  }
}

export function encryptOptional(plaintext: string | null | undefined): string | null {
  return plaintext ? encryptSecret(plaintext) : null;
}

export function decryptOptional(payload: string | null | undefined): string | null {
  return payload ? decryptSecret(payload) : null;
}

/** URL-safe random identifier, used for OAuth state and public media ids. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** RFC 7636 PKCE pair for the X authorization code flow. */
export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomToken(48); // 64 chars, within the 43-128 range
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function sha256Hex(input: Buffer | string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Constant-time compare for the public media token. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
