import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPkcePair, decryptSecret, encryptSecret, safeEqual } from "@/lib/crypto";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
});

afterEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
});

describe("token encryption", () => {
  it("round-trips a token", () => {
    const token = "oauth-access-token-value";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("never stores the plaintext and uses a fresh nonce each time", () => {
    const token = "oauth-access-token-value";
    const first = encryptSecret(token);
    const second = encryptSecret(token);

    expect(first).not.toContain(token);
    expect(first).not.toBe(second);
    expect(first.startsWith("v1.")).toBe(true);
  });

  it("fails loudly when the key changed", () => {
    const payload = encryptSecret("secret");
    process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptSecret(payload)).toThrow(/could not decrypt|not in a readable format/i);
  });

  it("rejects a tampered ciphertext", () => {
    const payload = encryptSecret("secret");
    const parts = payload.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("requires a 32-byte hex key", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "tooshort";
    expect(() => encryptSecret("secret")).toThrow(/32 bytes of hex/);
  });
});

describe("pkce", () => {
  it("creates a verifier in the RFC 7636 length range and an S256 challenge", () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(codeChallenge).not.toBe(codeVerifier);
    expect(createPkcePair().codeVerifier).not.toBe(codeVerifier);
  });
});

describe("safeEqual", () => {
  it("compares without throwing on different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
