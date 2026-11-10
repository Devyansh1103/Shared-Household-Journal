import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createInviteToken,
  hashInviteToken,
  INVITE_TOKEN_PATTERN,
  invitePath,
} from "./invite-token";

describe("createInviteToken", () => {
  it("makes a 43-character base64url token from 32 random bytes", () => {
    const { token } = createInviteToken();
    expect(token).toMatch(INVITE_TOKEN_PATTERN);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("stores SHA-256 of the raw bytes as lowercase hex, never the token", () => {
    const { token, tokenHash } = createInviteToken();
    const expected = createHash("sha256")
      .update(Buffer.from(token, "base64url"))
      .digest("hex");
    expect(tokenHash).toBe(expected);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
  });

  it("gives a different token every time", () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => createInviteToken().token),
    );
    expect(tokens.size).toBe(100);
  });
});

describe("hashInviteToken", () => {
  it("matches the hash made at creation", () => {
    const { token, tokenHash } = createInviteToken();
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it("rejects anything that isn't a well-formed token", () => {
    for (const bad of [
      "",
      "short",
      "a".repeat(42),
      "a".repeat(44),
      `${"a".repeat(42)}=`,
      `${"a".repeat(42)}+`,
      `${"a".repeat(42)}/`,
    ]) {
      expect(hashInviteToken(bad)).toBeNull();
    }
  });
});

describe("invitePath", () => {
  it("is an in-app path", () => {
    expect(invitePath("abc")).toBe("/invite/abc");
  });
});
