// Invite link tokens (D5 / ADR-009): 32 random bytes, sent as unpadded
// base64url. Only SHA-256 of the raw bytes is stored. The database computes the
// same hash on redemption (private.invite_token_hash).
//
// Uses node:crypto, so it can only run on the server.

import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/** 32 bytes as unpadded base64url is exactly 43 characters. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type NewInviteToken = { token: string; tokenHash: string };

export function createInviteToken(): NewInviteToken {
  const bytes = randomBytes(TOKEN_BYTES);
  return { token: bytes.toString("base64url"), tokenHash: sha256Hex(bytes) };
}

/** The stored hash for a raw token, or null if it isn't a well-formed token. */
export function hashInviteToken(token: string): string | null {
  if (!INVITE_TOKEN_PATTERN.test(token)) return null;
  return sha256Hex(Buffer.from(token, "base64url"));
}

export function invitePath(token: string): string {
  return `/invite/${token}`;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
