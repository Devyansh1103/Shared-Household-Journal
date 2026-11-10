import { describe, expect, it } from "vitest";
import { inviteStatus } from "./invite-status";

const now = new Date("2026-11-10T12:00:00Z");
const active = {
  expiresAt: "2026-11-17T12:00:00Z",
  maxUses: 10,
  useCount: 3,
  revokedAt: null,
};

describe("inviteStatus", () => {
  it("is active before expiry with uses left", () => {
    expect(inviteStatus(active, now)).toBe("active");
  });

  it("is expired at the expiry instant", () => {
    expect(
      inviteStatus({ ...active, expiresAt: "2026-11-10T12:00:00Z" }, now),
    ).toBe("expired");
  });

  it("is used up when every use is taken", () => {
    expect(inviteStatus({ ...active, useCount: 10 }, now)).toBe("used_up");
  });

  it("puts revoked before used up and expired", () => {
    expect(
      inviteStatus(
        {
          expiresAt: "2026-11-01T00:00:00Z",
          maxUses: 1,
          useCount: 1,
          revokedAt: "2026-11-02T00:00:00Z",
        },
        now,
      ),
    ).toBe("revoked");
  });
});
