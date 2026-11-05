import { randomBytes } from "node:crypto";

/** ≥128-bit random, URL-safe share token (§9). 32 bytes → 43 chars base64url. */
export function newReleaseToken(): string {
  return randomBytes(32).toString("base64url");
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
